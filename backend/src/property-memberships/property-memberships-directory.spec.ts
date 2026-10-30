import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PropertyMembershipsService } from './property-memberships.service';

/** Directorio de vecinos: el NIF/NIE de otro vecino no sale para el propietario. Sin base de datos. */
const row = (userId: string) => ({
  userId,
  settings: { visibleInDirectory: true, showPhoneInDirectory: true, showEmailInDirectory: true },
  user: { id: userId, fullName: userId, email: `${userId}@x.test`, phone: '600', taxId: '12345678Z', taxIdCountry: 'ES' },
});
const owner = { id: 'me', role: 'C', estateIds: ['e1'], administratorId: null } as unknown as AuthenticatedUser;
const manager = { id: 'b', role: 'B', estateIds: ['e1'], administratorId: 'adm' } as unknown as AuthenticatedUser;

describe('PropertyMembershipsService.listByProperty · NIF de otros vecinos', () => {
  const prisma = {
    property: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', estateId: 'e1' }) },
    propertyMembership: { findMany: jest.fn().mockResolvedValue([row('me'), row('vecino')]) },
  } as unknown as PrismaService;
  const service = new PropertyMembershipsService(prisma, new EstateAccessService());

  it('el propietario ve su propio NIF pero no el de otro vecino', async () => {
    const list = await service.listByProperty('p1', owner);
    expect(list.find((m) => m.userId === 'me')?.user.taxId).toBe('12345678Z');
    const neighbour = list.find((m) => m.userId === 'vecino')!;
    expect(neighbour.user.taxId).toBeNull();
    expect(neighbour.user.taxIdCountry).toBeNull();
  });

  it('la gestión ve el dato completo', async () => {
    const list = await service.listByProperty('p1', manager);
    expect(list.every((m) => m.user.taxId === '12345678Z')).toBe(true);
  });
});
