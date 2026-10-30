import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CatastroService } from './catastro.service';
import { parseParcel } from './catastro-mapper';
import { CatastroError, type CatastroParcel } from './catastro.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { CatastroClient } from './catastro.client';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type {
  ImportCatastroDto,
  ImportCatastroUnitDto,
} from './dto/import-catastro.dto';

const BUILDING: CatastroParcel = parseParcel(
  JSON.parse(
    readFileSync(join(__dirname, 'fixtures', 'building-list.json'), 'utf8'),
  ),
);

function manager(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    role: 'B',
    estateIds: ['estate-1'],
    administratorId: 'admin-1',
    ...overrides,
  };
}

function unitDto(
  ref: string,
  overrides: Partial<ImportCatastroUnitDto> = {},
): ImportCatastroUnitDto {
  return { cadastralReference: ref, type: 'Piso', ...overrides };
}

describe('CatastroService', () => {
  let client: {
    byReference: jest.Mock;
    byAddress: jest.Mock;
    provinces: jest.Mock;
    municipalities: jest.Mock;
    streets: jest.Mock;
  };
  let estateFindFirst: jest.Mock;
  let estateFindFirstOrThrow: jest.Mock;
  let estateUpdate: jest.Mock;
  let propertyFindMany: jest.Mock;
  let propertyCreateMany: jest.Mock;
  let activityCreate: jest.Mock;
  let queryRaw: jest.Mock;
  let facadeRefresh: jest.Mock;
  let service: CatastroService;

  beforeEach(() => {
    client = {
      byReference: jest.fn().mockResolvedValue(BUILDING),
      byAddress: jest.fn().mockResolvedValue(BUILDING),
      provinces: jest.fn().mockResolvedValue([{ code: '28', name: 'MADRID' }]),
      municipalities: jest.fn(),
      streets: jest.fn(),
    };
    estateFindFirst = jest.fn().mockResolvedValue({ id: 'estate-1' });
    estateFindFirstOrThrow = jest.fn().mockResolvedValue({
      administratorId: 'admin-1',
      province: null,
      postalCode: null,
      cadastralReference: null,
    });
    estateUpdate = jest.fn().mockResolvedValue({});
    propertyFindMany = jest.fn().mockResolvedValue([]);
    propertyCreateMany = jest.fn().mockResolvedValue({ count: 0 });
    activityCreate = jest.fn().mockResolvedValue({});
    queryRaw = jest.fn().mockResolvedValue([{ id: 'estate-1' }]);
    facadeRefresh = jest.fn().mockResolvedValue(null);

    const tx = {
      $queryRaw: queryRaw,
      estate: {
        findFirstOrThrow: estateFindFirstOrThrow,
        update: estateUpdate,
      },
      property: { findMany: propertyFindMany, createMany: propertyCreateMany },
      activityLogEntry: { create: activityCreate },
    };
    const prisma = {
      estate: { findFirst: estateFindFirst },
      property: { findMany: propertyFindMany },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;

    service = new CatastroService(
      client as unknown as CatastroClient,
      prisma,
      new EstateAccessService(),
      { refreshEstate: facadeRefresh } as never,
    );
  });

  describe('lookup', () => {
    it('lee la PARCELA (14 caracteres, mayúsculas) aunque se pegue la RC de una unidad (20)', async () => {
      await service.lookup(
        'estate-1',
        { refCat: '2853604vk4725d0001yp' },
        manager(),
      );

      expect(client.byReference).toHaveBeenCalledWith('2853604VK4725D');
    });

    it('sin referencia, consulta por dirección con los cinco campos', async () => {
      await service.lookup(
        'estate-1',
        {
          provincia: 'MADRID',
          municipio: 'MADRID',
          sigla: 'CL',
          calle: 'ALCALA',
          numero: '100',
        },
        manager(),
      );

      expect(client.byAddress).toHaveBeenCalledWith({
        provincia: 'MADRID',
        municipio: 'MADRID',
        sigla: 'CL',
        calle: 'ALCALA',
        numero: '100',
      });
    });

    it('sin referencia ni dirección completa → 400', async () => {
      await expect(
        service.lookup('estate-1', { provincia: 'MADRID' }, manager()),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(client.byAddress).not.toHaveBeenCalled();
    });

    it('marca las unidades ya importadas, cuenta las importables y no escribe nada', async () => {
      propertyFindMany.mockResolvedValue([
        { cadastralReference: BUILDING.units[0].cadastralReference },
        { cadastralReference: BUILDING.units[1].cadastralReference },
      ]);

      const result = await service.lookup(
        'estate-1',
        { refCat: '2853604VK4725D' },
        manager(),
      );

      expect(result.units[0].alreadyImported).toBe(true);
      expect(result.units[2].alreadyImported).toBe(false);
      expect(result.units).toHaveLength(34);
      expect(result.units.filter((u) => u.alreadyImported)).toHaveLength(2);
      expect(result.warnings.join(' ')).toMatch(
        /2 unidad\(es\) ya están importadas/,
      );
      expect(propertyCreateMany).not.toHaveBeenCalled();
      expect(result.source).toMatchObject({
        name: 'Dirección General del Catastro',
        parcelReference: '2853604VK4725D',
      });
    });

    it('un edificio cuyos coeficientes suman 100 no genera aviso de coeficientes', async () => {
      const result = await service.lookup(
        'estate-1',
        { refCat: '2853604VK4725D' },
        manager(),
      );

      expect(result.warnings).toEqual([]);
    });

    it('avisa si los coeficientes no suman 100', async () => {
      client.byReference.mockResolvedValue({
        ...BUILDING,
        units: BUILDING.units.slice(0, 3),
      });

      const result = await service.lookup(
        'estate-1',
        { refCat: '2853604VK4725D' },
        manager(),
      );

      expect(result.warnings.join(' ')).toMatch(/suman .*% \(no 100%\)/);
    });

    it('avisa de posibles duplicados con propiedades creadas a mano (sin referencia)', async () => {
      propertyFindMany.mockResolvedValue([
        { cadastralReference: null },
        { cadastralReference: null },
      ]);

      const result = await service.lookup(
        'estate-1',
        { refCat: '2853604VK4725D' },
        manager(),
      );

      expect(result.warnings.join(' ')).toMatch(
        /2 propiedad\(es\) sin referencia catastral/,
      );
    });

    it('rechaza a un gestor de otra finca antes de tocar el Catastro', async () => {
      await expect(
        service.lookup('estate-2', { refCat: '2853604VK4725D' }, manager()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(client.byReference).not.toHaveBeenCalled();
    });

    it('finca inexistente → 404', async () => {
      estateFindFirst.mockResolvedValue(null);

      await expect(
        service.lookup('estate-1', { refCat: '2853604VK4725D' }, manager()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('cachea las consultas correctas: la segunda vez no vuelve a llamar al Catastro', async () => {
      await service.lookup('estate-1', { refCat: '2853604VK4725D' }, manager());
      await service.lookup('estate-1', { refCat: '2853604vk4725d' }, manager());

      expect(client.byReference).toHaveBeenCalledTimes(1);
    });

    it('NO cachea los errores: el siguiente intento vuelve a consultar', async () => {
      client.byReference.mockRejectedValueOnce(
        new CatastroError('unavailable', 'caído'),
      );

      await expect(
        service.lookup('estate-1', { refCat: '2853604VK4725D' }, manager()),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await service.lookup('estate-1', { refCat: '2853604VK4725D' }, manager());

      expect(client.byReference).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['not_found', NotFoundException],
      ['invalid', BadRequestException],
      ['unavailable', ServiceUnavailableException],
    ] as const)(
      'error del Catastro "%s" → excepción HTTP correspondiente',
      async (kind, expected) => {
        client.byReference.mockRejectedValue(
          new CatastroError(kind, 'mensaje del Catastro'),
        );

        const err = await service
          .lookup('estate-1', { refCat: '2853604VK4725D' }, manager())
          .catch((e: unknown) => e);

        expect(err).toBeInstanceOf(expected);
        expect((err as Error).message).toBe('mensaje del Catastro');
      },
    );
  });

  describe('importUnits', () => {
    const dto = (
      units: ImportCatastroUnitDto[],
      extra: Partial<ImportCatastroDto> = {},
    ): ImportCatastroDto => ({
      units,
      ...extra,
    });

    it('resuelve la fachada tras guardar las unidades importadas', async () => {
      estateFindFirst.mockResolvedValue({
        id: 'estate-1',
        cadastralReference: '2853604VK4725D',
      });
      const result = await service.importUnits(
        'estate-1',
        dto([unitDto('2853604VK4725D0001YP')]),
        manager(),
      );
      expect(result).toEqual({ created: 1, skipped: 0 });
      expect(facadeRefresh).toHaveBeenCalledWith('estate-1', '2853604VK4725D');
      expect(propertyCreateMany.mock.invocationCallOrder[0]).toBeLessThan(
        facadeRefresh.mock.invocationCallOrder[0],
      );
    });

    it('crea las unidades con finca, gestora, estado Vacío y referencia catastral', async () => {
      const result = await service.importUnits(
        'estate-1',
        dto([
          unitDto('2853604VK4725D0001YP', {
            floor: 'Bajo',
            participationQuota: 2.15,
            builtAreaM2: 41,
          }),
        ]),
        manager(),
      );

      expect(result).toEqual({ created: 1, skipped: 0 });
      expect(propertyCreateMany).toHaveBeenCalledTimes(1);
      expect(propertyCreateMany.mock.calls[0][0].data[0]).toMatchObject({
        estateId: 'estate-1',
        administratorId: 'admin-1',
        status: 'Vacio',
        country: 'ES',
        cadastralReference: '2853604VK4725D0001YP',
        floor: 'Bajo',
        participationQuota: 2.15,
        builtAreaM2: 41,
      });
      expect(
        propertyCreateMany.mock.calls[0][0].data[0].catastroSyncedAt,
      ).toBeInstanceOf(Date);
    });

    it('omite las referencias que la finca ya tiene (idempotencia ante doble confirmación)', async () => {
      propertyFindMany.mockResolvedValue([
        { cadastralReference: 'A'.repeat(20) },
      ]);

      const result = await service.importUnits(
        'estate-1',
        dto([unitDto('A'.repeat(20)), unitDto('B'.repeat(20))]),
        manager(),
      );

      expect(result).toEqual({ created: 1, skipped: 1 });
      expect(propertyCreateMany.mock.calls[0][0].data).toHaveLength(1);
      expect(
        propertyCreateMany.mock.calls[0][0].data[0].cadastralReference,
      ).toBe('B'.repeat(20));
    });

    it('una referencia repetida dentro del propio envío se crea una sola vez', async () => {
      const result = await service.importUnits(
        'estate-1',
        dto([unitDto('C'.repeat(20)), unitDto('C'.repeat(20))]),
        manager(),
      );

      expect(result).toEqual({ created: 1, skipped: 1 });
    });

    it('inserta por lotes de 500', async () => {
      const units = Array.from({ length: 1200 }, (_, i) =>
        unitDto(String(i).padStart(20, '0')),
      );

      await service.importUnits('estate-1', dto(units), manager());

      expect(
        propertyCreateMany.mock.calls.map((c) => c[0].data.length),
      ).toEqual([500, 500, 200]);
    });

    it('bloquea la fila de la finca antes de comprobar duplicados (serializa doble clic / dos pestañas)', async () => {
      await service.importUnits(
        'estate-1',
        dto([unitDto('D'.repeat(20))]),
        manager(),
      );

      expect(queryRaw).toHaveBeenCalledTimes(1);
      // Es un bloqueo de fila real (SELECT … FOR UPDATE), no una lectura cualquiera. La
      // consulta llega como plantilla etiquetada: el primer argumento son sus trozos de SQL.
      const sql = (queryRaw.mock.calls[0][0] as string[]).join('?');
      expect(sql).toMatch(/FROM estates/);
      expect(sql).toMatch(/FOR UPDATE/);
      expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        propertyFindMany.mock.invocationCallOrder[0],
      );
    });

    it('rellena en la finca solo los datos que le faltaban', async () => {
      await service.importUnits(
        'estate-1',
        dto(
          [
            unitDto('E'.repeat(20), {
              province: 'Madrid',
              postalCode: '28009',
            }),
          ],
          {
            parcelReference: '2853604VK4725D',
          },
        ),
        manager(),
      );

      expect(estateUpdate).toHaveBeenCalledWith({
        where: { id: 'estate-1' },
        data: {
          cadastralReference: '2853604VK4725D',
          province: 'Madrid',
          postalCode: '28009',
        },
      });
    });

    it('NO pisa lo que la finca ya tenía', async () => {
      estateFindFirstOrThrow.mockResolvedValue({
        administratorId: 'admin-1',
        province: 'Segovia',
        postalCode: '40001',
        cadastralReference: '9999999XX9999X',
      });

      await service.importUnits(
        'estate-1',
        dto(
          [
            unitDto('F'.repeat(20), {
              province: 'Madrid',
              postalCode: '28009',
            }),
          ],
          {
            parcelReference: '2853604VK4725D',
          },
        ),
        manager(),
      );

      expect(estateUpdate).not.toHaveBeenCalled();
    });

    it('registra una sola entrada de actividad resumen (no una por unidad)', async () => {
      const units = Array.from({ length: 30 }, (_, i) =>
        unitDto(String(i).padStart(20, '0')),
      );

      await service.importUnits('estate-1', dto(units), manager());

      expect(activityCreate).toHaveBeenCalledTimes(1);
      expect(activityCreate.mock.calls[0][0].data).toMatchObject({
        actorUserId: 'user-1',
        subjectType: 'property',
        subjectId: 'estate-1',
        verb: 'created',
        summary: 'Importadas 30 propiedades desde el Catastro',
        estateId: 'estate-1',
      });
    });

    it('si todo ya existía, no escribe ni registra actividad', async () => {
      propertyFindMany.mockResolvedValue([
        { cadastralReference: 'G'.repeat(20) },
      ]);

      const result = await service.importUnits(
        'estate-1',
        dto([unitDto('G'.repeat(20))]),
        manager(),
      );

      expect(result).toEqual({ created: 0, skipped: 1 });
      expect(propertyCreateMany).not.toHaveBeenCalled();
      expect(activityCreate).not.toHaveBeenCalled();
    });

    it('la fecha de acceso citada no puede ser futura', async () => {
      const future = new Date(Date.now() + 3_600_000).toISOString();

      await service.importUnits(
        'estate-1',
        dto([unitDto('H'.repeat(20))], { fetchedAt: future }),
        manager(),
      );

      const synced = propertyCreateMany.mock.calls[0][0].data[0]
        .catastroSyncedAt as Date;
      expect(synced.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('respeta la fecha de consulta enviada si es pasada', async () => {
      const past = '2026-09-20T10:00:00.000Z';

      await service.importUnits(
        'estate-1',
        dto([unitDto('I'.repeat(20))], { fetchedAt: past }),
        manager(),
      );

      expect(
        (
          propertyCreateMany.mock.calls[0][0].data[0].catastroSyncedAt as Date
        ).toISOString(),
      ).toBe(past);
    });

    it('finca inexistente o borrada → 404 y no crea nada', async () => {
      queryRaw.mockResolvedValue([]);

      await expect(
        service.importUnits(
          'estate-1',
          dto([unitDto('J'.repeat(20))]),
          manager(),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(propertyCreateMany).not.toHaveBeenCalled();
    });

    it('rechaza a un gestor de otra finca', async () => {
      await expect(
        service.importUnits(
          'estate-2',
          dto([unitDto('K'.repeat(20))]),
          manager(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('catálogos', () => {
    it('las provincias se cachean (no cambian)', async () => {
      await service.provinces();
      await service.provinces();

      expect(client.provinces).toHaveBeenCalledTimes(1);
    });

    it('un fallo del Catastro en el autocompletado es 503', async () => {
      client.streets.mockRejectedValue(
        new CatastroError('unavailable', 'caído'),
      );

      await expect(
        service.streets('MADRID', 'MADRID', 'ALC'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
