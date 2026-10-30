import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EstateOverviewQueryDto } from './estate-overview.dto';

describe('EstateOverviewQueryDto', () => {
  it('defaults y conversión de parámetros', async () => {
    const dto = plainToInstance(EstateOverviewQueryDto, {
      page: '2',
      pageSize: '12',
      types: 'Edificio,Urbanizacion',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto).toEqual(
      expect.objectContaining({
        page: 2,
        pageSize: 12,
        sort: 'name',
        direction: 'asc',
        types: ['Edificio', 'Urbanizacion'],
      }),
    );
  });
  it.each([
    { page: 0 },
    { page: 'NaN' },
    { pageSize: 1000 },
    { types: 'Activa' },
    { sort: 'status' },
    { direction: 'random' },
    { search: 'x'.repeat(101) },
  ])('rechaza entradas inválidas %p', async (params) => {
    expect(
      (await validate(plainToInstance(EstateOverviewQueryDto, params))).length,
    ).toBeGreaterThan(0);
  });
});
