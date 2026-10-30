import type { DemoCtx, DemoEstateRef } from '../context';
import { INSTALLATION_FIGURES, INSTALLATION_SUPPLIERS, INSTALLATIONS } from '../data/installations';
import { AssetsService } from '../../../src/inspections/assets.service';
import { InspectionsService } from '../../../src/inspections/inspections.service';
import { SuppliersService } from '../../../src/suppliers/suppliers.service';
import { makeCif } from '../lib/nif';

/**
 * F2b — instalaciones (elementos comunes) de cada finca: activos con su
 * proveedor responsable, su historial de revisiones y las incidencias
 * abiertas que las afectan. Va DESPUÉS de F2 para reutilizar los proveedores
 * que ya sembró.
 *
 * Servicios REALES: `AssetsService.createAsset` (activos),
 * `InspectionsService.create` (la revisión pendiente de cada ciclo) y
 * `SuppliersService.createSupplier` (solo si la finca aún no tiene proveedor
 * de esa categoría). RAW, con su motivo:
 *  - la revisión YA REALIZADA de cada ciclo: ningún servicio crea una
 *    inspección en estado `realizada` con su fecha de última revisión (eso
 *    nace al registrar un resultado, que exige certificado);
 *  - pasar a `vencida` las que ya pasaron: lo hace un cron, que el seed no
 *    arranca;
 *  - las incidencias: `IssuesModule` arrastra `AiCoreModule` (clasificación
 *    IA) y el seed no debe levantarlo; la fase de incidencias las sembrará
 *    con el servicio real.
 */
export async function runF2Installations(ctx: DemoCtx): Promise<void> {
  const assets = ctx.app.get(AssetsService, { strict: false });
  const inspections = ctx.app.get(InspectionsService, { strict: false });
  const suppliers = ctx.app.get(SuppliersService, { strict: false });
  const gestora = ctx.actors.gestora;
  const { prisma, clock, rng } = ctx;
  const yearsAgo = clock.monthStart(6);
  let issueSeq = 0;

  for (const estate of ctx.estates) {
    const specs = INSTALLATIONS[estate.key];
    const supplierByCategory = new Map<string, string>();

    const supplierFor = async (category: string): Promise<string> => {
      const cached = supplierByCategory.get(category);
      if (cached) return cached;
      const existing = await prisma.supplier.findFirst({ where: { estateId: estate.id, category }, select: { id: true } });
      let id = existing?.id;
      if (!id) {
        const template = INSTALLATION_SUPPLIERS[category];
        if (!template) throw new Error(`F2b: sin plantilla de proveedor para la categoría "${category}".`);
        const created = await suppliers.createSupplier(
          estate.id,
          { name: template.name, category, taxIdCountry: 'ES', taxId: makeCif(rng, 'B'), phone: template.phone },
          gestora,
        );
        // RAW: el servicio usa `new Date()` como fecha de alta (igual que en F2).
        await prisma.supplier.update({ where: { id: created.id }, data: { createdAt: yearsAgo } });
        id = created.id;
      }
      supplierByCategory.set(category, id);
      return id;
    };

    for (const [index, spec] of specs.entries()) {
      const asset = await assets.createAsset(
        estate.id,
        {
          name: spec.name,
          category: spec.category,
          location: spec.location,
          manufacturer: spec.manufacturer,
          operationalStatus: spec.operationalStatus,
          supplierId: spec.supplierCategory ? await supplierFor(spec.supplierCategory) : undefined,
        },
        gestora,
      );
      await prisma.asset.update({ where: { id: asset.id }, data: { createdAt: yearsAgo } });

      for (const insp of spec.inspections) {
        const type = await prisma.inspectionType.findFirst({ where: { code: insp.typeCode, estateId: null }, select: { id: true } });
        if (!type) throw new Error(`F2b: tipo de inspección ${insp.typeCode} no encontrado en el catálogo global.`);
        if (insp.lastDoneDaysAgo !== null) {
          await prisma.regulatoryInspection.create({
            data: {
              estateId: estate.id, assetId: asset.id, inspectionTypeId: type.id, createdByUserId: gestora.id,
              status: 'realizada', lastDoneDate: clock.d(-insp.lastDoneDaysAgo),
            },
          });
        }
        if (insp.dueInDays !== null) {
          const pending = await inspections.create(
            estate.id,
            { assetId: asset.id, inspectionTypeId: type.id, nextDueDate: clock.d(insp.dueInDays).toISOString().slice(0, 10) },
            gestora,
          );
          if (insp.dueInDays < 0) {
            await prisma.regulatoryInspection.update({ where: { id: pending.id }, data: { status: 'vencida' } });
          }
        }
      }

      for (const issue of spec.issues ?? []) {
        issueSeq += 1;
        await seedLinkedIssue(ctx, estate, asset.id, issueSeq, issue);
      }
    }
  }
  await assertInstallationFigures(ctx);
}

async function seedLinkedIssue(
  ctx: DemoCtx,
  estate: DemoEstateRef,
  assetId: string,
  seq: number,
  issue: { title: string; description: string; type: 'Averia' | 'Fuga' | 'Seguridad' | 'Otro'; priority: 'Normal' | 'Urgente' },
): Promise<void> {
  const date = ctx.clock.d(-(3 + seq * 4));
  await ctx.prisma.issue.create({
    data: {
      ref: `#INC-${date.getUTCFullYear()}-I${String(seq).padStart(2, '0')}`,
      estateId: estate.id,
      assetId,
      type: issue.type,
      title: issue.title,
      description: issue.description,
      status: 'Abierta',
      priority: issue.priority,
      source: 'Comunidad',
      date,
      reports: { create: { channel: 'form', content: issue.description, receivedAt: date, createdByKind: 'person', createdByUserId: ctx.actors.gestora.id } },
      timeline: { create: { date, authorUserId: ctx.actors.gestora.id, role: 'Administrador', actorKind: 'person', kind: 'report_received', text: issue.description } },
    },
  });
}

/** Aborta el seed si las instalaciones no cuadran con `INSTALLATION_FIGURES`. */
async function assertInstallationFigures(ctx: DemoCtx): Promise<void> {
  const { prisma } = ctx;
  for (const estate of ctx.estates) {
    const where = { estateId: estate.id };
    const actual = {
      assets: await prisma.asset.count({ where }),
      pendingInspections: await prisma.regulatoryInspection.count({ where: { ...where, status: { in: ['planificada', 'citada', 'vencida'] } } }),
      doneInspections: await prisma.regulatoryInspection.count({ where: { ...where, status: 'realizada' } }),
      linkedIssues: await prisma.issue.count({ where: { asset: { estateId: estate.id } } }),
    };
    const expected = {
      assets: INSTALLATION_FIGURES.assets[estate.key],
      pendingInspections: INSTALLATION_FIGURES.pendingInspections[estate.key],
      doneInspections: INSTALLATION_FIGURES.doneInspections[estate.key],
      linkedIssues: INSTALLATION_FIGURES.linkedIssues[estate.key],
    };
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      if (actual[key] !== expected[key]) {
        throw new Error(`F2b: ${estate.name} · ${key}: esperado ${expected[key]}, hay ${actual[key]}.`);
      }
    }
  }
}
