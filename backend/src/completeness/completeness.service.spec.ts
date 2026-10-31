import type { PrismaService } from '../prisma/prisma.service';
import type {
  EstateSetupService,
  SetupStep,
} from '../estates/estate-setup.service';
import { CompletenessService } from './completeness.service';

const admin = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  contactName: null,
  contactEmail: null,
  phone: null,
  billing: null,
  subscription: null,
  primaryUser: null,
  _count: { users: 1, teamInvites: 0 },
  ...over,
});

const steps = (done: boolean): SetupStep[] => [
  { key: 'fiscal', weight: 'required', status: done ? 'done' : 'pending' },
  { key: 'sepa', weight: 'recommended', status: 'pending' },
];

function service(
  admins: unknown[],
  estates: {
    id: string;
    name: string;
    administratorId: string;
    done: boolean;
  }[],
) {
  const prisma = {
    administrator: { findMany: jest.fn().mockResolvedValue(admins) },
    estate: { findMany: jest.fn().mockResolvedValue(estates) },
  };
  const estateSetup = {
    computeMany: jest.fn().mockResolvedValue(
      new Map(
        estates.map((e) => [
          e.id,
          {
            estateId: e.id,
            steps: steps(e.done),
            requiredDone: e.done ? 1 : 0,
            requiredTotal: 1,
            complete: e.done,
            invitableOwners: 0,
          },
        ]),
      ),
    ),
  };
  return {
    svc: new CompletenessService(
      prisma as unknown as PrismaService,
      estateSetup as unknown as EstateSetupService,
    ),
    prisma,
    estateSetup,
  };
}

describe('CompletenessService.overview', () => {
  it('averages the despachos completitud for the KPI, leaving Stripe-cancelled ones out', async () => {
    // a1: only the estates step done → 1 of 5 counted despacho steps = 20; its estate 1 of 2 = 50 → 35
    // a2: office 0, no estates → 0
    // a3: cancelled in Stripe → listed, not averaged
    const { svc, estateSetup } = service(
      [
        admin('a1'),
        admin('a2'),
        admin('a3', {
          subscription: { stripeSubscriptionId: 'sub', status: 'canceled' },
        }),
      ],
      [{ id: 'e1', name: 'Finca', administratorId: 'a1', done: true }],
    );
    const result = await svc.overview();
    expect(
      result.offices.map((o) => [
        o.administratorId,
        o.office,
        o.estates,
        o.total,
        o.includedInAverage,
      ]),
    ).toEqual([
      ['a1', 20, 50, 35, true],
      ['a2', 0, 0, 0, true],
      ['a3', 0, 0, 0, false],
    ]);
    expect(result.average).toBe(17.5);
    // The estate checklist comes from EstateSetupService in one batch for every despacho.
    expect(estateSetup.computeMany).toHaveBeenCalledTimes(1);
    expect(estateSetup.computeMany).toHaveBeenCalledWith(['e1']);
  });

  it('returns a null average without despachos', async () => {
    await expect(service([], []).svc.overview()).resolves.toEqual({
      average: null,
      offices: [],
    });
  });

  it('does not count the primary user as team, and reads 2FA only from an active primary user', async () => {
    const primaryUser = {
      role: 'B',
      administratorId: 'a1',
      deletedAt: null,
      totpEnabled: true,
    };
    const { svc } = service(
      [admin('a1', { primaryUser, _count: { users: 1, teamInvites: 0 } })],
      [],
    );
    const detail = await svc.detail('a1');
    expect(detail.officeSteps.find((s) => s.key === 'team')?.status).toBe(
      'pending',
    );
    expect(detail.officeSteps.find((s) => s.key === 'twoFactor')?.status).toBe(
      'done',
    );

    const team = service(
      [admin('a1', { primaryUser, _count: { users: 2, teamInvites: 0 } })],
      [],
    );
    expect(
      (await team.svc.detail('a1')).officeSteps.find((s) => s.key === 'team')
        ?.status,
    ).toBe('done');

    const gone = service(
      [
        admin('a1', {
          primaryUser: { ...primaryUser, deletedAt: new Date() },
          _count: { users: 1, teamInvites: 0 },
        }),
      ],
      [],
    );
    const goneDetail = await gone.svc.detail('a1');
    expect(goneDetail.officeSteps.find((s) => s.key === 'team')?.status).toBe(
      'pending',
    );
    expect(
      goneDetail.officeSteps.find((s) => s.key === 'twoFactor')?.status,
    ).toBe('pending');
  });
});
