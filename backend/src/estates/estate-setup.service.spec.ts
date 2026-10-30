import { PrismaService } from '../prisma/prisma.service';
import {
  EstateSetupService,
  type EstateSetupStatus,
  type SetupStepKey,
} from './estate-setup.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra Postgres real: el estado se agrega con `groupBy` y
 * filtros de relación (memberships/externalOwners) — justo lo que un mock
 * no verifica. Tres fincas en estados distintos, de la misma gestora, más
 * una finca de otra gestora y una borrada que el resumen no debe incluir.
 */
const prisma = createPrismaClient();
const service = new EstateSetupService(prisma as unknown as PrismaService);

const TAG = `setup-${Date.now()}`;
let administratorId: string;
let otherAdministratorId: string;
let emptyEstateId: string;
let completeEstateId: string;
let partialEstateId: string;
let deletedEstateId: string;
let otherAdminEstateId: string;
const userIds: string[] = [];

function step(status: EstateSetupStatus | undefined, key: SetupStepKey) {
  const found = status?.steps.find((s) => s.key === key);
  if (!found) throw new Error(`paso ${key} ausente`);
  return found;
}

async function user(role: 'B' | 'C', label: string): Promise<string> {
  const u = await prisma.user.create({
    data: {
      email: `${label}-${TAG}@test.local`,
      passwordHash: 'x',
      fullName: label,
      role,
      administratorId: role === 'B' ? administratorId : null,
    },
  });
  userIds.push(u.id);
  return u.id;
}

async function property(
  estateId: string,
  door: string,
  quotaMonthly: string,
  participationQuota: string | null,
) {
  return prisma.property.create({
    data: {
      estateId,
      type: 'Piso',
      status: 'Ocupado',
      floor: '1',
      door,
      quotaMonthly,
      participationQuota,
    },
  });
}

beforeAll(async () => {
  const admin = await prisma.administrator.create({
    data: {
      name: 'Gestora setup',
      cif: `TSETUP-${TAG}`.slice(0, 20),
      plan: 'BASE',
      tier: 'basic',
      usersMax: 5,
      status: 'Activa',
    },
  });
  administratorId = admin.id;
  const otherAdmin = await prisma.administrator.create({
    data: {
      name: 'Otra gestora',
      cif: `TSETUP2-${TAG}`.slice(0, 20),
      plan: 'BASE',
      tier: 'basic',
      usersMax: 5,
      status: 'Activa',
    },
  });
  otherAdministratorId = otherAdmin.id;
  const gestora = await user('B', 'gestora');

  const base = {
    administratorId,
    type: 'Edificio' as const,
    address: 'Calle Falsa',
    location: 'Madrid',
  };
  emptyEstateId = (
    await prisma.estate.create({ data: { ...base, name: 'Vacía' } })
  ).id;
  completeEstateId = (
    await prisma.estate.create({
      data: {
        ...base,
        name: 'Completa',
        cif: 'H12345678',
        creditorId: 'ES23000H12345678',
        creditorIban: 'enc:v1:ficticio',
        creditorBic: 'CAIXESBBXXX',
      },
    })
  ).id;
  partialEstateId = (
    await prisma.estate.create({
      data: { ...base, name: 'A medias', creditorId: 'ES23000H87654321' },
    })
  ).id;
  deletedEstateId = (
    await prisma.estate.create({
      data: { ...base, name: 'Borrada', deletedAt: new Date() },
    })
  ).id;
  otherAdminEstateId = (
    await prisma.estate.create({
      data: {
        ...base,
        administratorId: otherAdministratorId,
        name: 'De otra gestora',
      },
    })
  ).id;

  // Completa: 2 propiedades, cuota y coeficientes (60 + 40), un Propietario con cuenta y un titular importado con email.
  const c1 = await property(completeEstateId, 'A', '80.00', '60.00');
  const c2 = await property(completeEstateId, 'B', '60.00', '40.00');
  const owner = await user('C', 'propietario');
  await prisma.propertyMembership.create({
    data: {
      propertyId: c1.id,
      userId: owner,
      roleType: 'Propietario',
      status: 'linked',
      isPrimaryContact: true,
      linkedAt: new Date(),
    },
  });
  await prisma.externalOwner.create({
    data: {
      propertyId: c2.id,
      fullName: 'Importado Con Email',
      email: 'importado@test.local',
      createdByUserId: gestora,
    },
  });

  // A medias: 3 propiedades; una sin cuota; coeficientes 50 + 30 + null; solo una con titular;
  // otra con un INQUILINO vinculado, que no cuenta como titular; un titular importado SIN email.
  const p1 = await property(partialEstateId, 'A', '50.00', '50.00');
  const p2 = await property(partialEstateId, 'B', '0', '30.00');
  await property(partialEstateId, 'C', '50.00', null);
  await prisma.externalOwner.create({
    data: {
      propertyId: p1.id,
      fullName: 'Importado Sin Email',
      createdByUserId: gestora,
    },
  });
  const tenant = await user('C', 'inquilino');
  await prisma.propertyMembership.create({
    data: {
      propertyId: p2.id,
      userId: tenant,
      roleType: 'Inquilino',
      status: 'linked',
      isPrimaryContact: false,
      linkedAt: new Date(),
    },
  });

  // Completa: "sin saldos previos" confirmado (fase 9) — la otra forma de
  // dar el paso "Saldos iniciales" por hecho, sin necesidad de un asiento
  // de apertura contabilizado.
  await prisma.accountingSettings.create({
    data: {
      estateId: completeEstateId,
      cutoverDate: new Date(),
      noPriorBalancesConfirmedAt: new Date(),
      noPriorBalancesConfirmedByUserId: gestora,
    },
  });
});

afterAll(async () => {
  const estateIds = [
    emptyEstateId,
    completeEstateId,
    partialEstateId,
    deletedEstateId,
    otherAdminEstateId,
  ];
  const props = await prisma.property.findMany({
    where: { estateId: { in: estateIds } },
    select: { id: true },
  });
  const propIds = props.map((p) => p.id);
  await prisma.externalOwner.deleteMany({
    where: { propertyId: { in: propIds } },
  });
  await prisma.propertyMembership.deleteMany({
    where: { propertyId: { in: propIds } },
  });
  await prisma.property.deleteMany({ where: { id: { in: propIds } } });
  await prisma.accountingSettings.deleteMany({
    where: { estateId: { in: estateIds } },
  });
  await prisma.chartAccount.deleteMany({
    where: { estateId: { in: estateIds } },
  });
  await prisma.estate.deleteMany({ where: { id: { in: estateIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.administrator.deleteMany({
    where: { id: { in: [administratorId, otherAdministratorId] } },
  });
  await prisma.$disconnect();
});

describe('EstateSetupService (Postgres real)', () => {
  it('finca recién creada: todo pendiente, nada completo', async () => {
    const s = await service.compute(emptyEstateId);

    expect(s?.complete).toBe(false);
    expect(s?.requiredDone).toBe(0);
    expect(s?.requiredTotal).toBe(5); // fiscal, properties, quotas, coefficients, owners
    for (const key of [
      'fiscal',
      'properties',
      'quotas',
      'owners',
      'sepa',
      'opening',
      'linked',
    ] as const) {
      expect(step(s!, key).status).toBe('pending');
    }
    expect(step(s!, 'coefficients').status).toBe('pending'); // sin propiedades no es "aviso", es pendiente
  });

  it('finca configurada: completa, con los recomendados en verde y un propietario importado invitable', async () => {
    const s = await service.compute(completeEstateId);

    expect(s?.complete).toBe(true);
    expect(s?.requiredDone).toBe(s?.requiredTotal);
    expect(step(s!, 'coefficients')).toMatchObject({
      status: 'done',
      weight: 'required',
      done: 2,
      total: 2,
    });
    expect(step(s!, 'sepa')).toMatchObject({ status: 'done', done: 3 });
    expect(step(s!, 'owners')).toMatchObject({
      status: 'done',
      done: 2,
      total: 2,
    });
    expect(step(s!, 'linked')).toMatchObject({ status: 'done', done: 1 });
    expect(step(s!, 'opening')).toMatchObject({
      status: 'done',
      weight: 'recommended',
    });
    expect(s?.invitableOwners).toBe(1);
  });

  it('finca a medias: cuenta bien cada paso, el inquilino no cuenta como titular y el importado sin email no es invitable', async () => {
    const s = await service.compute(partialEstateId);

    expect(s?.complete).toBe(false);
    expect(step(s!, 'fiscal').status).toBe('pending');
    expect(step(s!, 'properties')).toMatchObject({ status: 'done', done: 3 });
    expect(step(s!, 'quotas')).toMatchObject({
      status: 'pending',
      done: 2,
      total: 3,
    });
    // 50 + 30 = 80 y uno sin coeficiente: aviso — "required" marca la
    // finca como no completa, pero NO bloquea guardar cada propiedad
    // individual (eso lo decide PropertiesService.update, no este paso).
    expect(step(s!, 'coefficients')).toMatchObject({
      status: 'warning',
      weight: 'required',
      done: 2,
      total: 3,
    });
    expect(step(s!, 'owners')).toMatchObject({
      status: 'pending',
      done: 1,
      total: 3,
    });
    expect(step(s!, 'sepa')).toMatchObject({ status: 'pending', done: 1 });
    expect(step(s!, 'linked')).toMatchObject({ status: 'pending', done: 0 });
    // Sin apertura contabilizada ni "sin saldos previos" confirmado.
    expect(step(s!, 'opening')).toMatchObject({ status: 'pending' });
    expect(s?.invitableOwners).toBe(0);
  });

  it('una finca inexistente o borrada no devuelve estado', async () => {
    expect(await service.compute(deletedEstateId)).toBeNull();
    expect(
      await service.compute('00000000-0000-0000-0000-000000000000'),
    ).toBeNull();
  });

  it('el resumen de la gestora sale de administratorId: sus fincas activas, ni borradas ni ajenas', async () => {
    const summary = await service.summaryForAdministrator(administratorId);
    const ids = summary.map((s) => s.estateId).sort();

    expect(ids).toEqual(
      [emptyEstateId, completeEstateId, partialEstateId].sort(),
    );
    expect(summary.find((s) => s.estateId === completeEstateId)?.complete).toBe(
      true,
    );
    expect(summary[0]).not.toHaveProperty('steps');
  });

  it('el número de consultas no crece con el número de fincas (sin N+1)', async () => {
    const groupBy = jest.spyOn(prisma.property, 'groupBy');
    const estateFind = jest.spyOn(prisma.estate, 'findMany');
    const ownerFind = jest.spyOn(prisma.externalOwner, 'findMany');

    await service.computeMany([emptyEstateId]);
    const one =
      groupBy.mock.calls.length +
      estateFind.mock.calls.length +
      ownerFind.mock.calls.length;
    groupBy.mockClear();
    estateFind.mockClear();
    ownerFind.mockClear();
    await service.computeMany([
      emptyEstateId,
      completeEstateId,
      partialEstateId,
    ]);
    const three =
      groupBy.mock.calls.length +
      estateFind.mock.calls.length +
      ownerFind.mock.calls.length;

    expect(three).toBe(one);
    groupBy.mockRestore();
    estateFind.mockRestore();
    ownerFind.mockRestore();
  });
});
