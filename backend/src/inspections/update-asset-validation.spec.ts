import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAssetDto } from './dto/update-asset.dto';

const errorsFor = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(UpdateAssetDto, body)))
    .map((e) => e.property)
    .sort();

describe('PATCH de instalaciones: un null en un campo obligatorio es un 400, no un 500', () => {
  it('name, category y operationalStatus no admiten null; los opcionales sí', async () => {
    expect(
      await errorsFor({ name: null, category: null, operationalStatus: null }),
    ).toEqual(['category', 'name', 'operationalStatus']);
    expect(await errorsFor({})).toEqual([]);
    expect(
      await errorsFor({
        operationalStatus: 'operativa',
        location: null,
        supplierId: null,
      }),
    ).toEqual([]);
  });
});
