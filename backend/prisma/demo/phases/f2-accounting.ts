import type { DemoCtx, DemoEstateRef } from '../context';
import { ESTATE_SPECS } from '../data/estates';
import { makeCif } from '../lib/nif';
import { pick, randInt, type Rng } from '../lib/rng';
import { assertF2Figures } from './f2-figures';
import { resolveF2Services, type F2Services } from './f2-services';

/**
 * F2 — contabilidad, SEPA y proveedores. Historial de `ACCOUNTING_MONTHS`
 * meses (no los `ageMonths` completos de cada finca: con 3 fincas sería
 * cientos de recibos y decenas de remesas — más lento de sembrar sin aportar
 * más realismo del que ya aporta medio año de recibos/cobros/facturas). Todo
 * vía servicios REALES: `AccountingService.generateReceipts` (cuotas),
 * `RemesasService` (domiciliación), `AccountingService.updateReceipt`
 * (cobro manual y devoluciones — funciona igual venga el cobro de una
 * remesa o de un cobro suelto), `SuppliersService`/`SupplierInvoicesService`
 * (proveedores y sus facturas).
 */
const ACCOUNTING_MONTHS = 6;

function periodKeyFor(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function runF2Accounting(ctx: DemoCtx): Promise<void> {
  const svc = resolveF2Services(ctx.app);
  for (const estate of ctx.estates) {
    await backdateCutover(ctx, estate);
  }
  await seedReceiptsAndCollections(ctx, svc);
  await seedSuppliersAndInvoices(ctx, svc);
  await assertF2Figures(ctx);
}

/**
 * `EstatesService.create` (F1) ya arrancó la contabilidad de cada finca con
 * `bootstrapEstateLedger`, pero con `cutoverDate` = hoy (su valor por
 * defecto). Sin retrasarla, `ReceiptPostingService.issue` fecharía TODOS los
 * recibos de meses pasados al día de corte (clamp), perdiendo el historial.
 * RAW: `ensureAccountingSettings` es `ON CONFLICT DO NOTHING`, así que no hay
 * servicio que permita cambiar la fecha de corte ya creada.
 */
async function backdateCutover(ctx: DemoCtx, estate: DemoEstateRef): Promise<void> {
  await ctx.prisma.accountingSettings.update({
    where: { estateId: estate.id },
    data: { cutoverDate: ctx.clock.monthStart(ACCOUNTING_MONTHS) },
  });
}

async function seedReceiptsAndCollections(ctx: DemoCtx, svc: F2Services): Promise<void> {
  const { clock, prisma } = ctx;
  const gestora = ctx.actors.gestora;
  const morosoPropertyId = ctx.named.moroso?.propertyIds[0];
  if (!morosoPropertyId) {
    throw new Error('F2: no se encontró la propiedad del propietario "moroso" (¿corrió F1?).');
  }

  for (const estate of ctx.estates) {
    const spec = ESTATE_SPECS.find((e) => e.key === estate.key);
    if (!spec) throw new Error(`F2: finca ${estate.key} sin spec.`);

    for (let n = ACCOUNTING_MONTHS; n >= 0; n--) {
      const periodDate = clock.monthStart(n);
      const periodKey = periodKeyFor(periodDate);
      const result = await svc.accounting.generateReceipts(estate.id, { periodKey }, gestora);

      // RAW: generateReceipts fecha el periodo y cada recibo con `new Date()`
      // (hoy real); el asiento de emisión (accrualDate) sí queda bien
      // fechado al mes del periodo — esto solo corrige los campos de
      // exhibición para que el historial se vea coherente.
      await prisma.accountingPeriod.update({
        where: { id: result.period.id },
        data: { issuedAt: periodDate },
      });
      await prisma.accountingReceipt.updateMany({
        where: { periodId: result.period.id },
        data: { date: periodDate },
      });

      // El mes en curso queda pendiente para todos — todavía no vence.
      if (n === 0) continue;

      const receipts = await prisma.accountingReceipt.findMany({
        where: { periodId: result.period.id, status: 'Pendiente' },
        select: { id: true, propertyId: true },
      });
      if (receipts.length === 0) continue;

      const chargeDate = new Date(Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth(), 10));
      if (spec.usesSepa) {
        const remesa = await svc.remesas.create(
          estate.id,
          {
            periodKey,
            chargeDate: chargeDate.toISOString().slice(0, 10),
            scheme: 'CORE',
            concept: `Cuota ordinaria ${periodKey}`,
          },
          gestora,
        );
        await svc.remesas.collect(remesa.id, { date: chargeDate.toISOString().slice(0, 10) }, gestora);
      } else {
        // Cuba 18 cobra por transferencia (sin mandatos, F1 no los creó para
        // esta finca): un cobro manual por recibo vía el mismo servicio que
        // usa la gestora desde la pantalla de recibos.
        for (const r of receipts) {
          await svc.accounting.updateReceipt(r.id, { status: 'Pagada', method: 'Transferencia' }, gestora);
        }
      }

      // Caso moroso: en Colón 24, los dos meses ya cobrados más recientes
      // (n=1, n=2) se devuelven — el banco los rechazó. La unidad cobra por
      // remesa, así que la devolución correcta es `DebtorsService
      // .returnRemesaLine` (la misma pantalla que usaría la gestora):
      // además de reabrir el recibo con deuda real, deja la línea de la
      // remesa en `Devuelto` y la remesa en `ConDevoluciones` — si se
      // devolviera a través de `updateReceipt` el recibo quedaría bien pero
      // el detalle de la remesa seguiría mostrando "Cobrada" sin devolución.
      if (estate.key === 'val' && (n === 1 || n === 2)) {
        const morosoReceipt = receipts.find((r) => r.propertyId === morosoPropertyId);
        if (morosoReceipt) {
          const line = await prisma.remesaLine.findFirst({
            where: { receiptId: morosoReceipt.id },
            select: { id: true },
          });
          if (!line) {
            throw new Error(`F2: recibo moroso ${morosoReceipt.id} sin línea de remesa.`);
          }
          const returnDate = new Date(chargeDate.getTime() + randInt(ctx.rng, 2, 5) * 86_400_000);
          await svc.debtors.returnRemesaLine(
            line.id,
            {
              returnCode: 'MD01',
              returnReason: 'Mandato no válido o no existe',
              date: returnDate.toISOString().slice(0, 10),
            },
            gestora,
          );
        }
      }
    }
  }
}

interface SupplierTemplate {
  category: string;
  name: string;
  /** Cuenta de gasto (grupo 6) a la que se imputan sus facturas. */
  accountCode: string;
  phone: string;
  baseAmountRange: readonly [number, number];
}

const SUPPLIER_TEMPLATES: readonly SupplierTemplate[] = [
  {
    category: 'Fontanería',
    name: 'Fontanería Hermanos Ruiz S.L.',
    accountCode: '622',
    phone: '96 352 14 08',
    baseAmountRange: [60, 420],
  },
  {
    category: 'Limpieza',
    name: 'Limpiezas Costa Azul S.L.',
    accountCode: '622',
    phone: '96 318 27 45',
    baseAmountRange: [180, 320],
  },
  {
    category: 'Ascensores',
    name: 'Ascensores Levante Mantenimiento S.L.',
    accountCode: '622',
    phone: '96 341 09 77',
    baseAmountRange: [95, 180],
  },
  {
    category: 'Jardinería',
    name: 'Jardinería Mediterráneo S.L.',
    accountCode: '622',
    phone: '96 384 09 12',
    baseAmountRange: [70, 150],
  },
  {
    category: 'Seguros',
    name: 'Correduría Credimar Seguros S.L.',
    accountCode: '625',
    phone: '96 329 55 61',
    baseAmountRange: [340, 820],
  },
];

/** Tres proveedores por finca: siempre el de seguros + dos de mantenimiento, sin repetir entre fincas. */
function suppliersFor(rng: Rng, estateKey: string): SupplierTemplate[] {
  const insurance = SUPPLIER_TEMPLATES.find((t) => t.category === 'Seguros') as SupplierTemplate;
  const maintenance = SUPPLIER_TEMPLATES.filter((t) => t.category !== 'Seguros');
  const offset = estateKey === 'val' ? 0 : estateKey === 'mad' ? 1 : 2;
  const chosen = [
    maintenance[offset % maintenance.length],
    maintenance[(offset + 1) % maintenance.length],
  ] as SupplierTemplate[];
  void rng;
  return [insurance, ...chosen];
}

async function seedSuppliersAndInvoices(ctx: DemoCtx, svc: F2Services): Promise<void> {
  const { clock, rng, prisma } = ctx;
  const gestora = ctx.actors.gestora;

  for (const estate of ctx.estates) {
    const templates = suppliersFor(rng, estate.key);
    for (const [idx, tpl] of templates.entries()) {
      const supplier = await svc.suppliers.createSupplier(
        estate.id,
        {
          name: tpl.name,
          category: tpl.category,
          taxIdCountry: 'ES',
          taxId: makeCif(rng, 'B'),
          phone: tpl.phone,
        },
        gestora,
      );
      // RAW: ningún campo de CreateSupplierDto fija la fecha de alta; el
      // servicio usa `new Date()`.
      await prisma.supplier.update({
        where: { id: supplier.id },
        data: { createdAt: clock.monthStart(ACCOUNTING_MONTHS) },
      });

      const account = await prisma.chartAccount.findFirst({
        where: { estateId: estate.id, code: tpl.accountCode },
        select: { id: true },
      });
      if (!account) {
        throw new Error(`F2: ${estate.name} sin cuenta ${tpl.accountCode} en su plan.`);
      }

      // Una factura cada 2 meses del ejercicio, alternadas entre proveedores
      // para que no las tres caigan el mismo mes.
      for (let n = ACCOUNTING_MONTHS - idx; n >= 1; n -= 2) {
        const issueDate = new Date(
          Date.UTC(clock.monthStart(n).getUTCFullYear(), clock.monthStart(n).getUTCMonth(), randInt(rng, 3, 24)),
        );
        const base = randInt(rng, tpl.baseAmountRange[0] * 100, tpl.baseAmountRange[1] * 100) / 100;
        const invoice = await svc.supplierInvoices.create(
          estate.id,
          supplier.id,
          {
            number: `${issueDate.getUTCFullYear()}-${String(randInt(rng, 100, 999))}`,
            concept: `${tpl.category} · ${periodKeyFor(issueDate)}`,
            issueDate: issueDate.toISOString().slice(0, 10),
            vatRatePct: 21,
            withholdingRatePct: 0,
            lines: [{ accountId: account.id, baseAmount: base }],
          },
          gestora,
        );
        // La mayoría ya está pagada; la más reciente de cada proveedor queda pendiente.
        if (n > 1) {
          const payDate = new Date(issueDate.getTime() + randInt(rng, 3, 15) * 86_400_000);
          await svc.supplierInvoices.pay(
            estate.id,
            {
              supplierId: supplier.id,
              date: payDate.toISOString().slice(0, 10),
              amount: invoice.total,
              method: 'Transferencia',
              invoiceIds: [invoice.id],
            },
            gestora,
          );
        }
      }
    }
  }
  void pick; // reservado para variar nombres si se amplía el catálogo de proveedores.
}
