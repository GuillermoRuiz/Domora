/* eslint-disable @typescript-eslint/no-explicit-any */
import { IssuesService } from '../issues/issues.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
const user: any = {
  id: 'u1',
  role: 'C',
  estateIds: ['e1'],
  administratorId: null,
};
describe('Resident incident creation is purely manual', () => {
  it('creates the incident without any automation dependency', async () => {
    const saved: any = {
      id: 'incident',
      estateId: 'e1',
      title: 'Fuga',
      photos: [{ s3Key: 'original-photo' }],
      timeline: [],
    };
    let persisted = false;
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ last_value: 1 }]),
      issue: {
        create: jest.fn().mockImplementation(async () => {
          persisted = true;
          return saved;
        }),
      },
    };
    const db: any = {
      estate: { findFirst: jest.fn().mockResolvedValue({ id: 'e1' }) },
      $transaction: (fn: any) => fn(tx),
    };
    const service = new IssuesService(
      db,
      new EstateAccessService(),
      {} as any,
      undefined,
      undefined,
      { isActiveMember: jest.fn().mockResolvedValue(true) } as any,
    );
    const result = await service.create(
      'e1',
      {
        type: 'Fuga',
        title: 'Fuga',
        description: 'Agua en portal B',
        priority: 'Normal',
      },
      user,
    );
    expect(persisted).toBe(true);
    expect(result.id).toBe('incident');
    expect(result.photos[0]).not.toHaveProperty('s3Key'); // el vecino nunca recibe la clave de almacenamiento
  });
});
