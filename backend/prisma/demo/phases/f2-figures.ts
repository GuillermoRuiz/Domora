import type { DemoCtx } from '../context';
import { ESTATE_SPECS } from '../data/estates';

/**
 * Cifras que F2 SIEMBRA (contadas en la BD, no en el código que siembra).
 * A diferencia de F1, varias cifras NO son un número fijo: cuántos recibos
 * caen en cada remesa depende de cuántas unidades tienen mandato SEPA activo
 * (F1 deja ~12 % de titulares sin domiciliar, al azar) — eso es
 * intencional (así se ve una morosidad real, no solo la narrativa), así que
 * aquí solo se fijan las cifras que el propio código de F2 controla por
 * construcción (periodos, remesas emitidas, proveedores, facturas) más los
 * invariantes de deuda real del caso moroso.
 */
export const F2_FIGURES = {
  /** Meses de historial (`ACCOUNTING_MONTHS` = 6) + el mes en curso. */
  periodsPerEstate: 7,
  /** Un periodo vencido (n=6..1) por finca con SEPA; el mes en curso (n=0) no genera remesa. */
  remesasPerSepaEstate: 6,
  suppliersPerEstate: 3,
  supplierInvoicesPerEstate: 8,
  supplierInvoicesPaidPerEstate: 7,
  supplierInvoicesPendingPerEstate: 1,
  /** Los dos meses más recientes ya cobrados de Colón 24 se devuelven. */
  morosoReceiptsReturned: 2,
} as const;

/**
 * Comprobación de salida de F2: si una cifra no coincide el seed ABORTA
 * nombrando la cifra, en lugar de dejar una demo a medias.
 */
export async function assertF2Figures(ctx: DemoCtx): Promise<void> {
  const { prisma } = ctx;
  const problems: string[] = [];
  const expect = (what: string, actual: number, expected: number) => {
    if (actual !== expected) {
      problems.push(`${what}: ${actual} (esperado ${expected})`);
    }
  };

  for (const estate of ctx.estates) {
    const spec = ESTATE_SPECS.find((e) => e.key === estate.key);
    if (!spec) {
      problems.push(`finca ${estate.key}: sin spec`);
      continue;
    }

    expect(
      `periodos contables de ${estate.key}`,
      await prisma.accountingPeriod.count({ where: { estateId: estate.id } }),
      F2_FIGURES.periodsPerEstate,
    );

    const unitsWithQuota = await prisma.property.count({
      where: { estateId: estate.id, deletedAt: null, quotaMonthly: { gt: 0 } },
    });
    expect(
      `recibos de ${estate.key}`,
      await prisma.accountingReceipt.count({ where: { estateId: estate.id } }),
      unitsWithQuota * F2_FIGURES.periodsPerEstate,
    );

    expect(
      `proveedores de ${estate.key}`,
      await prisma.supplier.count({ where: { estateId: estate.id } }),
      F2_FIGURES.suppliersPerEstate,
    );
    expect(
      `facturas de proveedor de ${estate.key}`,
      await prisma.supplierInvoice.count({ where: { estateId: estate.id } }),
      F2_FIGURES.supplierInvoicesPerEstate,
    );
    expect(
      `facturas pagadas de ${estate.key}`,
      await prisma.supplierInvoice.count({ where: { estateId: estate.id, status: 'Pagada' } }),
      F2_FIGURES.supplierInvoicesPaidPerEstate,
    );
    expect(
      `facturas pendientes de ${estate.key}`,
      await prisma.supplierInvoice.count({ where: { estateId: estate.id, status: 'Registrada' } }),
      F2_FIGURES.supplierInvoicesPendingPerEstate,
    );

    expect(
      `remesas de ${estate.key}`,
      await prisma.remesaHistoryItem.count({ where: { estateId: estate.id } }),
      spec.usesSepa ? F2_FIGURES.remesasPerSepaEstate : 0,
    );
  }

  const morosoPropertyId = ctx.named.moroso?.propertyIds[0];
  if (!morosoPropertyId) {
    problems.push('moroso: no se encontró su propiedad en el contexto (¿corrió F1?).');
  } else {
    expect(
      'recibos devueltos del moroso',
      await prisma.accountingReceipt.count({
        where: { propertyId: morosoPropertyId, status: 'Devuelto' },
      }),
      F2_FIGURES.morosoReceiptsReturned,
    );
    expect(
      'líneas de remesa devueltas del moroso',
      await prisma.remesaLine.count({
        where: { propertyId: morosoPropertyId, status: 'Devuelto' },
      }),
      F2_FIGURES.morosoReceiptsReturned,
    );

    const outstanding = await prisma.accountingReceipt.aggregate({
      where: { propertyId: morosoPropertyId },
      _sum: { outstanding: true },
    });
    const totalOutstanding = Number(outstanding._sum.outstanding ?? 0);
    if (!(totalOutstanding > 0)) {
      problems.push(
        `deuda pendiente real del moroso: ${totalOutstanding.toFixed(2)} € (esperado > 0 — si es 0 el caso moroso no se ve)`,
      );
    }
  }

  if (problems.length > 0) {
    throw new Error(`F2: cifras sembradas incorrectas:\n - ${problems.join('\n - ')}`);
  }
}
