import { DEMO_EMAIL_DOMAIN } from '../guard';
import type { DemoCtx } from '../context';
import type { F1Stats } from './f1-owners';

/**
 * Cifras que F1 SIEMBRA (contadas en la BD, no en el código que siembra).
 * Se exportan para que el spec de integración asierte exactamente lo mismo.
 */
export const F1_FIGURES = {
  estates: 3,
  unitsByEstate: { val: 40, mad: 15, valb: 6 } as Record<string, number>,
  units: 61,
  ownerUsers: 50, // titulares con cuenta (46 principales + 4 cotitulares)
  externalOwnersUnpromoted: 2, // empresas sin cuenta
  owners: 52, // ownerUsers + externalOwnersUnpromoted
  tenants: 5,
  pendingAdhesion: 3,
  pendingInvites: 4,
  representations: 3,
  coOwnedUnits: 4,
  usersC: 58, // 50 propietarios + 5 inquilinos + 3 solicitantes de adhesión
  usersTotal: 60, // + superadmin + gestora
} as const;

/**
 * Comprobación de salida de F1: si una cifra no coincide el seed ABORTA
 * nombrando la cifra, en lugar de dejar una demo a medias.
 */
export async function assertF1Figures(
  ctx: DemoCtx,
  stats: F1Stats,
): Promise<void> {
  const { prisma } = ctx;
  const problems: string[] = [];
  const expect = (what: string, actual: number, expected: number) => {
    if (actual !== expected) {
      problems.push(`${what}: ${actual} (esperado ${expected})`);
    }
  };

  expect('fincas', await prisma.estate.count(), F1_FIGURES.estates);
  const units = await prisma.property.groupBy({
    by: ['estateId'],
    where: { estateId: { not: null }, deletedAt: null },
    _count: { _all: true },
    _sum: { participationQuota: true, quotaMonthly: true },
  });
  for (const estate of ctx.estates) {
    const row = units.find((u) => u.estateId === estate.id);
    expect(
      `unidades de ${estate.key}`,
      row?._count._all ?? 0,
      F1_FIGURES.unitsByEstate[estate.key] as number,
    );
    expect(
      `Σ coeficientes de ${estate.key} (centésimas)`,
      Math.round(Number(row?._sum.participationQuota ?? 0) * 100),
      10_000,
    );
    expect(
      `Σ cuotas mensuales de ${estate.key} (céntimos)`,
      Math.round(Number(row?._sum.quotaMonthly ?? 0) * 100),
      estate.monthlyBudgetCents,
    );
  }
  expect(
    'unidades totales',
    units.reduce((a, u) => a + u._count._all, 0),
    F1_FIGURES.units,
  );

  const withoutHolder = await prisma.property.count({
    where: {
      estateId: { not: null },
      deletedAt: null,
      memberships: {
        none: { roleType: 'Propietario', status: 'linked', revokedAt: null },
      },
      externalOwners: { none: {} },
    },
  });
  expect('unidades sin titular', withoutHolder, 0);

  const ownerUsers = await prisma.propertyMembership.findMany({
    where: { roleType: 'Propietario', status: 'linked', revokedAt: null },
    distinct: ['userId'],
    select: { userId: true },
  });
  expect('propietarios con cuenta', ownerUsers.length, F1_FIGURES.ownerUsers);
  expect(
    'propietarios externos sin cuenta',
    await prisma.externalOwner.count({ where: { promotedToUserId: null } }),
    F1_FIGURES.externalOwnersUnpromoted,
  );
  expect(
    'inquilinos',
    await prisma.propertyMembership.count({
      where: { roleType: 'Inquilino', status: 'linked', revokedAt: null },
    }),
    F1_FIGURES.tenants,
  );
  expect(
    'solicitudes de adhesión pendientes',
    await prisma.adhesionRequest.count({ where: { status: 'pending' } }),
    F1_FIGURES.pendingAdhesion,
  );
  expect(
    'invitaciones pendientes',
    await prisma.propertyMembershipInvite.count({
      where: { usedAt: null, revokedAt: null },
    }),
    F1_FIGURES.pendingInvites,
  );
  expect(
    'representaciones',
    await prisma.userRepresentation.count(),
    F1_FIGURES.representations,
  );
  expect(
    'usuarios C',
    await prisma.user.count({ where: { role: 'C' } }),
    F1_FIGURES.usersC,
  );
  expect('usuarios', await prisma.user.count(), F1_FIGURES.usersTotal);
  expect(
    'usuarios fuera de @demo.domora.app',
    await prisma.user.count({
      where: { NOT: { email: { endsWith: DEMO_EMAIL_DOMAIN } } },
    }),
    0,
  );
  // El código que siembra y la BD deben contar lo mismo.
  expect('cotitulares (stats)', stats.secondaryOwners, F1_FIGURES.coOwnedUnits);
  expect(
    'propietarios con cuenta (stats)',
    stats.ownerUsers,
    F1_FIGURES.ownerUsers,
  );

  if (problems.length > 0) {
    throw new Error(
      `F1: cifras sembradas incorrectas:\n - ${problems.join('\n - ')}`,
    );
  }
}
