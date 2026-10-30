import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import { IssuesService } from './issues.service';

/**
 * El propietario (rol C) no ve el inventario de la finca: ni la instalación vinculada a una
 * incidencia, ni su id, ni puede filtrar el listado por instalación. Sin base de datos.
 */
const ISSUE = { id: 'i1', estateId: 'e1', assetId: 'asset-1', asset: { id: 'asset-1', name: 'Ascensor' }, timeline: [], photos: [] };
const owner = { id: 'u-c', role: 'C', estateIds: ['e1'], administratorId: null } as unknown as AuthenticatedUser;
const manager = { id: 'u-b', role: 'B', estateIds: ['e1'], administratorId: 'adm' } as unknown as AuthenticatedUser;

describe('IssuesService · inventario oculto al propietario', () => {
  let findMany: jest.Mock;
  let service: IssuesService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([ISSUE]);
    const prisma = {
      issue: {
        count: jest.fn().mockResolvedValue(1),
        findMany,
        findFirst: jest.fn().mockResolvedValue({ id: 'i1', estateId: 'e1' }),
        findUnique: jest.fn().mockResolvedValue(ISSUE),
      },
      issueReport: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      propertyMembership: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
    } as unknown as PrismaService;
    const estateAccess = new EstateAccessService();
    service = new IssuesService(
      prisma,
      estateAccess,
      {} as NotificationsService,
      undefined,
      undefined,
      new PropertyAccessService(prisma, estateAccess),
    );
  });

  it('listByEstate: el propietario no pide la instalación, no recibe su id y no puede filtrar por ella', async () => {
    await expect(service.listByEstate('e1', owner, { assetId: 'asset-1' })).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
    const page = await service.listByEstate('e1', owner);
    expect(findMany.mock.calls[0][0].include).not.toHaveProperty('asset');
    expect(page.items[0]).not.toHaveProperty('assetId');
  });

  it('listByEstate: la gestión sí recibe la instalación y puede filtrar por ella', async () => {
    const page = await service.listByEstate('e1', manager, { assetId: 'asset-1' });
    const args = findMany.mock.calls[0][0];
    expect(args.include).toHaveProperty('asset');
    expect(args.where.assetId).toBe('asset-1');
    expect(page.items[0].assetId).toBe('asset-1');
  });

  it('findById: el propietario no recibe el id de la instalación; la gestión sí', async () => {
    expect(await service.findById('i1', owner)).not.toHaveProperty('assetId');
    expect((await service.findById('i1', manager))?.assetId).toBe('asset-1');
  });
});
