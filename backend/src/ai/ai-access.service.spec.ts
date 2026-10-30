/* eslint-disable @typescript-eslint/no-explicit-any */
import { AiAccessService } from './ai-access.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
describe('AI administrator tenant authorization', () => {
  const user: any = {
    id: 'u',
    role: 'B',
    estateIds: ['e1'],
    administratorId: 'a1',
  };
  const fixture = () => {
    const db: any = {
      estate: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 'e1', administratorId: 'a1' }),
      },
      user: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ role: 'B', administratorId: 'a1' }),
      },
    };
    return { db, service: new AiAccessService(db, new EstateAccessService()) };
  };
  it('rejects an unclaimed estate before querying its data', async () => {
    const f = fixture();
    await expect(f.service.manager('e2', user)).rejects.toThrow();
    expect(f.db.estate.findFirst).not.toHaveBeenCalled();
  });
  it('rejects resident access to accounting/AI administration', async () => {
    const f = fixture();
    await expect(
      f.service.manager('e1', { ...user, role: 'C' }),
    ).rejects.toThrow();
  });
  it('rechecks current administrator affiliation from the database', async () => {
    const f = fixture();
    f.db.user.findFirst.mockResolvedValue({ role: 'B', administratorId: 'a2' });
    await expect(f.service.manager('e1', user)).rejects.toThrow();
  });
  it('authorizes a current scoped manager', async () => {
    const f = fixture();
    await expect(f.service.manager('e1', user)).resolves.toMatchObject({
      id: 'e1',
    });
  });
});
