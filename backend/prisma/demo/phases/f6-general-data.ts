import type { ConfigService } from '@nestjs/config';
import { EstatesService } from '../../../src/estates/estates.service';
import { EstateGovernanceService } from '../../../src/estates/estate-governance.service';
import { EstateGeneralService, ESSENTIAL_DOCUMENT_TYPES } from '../../../src/estates/estate-general.service';
import { ResourcesService } from '../../../src/resources/resources.service';
import { SuppliersService } from '../../../src/suppliers/suppliers.service';
import { StorageService } from '../../../src/files/storage.service';
import type { DemoCtx } from '../context';
import { GENERAL_DATA, GENERAL_TAX_REGIME } from '../data/general';
import { makePdf } from '../lib/pdf';
import { fileInLibrary, type Filing } from './library-filing';

/**
 * F6 — la pestaña «Datos generales» de cada finca: año, uso, referencia
 * interna, régimen fiscal y observaciones; ubicación para el mapa (fija: el
 * demo no consulta servicios externos); presidente y vicepresidentes;
 * contactos clave; documentos esenciales con su PDF y nº de póliza del seguro.
 *
 * Servicios REALES: `EstatesService.update`, `EstateGovernanceService.appoint`,
 * `EstateGeneralService.setKeyContact`, `ResourcesService.createDocument` y
 * `SuppliersService.updateSupplierContract`. RAW: solo la ubicación y la
 * superficie de parcela, que en producción calcula el backend (Catastro).
 */

/** Lo que el seed deja; la fase aborta si no cuadra. */
export const GENERAL_DATA_FIGURES = {
  presidentsPerEstate: 1,
  /** Personas marcadas como contacto clave por finca: presidente, vicepresidente(s) y un vecino más. */
  extraKeyContacts: 1,
  /** Documentos esenciales que añade F6 (F3 ya sube los «Estatutos» de las 3 fincas con nombre). */
  documentsAddedByF6: (estateName: string, hasStatutes: boolean) =>
    ESSENTIAL_DOCUMENT_TYPES.filter(t => !(hasStatutes && t === 'Estatutos') && !(GENERAL_DATA[estateName]?.missingDocuments ?? []).includes(t)).length,
} as const;

/**
 * Biblioteca: la escritura y los estatutos heredan «Documentación legal» (F3 la abre a propietarios en
 * las fincas con nombre; en el resto sigue «Solo gestora»); el CIF y el IBI se quedan para la gestora;
 * la póliza se abre a los propietarios.
 */
const ESSENTIAL_FILING: Record<(typeof ESSENTIAL_DOCUMENT_TYPES)[number], Filing> = {
  'Escritura de constitución': { folder: 'legal', visibility: null },
  Estatutos: { folder: 'legal', visibility: null },
  'CIF de la comunidad': { folder: 'legal', visibility: 'MANAGER' },
  IBI: { folder: 'contabilidad', visibility: null },
  'Póliza de seguro': { folder: 'seguros', visibility: 'OWNERS' },
};

const DOCUMENT_DAYS_AGO: Record<(typeof ESSENTIAL_DOCUMENT_TYPES)[number], number> = {
  'Escritura de constitución': 2900,
  Estatutos: 2880,
  'CIF de la comunidad': 2860,
  IBI: 280,
  'Póliza de seguro': 95,
};

export async function runF6GeneralData(ctx: DemoCtx): Promise<void> {
  const estatesSvc = ctx.app.get(EstatesService, { strict: false });
  const governance = ctx.app.get(EstateGovernanceService, { strict: false });
  const general = ctx.app.get(EstateGeneralService, { strict: false });
  const resources = ctx.app.get(ResourcesService, { strict: false });
  const suppliers = ctx.app.get(SuppliersService, { strict: false });
  // Almacenamiento con el STORAGE_DIR real del proceso (ver F3).
  const storage = new StorageService({ get: (key: string) => process.env[key] } as unknown as ConfigService);
  const gestora = ctx.actors.gestora;
  const { prisma, clock } = ctx;
  const iso = (days: number) => clock.d(days).toISOString().slice(0, 10);

  const estates = await prisma.estate.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  for (const estate of estates) {
    const spec = GENERAL_DATA[estate.name];
    if (!spec) throw new Error(`F6: no hay datos generales para «${estate.name}».`);

    // ── Campos de la finca (los que se editan en «Editar finca») ───────
    await estatesSvc.update(estate.id, {
      yearBuilt: spec.yearBuilt, mainUse: spec.mainUse, internalRef: spec.internalRef, taxRegime: GENERAL_TAX_REGIME, notes: spec.notes,
    }, gestora);
    await prisma.estate.update({
      where: { id: estate.id },
      data: { latitude: spec.latitude.toFixed(6), longitude: spec.longitude.toFixed(6), geoSource: 'seed', geoResolvedAt: clock.anchor, parcelAreaM2: spec.parcelAreaM2.toFixed(2) },
    });

    // ── Cargos y contactos clave ────────────────────────────────────────
    const people = (await governance.candidates(estate.id, gestora)).flatMap(p => (p.holders[0] ? [{ propertyId: p.id, holder: p.holders[0] }] : []));
    const vicePresidents = spec.vicePresidents ?? 1;
    const needed = 1 + vicePresidents + GENERAL_DATA_FIGURES.extraKeyContacts;
    if (people.length < needed) throw new Error(`F6: ${estate.name} tiene ${people.length} titulares; hacen falta ${needed}.`);
    const appoint = (index: number, role: 'PRESIDENT' | 'VICE_PRESIDENT', daysAgo: number) =>
      governance.appoint(estate.id, {
        role, startsAt: iso(-daysAgo), propertyId: people[index].propertyId,
        userId: people[index].holder.userId ?? undefined, externalOwnerId: people[index].holder.externalOwnerId ?? undefined,
      }, gestora);
    await appoint(0, 'PRESIDENT', 220);
    for (let i = 1; i <= vicePresidents; i++) await appoint(i, 'VICE_PRESIDENT', 220 - i * 5);
    for (const person of people.slice(0, needed)) {
      await general.setKeyContact(estate.id, {
        propertyId: person.propertyId, userId: person.holder.userId ?? undefined, externalOwnerId: person.holder.externalOwnerId ?? undefined, keyContact: true,
      }, gestora);
    }

    // ── Documentos esenciales con su PDF ────────────────────────────────
    const hasStatutes = (await prisma.document.count({ where: { estateId: estate.id, type: 'Estatutos' } })) > 0;
    const essentials = [];
    for (const type of ESSENTIAL_DOCUMENT_TYPES) {
      if ((hasStatutes && type === 'Estatutos') || (spec.missingDocuments ?? []).includes(type)) continue;
      const date = clock.d(-DOCUMENT_DAYS_AGO[type]);
      const title = type === 'IBI' ? `IBI ${date.getUTCFullYear()}` : type;
      const pdf = await makePdf({ title, subtitle: estate.name, lines: [`${type} de la comunidad.`, 'Datos ficticios del entorno de demostración.'], creationDate: date });
      const key = await storage.put(`documents/${estate.id}`, `${title}.pdf`, pdf);
      const created = await resources.createDocument(
        estate.id,
        { title, type, date: date.toISOString().slice(0, 10), size: `${Math.max(1, Math.round(pdf.length / 1024))} KB`, s3Key: key } as never,
        gestora,
      );
      essentials.push({ id: created.id, filing: ESSENTIAL_FILING[type], sizeBytes: pdf.length });
    }
    await fileInLibrary(ctx, estate.id, essentials);

    // ── Póliza del seguro: tipo, nº de póliza y cobertura ──────────────
    const insurance = await prisma.supplierContract.findMany({
      where: { estateId: estate.id, supplier: { category: 'Seguros' } },
      orderBy: { id: 'asc' },
      select: { id: true, supplierId: true },
    });
    for (const [index, contract] of insurance.entries()) {
      await suppliers.updateSupplierContract(estate.id, contract.supplierId, contract.id, {
        serviceType: 'Multirriesgo comunidad',
        contractNumber: `${spec.internalRef.replace('FIN-', 'POL-')}-${index + 1}`,
        notes: 'Daños materiales, daños por agua, responsabilidad civil y defensa jurídica.',
      } as never, gestora);
    }
  }
  await assertGeneralDataFigures(ctx);
}

/** Aborta el seed si lo sembrado no cuadra con `GENERAL_DATA_FIGURES`. */
async function assertGeneralDataFigures(ctx: DemoCtx): Promise<void> {
  const { prisma } = ctx;
  const estates = await prisma.estate.findMany({ select: { id: true, name: true, latitude: true, yearBuilt: true } });
  for (const estate of estates) {
    const spec = GENERAL_DATA[estate.name]!;
    const where = { estateId: estate.id, endsAt: null };
    const problems: string[] = [];
    if (estate.latitude == null || estate.yearBuilt !== spec.yearBuilt) problems.push('ubicación o año de construcción');
    const presidents = await prisma.estateOfficeTerm.count({ where: { ...where, role: 'PRESIDENT' } });
    const vices = await prisma.estateOfficeTerm.count({ where: { ...where, role: 'VICE_PRESIDENT' } });
    if (presidents !== GENERAL_DATA_FIGURES.presidentsPerEstate || vices !== (spec.vicePresidents ?? 1)) problems.push(`cargos (${presidents} presidente, ${vices} vicepresidentes)`);
    const keyContacts =
      (await prisma.propertyMembership.count({ where: { isKeyContact: true, property: { estateId: estate.id } } })) +
      (await prisma.externalOwner.count({ where: { isKeyContact: true, property: { estateId: estate.id } } }));
    if (keyContacts !== 1 + (spec.vicePresidents ?? 1) + GENERAL_DATA_FIGURES.extraKeyContacts) problems.push(`contactos clave (${keyContacts})`);
    const essentials = new Set((await prisma.document.findMany({ where: { estateId: estate.id, type: { in: [...ESSENTIAL_DOCUMENT_TYPES] } }, select: { type: true } })).map(d => d.type));
    if (essentials.size !== ESSENTIAL_DOCUMENT_TYPES.length - (spec.missingDocuments?.length ?? 0)) problems.push(`documentos esenciales (${essentials.size})`);
    const unnumbered = await prisma.supplierContract.count({ where: { estateId: estate.id, supplier: { category: 'Seguros' }, contractNumber: null } });
    if (unnumbered > 0) problems.push(`${unnumbered} pólizas sin número`);
    if (problems.length) throw new Error(`F6: ${estate.name}: ${problems.join('; ')}.`);
  }
}
