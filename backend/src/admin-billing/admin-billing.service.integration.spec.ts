import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../sepa/crypto.service';
import { createAdministrator, purgeAdministrator, type AdministratorFixture } from '../testing/db-fixtures';
import { AdminBillingService } from './admin-billing.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Without Domora's SEPA creditor identifier configured, domiciliación cannot be
 * chosen (odd/tasks/role-a-panel.md S17), against real Postgres.
 */
const prisma = createPrismaClient();
const config = { get: (key: string) => (key === 'JWT_SECRET' ? 'test-secret' : undefined), getOrThrow: () => 'test-secret' } as unknown as ConfigService;
const service = new AdminBillingService(prisma as unknown as PrismaService, new CryptoService(config), {
  creditorId: null,
  creditorName: 'Domora Pruebas S.L.',
  creditorAddress: 'Calle Domora 1, Madrid',
});
let fx: AdministratorFixture;
let user: AuthenticatedUser;

beforeAll(async () => {
  fx = await createAdministrator(prisma, { name: 'Facturación sin acreedor SEPA' });
  user = { id: fx.userId, role: 'B', administratorId: fx.administratorId, estateIds: [] } as unknown as AuthenticatedUser;
});

afterAll(async () => {
  if (fx) await purgeAdministrator(prisma, fx.administratorId);
  await prisma.$disconnect();
});

it('says domiciliación is not available and offers no mandate', async () => {
  const own = await service.getOwn(user);
  expect(own.sepa).toEqual({ available: false, creditorId: null, creditorName: 'Domora Pruebas S.L.', mandateReference: null, mandateText: null });
});

it('refuses domiciliación with a Spain Spanish message and writes nothing', async () => {
  const attempt = service.updateOwn(user, {
    businessName: 'Fincas S.L.',
    cif: 'B12345674',
    address: 'Calle 1',
    email: 'f@test.local',
    paymentMethod: 'Domiciliacion',
    iban: 'ES9121000418450200051332',
    mandate: { accepted: true, reference: `DOM-${fx.administratorId.replace(/-/g, '').slice(0, 8).toUpperCase()}-20261027-ABCDEF`, debtorName: 'Fincas S.L.' },
  });
  await expect(attempt).rejects.toBeInstanceOf(ConflictException);
  await expect(attempt).rejects.toThrow('Domora todavía no ofrece el pago por domiciliación. Elige tarjeta o transferencia.');
  expect(await prisma.adminBilling.findUnique({ where: { administratorId: fx.administratorId } })).toBeNull();
  expect(await prisma.adminSepaMandate.count({ where: { administratorId: fx.administratorId } })).toBe(0);
});
