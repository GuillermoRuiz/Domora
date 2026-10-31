import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import {
  createAdministrator,
  createEstate,
  createOwnerUser,
  createProperty,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { LibraryService } from './library.service';
import { RagAuthorizationService } from '../assistant/rag-authorization.service';
import { StorageService } from '../files/storage.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { createPrismaClient } from '../prisma/create-prisma-client';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const pdf = (name = 'acta.pdf') => ({
  originalname: name,
  mimetype: 'application/pdf',
  size: PDF.length,
  buffer: PDF,
});

/** Own unique fixtures only; requires a migrated disposable PostgreSQL DB. */
describe('LibraryService (PostgreSQL)', () => {
  const db = createPrismaClient();
  const storage = new StorageService({
    get: () => mkdtempSync(path.join(tmpdir(), 'domora-library-')),
  } as unknown as ConfigService);
  const notify = jest.fn().mockResolvedValue(undefined);
  const library = new LibraryService(
    db as unknown as PrismaService,
    storage,
    new RagAuthorizationService(db as unknown as PrismaService),
    { notify } as never,
  );
  let fx: AdministratorFixture;
  let estateId: string, p1: string, ownerId: string;
  let manager: AuthenticatedUser, owner: AuthenticatedUser;
  const folder = async (key: string) =>
    (
      await db.documentFolder.findFirstOrThrow({
        where: { estateId, systemKey: key },
      })
    ).id;
  const titlesFor = async (user: AuthenticatedUser, folderId?: string) =>
    (await library.list(estateId, user, { folderId })).documents
      .map((d) => d.title)
      .sort();

  beforeAll(async () => {
    fx = await createAdministrator(db);
    estateId = await createEstate(db, fx.administratorId);
    p1 = await createProperty(db, estateId, { ref: '1A' });
    ownerId = await createOwnerUser(db, { fullName: 'Propietaria' });
    await db.propertyMembership.create({
      data: {
        userId: ownerId,
        propertyId: p1,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: new Date(),
      },
    });
    manager = roleB(fx, [estateId]);
    owner = {
      id: ownerId,
      role: 'C',
      estateIds: [estateId],
      administratorId: null,
    };
  }, 30000);

  afterAll(async () => {
    await db.document.deleteMany({ where: { estateId } });
    await db.documentFolder.updateMany({
      where: { estateId },
      data: { parentId: null },
    });
    await db.documentFolder.deleteMany({ where: { estateId } });
    await db.propertyMembership.deleteMany({ where: { userId: ownerId } });
    await db.property.deleteMany({ where: { id: p1 } });
    await db.estate.deleteMany({ where: { id: estateId } });
    await db.user.deleteMany({ where: { id: { in: [ownerId, fx.userId] } } });
    await db.administrator.deleteMany({ where: { id: fx.administratorId } });
    await db.$disconnect();
  });

  beforeEach(() => notify.mockClear());

  it('creates the seven template folders, all «Solo gestora», and an uploaded document is born «Solo gestora» (S7)', async () => {
    const listed = await library.list(estateId, manager, {});
    expect(listed.folders.map((f) => f.name)).toEqual([
      'Documentación legal',
      'Actas y juntas',
      'Contabilidad y presupuestos',
      'Seguros',
      'Contratos y mantenimiento',
      'Certificados e inspecciones',
      'Interno de la gestora',
    ]);
    expect(
      listed.folders.every((f) => f.effectiveVisibility === 'MANAGER'),
    ).toBe(true);
    const doc = await library.upload(
      estateId,
      pdf('Estatutos.pdf'),
      { folderId: await folder('legal'), type: 'Estatutos' },
      manager,
    );
    expect(doc).toMatchObject({
      title: 'Estatutos.pdf',
      visibility: null,
      effectiveVisibility: 'MANAGER',
      mimeType: 'application/pdf',
      sizeBytes: PDF.length,
    });
    expect(await titlesFor(owner, await folder('legal'))).toEqual([]);
  });

  it('opening a folder to the owners opens the documents that inherit, and reports them as just opened', async () => {
    const legal = await folder('legal');
    const { opened } = await library.updateFolder(
      estateId,
      legal,
      { visibility: 'OWNERS' },
      manager,
    );
    expect(opened).toHaveLength(1);
    // The owners are told once, with the document's name.
    expect(notify).toHaveBeenCalledTimes(1);
    const estatutos = await db.document.findFirstOrThrow({
      where: { estateId, title: 'Estatutos.pdf' },
    });
    // The notice opens that document in the owner's «Documentación».
    expect(notify.mock.calls[0][0]).toMatchObject({
      userIds: [ownerId],
      category: 'document',
      title: 'Nuevo documento: Estatutos.pdf',
      link: `/c/documentacion?doc=${estatutos.id}`,
    });
    expect(await titlesFor(owner, legal)).toEqual(['Estatutos.pdf']);
    // Folders without anything for the owner are not shown to them.
    expect(
      (await library.list(estateId, owner, {})).folders.map((f) => f.name),
    ).toEqual(['Documentación legal']);
    // The manager knows what owners see in each folder («Ver como propietario»).
    const forManager = await library.list(estateId, manager, {});
    expect(
      forManager.folders.find((f) => f.systemKey === 'legal'),
    ).toMatchObject({ ownerDocumentCount: 1, documentCount: 1 });
    expect(
      forManager.folders.find((f) => f.systemKey === 'actas'),
    ).toMatchObject({ ownerDocumentCount: 0 });
  });

  it('a document can keep its own visibility inside a public folder («Visibilidad propia»)', async () => {
    const legal = await folder('legal');
    const internal = await library.upload(
      estateId,
      pdf('Informe interno.pdf'),
      { folderId: legal, visibility: 'MANAGER' },
      manager,
    );
    expect(internal.effectiveVisibility).toBe('MANAGER');
    expect(await titlesFor(owner, legal)).toEqual(['Estatutos.pdf']);
    // Back to inheriting: now the owner sees it too.
    await library.updateDocument(
      estateId,
      internal.id,
      { visibility: null },
      manager,
    );
    expect(await titlesFor(owner, legal)).toEqual([
      'Estatutos.pdf',
      'Informe interno.pdf',
    ]);
  });

  it('subfolders inherit; a private subfolder hides what it holds even under a public folder', async () => {
    const legal = await folder('legal');
    const sub = await library.createFolder(
      estateId,
      { name: 'Borradores', parentId: legal, visibility: 'MANAGER' },
      manager,
    );
    const draft = await library.upload(
      estateId,
      pdf('Borrador.pdf'),
      { folderId: sub.id },
      manager,
    );
    expect(draft.effectiveVisibility).toBe('MANAGER');
    await library.updateFolder(estateId, sub.id, { visibility: null }, manager);
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: draft.id } }))
        .effectiveVisibility,
    ).toBe('OWNERS');
  });

  it('a document for one property is seen only by its owners', async () => {
    const doc = await library.upload(
      estateId,
      pdf('Carta 1A.pdf'),
      { targetPropertyId: p1 },
      manager,
    );
    expect(doc).toMatchObject({
      visibility: 'PROPERTY',
      effectiveVisibility: 'PROPERTY',
      targetPropertyId: p1,
    });
    expect(notify.mock.calls.map((c) => c[0].userIds)).toEqual([[ownerId]]);
    expect(await titlesFor(owner)).toContain('Carta 1A.pdf');
  });

  it('nobody is notified while a document stays «Solo gestora», and tenants or other properties never are', async () => {
    const tenant = await createOwnerUser(db, { fullName: 'Inquilina' });
    const p2 = await createProperty(db, estateId, { ref: '2B' });
    const neighbour = await createOwnerUser(db, { fullName: 'Vecino 2B' });
    await db.propertyMembership.create({
      data: {
        userId: tenant,
        propertyId: p1,
        roleType: 'Inquilino',
        status: 'linked',
        linkedAt: new Date(),
      },
    });
    await db.propertyMembership.create({
      data: {
        userId: neighbour,
        propertyId: p2,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: new Date(),
      },
    });
    try {
      await library.upload(estateId, pdf('Privado.pdf'), {}, manager);
      expect(notify).not.toHaveBeenCalled();
      await library.upload(
        estateId,
        pdf('Solo 1A.pdf'),
        { targetPropertyId: p1 },
        manager,
      );
      expect(notify.mock.calls.map((c) => c[0].userIds)).toEqual([[ownerId]]);
    } finally {
      await db.propertyMembership.deleteMany({
        where: { userId: { in: [tenant, neighbour] } },
      });
      await db.document.updateMany({
        where: { targetPropertyId: p2 },
        data: { targetPropertyId: null },
      });
      await db.property.deleteMany({ where: { id: p2 } });
      await db.user.deleteMany({ where: { id: { in: [tenant, neighbour] } } });
    }
  });

  it('protects the template, unique names and the folder tree', async () => {
    const legal = await folder('legal');
    await expect(
      library.deleteFolder(estateId, legal, manager),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      library.updateFolder(
        estateId,
        legal,
        { parentId: await folder('actas') },
        manager,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      library.createFolder(estateId, { name: 'documentación LEGAL' }, manager),
    ).rejects.toBeInstanceOf(ConflictException);
    const a = await library.createFolder(estateId, { name: 'A' }, manager);
    const b = await library.createFolder(
      estateId,
      { name: 'B', parentId: a.id },
      manager,
    );
    await expect(
      library.updateFolder(estateId, a.id, { parentId: b.id }, manager),
    ).rejects.toBeInstanceOf(BadRequestException);
    await library.upload(
      estateId,
      pdf('dentro.pdf'),
      { folderId: b.id },
      manager,
    );
    await expect(
      library.deleteFolder(estateId, b.id, manager),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('the trash hides a document from everybody until restored; generated documents cannot be trashed', async () => {
    const doc = (
      await db.document.findFirstOrThrow({
        where: { estateId, title: 'Estatutos.pdf' },
      })
    ).id;
    await library.trash(estateId, doc, manager);
    expect(await titlesFor(owner)).not.toContain('Estatutos.pdf');
    expect(
      (await library.list(estateId, manager, { view: 'trash' })).documents.map(
        (d) => d.title,
      ),
    ).toEqual(['Estatutos.pdf']);
    await library.restore(estateId, doc, manager);
    expect(await titlesFor(owner, await folder('legal'))).toContain(
      'Estatutos.pdf',
    );

    const generated = await db.document.create({
      data: {
        estateId,
        title: 'Acta generada',
        type: 'Acta',
        date: new Date(),
        size: '—',
        source: 'generated',
        sourceRef: 'meeting:00000000-0000-4000-8000-000000000001',
      },
    });
    await expect(
      library.trash(estateId, generated.id, manager),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      library.updateDocument(
        estateId,
        generated.id,
        { title: 'Otro' },
        manager,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('documents hidden by the migration are flagged until their visibility is decided or kept private', async () => {
    const a = await db.document.create({
      data: {
        estateId,
        title: 'Antiguo A',
        type: 'Otro',
        date: new Date(),
        size: '1 KB',
        visibilityReviewPending: true,
      },
    });
    const b = await db.document.create({
      data: {
        estateId,
        title: 'Antiguo B',
        type: 'Otro',
        date: new Date(),
        size: '1 KB',
        visibilityReviewPending: true,
      },
    });
    expect((await library.list(estateId, manager, {})).pendingReview).toBe(2);
    expect(
      (await library.list(estateId, manager, { view: 'review' })).documents
        .map((d) => d.title)
        .sort(),
    ).toEqual(['Antiguo A', 'Antiguo B']);
    await library.updateDocument(
      estateId,
      a.id,
      { visibility: 'OWNERS' },
      manager,
    );
    await library.markReviewed(estateId, [b.id], false, manager);
    expect((await library.list(estateId, manager, {})).pendingReview).toBe(0);
    expect(
      (await db.document.findUniqueOrThrow({ where: { id: b.id } }))
        .effectiveVisibility,
    ).toBe('MANAGER');
  });

  it('a document created before the library stored its type shows the type of its file, so it can be previewed', async () => {
    const old = await db.document.create({
      data: {
        estateId,
        title: 'Presupuesto antiguo',
        type: 'Presupuesto',
        date: new Date(),
        size: '2 KB',
        s3Key: `documents/${estateId}/x-Presupuesto.pdf`,
      },
    });
    const root = (await library.list(estateId, manager, {})).documents.find(
      (d) => d.id === old.id,
    );
    expect(root?.mimeType).toBe('application/pdf');
    await db.document.delete({ where: { id: old.id } });
  });

  it('rejects a file whose content does not match its type, and owners cannot manage the library', async () => {
    await expect(
      library.upload(
        estateId,
        { ...pdf('falso.pdf'), buffer: Buffer.from('<html>no</html>') },
        {},
        manager,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      library.upload(estateId, pdf(), {}, owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      library.createFolder(estateId, { name: 'Mía' }, owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      library.list(estateId, owner, { view: 'trash' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('signed actas (T3)', () => {
    const meeting = (data: Record<string, unknown>) =>
      db.meeting.create({
        data: {
          estateId,
          title: 'Junta ordinaria 2026',
          type: 'ordinaria',
          scheduledAt1: new Date('2026-03-15T17:00:00Z'),
          scheduledAt2: new Date('2026-03-15T17:30:00Z'),
          agenda: [],
          convokedBy: 'presidente',
          signerRole: 'administrador',
          createdByUserId: fx.userId,
          status: 'firmada',
          actaSignedAt: new Date(),
          ...data,
        } as never,
      });

    it('a signed acta enters «Actas y juntas» as «Solo gestora», once', async () => {
      const m = await meeting({});
      await db.meeting.update({
        where: { id: m.id },
        data: { actaS3Key: `meetings/${m.id}/acta/acta-junta.docx` },
      });
      const first = await library.registerSignedActa(m.id);
      const again = await library.registerSignedActa(m.id);
      expect(again).toBe(first);
      const doc = await db.document.findUniqueOrThrow({
        where: { id: first! },
      });
      expect(doc).toMatchObject({
        title: 'Acta — Junta ordinaria 2026',
        type: 'Acta',
        source: 'generated',
        sourceRef: `meeting:${m.id}`,
        folderId: await folder('actas'),
        effectiveVisibility: 'MANAGER',
        s3Key: `meetings/${m.id}/acta/acta-junta.docx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      expect(await titlesFor(owner, await folder('actas'))).toEqual([]);
    });

    it('sending the acta to the owners opens it to them (D4) and reports it as just opened', async () => {
      const m = await meeting({ title: 'Junta extraordinaria' });
      await db.meeting.update({
        where: { id: m.id },
        data: { actaS3Key: `meetings/${m.id}/acta/acta.docx` },
      });
      const opened = await library.publishActa(m.id);
      expect(opened).toHaveLength(1);
      expect(await titlesFor(owner, await folder('actas'))).toEqual([
        'Acta — Junta extraordinaria',
      ]);
      expect(await library.publishActa(m.id)).toEqual([]);
    });

    it('an uploaded signed acta keeps its file type and size', async () => {
      const m = await meeting({
        title: 'Junta con acta subida',
        actaOrigin: 'uploaded',
        actaUploadMimeType: 'application/pdf',
        actaUploadSizeBytes: 2048,
      });
      await db.meeting.update({
        where: { id: m.id },
        data: { actaS3Key: `meetings/${m.id}/acta-upload/acta.pdf` },
      });
      const doc = await db.document.findUniqueOrThrow({
        where: { id: (await library.registerSignedActa(m.id))! },
      });
      expect(doc).toMatchObject({
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        size: '2 KB',
      });
    });

    it('a meeting without signed acta registers nothing', async () => {
      const m = await meeting({
        status: 'celebrada',
        actaSignedAt: null,
        title: 'Sin acta',
      });
      expect(await library.registerSignedActa(m.id)).toBeNull();
    });

    afterAll(async () => {
      await db.document.deleteMany({
        where: { estateId, source: 'generated' },
      });
      await db.meeting.deleteMany({ where: { estateId } });
    });
  });
});
