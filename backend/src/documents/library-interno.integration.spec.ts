import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { createAdministrator, createEstate, createOwnerUser, createProperty, roleB, type AdministratorFixture } from '../testing/db-fixtures';
import { LibraryService } from './library.service';
import { OwnerDocumentsService } from './owner-documents.service';
import { documentVisibleWhere } from './document-access.service';
import { RagAuthorizationService } from '../assistant/rag-authorization.service';
import { StorageService } from '../files/storage.service';
import { DocumentFilesController } from '../files/files.controller';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../gdpr/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createPrismaClient } from '../prisma/create-prisma-client';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const pdf = (name: string) => ({ originalname: name, mimetype: 'application/pdf', size: PDF.length, buffer: PDF });
const LOCKED = 'La carpeta «Interno de la gestora» es solo para la gestora: ni ella ni lo que contiene se puede abrir a los propietarios ni a la junta.';

/**
 * G2 (odd/tasks/owner-documents.md): «Interno de la gestora», its subfolders and their documents
 * never reach owners. Own unique fixtures only; requires a migrated disposable PostgreSQL DB.
 */
describe('«Interno de la gestora» never reaches owners (PostgreSQL)', () => {
  const db = createPrismaClient();
  const prisma = db as unknown as PrismaService;
  const storage = new StorageService({ get: () => mkdtempSync(path.join(tmpdir(), 'domora-interno-')) } as unknown as ConfigService);
  const notify = jest.fn().mockResolvedValue(undefined);
  const auth = new RagAuthorizationService(prisma);
  const library = new LibraryService(prisma, storage, auth, { notify } as never);
  const owners = new OwnerDocumentsService(prisma);
  const files = new DocumentFilesController(prisma, storage, auth, { logAccess: jest.fn() } as unknown as AuditService);
  let fx: AdministratorFixture;
  let estateId: string, p1: string, ownerId: string;
  let manager: AuthenticatedUser, owner: AuthenticatedUser;
  let interno: string, internoSub: string, legal: string;
  const folder = async (key: string) => (await db.documentFolder.findFirstOrThrow({ where: { estateId, systemKey: key } })).id;
  const stored = (id: string) => db.document.findUniqueOrThrow({ where: { id } });
  const ownerTitles = async () => (await owners.list(owner, {})).items.map((d) => d.title);
  const visibleToOwner = async (id: string) =>
    (await db.document.count({ where: { AND: [{ id }, await documentVisibleWhere(prisma, owner)] } })) === 1;

  beforeAll(async () => {
    fx = await createAdministrator(db);
    estateId = await createEstate(db, fx.administratorId);
    p1 = await createProperty(db, estateId, { ref: '1A' });
    ownerId = await createOwnerUser(db, { fullName: 'Propietaria' });
    await db.propertyMembership.create({ data: { userId: ownerId, propertyId: p1, roleType: 'Propietario', status: 'linked', linkedAt: new Date() } });
    manager = roleB(fx, [estateId]);
    owner = { id: ownerId, role: 'C', estateIds: [estateId], administratorId: null };
    await library.ensureTemplate(estateId);
    interno = await folder('interno');
    legal = await folder('legal');
    internoSub = (await library.createFolder(estateId, { name: 'Recursos humanos', parentId: interno }, manager)).id;
    await library.updateFolder(estateId, legal, { visibility: 'OWNERS' }, manager);
  }, 30000);

  afterAll(async () => {
    await db.document.deleteMany({ where: { estateId } });
    await db.documentFolder.updateMany({ where: { estateId }, data: { parentId: null } });
    await db.documentFolder.deleteMany({ where: { estateId } });
    await db.propertyMembership.deleteMany({ where: { userId: ownerId } });
    await db.property.deleteMany({ where: { id: p1 } });
    await db.estate.deleteMany({ where: { id: estateId } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, fx.userId] } } });
    await db.administrator.deleteMany({ where: { id: fx.administratorId } });
    await db.$disconnect();
  });

  beforeEach(() => notify.mockClear());

  describe('folders', () => {
    it.each(['OWNERS', 'BOARD'] as const)('refuses opening the interno folder to %s', async (visibility) => {
      await expect(library.updateFolder(estateId, interno, { visibility }, manager)).rejects.toThrow(new BadRequestException(LOCKED));
      expect((await db.documentFolder.findUniqueOrThrow({ where: { id: interno } })).visibility).toBe('MANAGER');
    });

    it('refuses opening a subfolder of interno', async () => {
      await expect(library.updateFolder(estateId, internoSub, { visibility: 'OWNERS' }, manager)).rejects.toThrow(new BadRequestException(LOCKED));
    });

    it('refuses creating a subfolder of interno with a wider visibility', async () => {
      await expect(library.createFolder(estateId, { name: 'Abierta', parentId: interno, visibility: 'OWNERS' }, manager)).rejects.toThrow(new BadRequestException(LOCKED));
      await expect(library.createFolder(estateId, { name: 'Abierta', parentId: internoSub, visibility: 'BOARD' }, manager)).rejects.toThrow(new BadRequestException(LOCKED));
      expect(await db.documentFolder.count({ where: { estateId, name: 'Abierta' } })).toBe(0);
    });

    it('a public folder moved under interno closes, and opens again when moved out (recomputed as today)', async () => {
      const open = await library.createFolder(estateId, { name: 'Publica', visibility: 'OWNERS' }, manager);
      const doc = await library.upload(estateId, pdf('Circular.pdf'), { folderId: open.id }, manager);
      expect(doc.effectiveVisibility).toBe('OWNERS');
      await library.updateFolder(estateId, open.id, { parentId: internoSub }, manager);
      expect((await stored(doc.id)).effectiveVisibility).toBe('MANAGER');
      expect(await ownerTitles()).not.toContain('Circular.pdf');
      await library.updateFolder(estateId, open.id, { parentId: null }, manager);
      expect((await stored(doc.id)).effectiveVisibility).toBe('OWNERS');
      expect(await ownerTitles()).toContain('Circular.pdf');
    });

    it('the manager still renames, creates and keeps «Solo gestora» folders inside interno', async () => {
      const sub = await library.createFolder(estateId, { name: 'Nóminas', parentId: interno, visibility: 'MANAGER' }, manager);
      await library.updateFolder(estateId, sub.id, { name: 'Nóminas 2026', visibility: null }, manager);
      const listed = await library.list(estateId, manager, {});
      expect(listed.folders.find((f) => f.id === sub.id)).toMatchObject({ name: 'Nóminas 2026', effectiveVisibility: 'MANAGER' });
      expect(listed.folders.find((f) => f.id === interno)).toMatchObject({ effectiveVisibility: 'MANAGER' });
    });
  });

  describe('documents', () => {
    it('refuses uploading into interno with a wider visibility or for a property', async () => {
      await expect(library.upload(estateId, pdf('Abierto.pdf'), { folderId: internoSub, visibility: 'OWNERS' }, manager)).rejects.toThrow(new BadRequestException(LOCKED));
      await expect(library.upload(estateId, pdf('Abierto.pdf'), { folderId: interno, targetPropertyId: p1 }, manager)).rejects.toThrow(new BadRequestException(LOCKED));
      expect(await db.document.count({ where: { estateId, title: 'Abierto.pdf' } })).toBe(0);
    });

    it('the manager still uploads into interno, «Solo gestora»', async () => {
      const doc = await library.upload(estateId, pdf('Nómina.pdf'), { folderId: internoSub }, manager);
      expect(doc).toMatchObject({ effectiveVisibility: 'MANAGER' });
      expect((await library.list(estateId, manager, { folderId: internoSub })).documents.map((d) => d.title)).toContain('Nómina.pdf');
    });

    it('refuses opening a document that lives in interno', async () => {
      const doc = await library.upload(estateId, pdf('Informe.pdf'), { folderId: interno }, manager);
      await expect(library.updateDocument(estateId, doc.id, { visibility: 'OWNERS' }, manager)).rejects.toThrow(new BadRequestException(LOCKED));
      await expect(library.updateDocument(estateId, doc.id, { visibility: 'PROPERTY', targetPropertyId: p1 }, manager)).rejects.toThrow(new BadRequestException(LOCKED));
      // Moving it in with a wider visibility in the same request is refused too.
      const outside = await library.upload(estateId, pdf('Fuera.pdf'), { folderId: legal }, manager);
      await expect(library.updateDocument(estateId, outside.id, { folderId: internoSub, visibility: 'BOARD' }, manager)).rejects.toThrow(new BadRequestException(LOCKED));
      expect(await stored(doc.id)).toMatchObject({ visibility: null, effectiveVisibility: 'MANAGER', targetPropertyId: null });
      // Editing what does not open it still works.
      await library.updateDocument(estateId, doc.id, { title: 'Informe anual.pdf', description: 'Interno' }, manager);
      expect(await stored(doc.id)).toMatchObject({ title: 'Informe anual.pdf', effectiveVisibility: 'MANAGER' });
    });

    it('moving a document into interno forces it back to «Solo gestora»; moving it out recomputes as today', async () => {
      const doc = await library.upload(estateId, pdf('Carta 1A.pdf'), { targetPropertyId: p1 }, manager);
      expect(await ownerTitles()).toContain('Carta 1A.pdf');
      await library.updateDocument(estateId, doc.id, { folderId: internoSub }, manager);
      expect(await stored(doc.id)).toMatchObject({ visibility: null, targetPropertyId: null, effectiveVisibility: 'MANAGER' });
      expect(await ownerTitles()).not.toContain('Carta 1A.pdf');
      notify.mockClear();
      await library.updateDocument(estateId, doc.id, { folderId: legal }, manager);
      expect(await stored(doc.id)).toMatchObject({ visibility: null, effectiveVisibility: 'OWNERS' });
      expect(await ownerTitles()).toContain('Carta 1A.pdf');
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('opening a document outside interno still works for the manager (existing behaviour)', async () => {
      const doc = await library.upload(estateId, pdf('Acta abierta.pdf'), {}, manager);
      const updated = await library.updateDocument(estateId, doc.id, { visibility: 'OWNERS' }, manager);
      expect(updated.effectiveVisibility).toBe('OWNERS');
      expect(notify.mock.calls.at(-1)?.[0]).toMatchObject({ userIds: [ownerId], link: `/c/documentacion?doc=${doc.id}` });
    });

    it('nothing in interno is ever announced to owners', async () => {
      await library.upload(estateId, pdf('Silencio.pdf'), { folderId: internoSub }, manager);
      await library.recompute(estateId);
      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe('defence in depth: a row opened behind the application\'s back', () => {
    it.each([
      ['in the interno folder', () => interno],
      ['in a subfolder of interno', () => internoSub],
    ])('a document %s with effective visibility OWNERS written by raw SQL is not listed nor downloadable', async (_case, folderOf) => {
      const doc = await library.upload(estateId, pdf('Filtrado.pdf'), { folderId: folderOf() }, manager);
      await db.$executeRaw`UPDATE documents SET effective_visibility = 'OWNERS', visibility = 'OWNERS' WHERE id = ${doc.id}::uuid`;
      try {
        expect(await visibleToOwner(doc.id)).toBe(false);
        expect(await ownerTitles()).not.toContain('Filtrado.pdf');
        expect((await library.list(estateId, owner, { folderId: folderOf() })).documents).toEqual([]);
        await expect(files.download(doc.id, owner, { setHeader: jest.fn(), send: jest.fn() } as unknown as Response)).rejects.toThrow(new NotFoundException('Documento no encontrado.'));
        // The manager keeps seeing it.
        expect((await library.list(estateId, manager, { folderId: folderOf() })).documents.map((d) => d.title)).toContain('Filtrado.pdf');
      } finally {
        await db.document.delete({ where: { id: doc.id } });
      }
    });

    it('documents in an opened folder outside interno and at the root are still visible to owners', async () => {
      const inLegal = await library.upload(estateId, pdf('Visible.pdf'), { folderId: legal }, manager);
      const atRoot = await library.upload(estateId, pdf('Raiz.pdf'), { visibility: 'OWNERS' }, manager);
      expect(await visibleToOwner(inLegal.id)).toBe(true);
      expect(await visibleToOwner(atRoot.id)).toBe(true);
    });
  });
});
