import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { LookupCatastroDto } from './lookup-catastro.dto';
import { ImportCatastroDto } from './import-catastro.dto';
import { MunicipalitiesQueryDto, StreetsQueryDto } from './catalog-query.dto';
import {
  CreateEstateDto,
  UpdateEstateDto,
} from '../../estates/dto/create-estate.dto';

/** Misma configuración que `main.ts`: lo que el frontend manda tiene que pasar ESTA validación. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

async function validate<T>(
  metatype: new () => T,
  body: unknown,
  type: 'body' | 'query' = 'body',
): Promise<T> {
  return (await pipe.transform(body, { type, metatype })) as T;
}

async function messagesOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof BadRequestException) {
      const res = err.getResponse() as { message: string[] | string };
      return Array.isArray(res.message) ? res.message.join(' | ') : res.message;
    }
    throw err;
  }
  return '';
}

const REF20 = '2853604VK4725D0001YP';

describe('LookupCatastroDto', () => {
  it.each(['2853604VK4725D', '2853604VK4725D0001', REF20])(
    'acepta una referencia catastral de %s caracteres',
    async (refCat) => {
      await expect(
        validate(LookupCatastroDto, { refCat }),
      ).resolves.toMatchObject({ refCat });
    },
  );

  it('rechaza una referencia de longitud inválida', async () => {
    expect(
      await messagesOf(validate(LookupCatastroDto, { refCat: '123' })),
    ).toMatch(/14, 18 o 20/);
    expect(
      await messagesOf(
        validate(LookupCatastroDto, { refCat: '2853604VK4725D00' }),
      ),
    ).toMatch(/14, 18 o 20/);
  });

  it('acepta una dirección completa sin referencia', async () => {
    const body = {
      provincia: 'MADRID',
      municipio: 'MADRID',
      sigla: 'CL',
      calle: 'ALCALA',
      numero: '100',
    };
    await expect(validate(LookupCatastroDto, body)).resolves.toMatchObject(
      body,
    );
  });

  it('sin referencia, exige TODOS los campos de la dirección (sin sigla el Catastro responde "no existe")', async () => {
    const msg = await messagesOf(
      validate(LookupCatastroDto, {
        provincia: 'MADRID',
        municipio: 'MADRID',
        calle: 'ALCALA',
        numero: '100',
      }),
    );
    expect(msg).toMatch(/sigla/);
  });

  it('con referencia, la dirección es opcional', async () => {
    await expect(
      validate(LookupCatastroDto, { refCat: '2853604VK4725D' }),
    ).resolves.toBeDefined();
  });

  it('el número tiene 1-4 dígitos', async () => {
    const base = {
      provincia: 'MADRID',
      municipio: 'MADRID',
      sigla: 'CL',
      calle: 'ALCALA',
    };
    expect(
      await messagesOf(
        validate(LookupCatastroDto, { ...base, numero: '12345' }),
      ),
    ).toMatch(/1 y 4 dígitos/);
    expect(
      await messagesOf(validate(LookupCatastroDto, { ...base, numero: '12a' })),
    ).toMatch(/1 y 4 dígitos/);
  });

  it('rechaza campos desconocidos (forbidNonWhitelisted)', async () => {
    expect(
      await messagesOf(
        validate(LookupCatastroDto, {
          refCat: '2853604VK4725D',
          estateId: 'x',
        }),
      ),
    ).toMatch(/should not exist/);
  });
});

describe('ImportCatastroDto', () => {
  /** Exactamente la forma que arma `CatastroService.importUnits` del frontend (con los null que salen del mapper). */
  const unit = {
    cadastralReference: REF20,
    type: 'Piso',
    viaType: 'Calle',
    viaName: 'Alcala',
    streetNumber: '100',
    streetNumberSuffix: null,
    block: null,
    staircase: '1',
    floor: 'Bajo',
    door: 'B',
    postalCode: '28009',
    municipality: 'Madrid',
    province: 'Madrid',
    builtAreaM2: 41,
    participationQuota: 2.15,
  };
  const body = (units: unknown[], extra: Record<string, unknown> = {}) => ({
    parcelReference: '2853604VK4725D',
    fetchedAt: '2026-09-20T10:00:00.000Z',
    units,
    ...extra,
  });

  it('acepta el payload que envía el frontend, incluidos los null', async () => {
    const dto = await validate(ImportCatastroDto, body([unit]));
    expect(dto.units[0]).toMatchObject({
      cadastralReference: REF20,
      streetNumberSuffix: null,
      participationQuota: 2.15,
    });
  });

  it('acepta unidades con solo los campos obligatorios y sin parcelReference/fetchedAt', async () => {
    await expect(
      validate(ImportCatastroDto, {
        units: [{ cadastralReference: REF20, type: 'Local' }],
      }),
    ).resolves.toBeDefined();
  });

  it('acepta todos los tipos de vía que el mapper puede producir', async () => {
    for (const viaType of [
      'Calle',
      'Avenida',
      'Plaza',
      'Paseo',
      'Camino',
      'Carretera',
      'Travesia',
      'Pasaje',
      'Ronda',
      'Glorieta',
      'Via',
      'Poligono',
      'UrbanizacionVia',
      'Lugar',
      'Otro',
    ]) {
      await expect(
        validate(ImportCatastroDto, body([{ ...unit, viaType }])),
      ).resolves.toBeDefined();
    }
  });

  it('rechaza los campos que el frontend NO debe mandar (por eso el servicio los elimina antes de enviar)', async () => {
    expect(
      await messagesOf(
        validate(
          ImportCatastroDto,
          body([{ ...unit, alreadyImported: false }]),
        ),
      ),
    ).toMatch(/alreadyImported should not exist/);
    expect(
      await messagesOf(
        validate(ImportCatastroDto, body([{ ...unit, use: 'Residencial' }])),
      ),
    ).toMatch(/use should not exist/);
  });

  it('exige al menos una unidad y como máximo 1000', async () => {
    expect(await messagesOf(validate(ImportCatastroDto, body([])))).toMatch(
      /units/,
    );
    const many = Array.from({ length: 1001 }, (_, i) => ({
      ...unit,
      cadastralReference: String(i).padStart(20, '0'),
    }));
    expect(await messagesOf(validate(ImportCatastroDto, body(many)))).toMatch(
      /units/,
    );
  });

  it('valida cada unidad: referencia de 20 caracteres, tipo, rango del coeficiente y decimales', async () => {
    expect(
      await messagesOf(
        validate(
          ImportCatastroDto,
          body([{ ...unit, cadastralReference: '2853604VK4725D' }]),
        ),
      ),
    ).toMatch(/20 caracteres/);
    expect(
      await messagesOf(
        validate(
          ImportCatastroDto,
          body([{ ...unit, cadastralReference: REF20.toLowerCase() }]),
        ),
      ),
    ).toMatch(/20 caracteres/);
    expect(
      await messagesOf(
        validate(ImportCatastroDto, body([{ ...unit, type: 'Chalet' }])),
      ),
    ).toMatch(/type/);
    expect(
      await messagesOf(
        validate(
          ImportCatastroDto,
          body([{ ...unit, participationQuota: 100.5 }]),
        ),
      ),
    ).toMatch(/participationQuota/);
    expect(
      await messagesOf(
        validate(
          ImportCatastroDto,
          body([{ ...unit, participationQuota: -1 }]),
        ),
      ),
    ).toMatch(/participationQuota/);
    expect(
      await messagesOf(
        validate(
          ImportCatastroDto,
          body([{ ...unit, participationQuota: 1.234 }]),
        ),
      ),
    ).toMatch(/participationQuota/);
    expect(
      await messagesOf(
        validate(
          ImportCatastroDto,
          body([{ ...unit, builtAreaM2: 1_000_000 }]),
        ),
      ),
    ).toMatch(/builtAreaM2/);
  });

  it('rechaza una referencia de parcela que no tiene 14 caracteres y una fecha que no es ISO', async () => {
    expect(
      await messagesOf(
        validate(ImportCatastroDto, body([unit], { parcelReference: '123' })),
      ),
    ).toMatch(/14 caracteres/);
    expect(
      await messagesOf(
        validate(ImportCatastroDto, body([unit], { fetchedAt: 'ayer' })),
      ),
    ).toMatch(/fetchedAt/);
  });
});

describe('consultas de autocompletado', () => {
  it('municipios: exige provincia; q es opcional', async () => {
    await expect(
      validate(MunicipalitiesQueryDto, { province: 'MADRID' }, 'query'),
    ).resolves.toBeDefined();
    expect(
      await messagesOf(validate(MunicipalitiesQueryDto, { q: 'alc' }, 'query')),
    ).toMatch(/province/);
  });

  it('calles: exige provincia, municipio y al menos 2 caracteres de búsqueda', async () => {
    await expect(
      validate(
        StreetsQueryDto,
        { province: 'MADRID', municipality: 'MADRID', q: 'al' },
        'query',
      ),
    ).resolves.toBeDefined();
    expect(
      await messagesOf(
        validate(
          StreetsQueryDto,
          { province: 'MADRID', municipality: 'MADRID', q: 'a' },
          'query',
        ),
      ),
    ).toMatch(/q/);
  });
});

describe('DTOs de finca — provincia, código postal y referencia catastral', () => {
  const base = {
    name: 'Edificio Sol',
    type: 'Edificio',
    address: 'Calle Mayor',
    location: 'Madrid',
    reserveTarget: 0,
  };

  it('el alta acepta los tres campos nuevos (opcionales)', async () => {
    await expect(
      validate(CreateEstateDto, {
        ...base,
        province: 'Madrid',
        postalCode: '28009',
        cadastralReference: '2853604VK4725D',
      }),
    ).resolves.toMatchObject({
      province: 'Madrid',
      postalCode: '28009',
      cadastralReference: '2853604VK4725D',
    });
    await expect(validate(CreateEstateDto, base)).resolves.toBeDefined();
  });

  it('el alta rechaza una referencia de parcela que no tiene 14 caracteres (mayúsculas)', async () => {
    expect(
      await messagesOf(
        validate(CreateEstateDto, { ...base, cadastralReference: '123' }),
      ),
    ).toMatch(/14 caracteres/);
    expect(
      await messagesOf(
        validate(CreateEstateDto, {
          ...base,
          cadastralReference: '2853604vk4725d',
        }),
      ),
    ).toMatch(/14 caracteres/);
  });

  it('la edición acepta null para BORRAR cada dato', async () => {
    await expect(
      validate(UpdateEstateDto, {
        province: null,
        postalCode: null,
        cadastralReference: null,
      }),
    ).resolves.toMatchObject({
      province: null,
      postalCode: null,
      cadastralReference: null,
    });
  });
});
