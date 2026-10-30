import { MeetingEligibilityService } from './meeting-eligibility.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('MeetingEligibilityService.listHoldersByEstate', () => {
  const membership = (propertyId: string, userId: string, fullName: string) => ({
    propertyId,
    user: { id: userId, fullName },
  });

  function build(memberships: ReturnType<typeof membership>[]) {
    const findMany = jest.fn().mockResolvedValue(memberships);
    const prisma = { propertyMembership: { findMany } } as unknown as PrismaService;
    return { service: new MeetingEligibilityService(prisma), findMany };
  }

  it('groups the linked holders of every property of the estate, keeping their order', async () => {
    const { service, findMany } = build([
      membership('p1', 'u1', 'Marta Vega'),
      membership('p2', 'u2', 'Luis Pons'),
      membership('p2', 'u3', 'Ana Pons'),
    ]);
    await expect(service.listHoldersByEstate('e1')).resolves.toEqual([
      { propertyId: 'p1', holders: [{ userId: 'u1', name: 'Marta Vega' }] },
      {
        propertyId: 'p2',
        holders: [
          { userId: 'u2', name: 'Luis Pons' },
          { userId: 'u3', name: 'Ana Pons' },
        ],
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ property: { estateId: 'e1' }, status: 'linked' }),
      }),
    );
  });

  it('lists a person once when they hold the property in two roles', async () => {
    const { service } = build([membership('p1', 'u1', 'Marta Vega'), membership('p1', 'u1', 'Marta Vega')]);
    await expect(service.listHoldersByEstate('e1')).resolves.toEqual([
      { propertyId: 'p1', holders: [{ userId: 'u1', name: 'Marta Vega' }] },
    ]);
  });
});
