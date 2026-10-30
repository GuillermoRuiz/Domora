import { DespachoResolverService } from './despacho-resolver.service';
import type { PrismaService } from '../prisma/prisma.service';

const ESTATE = '11111111-1111-4111-8111-111111111111';
const ADMIN = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

type Finder = jest.Mock<Promise<unknown>, [unknown]>;

function prismaWith(rows: Record<string, unknown>) {
  const delegates: Record<string, { findUnique: Finder }> = {};
  const delegate = (name: string) =>
    (delegates[name] ??= {
      findUnique: jest.fn((_args: unknown) => Promise.resolve(rows[name] ?? null)),
    });
  const prisma = new Proxy(
    {},
    { get: (_t, name: string) => delegate(name) },
  ) as unknown as PrismaService;
  return { prisma, delegate };
}

describe('DespachoResolverService', () => {
  it('resolves estateId params through the estate', async () => {
    const { prisma, delegate } = prismaWith({
      estate: { id: ESTATE, administratorId: ADMIN },
    });
    const target = await new DespachoResolverService(prisma).resolve(
      'estates/:estateId/cost-centres',
      { estateId: ESTATE },
    );
    expect(target).toEqual({ administratorId: ADMIN, estateId: ESTATE });
    expect(delegate('estate').findUnique).toHaveBeenCalledWith({
      where: { id: ESTATE },
      select: { administratorId: true },
    });
  });

  it('gives estateId precedence over nested ids', async () => {
    const { prisma, delegate } = prismaWith({
      estate: { administratorId: ADMIN },
    });
    await new DespachoResolverService(prisma).resolve(
      'estates/:estateId/suppliers/:supplierId',
      { estateId: ESTATE, supplierId: OTHER },
    );
    expect(delegate('estate').findUnique).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['properties/:id', { id: OTHER }, 'property', { estateId: ESTATE }],
    ['properties/:propertyId/external-owners', { propertyId: OTHER }, 'property', { estateId: ESTATE }],
    ['issues/:id/status', { id: OTHER }, 'issue', { estateId: ESTATE }],
    ['issues/:issueId/photos', { issueId: OTHER }, 'issue', { estateId: ESTATE }],
    ['meetings/:id/acta', { id: OTHER }, 'meeting', { estateId: ESTATE }],
    ['meetings/:meetingId/attachments', { meetingId: OTHER }, 'meeting', { estateId: ESTATE }],
    ['receipts/:id/cancel', { id: OTHER }, 'accountingReceipt', { estateId: ESTATE }],
    ['debtors/:debtorId/actions', { debtorId: OTHER }, 'debtor', { estateId: ESTATE }],
    ['payment-agreements/:agreementId/cancel', { agreementId: OTHER }, 'paymentAgreement', { debtor: { estateId: ESTATE } }],
    ['payment-installments/:installmentId/paid', { installmentId: OTHER }, 'paymentAgreementInstallment', { agreement: { debtor: { estateId: ESTATE } } }],
    ['remesa-lines/:lineId/return', { lineId: OTHER }, 'remesaLine', { property: { estateId: ESTATE } }],
    ['inspections/corrective-actions/:actionId', { actionId: OTHER }, 'correctiveAction', { inspection: { estateId: ESTATE } }],
    ['amenities/:id/blackouts', { id: OTHER }, 'amenity', { estateId: ESTATE }],
    ['bookings/:id/cancel', { id: OTHER }, 'booking', { amenity: { estateId: ESTATE } }],
    ['external-owners/:id', { id: OTHER }, 'externalOwner', { property: { estateId: ESTATE } }],
    ['reconciliations/:id', { id: OTHER }, 'reconciliationGroup', { estateId: ESTATE }],
  ])('resolves %s through %s', async (template, params, model, row) => {
    const { prisma, delegate } = prismaWith({
      [model]: row,
      estate: { administratorId: ADMIN },
    });
    const target = await new DespachoResolverService(prisma).resolve(
      template,
      params,
    );
    expect(delegate(model).findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: OTHER } }),
    );
    expect(target).toEqual({ administratorId: ADMIN, estateId: ESTATE });
  });

  it('returns null for a route whose despacho cannot be resolved', async () => {
    const { prisma } = prismaWith({});
    await expect(
      new DespachoResolverService(prisma).resolve('direct-messages/messages/:id', { id: OTHER }),
    ).resolves.toBeNull();
    await expect(
      new DespachoResolverService(prisma).resolve('estates', {}),
    ).resolves.toBeNull();
    await expect(
      new DespachoResolverService(prisma).resolve('assistant/documents/:id/index', { id: OTHER }),
    ).resolves.toBeNull();
  });

  it('returns null without querying when an id is not a UUID', async () => {
    const { prisma, delegate } = prismaWith({});
    await expect(
      new DespachoResolverService(prisma).resolve('estates/:estateId', { estateId: 'not-a-uuid' }),
    ).resolves.toBeNull();
    expect(delegate('estate').findUnique).not.toHaveBeenCalled();
  });

  it('returns null when the record does not exist or the lookup fails', async () => {
    const { prisma } = prismaWith({});
    await expect(
      new DespachoResolverService(prisma).resolve('issues/:id', { id: OTHER }),
    ).resolves.toBeNull();
    const failing = {
      estate: { findUnique: jest.fn(() => Promise.reject(new Error('db down'))) },
    } as unknown as PrismaService;
    await expect(
      new DespachoResolverService(failing).resolve('estates/:estateId', { estateId: ESTATE }),
    ).resolves.toBeNull();
  });
});
