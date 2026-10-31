import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { EstateGovernanceService } from './estate-governance.service';

describe('estate governance', () => {
  const user = {
    id: 'b1',
    role: 'B' as const,
    administratorId: 'stale',
    estateIds: ['foreign'],
  };
  const prisma: any = {
    user: { findFirst: jest.fn() },
    estate: { findFirst: jest.fn() },
    estateOfficeTerm: { findMany: jest.fn() },
    property: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new EstateGovernanceService(prisma);
  beforeEach(() => jest.clearAllMocks());
  it('rechecks the real user and tenant instead of trusting JWT estate IDs', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'b1',
      role: 'B',
      administratorId: 'actual',
    });
    prisma.estate.findFirst.mockResolvedValue(null);
    await expect(service.list('foreign', user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.estateOfficeTerm.findMany).not.toHaveBeenCalled();
  });
  it('rejects a deleted or demoted user despite a formerly valid token', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.list('estate', user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it('loads history only after fresh estate authorization', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'b1',
      role: 'B',
      administratorId: 'actual',
    });
    prisma.estate.findFirst.mockResolvedValue({ id: 'estate' });
    const history = [
      {
        holderNameSnapshot: 'Nombre conservado',
        startsAt: new Date('2026-01-01'),
      },
    ];
    prisma.estateOfficeTerm.findMany.mockResolvedValue(history);
    await expect(service.list('estate', user)).resolves.toEqual([
      { ...history[0], propertyReference: null },
    ]);
  });
  it('rejects empty or inverted periods before any write', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'b1',
      role: 'B',
      administratorId: 'actual',
    });
    prisma.estate.findFirst.mockResolvedValue({ id: 'estate' });
    await expect(
      service.appoint(
        'estate',
        {
          startsAt: '2026-10-15',
          endsAt: '2026-10-15',
          holderNameSnapshot: 'Titular',
        },
        user,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
