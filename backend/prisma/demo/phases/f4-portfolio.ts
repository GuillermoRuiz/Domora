import * as bcrypt from 'bcryptjs';
import type { ConfigService } from '@nestjs/config';
import { StorageService } from '../../../src/files/storage.service';
import type { AuthenticatedUser } from '../../../src/auth/auth.types';
import { AccountingService } from '../../../src/accounting/accounting.service';
import { CollectionPostingService } from '../../../src/ledger/posting/collection-posting.service';
import { EstatesService } from '../../../src/estates/estates.service';
import { ExternalOwnersService } from '../../../src/external-owners/external-owners.service';
import { DirectMessagesService } from '../../../src/direct-messages/direct-messages.service';
import { ResourcesService } from '../../../src/resources/resources.service';
import { AssetsService } from '../../../src/inspections/assets.service';
import { InspectionsService } from '../../../src/inspections/inspections.service';
import { BankAccountsService } from '../../../src/ledger/banks/bank-accounts.service';
import { MeetingsService } from '../../../src/meetings/meetings.service';
import { PropertiesService } from '../../../src/properties/properties.service';
import { PropertyMembershipInvitesService } from '../../../src/property-memberships/property-membership-invites.service';
import { SupplierInvoicesService } from '../../../src/suppliers/supplier-invoices.service';
import { SuppliersService } from '../../../src/suppliers/suppliers.service';
import type { DemoCtx } from '../context';
import { DEMO_PASSWORD } from '../data/accounts';
import { BANKS } from '../data/estates';
import { PORTFOLIO, type PortfolioEstate } from '../data/portfolio';
import { makeParcelReference, makeUnitReference } from '../lib/catastro';
import { splitCents } from '../lib/coef';
import { makeCreditorId } from '../lib/creditor-id';
import { makeIban } from '../lib/iban';
import { createSeededIssue } from '../lib/issue-seed';
import { PersonFactory } from '../lib/names';
import { makeCif } from '../lib/nif';
import { randInt } from '../lib/rng';

/**
 * F4 — cartera ampliada (7 fincas más) para la «Vista general» del gestor. Se
 * ejecuta la última y NO añade nada a `ctx.estates`: así las fases anteriores
 * y sus cifras (`F1/F2/F3_FIGURES`) no cambian. Cada finca tiene un perfil de
 * cobro e incidencias distinto (ver `data/portfolio.ts`).
 *
 * Servicios REALES: fincas, propiedades, titulares (censo + invitación +
 * canje), recibos y cobros (`AccountingService`), proveedores y contratos,
 * activos e inspecciones, juntas. RAW, con su motivo:
 *  - fechas de alta, de emisión y de corte de la contabilidad (los servicios
 *    usan `new Date()`), igual que en F1/F2;
 *  - la revisión ya realizada y el paso a `vencida` de las inspecciones (como
 *    F2b);
 *  - las incidencias con su línea de tiempo (IssuesModule arrastra la IA);
 *  - las solicitudes de adhesión pendientes y sus usuarios (no hay servicio
 *    que permita fijar la fecha de envío).
 */

/** Meses consecutivos sin pagar de una propiedad morosa. */
const OVERDUE_MONTHS = 7;

const SUPPLIER_SUFFIXES = ['Levante S.L.', 'Centro S.L.', 'Norte S.L.', 'Sur S.L.'] as const;

const AGENDA = [
  {
    id: 'a1',
    title: 'Aprobación de las cuentas del ejercicio',
    description: 'Examen y votación de las cuentas anuales.',
    hasVote: true,
    voteTemplate: { questions: [{ title: '¿Aprueba las cuentas del ejercicio?', type: 'single_choice' as const, options: ['A favor', 'En contra', 'Abstención'] }] },
  },
  { id: 'a2', title: 'Presupuesto del próximo ejercicio', description: 'Presentación del presupuesto ordinario.' },
  { id: 'a3', title: 'Ruegos y preguntas' },
];

/** Qué unidades (por posición) llevan cada caso de cobro de una finca. */
export interface PortfolioCases {
  returned: number[];
  overdue: number[];
  derramaUnpaid: number[];
}

/** Reparte los casos de una finca entre sus unidades sin solaparlos salvo que falten. */
export function planCases(spec: PortfolioEstate, units: number): PortfolioCases {
  const returned = Array.from({ length: Math.min(spec.returnedUnits, units) }, (_, i) => i);
  const overdue = Array.from({ length: Math.min(spec.overdueUnits, units - returned.length) }, (_, i) => returned.length + i);
  const unpaid = Math.min(spec.derrama?.unpaidUnits ?? 0, units);
  const derramaUnpaid = Array.from({ length: unpaid }, (_, i) => units - 1 - i);
  return { returned, overdue, derramaUnpaid };
}

/** Propiedades distintas con recibo devuelto o impago vencido, según el plan. */
export function expectedIncidentUnits(cases: PortfolioCases): number {
  return new Set([...cases.returned, ...cases.overdue, ...cases.derramaUnpaid]).size;
}

const periodKeyFor = (date: Date): string => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

export async function runF4Portfolio(ctx: DemoCtx): Promise<void> {
  const get = <T>(token: new (...args: never[]) => T): T => ctx.app.get(token, { strict: false });
  const svc = {
    estates: get(EstatesService),
    properties: get(PropertiesService),
    externalOwners: get(ExternalOwnersService),
    invites: get(PropertyMembershipInvitesService),
    bankAccounts: get(BankAccountsService),
    accounting: get(AccountingService),
    collections: get(CollectionPostingService),
    suppliers: get(SuppliersService),
    supplierInvoices: get(SupplierInvoicesService),
    assets: get(AssetsService),
    inspections: get(InspectionsService),
    meetings: get(MeetingsService),
    resources: get(ResourcesService),
    messages: get(DirectMessagesService),
  };
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const people = new PersonFactory(ctx.rng);

  const all: BuiltEstate[] = [];
  for (const spec of PORTFOLIO) {
    const built = await createEstateWithUnits(ctx, svc, spec);
    all.push(built);
    await seedOwners(ctx, svc, people, passwordHash, built);
    await seedReceipts(ctx, svc, spec, built);
    await seedSuppliersAndContracts(ctx, svc, spec, built);
    await seedAssets(ctx, svc, spec, built);
    await seedIssues(ctx, spec, built);
    await seedAdhesionRequests(ctx, svc, people, passwordHash, spec, built);
    await seedMeetings(ctx, svc, spec, built);
  }
  await seedManagerActivity(ctx, svc, all);
  await assertPortfolioFigures(ctx);
}

interface BuiltEstate {
  id: string;
  name: string;
  address: string;
  units: { id: string; ref: string; address: string }[];
  /** Usuarios titulares con cuenta, en el orden de las unidades. */
  ownerUserIds: string[];
}

async function createEstateWithUnits(
  ctx: DemoCtx,
  svc: {
    estates: EstatesService;
    properties: PropertiesService;
    bankAccounts: BankAccountsService;
  },
  spec: PortfolioEstate,
): Promise<BuiltEstate> {
  const { rng, clock, prisma } = ctx;
  const gestora = ctx.actors.gestora;
  const bank = BANKS[spec.bankCode];
  if (!bank) throw new Error(`F4: entidad desconocida ${spec.bankCode}`);
  const parcel = makeParcelReference(rng);
  const iban = makeIban(rng, spec.bankCode);
  const street = `${spec.viaType} ${spec.viaName}`;

  const estate = await svc.estates.create(
    {
      name: spec.name,
      type: 'Edificio',
      address: street,
      streetNumber: spec.streetNumber,
      location: spec.municipality,
      province: spec.province,
      postalCode: spec.postalCode,
      cadastralReference: parcel,
      reserveTarget: Math.round((spec.monthlyBudgetCents / 100) * 6),
      iban,
      color: spec.color,
    },
    gestora,
  );
  gestora.estateIds.push(estate.id);

  const cif = makeCif(rng, 'H');
  await svc.estates.update(estate.id, { cif }, gestora);
  await svc.estates.updateSepaBilling(
    estate.id,
    {
      creditorId: makeCreditorId(cif),
      creditorIban: iban,
      creditorBic: bank.bic,
      creditorPostalAddress: `${street} ${spec.streetNumber}, ${spec.postalCode} ${spec.municipality}`,
    },
    gestora,
  );
  const banks = await svc.bankAccounts.list(estate.id, gestora);
  const defaultBank = banks.find((b) => b.isDefault);
  if (!defaultBank) throw new Error(`F4: ${spec.name} sin cuenta por defecto.`);
  await svc.bankAccounts.update(
    estate.id,
    defaultBank.id,
    { alias: `Cuenta comunidad ${bank.name}`, iban, bic: bank.bic, bankName: bank.name },
    gestora,
  );
  // RAW: fecha de alta de la finca relativa al ancla.
  await prisma.estate.update({ where: { id: estate.id }, data: { createdAt: clock.monthsAgo(spec.ageMonths) } });

  const created: BuiltEstate['units'] = [];
  let cargo = 0;
  for (let f = 1; f <= spec.floors; f++) {
    for (let d = 0; d < spec.doors; d++) {
      cargo += 1;
      const door = String.fromCharCode(65 + d);
      const m2 = randInt(rng, 62, 118);
      const property = await svc.properties.createForEstate(estate.id, {
        type: 'Piso',
        viaType: spec.viaType,
        viaName: spec.viaName,
        streetNumber: spec.streetNumber,
        floor: String(f),
        door,
        municipality: spec.municipality,
        province: spec.province,
        builtAreaM2: m2,
      });
      const ref = `${f}${door}`;
      // RAW: ref, CP, referencia catastral y alta de la unidad (ningún DTO los acepta).
      await prisma.property.update({
        where: { id: property.id },
        data: {
          ref,
          postalCode: spec.postalCode,
          cadastralReference: makeUnitReference(rng, parcel, cargo),
          createdAt: clock.monthsAgo(spec.ageMonths),
        },
      });
      created.push({ id: property.id, ref, address: `${street} ${spec.streetNumber}, ${f}º ${door}, ${spec.postalCode} ${spec.municipality}` });
    }
  }

  const updated = await svc.properties.applyQuotasByArea(estate.id);
  const hundredths = new Map(updated.map((p) => [p.id, Math.round(Number(p.participationQuota) * 100)]));
  const sum = [...hundredths.values()].reduce((a, b) => a + b, 0);
  if (sum !== 10_000) throw new Error(`F4: coeficientes de ${spec.name} suman ${sum / 100}, no 100.`);
  const quotaCents = splitCents(created.map((c) => hundredths.get(c.id) ?? 0), spec.monthlyBudgetCents);
  for (const [i, c] of created.entries()) {
    await svc.properties.update(c.id, { quotaMonthly: (quotaCents[i] as number) / 100 }, gestora);
  }
  return { id: estate.id, name: spec.name, address: street, units: created, ownerUserIds: [] };
}

async function seedOwners(
  ctx: DemoCtx,
  svc: { externalOwners: ExternalOwnersService; invites: PropertyMembershipInvitesService },
  people: PersonFactory,
  passwordHash: string,
  built: BuiltEstate,
): Promise<void> {
  const { prisma, clock, rng } = ctx;
  const gestora = ctx.actors.gestora;
  for (const unit of built.units) {
    const person = await uniquePerson(ctx, people);
    const joinedAt = clock.d(-randInt(rng, 40, 300));
    const user = await prisma.user.create({
      data: {
        email: person.email,
        passwordHash,
        fullName: person.fullName,
        role: 'C',
        phone: person.phone,
        termsAcceptedAt: joinedAt,
        createdAt: joinedAt,
      },
    });
    const owner = await svc.externalOwners.create(
      unit.id,
      { fullName: person.fullName, taxIdCountry: 'ES', taxId: person.taxId, email: person.email, phone: person.phone, postalAddress: unit.address },
      gestora,
    );
    const { token } = await svc.invites.createOwnerInvite(unit.id, owner.id, gestora);
    await svc.invites.redeemInvite(token, { id: user.id, role: 'C', estateIds: [], administratorId: null } as AuthenticatedUser);
    built.ownerUserIds.push(user.id);
  }
}

/** Persona nueva cuyo email no choca con ningún usuario ya sembrado. */
async function uniquePerson(ctx: DemoCtx, people: PersonFactory) {
  for (let i = 0; i < 20; i++) {
    const person = people.next();
    const taken = await ctx.prisma.user.findUnique({ where: { email: person.email }, select: { id: true } });
    if (!taken) return person;
  }
  throw new Error('F4: no se pudo generar una persona con email libre.');
}

async function seedReceipts(
  ctx: DemoCtx,
  svc: { accounting: AccountingService; collections: CollectionPostingService },
  spec: PortfolioEstate,
  built: BuiltEstate,
): Promise<void> {
  const { clock, prisma } = ctx;
  const gestora = ctx.actors.gestora;
  const cases = planCases(spec, built.units.length);
  const idAt = (i: number) => built.units[i]?.id as string;
  const returned = new Set(cases.returned.map(idAt));
  const overdue = new Set(cases.overdue.map(idAt));
  // El cobro se asienta en su fecha real (a los pocos días del vencimiento), no hoy: así el saldo
  // pendiente de cada fecha pasada es creíble para las comparativas.
  const pay = (receipt: { id: string; propertyId: string; outstanding: unknown }, date: Date) =>
    prisma.$transaction((tx) =>
      svc.collections.collect(tx, {
        estateId: built.id,
        propertyId: receipt.propertyId,
        date: date > clock.anchor ? clock.anchor : date,
        amount: Math.round(Number(receipt.outstanding) * 100),
        method: 'Transferencia',
        receiptIds: [receipt.id],
      }),
    );

  // RAW: sin retrasar el corte, todos los recibos pasados se fecharían hoy.
  await prisma.accountingSettings.update({
    where: { estateId: built.id },
    data: { cutoverDate: clock.monthStart(spec.historyMonths) },
  });

  for (let n = spec.historyMonths; n >= 0; n--) {
    const periodDate = clock.monthStart(n);
    const periodKey = periodKeyFor(periodDate);
    const result = await svc.accounting.generateReceipts(built.id, { periodKey }, gestora);
    // RAW: el servicio fecha periodo y recibos con `new Date()`.
    await prisma.accountingPeriod.update({ where: { id: result.period.id }, data: { issuedAt: periodDate } });
    await prisma.accountingReceipt.updateMany({ where: { periodId: result.period.id }, data: { date: periodDate } });

    const receipts = await prisma.accountingReceipt.findMany({
      where: { periodId: result.period.id, status: 'Pendiente' },
      select: { id: true, propertyId: true, outstanding: true },
    });
    for (const r of receipts) {
      if (overdue.has(r.propertyId) && n <= OVERDUE_MONTHS) continue;
      await pay(r, new Date(Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth(), 8)));
      if (n === 1 && returned.has(r.propertyId)) {
        await svc.accounting.updateReceipt(
          r.id,
          { status: 'Devuelto', returnCode: 'MS03', returnReason: 'Motivo no especificado por la entidad' },
          gestora,
        );
      }
    }
  }

  if (spec.derrama) {
    const { amountCents, monthsAgo } = spec.derrama;
    const periodDate = clock.monthStart(monthsAgo);
    const unpaid = new Set(cases.derramaUnpaid.map(idAt));
    for (const unit of built.units) {
      const receipt = await svc.accounting.createManualReceipt(
        built.id,
        {
          propertyId: unit.id,
          periodKey: periodKeyFor(periodDate),
          concept: 'Derrama extraordinaria: rehabilitación de fachada',
          kind: 'derrama',
          amount: amountCents / 100,
          dueDate: new Date(Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth(), 20)).toISOString().slice(0, 10),
          method: 'Transferencia',
        },
        gestora,
      );
      await prisma.accountingReceipt.update({ where: { id: receipt.id }, data: { date: periodDate } });
      if (!unpaid.has(unit.id)) {
        await pay(receipt, new Date(Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth(), 28)));
      }
    }
  }

  // Aportación al fondo de reserva: emitida y cobrada por todas las propiedades hace 3 meses.
  if (spec.reserveUnitCents) {
    const periodDate = clock.monthStart(Math.min(3, spec.historyMonths));
    for (const unit of built.units) {
      const receipt = await svc.accounting.createManualReceipt(
        built.id,
        {
          propertyId: unit.id,
          periodKey: periodKeyFor(periodDate),
          concept: 'Aportación al fondo de reserva',
          kind: 'fondo_reserva',
          amount: spec.reserveUnitCents / 100,
          dueDate: new Date(Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth(), 15)).toISOString().slice(0, 10),
          method: 'Transferencia',
        },
        gestora,
      );
      await prisma.accountingReceipt.update({ where: { id: receipt.id }, data: { date: periodDate } });
      await pay(receipt, new Date(Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth(), 20)));
    }
  }
}

async function seedSuppliersAndContracts(
  ctx: DemoCtx,
  svc: { suppliers: SuppliersService; supplierInvoices: SupplierInvoicesService },
  spec: PortfolioEstate,
  built: BuiltEstate,
): Promise<void> {
  const { prisma, clock, rng } = ctx;
  const gestora = ctx.actors.gestora;
  const isoDay = (days: number) => clock.d(days).toISOString().slice(0, 10);
  for (const [i, contract] of spec.contracts.entries()) {
    const supplier = await svc.suppliers.createSupplier(
      built.id,
      {
        name: `${contract.category} ${SUPPLIER_SUFFIXES[(i + spec.key.length) % SUPPLIER_SUFFIXES.length]}`,
        category: contract.category,
        taxIdCountry: 'ES',
        taxId: makeCif(rng, 'B'),
        phone: `9${randInt(rng, 1, 9)} ${randInt(rng, 100, 999)} ${randInt(rng, 10, 99)} ${randInt(rng, 10, 99)}`,
      },
      gestora,
    );
    // RAW: el servicio usa `new Date()` como fecha de alta.
    await prisma.supplier.update({ where: { id: supplier.id }, data: { createdAt: clock.monthsAgo(spec.ageMonths) } });
    await svc.suppliers.createSupplierContract(
      built.id,
      supplier.id,
      {
        serviceType: contract.category,
        startDate: isoDay(contract.endInDays - 365),
        endDate: isoDay(contract.endInDays),
        renewalType: 'manual',
      },
      gestora,
    );

    // Gasto del ejercicio: dos facturas del servicio (≈6 % de la cuota mensual cada una); la más
    // antigua, pagada, y la reciente, pendiente.
    const account = await prisma.chartAccount.findFirstOrThrow({ where: { estateId: built.id, code: '622' }, select: { id: true } });
    for (const [k, daysAgo] of [90, 35].entries()) {
      const issueDate = clock.d(-daysAgo - i * 3);
      const invoice = await svc.supplierInvoices.create(
        built.id,
        supplier.id,
        {
          number: `${issueDate.getUTCFullYear()}-${100 + i * 10 + k}`,
          concept: `${contract.category} · ${issueDate.toISOString().slice(0, 7)}`,
          issueDate: issueDate.toISOString().slice(0, 10),
          vatRatePct: 21,
          withholdingRatePct: 0,
          lines: [{ accountId: account.id, baseAmount: Math.round(spec.monthlyBudgetCents * 0.06) / 100 }],
        },
        gestora,
      );
      if (k === 0) {
        await svc.supplierInvoices.pay(
          built.id,
          {
            supplierId: supplier.id,
            date: new Date(issueDate.getTime() + 10 * 86_400_000).toISOString().slice(0, 10),
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

async function seedAssets(
  ctx: DemoCtx,
  svc: { assets: AssetsService; inspections: InspectionsService },
  spec: PortfolioEstate,
  built: BuiltEstate,
): Promise<void> {
  const { prisma, clock } = ctx;
  const gestora = ctx.actors.gestora;
  for (const a of spec.assets) {
    const asset = await svc.assets.createAsset(
      built.id,
      { name: a.name, category: a.category, location: a.location, operationalStatus: a.operationalStatus },
      gestora,
    );
    await prisma.asset.update({ where: { id: asset.id }, data: { createdAt: clock.monthsAgo(spec.ageMonths) } });
    const type = await prisma.inspectionType.findFirst({ where: { code: a.typeCode, estateId: null }, select: { id: true } });
    if (!type) throw new Error(`F4: tipo de inspección ${a.typeCode} no encontrado.`);
    if (a.lastDoneDaysAgo !== null) {
      // RAW: ningún servicio crea una revisión ya realizada con su fecha.
      await prisma.regulatoryInspection.create({
        data: {
          estateId: built.id, assetId: asset.id, inspectionTypeId: type.id, createdByUserId: gestora.id,
          status: 'realizada', lastDoneDate: clock.d(-a.lastDoneDaysAgo),
        },
      });
    }
    if (a.dueInDays !== null) {
      const pending = await svc.inspections.create(
        built.id,
        { assetId: asset.id, inspectionTypeId: type.id, nextDueDate: clock.d(a.dueInDays).toISOString().slice(0, 10) },
        gestora,
      );
      // RAW: pasar a `vencida` lo hace un cron que el seed no arranca.
      if (a.dueInDays < 0) await prisma.regulatoryInspection.update({ where: { id: pending.id }, data: { status: 'vencida' } });
    }
  }
}

async function seedIssues(ctx: DemoCtx, spec: PortfolioEstate, built: BuiltEstate): Promise<void> {
  const { prisma, clock } = ctx;
  // Almacenamiento con el STORAGE_DIR real del proceso (ver F3).
  const storage = new StorageService({ get: (key: string) => process.env[key] } as unknown as ConfigService);
  const owners = await prisma.user.findMany({ where: { id: { in: built.ownerUserIds } }, select: { id: true, fullName: true } });
  const ownerById = new Map(owners.map((o) => [o.id, o]));
  for (const [i, issue] of spec.issues.entries()) {
    const unitIndex = i % built.units.length;
    const unit = built.units[unitIndex];
    if (!unit) throw new Error(`F4: ${spec.name} sin unidades para las incidencias.`);
    const supplier = issue.supplierCategory
      ? await prisma.supplier.findFirst({
          where: { estateId: built.id, category: issue.supplierCategory },
          select: { id: true, name: true, category: true, phone: true },
        })
      : null;
    if (issue.supplierCategory && !supplier) {
      throw new Error(`F4: ${spec.name} · «${issue.title}»: no hay proveedor de ${issue.supplierCategory}.`);
    }
    await createSeededIssue(prisma, storage, {
      ref: `#INC-${clock.d(-issue.createdAgoDays).getUTCFullYear()}-${spec.key.toUpperCase()}${String(i + 1).padStart(2, '0')}`,
      estateId: built.id,
      spec: issue,
      gestoraId: ctx.actors.gestora.id,
      owner: ownerById.get(built.ownerUserIds[unitIndex] ?? ''),
      supplier: supplier ?? undefined,
      recipients: built.units.length,
      estateName: spec.name,
      day: (offset) => clock.d(offset),
      photoSeed: i,
    });
  }
}

async function seedAdhesionRequests(
  ctx: DemoCtx,
  svc: { properties: PropertiesService },
  people: PersonFactory,
  passwordHash: string,
  spec: PortfolioEstate,
  built: BuiltEstate,
): Promise<void> {
  const { prisma, clock } = ctx;
  for (const [i, agoDays] of spec.adhesionAgoDays.entries()) {
    const person = await uniquePerson(ctx, people);
    const submittedAt = clock.d(-agoDays);
    const user = await prisma.user.create({
      data: {
        email: person.email, passwordHash, fullName: person.fullName, role: 'C', phone: person.phone,
        taxIdCountry: 'ES', taxId: person.taxId,
        termsAcceptedAt: submittedAt, createdAt: submittedAt,
      },
    });
    // Camino real del autoalta: el propietario da de alta SU propiedad indicando la finca.
    await svc.properties.create(
      {
        type: 'Piso',
        roleType: 'Propietario',
        viaType: spec.viaType,
        viaName: spec.viaName,
        streetNumber: spec.streetNumber,
        floor: String(spec.floors + 1),
        door: String.fromCharCode(65 + i),
        municipality: spec.municipality,
        province: spec.province,
        estateId: built.id,
      },
      { id: user.id, role: 'C', estateIds: [], administratorId: null } as AuthenticatedUser,
    );
    // RAW: el servicio fecha solicitud, vínculo y propiedad con `new Date()`.
    await prisma.adhesionRequest.updateMany({ where: { userId: user.id }, data: { submittedAt } });
    await prisma.propertyMembership.updateMany({ where: { userId: user.id }, data: { linkedAt: submittedAt } });
    await prisma.property.updateMany({ where: { primaryUserId: user.id }, data: { createdAt: submittedAt } });
  }
}

async function seedMeetings(
  ctx: DemoCtx,
  svc: { meetings: MeetingsService },
  spec: PortfolioEstate,
  built: BuiltEstate,
): Promise<void> {
  const gestora = ctx.actors.gestora;
  const at = (days: number, hourUtc: number) => new Date(ctx.clock.d(days).getTime() + hourUtc * 3_600_000);
  const base = { type: 'ordinaria', convokedBy: 'presidente', signerRole: 'administrador', attendeeEmails: [], includeJitsi: false, agenda: AGENDA, location: 'Salón de la comunidad' } as const;
  for (const days of spec.meetings.past) {
    const past = await svc.meetings.create(
      built.id,
      { ...base, title: 'Junta ordinaria de propietarios', scheduledAt1: at(-days, 17).toISOString(), scheduledAt2: at(-days, 17.5).toISOString() } as never,
      gestora,
    );
    await svc.meetings.updateStatus(past.id, { status: 'celebrada' } as never, gestora);
  }
  for (const days of spec.meetings.upcoming) {
    await svc.meetings.create(
      built.id,
      { ...base, title: 'Junta de propietarios', scheduledAt1: at(days, 17).toISOString(), scheduledAt2: at(days, 17.5).toISOString() } as never,
      gestora,
    );
  }
}

/** Aborta el seed si lo sembrado no cuadra con los perfiles de `data/portfolio.ts`. */
async function assertPortfolioFigures(ctx: DemoCtx): Promise<void> {
  const { prisma, clock } = ctx;
  const latest = await prisma.activityLogEntry.findMany({
    where: { actorUserId: ctx.actors.gestora.id },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: 5,
    select: { subjectType: true },
  });
  const latestTypes = latest.map((a) => a.subjectType).sort();
  if (latestTypes.join() !== 'communication,communication,message,message,supplier') {
    throw new Error(`F4: lo más reciente de la actividad del gestor no es lo previsto: ${latestTypes.join()}.`);
  }
  const today = clock.anchor;
  for (const spec of PORTFOLIO) {
    const estate = await prisma.estate.findFirstOrThrow({ where: { name: spec.name }, select: { id: true } });
    const where = { estateId: estate.id };
    const units = spec.floors * spec.doors;
    const cases = planCases(spec, units);
    const returnedProps = await prisma.accountingReceipt.findMany({
      where: { ...where, status: 'Devuelto' },
      distinct: ['propertyId'],
      select: { propertyId: true },
    });
    const overdueProps = await prisma.accountingReceipt.findMany({
      where: { ...where, status: 'Pendiente', dueDate: { lt: today } },
      distinct: ['propertyId'],
      select: { propertyId: true },
    });
    const incidentUnits = new Set([...returnedProps, ...overdueProps].map((r) => r.propertyId)).size;
    const actual = {
      properties: await prisma.property.count({ where: { ...where, deletedAt: null } }),
      returnedUnits: returnedProps.length,
      incidentUnits,
      activeIssues: await prisma.issue.count({
        where: { ...where, deletedAt: null, status: { in: ['Abierta', 'EnReparacion', 'PendienteProveedor'] } },
      }),
      pendingRequests: await prisma.adhesionRequest.count({ where: { ...where, status: 'pending' } }),
      convokedMeetings: await prisma.meeting.count({ where: { ...where, status: 'convocada' } }),
      celebratedMeetings: await prisma.meeting.count({ where: { ...where, status: 'celebrada' } }),
      contracts: await prisma.supplierContract.count({ where }),
      assets: await prisma.asset.count({ where }),
    };
    const expected = {
      properties: units,
      returnedUnits: cases.returned.length,
      incidentUnits: expectedIncidentUnits(cases),
      activeIssues: spec.issues.filter((i) => ['Abierta', 'EnReparacion', 'PendienteProveedor'].includes(i.status)).length,
      pendingRequests: spec.adhesionAgoDays.length,
      convokedMeetings: spec.meetings.upcoming.length,
      celebratedMeetings: spec.meetings.past.length,
      contracts: spec.contracts.length,
      assets: spec.assets.length,
    };
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      if (actual[key] !== expected[key]) {
        throw new Error(`F4: ${spec.name} · ${key}: esperado ${expected[key]}, hay ${actual[key]}.`);
      }
    }
  }
}

/**
 * Actividad reciente del gestor para la «Vista general»: reparte por los últimos días lo que el
 * seed ya dejó registrado (los servicios lo fechan con `new Date()`, todo en el mismo minuto) y
 * añade, con los servicios reales, un proveedor actualizado, dos comunicados y dos mensajes de
 * bandeja que quedan como lo más reciente. RAW solo para fechar las entradas.
 */
async function seedManagerActivity(
  ctx: DemoCtx,
  svc: { suppliers: SuppliersService; resources: ResourcesService; messages: DirectMessagesService },
  built: BuiltEstate[],
): Promise<void> {
  const { prisma, clock } = ctx;
  const gestora = ctx.actors.gestora;
  const at = (hoursAgo: number) => new Date(clock.anchor.getTime() - hoursAgo * 3_600_000);

  // RAW: repartir lo anterior entre 3 y 30 días atrás, de forma determinista.
  await prisma.$executeRaw`
    UPDATE "activity_log" AS a
       SET "occurred_at" = ${clock.anchor}::timestamptz
                           - (((t.rn % 28) + 3) * interval '1 day') - ((t.rn % 7) * interval '1 hour')
      FROM (SELECT "id", row_number() OVER (ORDER BY "id") AS rn FROM "activity_log" WHERE "actor_user_id" = ${gestora.id}::uuid) t
     WHERE a."id" = t."id"`;

  const [first, second] = [built[1], built[4]];
  if (!first || !second) throw new Error('F4: faltan fincas de la cartera para la actividad.');
  const date = async (subjectType: 'supplier' | 'communication' | 'message', subjectId: string, when: Date) => {
    await prisma.activityLogEntry.updateMany({ where: { actorUserId: gestora.id, subjectType, subjectId }, data: { occurredAt: when } });
  };

  const supplier = await prisma.supplier.findFirstOrThrow({ where: { estateId: first.id }, orderBy: { name: 'asc' }, select: { id: true } });
  await svc.suppliers.updateSupplier(first.id, supplier.id, { email: 'avisos@proveedor-demo.es' }, gestora);
  await date('supplier', supplier.id, at(18));

  const notices: Array<[BuiltEstate, string, string, number]> = [
    [first, 'Corte de agua programado', 'El jueves se cortará el agua de 10:00 a 12:00 por una reparación.', 20],
    [second, 'Calendario de limpieza', 'Se publica el calendario de limpieza del próximo trimestre.', 8],
  ];
  for (const [estate, title, body, hoursAgo] of notices) {
    const comm = await svc.resources.createCommunication(estate.id, { title, body, category: 'General' } as never, gestora);
    await date('communication', comm.id, at(hoursAgo));
  }

  const messages: Array<[BuiltEstate, string, number]> = [
    [first, 'Buenos días, ya tiene el aviso del corte de agua en el tablón.', 14],
    [second, 'Le confirmo que su solicitud queda registrada.', 3],
  ];
  for (const [estate, text, hoursAgo] of messages) {
    const recipientUserId = estate.ownerUserIds[0] as string;
    const message = await svc.messages.sendMessage({ recipientUserId, text }, gestora);
    await date('message', message.id, at(hoursAgo));
  }
}
