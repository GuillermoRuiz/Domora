import { NotFoundException } from '@nestjs/common';
import { AdminsService } from './admins.service';
import type { AdministratorClientStatus } from '../client-status/client-status.service';

const ADMIN_ROW = {
  id: 'adm',
  name: 'Despacho Uno',
  cif: 'B12345678',
  plan: 'BASE',
  tier: '<25',
  usersMax: 25,
  status: 'Activa',
  mrr: 49,
  deletedAt: null,
};

const STATUS: AdministratorClientStatus = {
  clientStatus: 'Activo',
  paymentStatus: 'Pendiente',
  pendingInvoices: { count: 1, amount: 60.5, overdueCount: 0, overdueAmount: 0 },
};

function setup(statuses: Map<string, AdministratorClientStatus>) {
  const prisma = {
    administrator: {
      findMany: jest.fn().mockResolvedValue([ADMIN_ROW, { ...ADMIN_ROW, id: 'adm2', name: 'Despacho Dos' }]),
      findFirst: jest.fn().mockResolvedValue({
        ...ADMIN_ROW,
        billing: null,
        invoices: [{ id: 'inv', status: 'Pendiente' }],
        activity: [{ id: 'act', type: 'signup', title: 'Alta', occurredAt: new Date('2026-01-02'), authorUser: null }],
        estates: [{ id: 'est', name: 'Finca', type: 'Edificio', location: 'Madrid', createdAt: new Date('2026-01-03'), deletedAt: null, _count: { properties: 4 } }],
      }),
    },
    propertyMembership: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]) },
  };
  const clientStatus = {
    forAdministrators: jest.fn().mockResolvedValue(statuses),
    forAdministrator: jest.fn(async (id: string) => statuses.get(id) ?? null),
  };
  const service = new AdminsService(prisma as never, undefined as never, undefined as never, clientStatus as never);
  return { service, prisma, clientStatus };
}

describe('AdminsService — client and payment status (S6)', () => {
  it('the list adds clientStatus, paymentStatus and pendingInvoices to every despacho, in one batch', async () => {
    const { service, clientStatus } = setup(new Map([['adm', STATUS], ['adm2', { ...STATUS, clientStatus: 'Suspendido', paymentStatus: 'Vencido' }]]));
    const list = await service.list();
    expect(list[0]).toMatchObject(STATUS);
    expect(list[1]).toMatchObject({ clientStatus: 'Suspendido', paymentStatus: 'Vencido' });
    expect(clientStatus.forAdministrators).toHaveBeenCalledTimes(1);
    expect(clientStatus.forAdministrators).toHaveBeenCalledWith(['adm', 'adm2']);
  });

  it('the list keeps every previous field unchanged', async () => {
    const { service } = setup(new Map([['adm', STATUS], ['adm2', STATUS]]));
    const [first] = await service.list();
    expect(first).toEqual({ ...ADMIN_ROW, usersActive: 2, ...STATUS });
  });

  it('the detail adds the same fields and keeps the previous ones', async () => {
    const { service } = setup(new Map([['adm', STATUS]]));
    const detail = await service.findById('adm');
    expect(detail).toEqual({
      ...ADMIN_ROW,
      billing: null,
      invoices: [{ id: 'inv', status: 'Pendiente' }],
      usersActive: 2,
      fincas: [{ id: 'est', name: 'Finca', type: 'Edificio', location: 'Madrid', units: 4, since: new Date('2026-01-03'), active: true }],
      activity: [{ id: 'act', type: 'signup', title: 'Alta', date: new Date('2026-01-02'), author: 'Sistema' }],
      ...STATUS,
    });
  });

  it('the detail of an unknown despacho is still a 404', async () => {
    const { service, prisma } = setup(new Map());
    prisma.administrator.findFirst.mockResolvedValue(null);
    await expect(service.findById('zz')).rejects.toBeInstanceOf(NotFoundException);
  });
});
