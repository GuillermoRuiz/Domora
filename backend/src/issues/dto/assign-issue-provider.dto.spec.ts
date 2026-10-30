import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssignIssueProviderDto } from './assign-issue-provider.dto';

const check = (plain: Record<string, unknown>) =>
  validate(plainToInstance(AssignIssueProviderDto, plain));

describe('AssignIssueProviderDto · fecha estimada', () => {
  it('acepta la fecha del control de fecha (AAAA-MM-DD) y un ISO completo', async () => {
    expect(
      await check({
        providerNameSnapshot: 'Pepe',
        estimatedResolutionDate: '2026-05-15',
      }),
    ).toEqual([]);
    expect(
      await check({
        providerNameSnapshot: 'Pepe',
        estimatedResolutionDate: '2026-05-15T00:00:00.000Z',
      }),
    ).toEqual([]);
  });

  it('rechaza un texto libre con un mensaje humano, no un código de validación', async () => {
    const errors = await check({
      providerNameSnapshot: 'Pepe',
      estimatedResolutionDate: '15 may 2026',
    });
    expect(errors).toHaveLength(1);
    expect(Object.values(errors[0].constraints ?? {})).toEqual([
      'La fecha estimada de resolución no es una fecha válida.',
    ]);
  });

  it('sin fecha es válido', async () => {
    expect(await check({ providerNameSnapshot: 'Pepe' })).toEqual([]);
  });
});
