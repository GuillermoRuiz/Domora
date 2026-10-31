import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { StorageService } from '../files/storage.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  createAdministrator,
  createLedgerEstate,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import {
  ESTATE_PHOTO_MAX_BYTES,
  EstatesService,
  detectImageType,
} from './estates.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * La foto de la finca: el tipo se decide por el CONTENIDO (no por lo que
 * declare el navegador), solo la gestora de la finca puede subirla o quitarla,
 * la clave de almacenamiento no sale nunca y al sustituirla no queda basura.
 */
const prisma = createPrismaClient();
const storageRoot = mkdtempSync(path.join(tmpdir(), 'domora-estate-photo-'));
const storage = new StorageService({
  get: () => storageRoot,
} as unknown as ConfigService);
const service = new EstatesService(
  prisma as unknown as PrismaService,
  new EstateAccessService(),
  undefined as never,
  { refreshEstate: jest.fn() } as never,
  storage,
  { refreshEstate: jest.fn() } as never,
);

// Cabeceras mínimas reales de cada formato (lo que mira `detectImageType`).
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32, 2),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4, 0),
  Buffer.from('WEBP'),
  Buffer.alloc(32, 3),
]);
const file = (buffer: Buffer) => ({ buffer, size: buffer.length });

let admin: AdministratorFixture;
let otherAdmin: AdministratorFixture;
let estate: string;
let manager: AuthenticatedUser;
let owner: AuthenticatedUser;

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (foto)',
  });
  otherAdmin = await createAdministrator(prisma, {
    name: 'Otra gestora (foto)',
  });
  estate = await createLedgerEstate(prisma, admin.administratorId, {
    estate: { name: 'Finca de prueba — foto' },
  });
  manager = roleB(admin, [estate]);
  owner = {
    id: 'owner-1',
    role: 'C',
    estateIds: [estate],
    administratorId: null,
  } as unknown as AuthenticatedUser;
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await purgeAdministrator(prisma, otherAdmin.administratorId);
  await prisma.$disconnect();
  rmSync(storageRoot, { recursive: true, force: true });
});

describe('detectImageType', () => {
  it('reconoce JPG, PNG y WebP por sus primeros bytes', () => {
    expect(detectImageType(JPEG)).toEqual({
      contentType: 'image/jpeg',
      extension: 'jpg',
    });
    expect(detectImageType(PNG)).toEqual({
      contentType: 'image/png',
      extension: 'png',
    });
    expect(detectImageType(WEBP)).toEqual({
      contentType: 'image/webp',
      extension: 'webp',
    });
  });

  it('rechaza lo demás: SVG, GIF, PDF, texto y ficheros vacíos o truncados', () => {
    for (const bad of [
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
      Buffer.from('GIF89a......'),
      Buffer.from('%PDF-1.7 ....'),
      Buffer.from('hola, esto no es una imagen'),
      Buffer.alloc(0),
      Buffer.from([0xff, 0xd8]), // JPEG truncado
      Buffer.concat([
        Buffer.from('RIFF'),
        Buffer.alloc(4),
        Buffer.from('WAVE'),
        Buffer.alloc(8),
      ]), // RIFF que no es WebP
    ]) {
      expect(detectImageType(bad)).toBeNull();
    }
  });
});

describe('EstatesService.setPhoto', () => {
  it('guarda la foto, marca cuándo se subió y NO devuelve la clave de almacenamiento', async () => {
    const updated = await service.setPhoto(estate, file(PNG), manager);
    expect(updated.photoUpdatedAt).toBeInstanceOf(Date);
    expect(updated).not.toHaveProperty('photoKey');
    expect(updated).not.toHaveProperty('photoContentType');
    const stored = await prisma.estate.findUniqueOrThrow({
      where: { id: estate },
      select: { photoKey: true, photoContentType: true },
    });
    expect(stored.photoContentType).toBe('image/png');
    expect(stored.photoKey).toMatch(
      new RegExp(`^estates/${estate}/photo/[0-9a-f-]{36}-photo\\.png$`),
    );
    expect(existsSync(path.join(storageRoot, stored.photoKey!))).toBe(true);
  });

  it('el tipo lo decide el contenido: un PNG que dice ser .jpg se guarda como PNG, y un texto disfrazado de imagen se rechaza', async () => {
    await service.setPhoto(estate, file(JPEG), manager);
    expect(
      (await prisma.estate.findUniqueOrThrow({ where: { id: estate } }))
        .photoContentType,
    ).toBe('image/jpeg');
    await expect(
      service.setPhoto(
        estate,
        file(Buffer.from('<svg onload="alert(1)"></svg>')),
        manager,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('al sustituir la foto borra el fichero anterior (no deja basura)', async () => {
    await service.setPhoto(estate, file(PNG), manager);
    const first = (
      await prisma.estate.findUniqueOrThrow({ where: { id: estate } })
    ).photoKey!;
    await service.setPhoto(estate, file(WEBP), manager);
    const second = (
      await prisma.estate.findUniqueOrThrow({ where: { id: estate } })
    ).photoKey!;
    expect(second).not.toBe(first);
    expect(existsSync(path.join(storageRoot, first))).toBe(false);
    expect(existsSync(path.join(storageRoot, second))).toBe(true);
  });

  it('rechaza una foto vacía, ausente o de más de 5 MB, sin tocar la que había', async () => {
    const before = (
      await prisma.estate.findUniqueOrThrow({ where: { id: estate } })
    ).photoKey;
    await expect(
      service.setPhoto(estate, undefined, manager),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.setPhoto(estate, file(Buffer.alloc(0)), manager),
    ).rejects.toBeInstanceOf(BadRequestException);
    const big = Buffer.concat([PNG, Buffer.alloc(ESTATE_PHOTO_MAX_BYTES)]);
    await expect(
      service.setPhoto(estate, file(big), manager),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (await prisma.estate.findUniqueOrThrow({ where: { id: estate } }))
        .photoKey,
    ).toBe(before);
  });

  it('solo la gestora de la finca (o un superadmin) puede subirla: ni otra gestora ni un propietario', async () => {
    await expect(
      service.setPhoto(estate, file(PNG), roleB(otherAdmin, [estate])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.setPhoto(estate, file(PNG), owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const superadmin = {
      id: 'root',
      role: 'A',
      estateIds: [],
      administratorId: null,
    } as unknown as AuthenticatedUser;
    await expect(
      service.setPhoto(estate, file(PNG), superadmin),
    ).resolves.toBeDefined();
  });

  it('una finca que no existe da 404', async () => {
    await expect(
      service.setPhoto(
        '00000000-0000-4000-8000-000000000000',
        file(PNG),
        manager,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EstatesService.getPhoto', () => {
  it('la devuelve con el tipo guardado a quien tiene acceso (gestora y propietario), y no a quien no', async () => {
    await service.setPhoto(estate, file(JPEG), manager);
    const asManager = await service.getPhoto(estate, manager);
    expect(asManager.contentType).toBe('image/jpeg');
    expect(asManager.content.equals(JPEG)).toBe(true);
    expect((await service.getPhoto(estate, owner)).contentType).toBe(
      'image/jpeg',
    );
    await expect(
      service.getPhoto(estate, roleB(otherAdmin, [])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sin foto subida da 404', async () => {
    const other = await createLedgerEstate(prisma, admin.administratorId, {
      estate: { name: 'Finca sin foto' },
    });
    await expect(
      service.getPhoto(other, roleB(admin, [other])),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EstatesService.removePhoto', () => {
  it('quita la foto y borra el fichero; quitarla otra vez no falla', async () => {
    await service.setPhoto(estate, file(PNG), manager);
    const key = (
      await prisma.estate.findUniqueOrThrow({ where: { id: estate } })
    ).photoKey!;
    const updated = await service.removePhoto(estate, manager);
    expect(updated.photoUpdatedAt).toBeNull();
    expect(existsSync(path.join(storageRoot, key))).toBe(false);
    await expect(service.getPhoto(estate, manager)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.removePhoto(estate, manager)).resolves.toBeDefined();
  });

  it('solo la gestora de la finca puede quitarla', async () => {
    await service.setPhoto(estate, file(PNG), manager);
    await expect(
      service.removePhoto(estate, roleB(otherAdmin, [estate])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.removePhoto(estate, owner)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('las respuestas generales de la finca', () => {
  it('findById y list no exponen la clave de almacenamiento, solo cuándo se subió', async () => {
    await service.setPhoto(estate, file(PNG), manager);
    const one = await service.findById(estate, manager);
    expect(one).not.toHaveProperty('photoKey');
    expect(one.photoUpdatedAt).toBeInstanceOf(Date);
    const listed = (await service.list(manager)).find((e) => e.id === estate)!;
    expect(listed).not.toHaveProperty('photoKey');
    expect(listed).not.toHaveProperty('photoContentType');
  });
});
