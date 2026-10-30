import type { DemoCtx, DemoEstateRef, DemoUnitRef } from '../context';
import {
  BANKS,
  buildUnits,
  ESTATE_SPECS,
  GESTORA,
  type EstateSpec,
  type UnitSpec,
} from '../data/estates';
import { makeParcelReference, makeUnitReference } from '../lib/catastro';
import { splitCents } from '../lib/coef';
import { makeCreditorId } from '../lib/creditor-id';
import { makeIban } from '../lib/iban';
import { makeCif } from '../lib/nif';
import { PersonFactory } from '../lib/names';
import { GESTORA_EMAIL } from './f0-bootstrap';
import { verifyDemoAccounts } from './f1-accounts';
import { assertF1Figures } from './f1-figures';
import { runF1Owners } from './f1-owners';
import { type F1Services, resolveF1Services } from './f1-services';

/** Unidad ya creada, con su clave `<finca>:<ref>` para el plan de titulares. */
export interface F1Unit {
  /** `val:3A`, `mad:P1`, `valb:2B`… */
  key: string;
  estate: DemoEstateRef;
  spec: UnitSpec;
  ref: DemoUnitRef;
  /** Dirección postal completa de la unidad (para titulares). */
  address: string;
}

/**
 * F1 — personas y propiedades (T1.2-T1.4). Orden: gestora (facturación) ->
 * fincas (CIF, SEPA, cuenta bancaria) -> unidades (m² y coeficientes) ->
 * titulares y casos especiales (f1-owners) -> comprobación de cifras y de
 * login de las cuentas demo. Todo con servicios REALES salvo lo que ningún
 * servicio expone (ref/CP/catastral de unidad, mandatos, representaciones),
 * marcado `// RAW:` en cada sitio.
 */
export async function runF1People(ctx: DemoCtx): Promise<void> {
  const svc = resolveF1Services(ctx.app);
  await seedGestoraBilling(ctx, svc);
  const units = await seedEstatesAndUnits(ctx, svc);
  const people = new PersonFactory(ctx.rng);
  const stats = await runF1Owners(ctx, svc, people, units);
  await verifyDemoAccounts(svc.auth, ctx.prisma);
  await assertF1Figures(ctx, stats);
}

async function seedGestoraBilling(
  ctx: DemoCtx,
  svc: F1Services,
): Promise<void> {
  const adminId = ctx.actors.gestora.administratorId;
  if (!adminId) throw new Error('F1: la gestora no tiene administratorId.');
  const admin = await ctx.prisma.administrator.findUniqueOrThrow({
    where: { id: adminId },
    select: { cif: true },
  });
  await svc.admins.upsertBilling(adminId, {
    businessName: GESTORA.name,
    cif: admin.cif,
    address: `${GESTORA.street}, ${GESTORA.postalCode} ${GESTORA.city}`,
    email: GESTORA_EMAIL,
    paymentMethod: 'Domiciliacion',
    iban: makeIban(ctx.rng, GESTORA.bankCode),
  });
  // RAW: fecha de alta de la gestora relativa al ancla (el servicio usa now()).
  await ctx.prisma.administrator.update({
    where: { id: adminId },
    data: { createdAt: ctx.clock.monthsAgo(16) },
  });
}

async function seedEstatesAndUnits(
  ctx: DemoCtx,
  svc: F1Services,
): Promise<F1Unit[]> {
  const all: F1Unit[] = [];
  for (const spec of ESTATE_SPECS) {
    all.push(...(await seedEstate(ctx, svc, spec)));
  }
  return all;
}

async function seedEstate(
  ctx: DemoCtx,
  svc: F1Services,
  spec: EstateSpec,
): Promise<F1Unit[]> {
  const { rng, clock, prisma } = ctx;
  const gestora = ctx.actors.gestora;
  const bank = BANKS[spec.bankCode];
  if (!bank) throw new Error(`Entidad desconocida ${spec.bankCode}`);
  const parcel = makeParcelReference(rng);
  const communityIban = makeIban(rng, spec.bankCode);
  const streetAddress = `${spec.viaType} ${spec.viaName}`;

  // --- Finca: EstatesService.create arranca también su contabilidad ---------
  const estate = await svc.estates.create(
    {
      name: spec.name,
      type: 'Edificio',
      address: streetAddress,
      streetNumber: spec.streetNumber,
      location: spec.municipality,
      province: spec.province,
      postalCode: spec.postalCode,
      cadastralReference: parcel,
      reserveTarget: spec.reserveTarget,
      iban: communityIban,
      color: spec.color,
    },
    gestora,
  );
  // El JWT de la gestora lleva sus fincas: sin esto los servicios con
  // scoping por finca (propiedades, cuentas, invitaciones) la rechazarían.
  gestora.estateIds.push(estate.id);

  const cif = makeCif(rng, 'H');
  await svc.estates.update(estate.id, { cif }, gestora);
  await svc.estates.updateSepaBilling(
    estate.id,
    {
      creditorId: makeCreditorId(cif),
      creditorIban: communityIban,
      creditorBic: bank.bic,
      creditorPostalAddress: `${streetAddress} ${spec.streetNumber}, ${spec.postalCode} ${spec.municipality}`,
    },
    gestora,
  );

  // La cuenta bancaria por defecto nace sin IBAN: se completa con el servicio.
  const banks = await svc.bankAccounts.list(estate.id, gestora);
  const defaultBank = banks.find((b) => b.isDefault);
  if (!defaultBank) throw new Error(`F1: ${spec.name} sin cuenta por defecto.`);
  await svc.bankAccounts.update(
    estate.id,
    defaultBank.id,
    {
      alias: `Cuenta comunidad ${bank.name}`,
      iban: communityIban,
      bic: bank.bic,
      bankName: bank.name,
    },
    gestora,
  );

  // RAW: fecha de alta de la finca relativa al ancla.
  await prisma.estate.update({
    where: { id: estate.id },
    data: { createdAt: clock.monthsAgo(spec.ageMonths) },
  });

  // --- Unidades -------------------------------------------------------------
  const unitSpecs = buildUnits(spec, rng);
  const created: Array<{ id: string; spec: UnitSpec; address: string }> = [];
  let cargo = 0;
  for (const u of unitSpecs) {
    cargo += 1;
    const property = await svc.properties.createForEstate(estate.id, {
      type: u.kind,
      viaType: spec.viaType,
      viaName: spec.viaName,
      streetNumber: spec.streetNumber,
      floor: u.floor,
      door: u.door,
      municipality: spec.municipality,
      province: spec.province,
      builtAreaM2: u.m2,
    });
    // RAW: ref, CP, referencia catastral y alta de la unidad (ni
    // CreateEstatePropertyDto ni UpdatePropertyDto los aceptan).
    await prisma.property.update({
      where: { id: property.id },
      data: {
        ref: u.ref,
        postalCode: spec.postalCode,
        cadastralReference: makeUnitReference(rng, parcel, cargo),
        createdAt: clock.monthsAgo(spec.ageMonths),
      },
    });
    const place = [u.floor && `${u.floor}º`, u.door].filter(Boolean).join(' ');
    created.push({
      id: property.id,
      spec: u,
      address: `${streetAddress} ${spec.streetNumber}${place ? `, ${place}` : ''}, ${spec.postalCode} ${spec.municipality}`,
    });
  }

  // --- Coeficientes por m² (servicio de la Tarea 11, resto mayor) -----------
  const updated = await svc.properties.applyQuotasByArea(estate.id);
  const hundredths = new Map(
    updated.map((p) => [p.id, Math.round(Number(p.participationQuota) * 100)]),
  );
  const sum = [...hundredths.values()].reduce((a, b) => a + b, 0);
  if (sum !== 10_000) {
    throw new Error(
      `F1: coeficientes de ${spec.name} suman ${sum / 100}, no 100.`,
    );
  }
  // Cuota mensual proporcional al coeficiente (resto mayor): Σ == presupuesto.
  const weights = created.map((c) => hundredths.get(c.id) ?? 0);
  const quotaCents = splitCents(weights, spec.monthlyBudgetCents);

  const estateRef: DemoEstateRef = {
    id: estate.id,
    key: spec.key,
    name: spec.name,
    propertyIds: created.map((c) => c.id),
    ownerIds: [],
    monthlyBudgetCents: spec.monthlyBudgetCents,
    bankAccountId: defaultBank.id,
    units: [],
  };
  const out: F1Unit[] = [];
  for (const [i, c] of created.entries()) {
    await svc.properties.update(
      c.id,
      { quotaMonthly: (quotaCents[i] as number) / 100 },
      gestora,
    );
    const ref: DemoUnitRef = {
      propertyId: c.id,
      ref: c.spec.ref,
      kind: c.spec.kind,
      coefficient: (hundredths.get(c.id) as number) / 100,
      quotaMonthlyCents: quotaCents[i] as number,
      ownerUserId: null,
      externalOwnerId: null,
      mandateId: null,
    };
    estateRef.units.push(ref);
    out.push({
      key: `${spec.key}:${c.spec.ref}`,
      estate: estateRef,
      spec: c.spec,
      ref,
      address: c.address,
    });
  }
  ctx.estates.push(estateRef);
  return out;
}
