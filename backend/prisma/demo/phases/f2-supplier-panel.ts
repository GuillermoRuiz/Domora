import type { DemoCtx } from '../context';
import { PersonFactory } from '../lib/names';
import { SuppliersService } from '../../../src/suppliers/suppliers.service';
import { SupplierVisitsService } from '../../../src/suppliers/supplier-visits.service';

/**
 * F2c — lo que necesita el panel de Proveedores de cada finca: persona de
 * contacto, un contrato por proveedor (vigente, por vencer o vencido), visitas
 * pasadas y futuras, y las incidencias abiertas de cada instalación asignadas
 * a su proveedor. Va DESPUÉS de F2b para reutilizar proveedores e instalaciones.
 *
 * Servicios REALES: `SuppliersService.updateSupplier` (contacto) y
 * `createSupplierContract`, `SupplierVisitsService.create/complete`. RAW, con
 * su motivo:
 *  - fecha de realización y de alta de las visitas: el servicio usa
 *    `new Date()` al cerrarlas y al crearlas;
 *  - la asignación de proveedor a las incidencias: `IssuesModule` arrastra
 *    `AiCoreModule` y el seed no debe levantarlo (igual que F2b).
 */

/** Lo que el seed deja por finca para el panel de Proveedores; la fase aborta si no cuadra. */
export const SUPPLIER_PANEL_FIGURES = {
  /** Un contrato por proveedor. */
  contracts: { val: 10, mad: 5, valb: 4 },
  plannedVisits: { val: 7, mad: 4, valb: 3 },
  doneVisits: { val: 20, mad: 10, valb: 8 },
  /** Incidencias de una instalación con proveedor, asignadas a ese proveedor. */
  assignedIssues: { val: 3, mad: 0, valb: 0 },
} as const;

/** Motivo de visita por categoría; el resto usa uno genérico. */
const VISIT_PURPOSES: Record<string, readonly [string, string]> = {
  Ascensores: ['Revisión mensual del ascensor', 'Inspección periódica'],
  Fontanería: ['Revisión de bajantes', 'Reparación de fuga en sótano'],
  Limpieza: ['Limpieza a fondo de zonas comunes', 'Revisión del servicio'],
  Jardinería: ['Poda y mantenimiento de jardín', 'Revisión del riego'],
  Seguros: ['Revisión de pólizas', 'Peritación de siniestro'],
};
const GENERIC_PURPOSES = ['Visita de mantenimiento', 'Revisión de la instalación'] as const;

/** Cómo termina el contrato de cada proveedor, por posición: así el panel muestra todos los estados. */
const CONTRACT_PATTERN: readonly { endInDays: number; renewalType: 'manual' | 'tacita' }[] = [
  { endInDays: 210, renewalType: 'manual' }, // vigente
  { endInDays: 12, renewalType: 'manual' }, // por vencer
  { endInDays: 340, renewalType: 'tacita' }, // vigente, renovación tácita
  { endInDays: -25, renewalType: 'manual' }, // vencido
];

export async function runF2SupplierPanel(ctx: DemoCtx): Promise<void> {
  const suppliers = ctx.app.get(SuppliersService, { strict: false });
  const visits = ctx.app.get(SupplierVisitsService, { strict: false });
  const gestora = ctx.actors.gestora;
  const { prisma, clock } = ctx;
  const people = new PersonFactory(ctx.rng);
  const at = (days: number, hour: number) => new Date(clock.d(days).getTime() + hour * 3_600_000);
  const isoDay = (days: number) => clock.d(days).toISOString().slice(0, 10);

  for (const estate of ctx.estates) {
    const rows = await prisma.supplier.findMany({
      where: { estateId: estate.id, status: 'Activo' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, category: true },
    });

    for (const [index, supplier] of rows.entries()) {
      await suppliers.updateSupplier(estate.id, supplier.id, { contactName: people.next().fullName }, gestora);

      const pattern = CONTRACT_PATTERN[index % CONTRACT_PATTERN.length] as (typeof CONTRACT_PATTERN)[number];
      await suppliers.createSupplierContract(
        estate.id,
        supplier.id,
        {
          serviceType: supplier.category,
          startDate: isoDay(pattern.endInDays - 365),
          endDate: isoDay(pattern.endInDays),
          renewalType: pattern.renewalType,
        },
        gestora,
      );

      const [first, second] = VISIT_PURPOSES[supplier.category] ?? GENERIC_PURPOSES;
      const asset = await prisma.asset.findFirst({ where: { estateId: estate.id, supplierId: supplier.id }, orderBy: { name: 'asc' }, select: { id: true } });

      // Dos visitas ya hechas, a distinta distancia según la posición del proveedor.
      for (const [n, purpose] of [first, second].entries()) {
        const when = at(-(9 + index * 7 + n * 41), 10);
        const created = await visits.create(estate.id, supplier.id, { scheduledAt: when.toISOString(), purpose, assetId: n === 0 ? asset?.id : undefined }, gestora);
        await visits.complete(estate.id, supplier.id, created.id, { notes: 'Servicio realizado sin incidencias.' }, gestora);
        await prisma.supplierVisit.update({
          where: { id: created.id },
          data: { completedAt: new Date(when.getTime() + 2 * 3_600_000), createdAt: new Date(when.getTime() - 7 * 86_400_000) },
        });
      }

      // Una visita próxima para dos de cada tres proveedores (el tercero queda «sin visita»).
      if (index % 3 !== 2) {
        const created = await visits.create(
          estate.id,
          supplier.id,
          { scheduledAt: at(4 + index * 6, 9).toISOString(), purpose: first, assetId: asset?.id },
          gestora,
        );
        await prisma.supplierVisit.update({ where: { id: created.id }, data: { createdAt: clock.d(-2) } });
      }
    }

    // Las incidencias abiertas de una instalación con proveedor responsable se le asignan.
    const linked = await prisma.issue.findMany({
      where: { asset: { estateId: estate.id, supplierId: { not: null } }, deletedAt: null },
      select: { id: true, date: true, asset: { select: { supplier: { select: { id: true, name: true, category: true, phone: true } } } } },
    });
    for (const issue of linked) {
      const supplier = issue.asset?.supplier;
      if (!supplier) continue;
      await prisma.issueProviderAssignment.create({
        data: {
          issueId: issue.id,
          supplierId: supplier.id,
          providerNameSnapshot: supplier.name,
          categorySnapshot: supplier.category,
          phoneSnapshot: supplier.phone,
          assignedAt: issue.date,
          assignedByUserId: gestora.id,
        },
      });
    }
  }
  await assertSupplierPanelFigures(ctx);
}

/** Aborta el seed si el panel de Proveedores no cuadra con `SUPPLIER_PANEL_FIGURES`. */
async function assertSupplierPanelFigures(ctx: DemoCtx): Promise<void> {
  const { prisma } = ctx;
  for (const estate of ctx.estates) {
    const where = { estateId: estate.id };
    const actual = {
      contracts: await prisma.supplierContract.count({ where }),
      plannedVisits: await prisma.supplierVisit.count({ where: { ...where, status: 'planificada' } }),
      doneVisits: await prisma.supplierVisit.count({ where: { ...where, status: 'realizada' } }),
      assignedIssues: await prisma.issueProviderAssignment.count({ where: { supplier: where } }),
    };
    for (const key of Object.keys(actual) as (keyof typeof actual)[]) {
      const expected = SUPPLIER_PANEL_FIGURES[key][estate.key];
      if (actual[key] !== expected) {
        throw new Error(`F2c: ${estate.name} · ${key}: esperado ${expected}, hay ${actual[key]}.`);
      }
    }
    const withoutContact = await prisma.supplier.count({ where: { ...where, status: 'Activo', contactName: null } });
    if (withoutContact > 0) throw new Error(`F2c: ${estate.name} tiene ${withoutContact} proveedores sin persona de contacto.`);
  }
}
