import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { toCents, type Cents } from '../money';
import {
  deadline111,
  proratedShare,
  quarterRange,
  summarize111,
  summarize190,
  summarize347,
  type Operation347,
  type Quarter,
  type WithholdingEvent,
} from './tax.rules';

const euros = (c: Cents) => c / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function yearRange(year: number) {
  return {
    from: new Date(Date.UTC(year, 0, 1)),
    to: new Date(Date.UTC(year, 11, 31)),
  };
}

/**
 * Datos de los modelos 111, 190 y 347 a partir de la contabilidad (fase 7b).
 *
 * Las retenciones cuentan en la fecha de PAGO (doc/compliance/fiscal-
 * comunidades.md): las de proveedores, por lo que cada pago salda de la
 * factura (prorrateado si es parcial); las de nóminas, cuando la nómina se
 * paga. Lo que no se ha pagado todavía no entra.
 */
@Injectable()
export class TaxReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  async model111(
    estateId: string,
    year: number,
    quarter: Quarter,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const { from, to } = quarterRange(year, quarter);
    const events = await this.withholdingEvents(estateId, from, to);
    const summary = summarize111(events);
    const period = `${year}-T${quarter}`;
    const settlements = await this.prisma.taxSettlement.findMany({
      where: { estateId, kind: 'modelo111', period, undoneAt: null },
      orderBy: { date: 'asc' },
      select: { id: true, date: true, amount: true, reference: true },
    });
    const settled = settlements.reduce((s, x) => s + toCents(x.amount), 0);
    return {
      estate: await this.estateHeader(estateId),
      year,
      quarter,
      period,
      from: iso(from),
      to: iso(to),
      deadline: iso(deadline111(year, quarter)),
      boxes: {
        '01': summary.work.recipients,
        '02': euros(summary.work.perceptions),
        '03': euros(summary.work.withholdings),
        '07': summary.activities.recipients,
        '08': euros(summary.activities.perceptions),
        '09': euros(summary.activities.withholdings),
        '28': euros(summary.total),
      },
      unclassified: {
        recipients: summary.unclassified.recipients,
        perceptions: euros(summary.unclassified.perceptions),
        withholdings: euros(summary.unclassified.withholdings),
      },
      settlements: settlements.map((s) => ({
        ...s,
        date: iso(s.date),
        amount: Number(s.amount),
      })),
      settled: euros(settled),
      pending: euros(summary.total - settled),
      detail: events.map((e) => ({
        date: iso(e.date),
        key: e.key,
        nif: e.nif,
        name: e.name,
        documentRef: e.documentRef,
        source: e.source,
        perception: euros(e.perception),
        withholding: euros(e.withholding),
      })),
    };
  }

  async model190(estateId: string, year: number, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const { from, to } = yearRange(year);
    const rows = summarize190(await this.withholdingEvents(estateId, from, to));
    return {
      estate: await this.estateHeader(estateId),
      year,
      rows: rows.map((r) => ({
        ...r,
        perceptions: euros(r.perceptions),
        withholdings: euros(r.withholdings),
      })),
      totals: {
        recipients: rows.length,
        perceptions: euros(rows.reduce((s, r) => s + r.perceptions, 0)),
        withholdings: euros(rows.reduce((s, r) => s + r.withholdings, 0)),
      },
      missingNif: rows.filter((r) => !r.nif).map((r) => r.name),
    };
  }

  /**
   * 347: facturas recibidas no anuladas, por fecha de la factura. Los
   * ingresos de terceros (D12) se añadirán cuando la tesorería permita
   * registrarlos con su tercero (fase 8).
   */
  async model347(estateId: string, year: number, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const { from, to } = yearRange(year);
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: {
        estateId,
        status: { not: 'Anulada' },
        issueDate: { gte: from, lte: to },
      },
      select: {
        issueDate: true,
        total: true,
        withholdingAmount: true,
        supplier: {
          select: { id: true, name: true, taxId: true, excludedFrom347: true },
        },
      },
    });
    const operations: Operation347[] = invoices.map((i) => ({
      thirdPartyId: i.supplier.id,
      name: i.supplier.name,
      nif: i.supplier.taxId,
      date: i.issueDate,
      amount: toCents(i.total),
      excludedThirdParty: i.supplier.excludedFrom347,
      withheld: toCents(i.withholdingAmount) > 0,
    }));
    const summary = summarize347(operations);
    return {
      estate: await this.estateHeader(estateId),
      year,
      purchases: summary.declared.map((r) => ({
        supplierId: r.thirdPartyId,
        name: r.name,
        nif: r.nif,
        total: euros(r.total),
        quarters: r.quarters.map(euros),
      })),
      excluded: summary.excluded.map((e) => ({
        supplierId: e.thirdPartyId,
        name: e.name,
        total: euros(e.total),
        reason: e.reason,
      })),
      income: [] as {
        name: string;
        nif: string | null;
        total: number;
        quarters: number[];
      }[],
      missingNif: summary.declared.filter((r) => !r.nif).map((r) => r.name),
    };
  }

  // ── Internos ────────────────────────────────────────────────────────────

  /** Retenciones pagadas entre dos fechas: pagos a proveedores con retención y nóminas pagadas. */
  async withholdingEvents(
    estateId: string,
    from: Date,
    to: Date,
  ): Promise<WithholdingEvent[]> {
    const events: WithholdingEvent[] = [];

    // Facturas con retención que tienen algún pago en el periodo.
    const invoiceIds = await this.prisma.journalLine.findMany({
      where: {
        estateId,
        debit: { gt: 0 },
        date: { gte: from, lte: to },
        supplierInvoice: { withholdingAmount: { gt: 0 } },
        entry: {
          sourceType: 'supplier_payment',
          supplierPayment: { undoneAt: null },
        },
      },
      distinct: ['supplierInvoiceId'],
      select: { supplierInvoiceId: true },
    });
    if (invoiceIds.length > 0) {
      const invoices = await this.prisma.supplierInvoice.findMany({
        where: { id: { in: invoiceIds.map((l) => l.supplierInvoiceId!) } },
        select: {
          id: true,
          number: true,
          baseAmount: true,
          withholdingAmount: true,
          withholdingKey: true,
          payable: true,
          supplier: { select: { id: true, name: true, taxId: true } },
        },
      });
      const allPayments = await this.prisma.journalLine.findMany({
        where: {
          supplierInvoiceId: { in: invoices.map((i) => i.id) },
          debit: { gt: 0 },
          entry: {
            sourceType: 'supplier_payment',
            supplierPayment: { undoneAt: null },
          },
        },
        orderBy: [
          { date: 'asc' },
          { entry: { number: 'asc' } },
          { lineNo: 'asc' },
        ],
        select: { supplierInvoiceId: true, debit: true, date: true },
      });
      for (const inv of invoices) {
        let paid = 0;
        const payable = toCents(inv.payable);
        for (const p of allPayments.filter(
          (x) => x.supplierInvoiceId === inv.id,
        )) {
          const amount = toCents(p.debit);
          const withholding = proratedShare(
            toCents(inv.withholdingAmount),
            payable,
            paid,
            paid + amount,
          );
          const perception = proratedShare(
            toCents(inv.baseAmount),
            payable,
            paid,
            paid + amount,
          );
          paid += amount;
          if (p.date < from || p.date > to) continue;
          events.push({
            date: p.date,
            key:
              inv.withholdingKey === 'A_trabajo'
                ? 'A'
                : inv.withholdingKey === 'other'
                  ? 'other'
                  : 'G',
            recipientKey:
              inv.supplier.taxId?.toUpperCase() ??
              `proveedor:${inv.supplier.id}`,
            nif: inv.supplier.taxId,
            name: inv.supplier.name,
            perception,
            withholding,
            source: 'supplier_payment',
            documentRef: `Factura ${inv.number}`,
          });
        }
      }
    }

    const payrolls = await this.prisma.payrollRecord.findMany({
      where: { estateId, status: 'Pagada', paidDate: { gte: from, lte: to } },
      select: {
        period: true,
        kind: true,
        paidDate: true,
        grossSalary: true,
        irpfWithholding: true,
        staffMember: { select: { id: true, fullName: true, nationalId: true } },
      },
    });
    for (const p of payrolls) {
      events.push({
        date: p.paidDate!,
        key: 'A',
        recipientKey:
          p.staffMember.nationalId?.toUpperCase() ??
          `empleado:${p.staffMember.id}`,
        nif: p.staffMember.nationalId,
        name: p.staffMember.fullName,
        perception: toCents(p.grossSalary),
        withholding: toCents(p.irpfWithholding),
        source: 'payroll',
        documentRef: `Nómina ${p.kind === 'mensual' ? '' : `${p.kind} `}${p.period}`,
      });
    }
    return events.sort(
      (a, b) =>
        a.date.getTime() - b.date.getTime() ||
        a.name.localeCompare(b.name, 'es'),
    );
  }

  private async estateHeader(estateId: string) {
    const estate = await this.prisma.estate.findUniqueOrThrow({
      where: { id: estateId },
      select: { name: true, cif: true, address: true, location: true },
    });
    return estate;
  }
}
