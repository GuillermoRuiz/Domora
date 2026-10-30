import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { EstateOverviewService } from './estate-overview.service';
import { EstateOverviewQueryDto } from './dto/estate-overview.dto';
import type { AuthenticatedUser } from '../auth/auth.types';

const user: AuthenticatedUser = {
  id: 'manager',
  role: 'B',
  administratorId: 'admin',
  estateIds: ['a', 'b'],
};
const estate = (id: string, name: string) => ({
  id,
  name,
  type: 'Edificio',
  address: 'Calle Gran Vía',
  streetNumber: '12',
  location: 'Madrid',
  cadastralReference: null,
  catastroFacadeUrl: null,
});

describe('EstateOverviewService', () => {
  let service: EstateOverviewService;
  let db: any;
  let ledger: any;
  beforeEach(() => {
    db = {
      estate: {
        findMany: jest
          .fn()
          .mockResolvedValue([estate('a', 'Zulu'), estate('b', 'Álamo')]),
      },
      property: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ estateId: 'a', _count: { _all: 4 } }]),
      },
      propertyMembership: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: 'u1',
            user: { fullName: 'Ana', taxIdCountry: 'ES', taxId: 'H12345678' },
            property: { estateId: 'a', estate: estate('a', 'Zulu') },
          },
          {
            userId: 'u1',
            user: { fullName: 'Ana', taxIdCountry: 'ES', taxId: 'H12345678' },
            property: { estateId: 'a', estate: estate('a', 'Zulu') },
          },
        ]),
      },
      externalOwner: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'x1',
            fullName: 'Ana',
            taxIdCountry: 'ES',
            taxId: 'h.1234567-8',
            property: { estateId: 'a', estate: estate('a', 'Zulu') },
          },
          {
            id: 'x2',
            fullName: 'Ana',
            taxIdCountry: null,
            taxId: null,
            property: { estateId: 'a', estate: estate('a', 'Zulu') },
          },
        ]),
      },
      adhesionRequest: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ estateId: 'b', _count: { _all: 2 } }]),
      },
      issue: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            {
              id: 'i1',
              title: 'Ascensor roto',
              estate: estate('a', 'Zulu'),
            },
          ]),
        groupBy: jest
          .fn()
          .mockResolvedValue([{ estateId: 'a', _count: { _all: 1 } }]),
      },
      accountingReceipt: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            {
              estateId: 'b',
              _sum: { outstanding: new Prisma.Decimal('15.25') },
            },
          ]),
      },
    };
    ledger = {
      treasuryBalancesForEstates: jest.fn().mockResolvedValue(
        new Map([
          ['a', new Prisma.Decimal('100')],
          ['b', new Prisma.Decimal('-3')],
        ]),
      ),
    };
    service = new EstateOverviewService(db, ledger);
  });
  const query = (patch = {}) =>
    Object.assign(new EstateOverviewQueryDto(), patch);
  it('scope B incluye JWT, gestora y soft delete; C no obtiene finanzas', async () => {
    await service.overview(query(), user);
    expect(db.estate.findMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      id: { in: ['a', 'b'] },
      administratorId: 'admin',
    });
    await expect(
      service.overview(query(), { ...user, role: 'C' }),
    ).rejects.toThrow(ForbiddenException);
  });
  it('owners únicos: no cuenta inquilinos ni promovidos, dedup fiscal; nunca por nombre', async () => {
    const result = await service.overview(query(), user);
    expect(result.items.find((item) => item.id === 'a')?.ownersCount).toBe(2);
    expect(db.propertyMembership.findMany.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        roleType: 'Propietario',
        status: 'linked',
        revokedAt: null,
      }),
    );
    expect(
      db.externalOwner.findMany.mock.calls[0][0].where.promotedToUserId,
    ).toBeNull();
  });
  it('métricas bulk correctas y cuotas limitadas al kind real', async () => {
    const result = await service.overview(query(), user);
    expect(result.items.find((item) => item.id === 'a')).toEqual(
      expect.objectContaining({ balance: '100.00', activeIssues: 1 }),
    );
    expect(result.items.find((item) => item.id === 'b')).toEqual(
      expect.objectContaining({ pendingAmount: '15.25', pendingRequests: 2 }),
    );
    expect(db.accountingReceipt.groupBy.mock.calls[0][0].where.kind).toBe(
      'cuota_ordinaria',
    );
    expect(ledger.treasuryBalancesForEstates).toHaveBeenCalledTimes(1);
    expect(result.summary).toEqual({
      communities: 2,
      properties: 4,
      pendingRequests: 2,
    });
  });
  it.each([
    ['name', 'b'],
    ['ownersCount', 'b'],
    ['balance', 'b'],
    ['activeIssues', 'b'],
    ['pendingAmount', 'a'],
  ])('ordena %s antes de paginar', async (sort, first) => {
    const result = await service.overview(query({ sort, pageSize: 1 }), user);
    expect(result.items[0].id).toBe(first);
    expect(result.total).toBe(2);
    expect(result.totalPages).toBe(2);
  });
  it('búsqueda local normalizada por dirección y filtros server-side', async () => {
    expect(
      (
        await service.overview(
          query({ search: 'gran via 12', filter: 'issues' }),
          user,
        )
      ).items.map((e) => e.id),
    ).toEqual(['a']);
    expect(
      (await service.overview(query({ filter: 'pending' }), user)).items.map(
        (e) => e.id,
      ),
    ).toEqual(['b']);
    expect(
      (await service.overview(query({ filter: 'requests' }), user)).items.map(
        (e) => e.id,
      ),
    ).toEqual(['b']);
    expect(
      (await service.overview(query({ types: ['Garaje'] }), user)).total,
    ).toBe(0);
  });
  it('búsqueda superior encuentra comunidad, propietario e incidencia sin taxId en respuesta', async () => {
    expect((await service.search('gran via', user))[0].kind).toBe('community');
    expect((await service.search('ana', user)).map((r) => r.kind)).toContain(
      'owner',
    );
    expect(
      (await service.search('ascensor', user)).find(
        (result) => result.kind === 'issue',
      ),
    ).toEqual(
      expect.objectContaining({ kind: 'issue', issueId: 'i1', estateId: 'a' }),
    );
    expect(JSON.stringify(await service.search('ana', user))).not.toContain(
      'taxId',
    );
    expect(await service.search('a', user)).toEqual([]);
  });
  it('muchos propietarios coincidentes no ocultan los resultados de incidencias', async () => {
    db.estate.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => estate(String(index), 'Finca')),
    );
    db.propertyMembership.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        userId: String(index),
        user: { fullName: 'Ana' },
        property: { estate: estate('a', 'Finca') },
      })),
    );
    const results = await service.search('coincidencia', user);
    expect(results.filter((result) => result.kind === 'owner')).toHaveLength(5);
    expect(results.filter((result) => result.kind === 'issue')).toHaveLength(1);
    expect(results.length).toBeLessThanOrEqual(15);
  });
});
