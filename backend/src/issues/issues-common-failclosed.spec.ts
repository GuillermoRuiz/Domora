import { NotFoundException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { IssuesService } from './issues.service';

/**
 * Una incidencia es de la comunidad: un vecino solo la ve si es miembro ACTIVO (comprobado en la base de datos) y, sin el servicio
 * que lo comprueba, no ve ninguna (falla cerrado). Sin base de datos.
 */
const user = (role: 'A' | 'B' | 'C'): AuthenticatedUser =>
  ({
    id: 'u1',
    role,
    estateIds: ['e1'],
    administratorId: role === 'B' ? 'adm' : null,
  }) as unknown as AuthenticatedUser;

function serviceFor(row: Record<string, unknown> | null, membership: unknown) {
  const prisma = {
    issue: { findFirst: jest.fn().mockResolvedValue(row) },
    propertyMembership: { findFirst: jest.fn().mockResolvedValue(membership) },
  } as unknown as PrismaService;
  const estateAccess = new EstateAccessService();
  return new IssuesService(
    prisma,
    estateAccess,
    {} as NotificationsService,
    undefined,
    undefined,
    new PropertyAccessService(prisma, estateAccess),
  );
}

describe('IssuesService.assertIssueAccess · fallo cerrado', () => {
  it('el miembro pasa y quien no lo es recibe un 404', async () => {
    const row = { id: 'i1', estateId: 'e1' };
    await expect(
      serviceFor(row, { id: 'm1' }).assertIssueAccess('i1', user('C')),
    ).resolves.toMatchObject({ id: 'i1' });
    await expect(
      serviceFor(row, null).assertIssueAccess('i1', user('C')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin el servicio de acceso por membresía, un vecino no ve ninguna incidencia (falla cerrado)', async () => {
    const prisma = {
      issue: {
        findFirst: jest.fn().mockResolvedValue({ id: 'i1', estateId: 'e1' }),
      },
    } as unknown as PrismaService;
    const service = new IssuesService(
      prisma,
      new EstateAccessService(),
      {} as NotificationsService,
    );
    await expect(
      service.assertIssueAccess('i1', user('C')),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
