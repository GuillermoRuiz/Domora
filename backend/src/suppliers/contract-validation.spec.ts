import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateSupplierContractDto } from './dto/create-supplier-contract.dto';

describe('contract cost validation', () => {
  const base = {
    serviceType: 'Mantenimiento',
    startDate: '2026-01-01',
    renewalType: 'manual',
  };
  it('allows legacy unknown costs and explicit zero', async () => {
    expect(
      await validate(plainToInstance(CreateSupplierContractDto, base)),
    ).toEqual([]);
    expect(
      await validate(
        plainToInstance(CreateSupplierContractDto, {
          ...base,
          costAmount: 0,
          currency: 'EUR',
          costFrequency: 'MONTHLY',
        }),
      ),
    ).toEqual([]);
  });
  it.each([
    { costAmount: -1 },
    { costAmount: 1.001 },
    { costFrequency: 'WEEKLY' },
    { currency: 'ABC' },
    { currency: null },
    { costAmount: 10000000000 },
  ])('rejects invalid cost input %j', async (values) => {
    expect(
      await validate(
        plainToInstance(CreateSupplierContractDto, { ...base, ...values }),
      ),
    ).not.toEqual([]);
  });
});

describe('contract number validation', () => {
  const base = {
    serviceType: 'Seguro',
    startDate: '2026-01-01',
    renewalType: 'tacita',
  };
  it('accepts up to 50 characters', async () => {
    expect(
      await validate(
        plainToInstance(CreateSupplierContractDto, {
          ...base,
          contractNumber: 'x'.repeat(50),
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).toEqual([]);
  });
  it('rejects longer values', async () => {
    expect(
      await validate(
        plainToInstance(CreateSupplierContractDto, {
          ...base,
          contractNumber: 'x'.repeat(51),
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      ),
    ).not.toEqual([]);
  });
});
