import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ForbiddenException } from '@nestjs/common';
import { EstatesService } from './estates.service';
import { UpdateEstateDto } from './dto/create-estate.dto';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';

async function cifErrors(cif: unknown): Promise<string[]> {
  const dto = plainToInstance(UpdateEstateDto, { cif });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'cif').flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('UpdateEstateDto.cif', () => {
  it.each(['H12345678', 'h1234567j', 'E87654321'])('acepta %s (formato de CIF español)', async (cif) => {
    expect(await cifErrors(cif)).toEqual([]);
  });

  it.each(['12345678Z', 'H1234567', 'X12345678', 'H12345678X'])('rechaza %s', async (cif) => {
    expect(await cifErrors(cif)).not.toEqual([]);
  });

  it('acepta null para borrarlo', async () => {
    expect(await cifErrors(null)).toEqual([]);
  });
});

describe('UpdateEstateDto.description', () => {
  async function descriptionErrors(description: unknown): Promise<string[]> {
    const errors = await validate(plainToInstance(UpdateEstateDto, { description }));
    return errors.filter((e) => e.property === 'description').flatMap((e) => Object.values(e.constraints ?? {}));
  }

  it('acepta un texto de hasta 600 caracteres y null para borrarlo', async () => {
    expect(await descriptionErrors('Comunidad residencial en el centro.')).toEqual([]);
    expect(await descriptionErrors('x'.repeat(600))).toEqual([]);
    expect(await descriptionErrors(null)).toEqual([]);
  });

  it('rechaza más de 600 caracteres o un valor que no es texto', async () => {
    expect(await descriptionErrors('x'.repeat(601))).not.toEqual([]);
    expect(await descriptionErrors(42)).not.toEqual([]);
  });
});

describe('EstatesService.update — cif', () => {
  const B: AuthenticatedUser = { id: 'b1', role: 'B', estateIds: ['e1'], administratorId: 'admin-1' };
  let update: jest.Mock;
  let service: EstatesService;

  beforeEach(() => {
    update = jest.fn().mockResolvedValue({});
    const prisma = {
      estate: {
        findFirst: jest.fn().mockResolvedValue({ id: 'e1', administratorId: 'admin-1', deletedAt: null }),
        update,
      },
    } as unknown as PrismaService;
    service = new EstatesService(prisma, undefined as never, undefined as never, undefined as never, undefined as never, { refreshEstate: jest.fn() } as never); // EstateAccess/Crypto/facade/storage/geo: cif no los usa
  });

  it('guarda el CIF normalizado en mayúsculas', async () => {
    await service.update('e1', { cif: 'h1234567j' }, B);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cif: 'H1234567J' }) }));
  });

  it('null lo borra tal cual', async () => {
    await service.update('e1', { cif: null }, B);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ cif: null }) }));
  });

  it('una gestora de otra administradora no puede tocarlo', async () => {
    const other: AuthenticatedUser = { ...B, administratorId: 'admin-otra' };
    await expect(service.update('e1', { cif: 'H12345678' }, other)).rejects.toThrow(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  /** The reference is compared under a row lock (SELECT … FOR UPDATE), not with the snapshot read before. */
  function withLockedRow(row: { cadastral_reference: string | null; catastro_facade_resolved_at: Date | null }, saved: object) {
    const update = jest.fn().mockResolvedValue(saved);
    const queryRaw = jest.fn().mockResolvedValue([row]);
    const tx = { estate: { update }, $queryRaw: queryRaw };
    const prisma = {
      estate: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', administratorId: 'admin-1', cadastralReference: 'SNAPSHOT-STALE' }), update },
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    return { prisma, update, queryRaw };
  }
  const RC = '1907401VK4810H';
  const URL_OK = 'https://ovc.catastro.meh.es/OVCServWeb/OVCWcfLibres/OVCFotoFachada.svc/RecuperarFotoFachadaGet?ReferenciaCatastral=1907401VK4810H';

  it('guardar la MISMA referencia catastral no borra la fachada ni vuelve a consultar al Catastro', async () => {
    const refreshEstate = jest.fn();
    const { prisma, update, queryRaw } = withLockedRow({ cadastral_reference: RC, catastro_facade_resolved_at: new Date() }, { id: 'e1', cadastralReference: RC, catastroFacadeUrl: URL_OK });
    const subject = new EstatesService(prisma, undefined as never, undefined as never, { refreshEstate } as never, undefined as never, { refreshEstate: jest.fn() } as never);
    const result = await subject.update('e1', { name: 'Otro nombre', cadastralReference: RC }, B);
    expect(queryRaw).toHaveBeenCalled();
    expect(update.mock.calls[0][0].data).not.toHaveProperty('catastroFacadeUrl');
    expect(refreshEstate).not.toHaveBeenCalled();
    expect(result.catastroFacadeUrl).toBe(URL_OK);
  });

  it('una referencia catastral distinta (según la fila bloqueada) invalida la fachada y devuelve la nueva', async () => {
    const refreshEstate = jest.fn().mockResolvedValue(URL_OK);
    const { prisma, update } = withLockedRow({ cadastral_reference: '9872023VH5797S', catastro_facade_resolved_at: new Date() }, { id: 'e1', cadastralReference: RC, catastroFacadeUrl: null, catastroFacadeResolvedAt: null });
    const subject = new EstatesService(prisma, undefined as never, undefined as never, { refreshEstate } as never, undefined as never, { refreshEstate: jest.fn() } as never);
    const result = await subject.update('e1', { cadastralReference: RC }, B);
    expect(update.mock.calls[0][0].data).toMatchObject({ catastroFacadeUrl: null, catastroFacadeResolvedAt: null });
    expect(refreshEstate).toHaveBeenCalledWith('e1', RC);
    expect(result.catastroFacadeUrl).toBe(URL_OK);
    expect(result.catastroFacadeResolvedAt).toBeInstanceOf(Date);
  });

  it('la misma referencia nunca resuelta (sin intento previo) sí consulta al Catastro', async () => {
    const refreshEstate = jest.fn().mockResolvedValue(URL_OK);
    const { prisma } = withLockedRow({ cadastral_reference: RC, catastro_facade_resolved_at: null }, { id: 'e1', cadastralReference: RC, catastroFacadeUrl: null });
    const subject = new EstatesService(prisma, undefined as never, undefined as never, { refreshEstate } as never, undefined as never, { refreshEstate: jest.fn() } as never);
    expect((await subject.update('e1', { cadastralReference: RC }, B)).catastroFacadeUrl).toBe(URL_OK);
  });

  it('borrar la referencia (null) borra la fachada', async () => {
    const refreshEstate = jest.fn().mockResolvedValue(null);
    const { prisma, update } = withLockedRow({ cadastral_reference: RC, catastro_facade_resolved_at: new Date() }, { id: 'e1', cadastralReference: null, catastroFacadeUrl: null });
    const subject = new EstatesService(prisma, undefined as never, undefined as never, { refreshEstate } as never, undefined as never, { refreshEstate: jest.fn() } as never);
    const result = await subject.update('e1', { cadastralReference: null }, B);
    expect(update.mock.calls[0][0].data).toMatchObject({ catastroFacadeUrl: null });
    expect(result.catastroFacadeUrl).toBeNull();
    expect(result.catastroFacadeResolvedAt).toBeNull();
  });
});

describe('UpdateEstateDto: datos generales (año, uso, referencia interna, fiscal, observaciones)', () => {
  async function errorsOf(body: Record<string, unknown>): Promise<string[]> {
    // Same options as the global ValidationPipe: unknown fields are an error.
    const errors = await validate(plainToInstance(UpdateEstateDto, body), { whitelist: true, forbidNonWhitelisted: true });
    return errors.map((e) => e.property);
  }

  it('acepta valores válidos y null para borrarlos', async () => {
    expect(await errorsOf({
      yearBuilt: 2001, mainUse: 'Residencial', internalRef: 'FIN-0001',
      taxRegime: 'Entidad en régimen de atribución de rentas', applicableLaw: 'Ley de Propiedad Horizontal',
      notes: 'Revisar la impermeabilización de la cubierta en 2026.',
    })).toEqual([]);
    expect(await errorsOf({ yearBuilt: null, mainUse: null, internalRef: null, taxRegime: null, applicableLaw: null, notes: null })).toEqual([]);
  });

  it('rechaza un año fuera de rango o no entero, un uso que no está en la lista y textos demasiado largos', async () => {
    expect(await errorsOf({ yearBuilt: 1499 })).toEqual(['yearBuilt']);
    expect(await errorsOf({ yearBuilt: 2101 })).toEqual(['yearBuilt']);
    expect(await errorsOf({ yearBuilt: 2001.5 })).toEqual(['yearBuilt']);
    expect(await errorsOf({ mainUse: 'Industrial' })).toEqual(['mainUse']);
    expect(await errorsOf({ internalRef: 'x'.repeat(51) })).toEqual(['internalRef']);
    expect(await errorsOf({ taxRegime: 'x'.repeat(151) })).toEqual(['taxRegime']);
    expect(await errorsOf({ applicableLaw: 'x'.repeat(151) })).toEqual(['applicableLaw']);
    expect(await errorsOf({ notes: 'x'.repeat(2001) })).toEqual(['notes']);
  });
});

describe('EstatesService.update — datos generales', () => {
  const B: AuthenticatedUser = { id: 'b1', role: 'B', estateIds: ['e1'], administratorId: 'admin-1' };

  it('una actualización parcial solo envía los campos recibidos (no pisa el resto)', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = { estate: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', administratorId: 'admin-1', deletedAt: null }), update } } as unknown as PrismaService;
    const geo = { refreshEstate: jest.fn() };
    const service = new EstatesService(prisma, undefined as never, undefined as never, undefined as never, undefined as never, geo as never);
    await service.update('e1', { yearBuilt: 2001, notes: null }, B);
    expect(geo.refreshEstate).not.toHaveBeenCalled();
    const data = update.mock.calls[0][0].data;
    expect(data).toMatchObject({ yearBuilt: 2001, notes: null });
    for (const untouched of ['name', 'mainUse', 'internalRef', 'taxRegime', 'applicableLaw', 'description', 'cif']) expect(data[untouched]).toBeUndefined();
  });
});

describe('EstatesService.update — ubicación para el mapa', () => {
  const B: AuthenticatedUser = { id: 'b1', role: 'B', estateIds: ['e1'], administratorId: 'admin-1' };
  it.each([['address', 'Calle Mayor'], ['streetNumber', '3'], ['postalCode', '28001'], ['location', 'Madrid'], ['province', 'Madrid']])(
    'cambiar %s vuelve a ubicar la finca en segundo plano', async (field, value) => {
      const prisma = { estate: { findFirst: jest.fn().mockResolvedValue({ id: 'e1', administratorId: 'admin-1' }), update: jest.fn().mockResolvedValue({}) } } as unknown as PrismaService;
      const geo = { refreshEstate: jest.fn() };
      await new EstatesService(prisma, undefined as never, undefined as never, undefined as never, undefined as never, geo as never).update('e1', { [field]: value }, B);
      expect(geo.refreshEstate).toHaveBeenCalledWith('e1');
    });

  it('guardar la misma dirección (el formulario la envía siempre) no vuelve a ubicarla', async () => {
    const stored = { id: 'e1', administratorId: 'admin-1', address: 'Calle Mayor', streetNumber: '3', postalCode: '28001', location: 'Madrid', province: 'Madrid', cadastralReference: null };
    const prisma = { estate: { findFirst: jest.fn().mockResolvedValue(stored), update: jest.fn().mockResolvedValue({}) } } as unknown as PrismaService;
    const geo = { refreshEstate: jest.fn() };
    await new EstatesService(prisma, undefined as never, undefined as never, undefined as never, undefined as never, geo as never)
      .update('e1', { address: 'Calle Mayor', streetNumber: '3', postalCode: '28001', location: 'Madrid', province: 'Madrid', name: 'Otro nombre' }, B);
    expect(geo.refreshEstate).not.toHaveBeenCalled();
  });
});
