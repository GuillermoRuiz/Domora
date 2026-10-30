import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RenewSupplierContractDto } from './renew-supplier-contract.dto';

const errorsFor = (newEndDate: string) => validate(plainToInstance(RenewSupplierContractDto, { newEndDate }));

describe('RenewSupplierContractDto', () => {
  it('acepta una fecha de calendario válida', async () => {
    expect(await errorsFor('2026-12-31')).toHaveLength(0);
  });

  it('rechaza una fecha de calendario inexistente en lugar de desplazarla (2026-02-30)', async () => {
    const errors = await errorsFor('2026-02-30');
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('newEndDate');
  });

  it('rechaza un texto que no es una fecha', async () => {
    expect(await errorsFor('mañana')).toHaveLength(1);
  });
});
