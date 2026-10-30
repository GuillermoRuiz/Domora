import * as bcrypt from 'bcryptjs';
import type { AuthenticatedUser } from '../../../src/auth/auth.types';
import type { DemoCtx } from '../context';
import {
  accountSpec,
  DEMO_PASSWORD,
  DEMO_ACCOUNT_SPECS,
} from '../data/accounts';
import { BANKS, ESTATE_SPECS } from '../data/estates';
import { DEMO_EMAIL_DOMAIN } from '../guard';
import { makeIban } from '../lib/iban';
import { PersonFactory, slugify, type DemoPerson } from '../lib/names';
import { makeCif } from '../lib/nif';
import { chance, randInt } from '../lib/rng';
import type { F1Services } from './f1-services';
import type { F1Unit } from './f1-people';

/**
 * Plan de titulares (cifras del tasks "Cifras fijas", reajustadas a la
 * realidad del código — ver apply-progress-F1):
 *
 *  - 61 unidades: 59 con titular con cuenta + 2 de empresas (titular externo).
 *  - 46 titulares principales con cuenta (1x4 unidades, 2x3, 6x2, 37x1) y 4
 *    cotitulares (copropiedad) = 50 usuarios C propietarios; con las 2 empresas
 *    son 52 propietarios.
 *  - 5 inquilinos (usuarios C con membresía Inquilino), 3 solicitudes de
 *    adhesión pendientes (usuarios C con su propia propiedad por aprobar),
 *    4 invitaciones pendientes, 3 representaciones.
 */
const MULTI_UNIT_HOLDERS: ReadonlyArray<{
  units: readonly string[];
  fixed?: string;
  account?: 'propietario';
}> = [
  {
    fixed: 'Ramón Blasco Ferrer',
    units: ['val:6C', 'val:6D', 'val:P07', 'val:L1'],
  },
  { account: 'propietario', units: ['val:3A', 'val:P03', 'valb:1A'] },
  { units: ['mad:2A', 'mad:2B', 'mad:P1'] },
  { units: ['val:1A', 'val:P01'] },
  { units: ['val:1C', 'val:P02'] },
  { units: ['val:4B', 'val:P05'] },
  { units: ['val:5D', 'val:P06'] },
  { units: ['mad:3C', 'mad:P2'] },
  { units: ['valb:2A', 'valb:2B'] },
];

const COMPANIES = [
  {
    unit: 'val:L4',
    name: 'Inmobiliaria Turia Gestión S.L.',
    org: 'B',
    email: `administracion.turia${DEMO_EMAIL_DOMAIN}`,
    phone: '963 94 17 20',
    address: 'Avenida del Puerto 112, 46023 Valencia',
  },
  {
    unit: 'mad:L1',
    name: 'Promociones Levante Sur S.A.',
    org: 'A',
    email: null,
    phone: '915 77 03 48',
    address: 'Calle de Orense 34, 28020 Madrid',
  },
] as const;

const NAMED_SINGLES = { moroso: 'val:5B', nuevo: 'mad:4C' } as const;
const CO_OWNED_UNITS = ['val:2C', 'val:7A', 'mad:1C', 'valb:3B'] as const;
const TENANT_UNITS = [
  'val:2B',
  'val:3C',
  'val:4D',
  'mad:1A',
  'valb:3A',
] as const;
/** Viviendas vacías (el resto de unidades consta como ocupado). */
const VACANT_UNITS = new Set(['val:6D', 'val:7C', 'mad:3B']);

export interface F1Stats {
  ownerUsers: number;
  secondaryOwners: number;
  externalCompanies: number;
  tenants: number;
  pendingAdhesion: number;
  pendingInvites: number;
  representations: number;
  mandates: number;
}

interface Slot {
  person: DemoPerson;
  userId: string;
  auth: AuthenticatedUser;
  joinedAt: Date;
}

export async function runF1Owners(
  ctx: DemoCtx,
  svc: F1Services,
  people: PersonFactory,
  units: F1Unit[],
): Promise<F1Stats> {
  const { prisma, rng, clock } = ctx;
  const gestora = ctx.actors.gestora;
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const byKey = new Map(units.map((u) => [u.key, u]));
  const unit = (key: string): F1Unit => {
    const u = byKey.get(key);
    if (!u) throw new Error(`F1: unidad inexistente ${key}`);
    return u;
  };
  for (const a of DEMO_ACCOUNT_SPECS) people.reserveEmail(a.email);

  const createUser = async (
    person: DemoPerson,
    joinedAt: Date,
    opts: { withTaxId: boolean; email?: string },
  ): Promise<Slot> => {
    const user = await prisma.user.create({
      data: {
        email: opts.email ?? person.email,
        passwordHash,
        fullName: person.fullName,
        role: 'C',
        phone: person.phone,
        ...(opts.withTaxId
          ? { taxIdCountry: 'ES' as const, taxId: person.taxId }
          : {}),
        termsAcceptedAt: joinedAt,
        createdAt: joinedAt,
      },
    });
    return {
      person,
      userId: user.id,
      auth: { id: user.id, role: 'C', estateIds: [], administratorId: null },
      joinedAt,
    };
  };
  const joined = () => clock.d(-randInt(rng, 40, 400));

  // --- 1) Plan de titulares principales ------------------------------------
  const primary = new Map<string, Slot>(); // clave de unidad -> titular principal
  const holders: Slot[] = [];
  const assign = (slot: Slot, keys: readonly string[]) => {
    holders.push(slot);
    for (const k of keys) {
      if (primary.has(k)) throw new Error(`F1: unidad ${k} asignada dos veces`);
      primary.set(k, slot);
    }
  };

  for (const m of MULTI_UNIT_HOLDERS) {
    let person: DemoPerson;
    if (m.account) {
      const spec = accountSpec(m.account);
      person = people.fixed(spec.fullName, spec.email);
    } else if (m.fixed) {
      const [first = '', last = ''] = m.fixed.split(' ');
      person = people.fixed(
        m.fixed,
        `${slugify(first)}.${slugify(last)}${DEMO_EMAIL_DOMAIN}`,
      );
    } else {
      person = people.next();
    }
    assign(await createUser(person, joined(), { withTaxId: false }), m.units);
  }
  const companyKeys = new Set<string>(COMPANIES.map((c) => c.unit));
  for (const [account, key] of Object.entries(NAMED_SINGLES)) {
    const spec = accountSpec(account as 'moroso' | 'nuevo');
    const when = account === 'nuevo' ? clock.d(-3) : joined();
    assign(
      await createUser(people.fixed(spec.fullName, spec.email), when, {
        withTaxId: false,
      }),
      [key],
    );
  }
  let singleIndex = 0;
  for (const u of units) {
    if (primary.has(u.key) || companyKeys.has(u.key)) continue;
    // Cada 9º titular individual es extranjero (NIE).
    const person = people.next({ foreign: singleIndex % 9 === 4 });
    singleIndex += 1;
    assign(await createUser(person, joined(), { withTaxId: false }), [u.key]);
  }

  // Cotitulares (copropiedad): usuario distinto del principal, misma unidad.
  const secondary = new Map<string, Slot>();
  for (const key of CO_OWNED_UNITS) {
    const head = primary.get(key);
    if (!head)
      throw new Error(`F1: copropiedad sobre unidad sin titular ${key}`);
    // El cotitular se une unos días después del titular principal.
    const slot = await createUser(
      people.next(),
      new Date(head.joinedAt.getTime() + randInt(rng, 3, 30) * 86_400_000),
      { withTaxId: false },
    );
    secondary.set(key, slot);
    holders.push(slot);
  }

  // --- 2) Titulares: ExternalOwner (censo) -> invitación -> canje ------------
  // Es el camino REAL de la gestora para unidades creadas por ella: el titular
  // principal se canjea ANTES que el cotitular (el primero queda como contacto
  // principal).
  const linkOwner = async (u: F1Unit, slot: Slot): Promise<void> => {
    const owner = await svc.externalOwners.create(
      u.ref.propertyId,
      {
        fullName: slot.person.fullName,
        taxIdCountry: 'ES',
        taxId: slot.person.taxId,
        email: slot.person.email,
        phone: slot.person.phone,
        postalAddress: u.address,
      },
      gestora,
    );
    const { token } = await svc.invites.createOwnerInvite(
      u.ref.propertyId,
      owner.id,
      gestora,
    );
    await svc.invites.redeemInvite(token, slot.auth);
  };
  for (const u of units) {
    const head = primary.get(u.key);
    if (!head) continue;
    await linkOwner(u, head);
    u.ref.ownerUserId = head.userId;
    const co = secondary.get(u.key);
    if (co) await linkOwner(u, co);
  }

  // Empresas: titular externo sin cuenta (no se canjea; una conserva su
  // invitación pendiente más abajo).
  const companyOwnerIds = new Map<string, string>();
  for (const c of COMPANIES) {
    const u = unit(c.unit);
    const owner = await svc.externalOwners.create(
      u.ref.propertyId,
      {
        fullName: c.name,
        taxIdCountry: 'ES',
        taxId: makeCif(rng, c.org),
        ...(c.email ? { email: c.email } : {}),
        phone: c.phone,
        postalAddress: c.address,
        notes: 'Persona jurídica propietaria; sin acceso a la plataforma.',
      },
      gestora,
    );
    u.ref.externalOwnerId = owner.id;
    companyOwnerIds.set(c.unit, owner.id);
  }

  // --- 3) Inquilinos: invitación del titular/gestora -> canje -----------------
  const tenantSlots: Slot[] = [];
  for (const key of TENANT_UNITS) {
    const u = unit(key);
    const slot = await createUser(
      people.next(),
      clock.d(-randInt(rng, 15, 200)),
      {
        withTaxId: true,
      },
    );
    const { token } = await svc.invites.createInvite(
      u.ref.propertyId,
      'Inquilino',
      slot.person.email,
      gestora,
    );
    await svc.invites.redeemInvite(token, slot.auth);
    tenantSlots.push(slot);
  }

  // --- 4) Solicitudes de adhesión pendientes (autoalta de un rol C) -----------
  const adhesionDefs = [
    {
      estate: 'val',
      type: 'Piso' as const,
      floor: '8',
      door: 'A',
    },
    { estate: 'mad', type: 'Parking' as const, door: 'Plaza 3' },
    { estate: 'valb', type: 'Trastero' as const, door: 'Trastero 1' },
  ];
  const adhesionSlots: Slot[] = [];
  for (const def of adhesionDefs) {
    const spec = ESTATE_SPECS.find((e) => e.key === def.estate);
    const estate = ctx.estates.find((e) => e.key === def.estate);
    if (!spec || !estate)
      throw new Error(`F1: finca ${def.estate} no sembrada`);
    const slot = await createUser(people.next(), clock.d(-randInt(rng, 1, 6)), {
      withTaxId: true,
    });
    await svc.properties.create(
      {
        type: def.type,
        roleType: 'Propietario',
        viaType: spec.viaType,
        viaName: spec.viaName,
        streetNumber: spec.streetNumber,
        floor: def.floor,
        door: def.door,
        municipality: spec.municipality,
        province: spec.province,
        estateId: estate.id,
      },
      slot.auth,
    );
    adhesionSlots.push(slot);
  }

  // --- 5) Invitaciones pendientes (4) ---------------------------------------------
  const pendingOwnerUnit = unit(COMPANIES[0].unit);
  await svc.invites.createOwnerInvite(
    pendingOwnerUnit.ref.propertyId,
    companyOwnerIds.get(COMPANIES[0].unit) as string,
    gestora,
  );
  const nuevo = primary.get(NAMED_SINGLES.nuevo) as Slot;
  await svc.invites.createInvite(
    unit(NAMED_SINGLES.nuevo).ref.propertyId,
    'Ocupante',
    people.next().email,
    nuevo.auth,
  );
  const propietario = primary.get('val:3A') as Slot;
  await svc.invites.createInvite(
    unit('valb:1A').ref.propertyId,
    'Inquilino',
    people.next().email,
    propietario.auth,
  );
  await svc.invites.createInvite(
    unit('mad:3A').ref.propertyId,
    'Representante',
    people.next().email,
    gestora,
  );

  // --- 6) Representaciones (3) ---------------------------------------------------
  // RAW: UserRepresentationsService es de solo lectura (no hay alta por API).
  const reps = [
    {
      type: 'apoderamiento_general' as const,
      represented: primary.get('val:2A') as Slot,
      representative: primary.get('val:7B') as Slot,
      estateKey: 'val',
      propertyKey: null,
      scope: 'Representación en juntas y gestiones de la comunidad',
      documentRef:
        'Escritura de poder general, Notaría de Valencia, protocolo 2.481/2025',
      validFrom: clock.d(-210),
    },
    {
      type: 'tutela' as const,
      represented: primary.get('val:7A') as Slot,
      representative: secondary.get('val:7A') as Slot,
      estateKey: 'val',
      propertyKey: 'val:7A',
      scope: 'Tutela: gestión ordinaria de la vivienda 7ºA',
      documentRef:
        'Auto del Juzgado de Primera Instancia nº 14 de Valencia, 312/2024',
      validFrom: clock.d(-330),
    },
    {
      type: 'herencia_yacente' as const,
      represented: primary.get('valb:3B') as Slot,
      representative: secondary.get('valb:3B') as Slot,
      estateKey: 'valb',
      propertyKey: 'valb:3B',
      scope: 'Herencia yacente: representación hasta la adjudicación',
      documentRef:
        'Acta de declaración de herederos, Notaría de Valencia, 1.052/2026',
      validFrom: clock.d(-95),
    },
  ];
  for (const r of reps) {
    const estate = ctx.estates.find((e) => e.key === r.estateKey);
    await prisma.userRepresentation.create({
      data: {
        representativeUserId: r.representative.userId,
        representedUserId: r.represented.userId,
        type: r.type,
        scope: r.scope,
        documentRef: r.documentRef,
        validFrom: r.validFrom,
        grantedEstateId: estate?.id ?? null,
        grantedPropertyId: r.propertyKey
          ? unit(r.propertyKey).ref.propertyId
          : null,
        createdByUserId: gestora.id,
        createdAt: r.validFrom,
      },
    });
  }

  // --- 7) Estado de ocupación y mandatos SEPA -----------------------------------
  for (const u of units) {
    if (VACANT_UNITS.has(u.key)) continue;
    // RAW: createForEstate deja todas las unidades "Vacío".
    await prisma.property.update({
      where: { id: u.ref.propertyId },
      data: { status: 'Ocupado' },
    });
  }
  const ibanByUser = new Map<string, string>();
  let mandates = 0;
  for (const u of units) {
    const spec = ESTATE_SPECS.find((e) => e.key === u.estate.key);
    if (!spec?.usesSepa || !u.ref.ownerUserId) continue;
    const named =
      u.ref.ownerUserId === propietario.userId ||
      u.key === NAMED_SINGLES.moroso;
    // ~12 % de titulares pagan por transferencia (sin mandato).
    if (!named && chance(rng, 0.12)) continue;
    let iban = ibanByUser.get(u.ref.ownerUserId);
    if (!iban) {
      iban = makeIban(rng);
      ibanByUser.set(u.ref.ownerUserId, iban);
    }
    const bank = BANKS[iban.slice(4, 8)];
    // RAW: ningún servicio da de alta mandatos (solo el seed mínimo de CI).
    const mandate = await prisma.mandate.create({
      data: {
        umr: `DOMORA-${u.estate.key.toUpperCase()}-${u.spec.ref}`,
        creditorEstateId: u.estate.id,
        propertyId: u.ref.propertyId,
        titularUserId: u.ref.ownerUserId,
        scheme: 'CORE',
        paymentType: 'recurrent',
        debtorIban: svc.crypto.encrypt(iban),
        debtorBic: bank?.bic ?? null,
        signedAt: clock.d(-randInt(rng, 300, 400)),
        status: 'active',
      },
    });
    u.ref.mandateId = mandate.id;
    mandates += 1;
  }

  // --- 8) Fechas relativas al ancla (el servicio usa new Date()) ------------------
  const everyone: Slot[] = [...holders, ...tenantSlots];
  for (const slot of everyone) {
    const t = slot.joinedAt;
    await prisma.propertyMembership.updateMany({
      where: { userId: slot.userId },
      data: { linkedAt: t },
    });
    await prisma.externalOwner.updateMany({
      where: { promotedToUserId: slot.userId },
      data: {
        createdAt: clock.d(-daysSince(clock.anchor, t) - 7),
        promotedAt: t,
      },
    });
    await prisma.propertyMembershipInvite.updateMany({
      where: { usedByUserId: slot.userId },
      data: {
        createdAt: new Date(t.getTime() - 2 * 86_400_000),
        lastSentAt: new Date(t.getTime() - 2 * 86_400_000),
        usedAt: t,
      },
    });
    await prisma.activityLogEntry.updateMany({
      where: { actorUserId: slot.userId, subjectType: 'membership' },
      data: { occurredAt: t },
    });
  }
  for (const slot of adhesionSlots) {
    await prisma.adhesionRequest.updateMany({
      where: { userId: slot.userId },
      data: { submittedAt: slot.joinedAt },
    });
    await prisma.propertyMembership.updateMany({
      where: { userId: slot.userId },
      data: { linkedAt: slot.joinedAt },
    });
    await prisma.property.updateMany({
      where: { primaryUserId: slot.userId },
      data: { createdAt: slot.joinedAt },
    });
  }
  for (const owner of companyOwnerIds.values()) {
    await prisma.externalOwner.update({
      where: { id: owner },
      data: { createdAt: clock.d(-380) },
    });
  }

  // --- 9) Registro en el contexto para F2+ ---------------------------------------
  for (const estate of ctx.estates) {
    estate.ownerIds = [
      ...new Set(
        estate.units
          .map((r) => r.ownerUserId)
          .filter((id): id is string => id !== null),
      ),
    ];
  }
  for (const [key, co] of secondary) {
    const est = unit(key).estate;
    if (!est.ownerIds.includes(co.userId)) est.ownerIds.push(co.userId);
  }
  const namedUser = (
    slot: Slot,
  ): { userId: string; estateIds: string[]; propertyIds: string[] } => {
    const owned = units.filter((u) => u.ref.ownerUserId === slot.userId);
    return {
      userId: slot.userId,
      estateIds: [...new Set(owned.map((u) => u.estate.id))],
      propertyIds: owned.map((u) => u.ref.propertyId),
    };
  };
  ctx.named.propietario = namedUser(propietario);
  ctx.named.moroso = namedUser(primary.get(NAMED_SINGLES.moroso) as Slot);
  ctx.named.nuevo = namedUser(nuevo);

  return {
    ownerUsers: holders.length,
    secondaryOwners: secondary.size,
    externalCompanies: COMPANIES.length,
    tenants: tenantSlots.length,
    pendingAdhesion: adhesionSlots.length,
    pendingInvites: 4,
    representations: reps.length,
    mandates,
  };
}

function daysSince(anchor: Date, when: Date): number {
  return Math.max(
    0,
    Math.round((anchor.getTime() - when.getTime()) / 86_400_000),
  );
}
