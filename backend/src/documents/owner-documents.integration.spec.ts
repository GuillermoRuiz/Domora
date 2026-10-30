import { type DocumentVisibility } from '../prisma/client';
import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { createAdministrator, createEstate, createOwnerUser, createProperty, roleB, type AdministratorFixture } from '../testing/db-fixtures';
import { OwnerDocumentsService } from './owner-documents.service';
import { SYSTEM_FOLDERS } from './library.service';
import { DocumentFilesController } from '../files/files.controller';
import { RagAuthorizationService } from '../assistant/rag-authorization.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { StorageService } from '../files/storage.service';
import type { AuditService } from '../gdpr/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { OwnerDocumentsQueryDto } from './dto/owner-documents.dto';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * `GET /me/documents` and the direct download by id against PostgreSQL (odd/tasks/owner-documents.md, T0).
 * Own unique fixtures only; requires a migrated disposable PostgreSQL DB.
 */
describe('Owner documents — /me/documents and download by id (PostgreSQL)', () => {
  const db = createPrismaClient();
  const prisma = db as unknown as PrismaService;
  const service = new OwnerDocumentsService(prisma);
  const storage = { assertDocumentKey: jest.fn(), get: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7')) };
  const audit = { logAccess: jest.fn().mockResolvedValue(undefined) };
  const files = new DocumentFilesController(prisma, storage as unknown as StorageService, new RagAuthorizationService(prisma), audit as unknown as AuditService);

  let fx: AdministratorFixture, foreign: AdministratorFixture;
  let estate: string, estate2: string, foreignEstate: string, estateName: string;
  let p1: string, p2: string, pDeleted: string, pB: string, pForeign: string;
  const users = {} as Record<'owner' | 'neighbour' | 'tenant' | 'pending' | 'revoked' | 'foreignOwner', string>;
  const docs: Record<string, string> = {};
  const folders: Record<string, string> = {};

  const asC = (id: string): AuthenticatedUser => ({ id, role: 'C', estateIds: [estate, estate2, foreignEstate], administratorId: null });
  const list = (id: string, query: OwnerDocumentsQueryDto = {}) => service.list(asC(id), query);
  const titles = async (id: string, query: OwnerDocumentsQueryDto = {}) => (await list(id, query)).items.map((d) => d.title);
  const response = () => ({ setHeader: jest.fn(), send: jest.fn() }) as unknown as Response & { setHeader: jest.Mock; send: jest.Mock };
  const download = (docId: string, user: AuthenticatedUser) => files.download(docId, user, response());

  const VISIBLE_TO_OWNER = [
    'Acta junta ordinaria', 'Acta extraordinaria', 'Presupuesto 2026', 'Estatutos', 'Póliza hogar', 'Contrato ascensor',
    'Certificado eficiencia', 'Normas de uso', 'Aviso sin carpeta', 'Carta 1A', 'Acta finca B',
  ];

  beforeAll(async () => {
    fx = await createAdministrator(db);
    foreign = await createAdministrator(db);
    estate = await createEstate(db, fx.administratorId, { name: 'Residencial Olivos' });
    estate2 = await createEstate(db, fx.administratorId, { name: 'Edificio B' });
    foreignEstate = await createEstate(db, foreign.administratorId, { name: 'Ajena' });
    estateName = 'Residencial Olivos';
    p1 = await createProperty(db, estate, { ref: '1A' });
    p2 = await createProperty(db, estate, { ref: '2B' });
    pDeleted = await createProperty(db, estate, { ref: '3C' });
    pB = await createProperty(db, estate2, { ref: 'B1' });
    pForeign = await createProperty(db, foreignEstate, { ref: 'X1' });
    for (const key of ['owner', 'neighbour', 'tenant', 'pending', 'revoked', 'foreignOwner'] as const) users[key] = await createOwnerUser(db, { fullName: key });
    const link = (userId: string, propertyId: string, roleType: 'Propietario' | 'Inquilino' | 'Representante', status: 'linked' | 'pending' | 'revoked' = 'linked') =>
      db.propertyMembership.create({ data: { userId, propertyId, roleType, status, linkedAt: new Date(), revokedAt: status === 'revoked' ? new Date() : null } });
    await link(users.owner, p1, 'Propietario');
    await link(users.owner, pDeleted, 'Propietario');
    await link(users.owner, pB, 'Representante');
    await link(users.neighbour, p2, 'Propietario');
    await link(users.tenant, p1, 'Inquilino');
    await link(users.pending, p1, 'Propietario', 'pending');
    await link(users.revoked, p1, 'Propietario', 'revoked');
    await link(users.foreignOwner, pForeign, 'Propietario');
    await db.property.update({ where: { id: pDeleted }, data: { deletedAt: new Date() } });

    await db.documentFolder.createMany({
      data: SYSTEM_FOLDERS.map((f, i) => ({ estateId: estate, name: f.name, systemKey: f.key, visibility: 'MANAGER' as const, sortOrder: i + 1 })),
    });
    for (const f of await db.documentFolder.findMany({ where: { estateId: estate } })) folders[f.systemKey!] = f.id;
    folders.actasSub = (await db.documentFolder.create({ data: { estateId: estate, name: 'Junta 2026', parentId: folders.actas } })).id;
    folders.legalSub = (await db.documentFolder.create({ data: { estateId: estate, name: 'Escrituras', parentId: folders.legal } })).id;
    folders.varios = (await db.documentFolder.create({ data: { estateId: estate, name: 'Varios' } })).id;

    const meetingId = randomUUID();
    const doc = async (title: string, v: DocumentVisibility, extra: Record<string, unknown> = {}, estateId = estate) => {
      docs[title] = (await db.document.create({
        data: {
          estateId, title, type: 'Otro', date: new Date('2026-01-01'), size: '1 KB', effectiveVisibility: v,
          s3Key: `documents/${estateId}/${randomUUID()}-file.pdf`, mimeType: 'application/pdf', sizeBytes: 1000, ...extra,
        } as never,
      })).id;
    };
    await doc('Acta junta ordinaria', 'OWNERS', {
      folderId: folders.actas, date: new Date('2026-03-10'), sizeBytes: 2000, source: 'generated',
      sourceRef: `meeting:${meetingId}`, s3Key: `meetings/${meetingId}/acta.pdf`, description: 'Aprobación de cuentas',
    });
    await doc('Acta extraordinaria', 'OWNERS', {
      folderId: folders.actasSub, date: new Date('2026-04-01'), sizeBytes: 5000,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    await doc('Presupuesto 2026', 'OWNERS', {
      folderId: folders.contabilidad, date: new Date('2026-01-15'), sizeBytes: 8000, description: 'Cuentas anuales de la comunidad',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await doc('Estatutos', 'OWNERS', { folderId: folders.legalSub, date: new Date('2025-06-01'), sizeBytes: null, mimeType: null, s3Key: `documents/${estate}/x-Estatutos.pdf` });
    await doc('Póliza hogar', 'OWNERS', { folderId: folders.seguros, date: new Date('2026-02-01'), sizeBytes: 3000, mimeType: 'image/png' });
    await doc('Contrato ascensor', 'OWNERS', { folderId: folders.contratos, date: new Date('2026-02-10'), sizeBytes: 4000 });
    await doc('Certificado eficiencia', 'OWNERS', { folderId: folders.certificados, date: new Date('2025-11-20'), sizeBytes: 1500 });
    await doc('Normas de uso', 'OWNERS', { folderId: folders.varios, date: new Date('2025-10-05'), sizeBytes: 600, mimeType: 'image/webp' });
    await doc('Aviso sin carpeta', 'OWNERS', { date: new Date('2025-09-01'), sizeBytes: 100, mimeType: 'text/plain' });
    await doc('Carta 1A', 'PROPERTY', { targetPropertyId: p1, visibility: 'PROPERTY', date: new Date('2025-08-01'), sizeBytes: 700 });
    await doc('Acta finca B', 'OWNERS', { date: new Date('2025-07-01'), sizeBytes: 900 }, estate2);
    // Never for this owner.
    await doc('Carta 2B', 'PROPERTY', { targetPropertyId: p2, visibility: 'PROPERTY' });
    await doc('Solo gestora', 'MANAGER', { folderId: folders.legal });
    await doc('Junta de gobierno', 'BOARD', { folderId: folders.actas });
    await doc('En la papelera', 'OWNERS', { deletedAt: new Date() });
    await doc('Interno', 'MANAGER', { folderId: folders.interno });
    await doc('Carta 3C', 'PROPERTY', { targetPropertyId: pDeleted, visibility: 'PROPERTY' });
    await doc('Ajeno', 'OWNERS', {}, foreignEstate);
  }, 60000);

  afterAll(async () => {
    const allUsers = Object.values(users);
    const estates = [estate, estate2, foreignEstate];
    await db.resourceRead.deleteMany({ where: { userId: { in: allUsers } } });
    await db.estateOfficeTerm.deleteMany({ where: { estateId: { in: estates } } });
    await db.document.deleteMany({ where: { estateId: { in: estates } } });
    await db.documentFolder.updateMany({ where: { estateId: { in: estates } }, data: { parentId: null } });
    await db.documentFolder.deleteMany({ where: { estateId: { in: estates } } });
    await db.propertyMembership.deleteMany({ where: { userId: { in: allUsers } } });
    await db.property.deleteMany({ where: { estateId: { in: estates } } });
    await db.estate.deleteMany({ where: { id: { in: estates } } });
    await db.user.deleteMany({ where: { id: { in: [...allUsers, fx.userId, foreign.userId] } } });
    await db.administrator.deleteMany({ where: { id: { in: [fx.administratorId, foreign.administratorId] } } });
    await db.$disconnect();
  });

  beforeEach(() => {
    audit.logAccess.mockClear();
    storage.get.mockClear();
  });

  describe('what the owner sees (S6, G1, G15)', () => {
    it('lists exactly the documents published for them or their communities, newest first', async () => {
      expect(await titles(users.owner)).toEqual([
        'Acta extraordinaria', 'Acta junta ordinaria', 'Contrato ascensor', 'Póliza hogar', 'Presupuesto 2026', 'Certificado eficiencia',
        'Normas de uso', 'Aviso sin carpeta', 'Carta 1A', 'Acta finca B', 'Estatutos',
      ]);
      expect((await titles(users.owner)).sort()).toEqual([...VISIBLE_TO_OWNER].sort());
    });

    it('answers only the public fields: no storage key, uploader, folder, target property or source reference', async () => {
      const { items } = await list(users.owner);
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual(
          ['board', 'category', 'date', 'description', 'estateId', 'estateName', 'fileType', 'id', 'isNew', 'mimeType', 'previewable', 'publishedBy', 'size', 'sizeBytes', 'title'].sort(),
        );
      }
      const acta = items.find((d) => d.title === 'Acta junta ordinaria')!;
      expect(acta).toEqual({
        id: docs['Acta junta ordinaria'], title: 'Acta junta ordinaria', description: 'Aprobación de cuentas', category: 'actas',
        date: '2026-03-10', size: '1 KB', sizeBytes: 2000, mimeType: 'application/pdf', fileType: 'pdf', previewable: true,
        isNew: true, board: false, publishedBy: 'Generado por Domora', estateId: estate, estateName,
      });
      expect(items.find((d) => d.title === 'Contrato ascensor')!.publishedBy).toBe('Administración de la comunidad');
    });

    it('derives file type and preview from the stored type, or the file extension when there is none (G13)', async () => {
      const byTitle = new Map((await list(users.owner)).items.map((d) => [d.title, d]));
      expect(byTitle.get('Estatutos')).toMatchObject({ mimeType: 'application/pdf', fileType: 'pdf', previewable: true, sizeBytes: null });
      expect(byTitle.get('Póliza hogar')).toMatchObject({ fileType: 'image', previewable: true });
      expect(byTitle.get('Normas de uso')).toMatchObject({ fileType: 'image', previewable: true });
      expect(byTitle.get('Presupuesto 2026')).toMatchObject({ fileType: 'spreadsheet', previewable: false });
      expect(byTitle.get('Acta extraordinaria')).toMatchObject({ fileType: 'document', previewable: false });
      expect(byTitle.get('Aviso sin carpeta')).toMatchObject({ fileType: 'document', previewable: false });
    });
  });

  describe('category from the root folder (S2)', () => {
    it('maps each system root folder, its subfolders, manager folders and documents without folder', async () => {
      const category = Object.fromEntries((await list(users.owner)).items.map((d) => [d.title, d.category]));
      expect(category).toEqual({
        'Acta junta ordinaria': 'actas', 'Acta extraordinaria': 'actas', 'Presupuesto 2026': 'economicos', Estatutos: 'normativa',
        'Póliza hogar': 'seguros', 'Contrato ascensor': 'contratos', 'Certificado eficiencia': 'otros', 'Normas de uso': 'otros',
        'Aviso sin carpeta': 'otros', 'Carta 1A': 'otros', 'Acta finca B': 'otros',
      });
    });

    it('counts per category are computed inside the visible set and ignore the category filter (G10)', async () => {
      const expected = { all: 11, actas: 2, economicos: 1, normativa: 1, seguros: 1, contratos: 1, otros: 5 };
      expect((await list(users.owner)).counts).toEqual(expected);
      const actas = await list(users.owner, { category: 'actas' });
      expect(actas.items.map((d) => d.title)).toEqual(['Acta extraordinaria', 'Acta junta ordinaria']);
      expect(actas.counts).toEqual(expected);
    });

    it('counts honour every other filter', async () => {
      expect((await list(users.owner, { fileType: 'pdf' })).counts).toEqual({ all: 6, actas: 1, economicos: 0, normativa: 1, seguros: 0, contratos: 1, otros: 3 });
      expect((await list(users.owner, { q: 'acta' })).counts).toEqual({ all: 3, actas: 2, economicos: 0, normativa: 0, seguros: 0, contratos: 0, otros: 1 });
    });

    it('a document hidden from the owner never changes any count, even in the folder of a category', async () => {
      const before = (await list(users.owner)).counts;
      const hidden = await db.document.create({ data: { estateId: estate, title: 'Acta oculta', type: 'Acta', date: new Date(), size: '1 KB', folderId: folders.actas, effectiveVisibility: 'MANAGER' } });
      try {
        expect((await list(users.owner)).counts).toEqual(before);
        expect((await list(users.owner, { q: 'oculta' })).counts.all).toBe(0);
      } finally {
        await db.document.delete({ where: { id: hidden.id } });
      }
    });
  });

  describe('abuse matrix: never listed and the direct download answers 404 (G2, G3, G5, G9)', () => {
    const owner = () => asC(users.owner);
    it.each([
      ['addressed to a neighbour\'s property (PROPERTY)', 'Carta 2B'],
      ['«Solo gestora» (MANAGER)', 'Solo gestora'],
      ['«Junta de gobierno» without a current office term (BOARD)', 'Junta de gobierno'],
      ['in the trash', 'En la papelera'],
      ['of another estate', 'Ajeno'],
      ['addressed to a deleted property', 'Carta 3C'],
      ['in «Interno de la gestora»', 'Interno'],
    ])('a document %s', async (_case, title) => {
      expect(await titles(users.owner)).not.toContain(title);
      expect(await titles(users.owner, { q: title })).toEqual([]);
      await expect(download(docs[title], owner())).rejects.toThrow(new NotFoundException('Documento no encontrado.'));
      expect(storage.get).not.toHaveBeenCalled();
      expect(audit.logAccess).not.toHaveBeenCalled();
    });

    it.each([
      ['a tenant (Inquilino)', 'tenant'],
      ['an owner whose adhesion is still pending', 'pending'],
      ['an owner whose membership was revoked', 'revoked'],
    ] as const)('%s sees no community documents and cannot download them', async (_case, who) => {
      const result = await list(users[who]);
      expect(result.items).toEqual([]);
      expect(result.counts).toEqual({ all: 0, actas: 0, economicos: 0, normativa: 0, seguros: 0, contratos: 0, otros: 0 });
      for (const title of ['Acta junta ordinaria', 'Carta 1A']) {
        await expect(download(docs[title], asC(users[who]))).rejects.toThrow(new NotFoundException('Documento no encontrado.'));
      }
      expect(storage.get).not.toHaveBeenCalled();
    });

    it('a missing id answers exactly like a hidden one', async () => {
      const missing = await download(randomUUID(), owner()).catch((e: NotFoundException) => e.getResponse());
      const hidden = await download(docs['Carta 2B'], owner()).catch((e: NotFoundException) => e.getResponse());
      expect(hidden).toEqual(missing);
    });

    it('the owner downloads what the list shows them', async () => {
      for (const title of ['Acta junta ordinaria', 'Carta 1A', 'Acta finca B']) {
        await expect(download(docs[title], owner())).resolves.toBeUndefined();
      }
      expect(storage.get).toHaveBeenCalledTimes(3);
    });

    it('a current office term opens «Junta de gobierno», marked as board, in list and download (G16)', async () => {
      await db.estateOfficeTerm.create({ data: { estateId: estate, role: 'PRESIDENT', userId: users.owner, propertyId: p1, holderNameSnapshot: 'owner', startsAt: new Date('2024-01-01'), createdByUserId: fx.userId } });
      try {
        const junta = (await list(users.owner)).items.find((d) => d.title === 'Junta de gobierno');
        expect(junta).toMatchObject({ board: true, category: 'actas' });
        expect((await list(users.owner)).items.filter((d) => d.board).map((d) => d.title)).toEqual(['Junta de gobierno']);
        await expect(download(docs['Junta de gobierno'], owner())).resolves.toBeUndefined();
        // An office that has ended closes it again.
        await db.estateOfficeTerm.updateMany({ where: { estateId: estate, userId: users.owner }, data: { endsAt: new Date(Date.now() - 86400000) } });
        expect(await titles(users.owner)).not.toContain('Junta de gobierno');
        await expect(download(docs['Junta de gobierno'], owner())).rejects.toBeInstanceOf(NotFoundException);
      } finally {
        await db.estateOfficeTerm.deleteMany({ where: { estateId: estate, userId: users.owner } });
      }
    });

    it.each([
      ['revoked', 'a revoked owner'],
      ['tenant', 'a tenant'],
      ['pending', 'a pending owner'],
    ] as const)('an office term never opens «Junta de gobierno» to %s without a linked owner membership (G3)', async (who, _label) => {
      await db.estateOfficeTerm.create({ data: { estateId: estate, role: 'PRESIDENT', userId: users[who], propertyId: p1, holderNameSnapshot: who, startsAt: new Date('2024-01-01'), createdByUserId: fx.userId } });
      try {
        expect(await titles(users[who])).not.toContain('Junta de gobierno');
      } finally {
        await db.estateOfficeTerm.deleteMany({ where: { estateId: estate, userId: users[who] } });
      }
    });

    it('an office term in a deleted estate opens nothing', async () => {
      await db.estateOfficeTerm.create({ data: { estateId: estate, role: 'PRESIDENT', userId: users.owner, propertyId: p1, holderNameSnapshot: 'owner', startsAt: new Date('2024-01-01'), createdByUserId: fx.userId } });
      await db.estate.update({ where: { id: estate }, data: { deletedAt: new Date() } });
      try {
        expect(await titles(users.owner)).toEqual(['Acta finca B']);
      } finally {
        await db.estate.update({ where: { id: estate }, data: { deletedAt: null } });
        await db.estateOfficeTerm.deleteMany({ where: { estateId: estate, userId: users.owner } });
      }
    });

    it('revoking the membership removes access on the next call, with the same token (G4)', async () => {
      const token = asC(users.owner);
      expect(await titles(users.owner)).toContain('Carta 1A');
      await db.propertyMembership.updateMany({ where: { userId: users.owner, propertyId: p1 }, data: { status: 'revoked', revokedAt: new Date() } });
      try {
        const after = (await service.list(token, {})).items.map((d) => d.title);
        expect(after).toEqual(['Acta finca B']);
        await expect(files.download(docs['Carta 1A'], token, response())).rejects.toBeInstanceOf(NotFoundException);
        await expect(files.download(docs['Acta junta ordinaria'], token, response())).rejects.toBeInstanceOf(NotFoundException);
      } finally {
        await db.propertyMembership.updateMany({ where: { userId: users.owner, propertyId: p1 }, data: { status: 'linked', revokedAt: null } });
      }
    });
  });

  describe('filters and sort (S1, S3)', () => {
    it('searches title, description and category name, case- and accent-insensitively', async () => {
      expect(await titles(users.owner, { q: 'PÓLIZA' })).toEqual(['Póliza hogar']);
      expect(await titles(users.owner, { q: 'cuentas' })).toEqual(['Acta junta ordinaria', 'Presupuesto 2026']);
      expect(await titles(users.owner, { q: 'economicos' })).toEqual(['Presupuesto 2026']);
      expect(await titles(users.owner, { q: 'Normativa' })).toEqual(['Estatutos']);
      expect(await titles(users.owner, { q: '   ' })).toHaveLength(11);
    });

    it('filters by document date range, both ends included', async () => {
      expect(await titles(users.owner, { from: '2026-02-01', to: '2026-03-10' })).toEqual(['Acta junta ordinaria', 'Contrato ascensor', 'Póliza hogar']);
      expect(await titles(users.owner, { to: '2025-07-01' })).toEqual(['Acta finca B', 'Estatutos']);
    });

    it('filters by file type', async () => {
      expect(await titles(users.owner, { fileType: 'image' })).toEqual(['Póliza hogar', 'Normas de uso']);
      expect(await titles(users.owner, { fileType: 'spreadsheet' })).toEqual(['Presupuesto 2026']);
      expect(await titles(users.owner, { fileType: 'other' })).toEqual([]);
    });

    it('sorts by date, name and size', async () => {
      expect((await titles(users.owner, { sort: 'date_asc' })).slice(0, 2)).toEqual(['Estatutos', 'Acta finca B']);
      expect(await titles(users.owner, { sort: 'name_asc' })).toEqual([...VISIBLE_TO_OWNER].sort((a, b) => a.localeCompare(b, 'es')));
      expect(await titles(users.owner, { sort: 'size_desc' })).toEqual([
        'Presupuesto 2026', 'Acta extraordinaria', 'Contrato ascensor', 'Póliza hogar', 'Acta junta ordinaria', 'Certificado eficiencia',
        'Acta finca B', 'Carta 1A', 'Normas de uso', 'Aviso sin carpeta', 'Estatutos',
      ]);
    });

    it('scopes to one of the owner\'s properties: its estate plus what is addressed to it', async () => {
      expect((await titles(users.owner, { propertyId: p1 })).sort()).toEqual(VISIBLE_TO_OWNER.filter((t) => t !== 'Acta finca B').sort());
      expect(await titles(users.owner, { propertyId: pB })).toEqual(['Acta finca B']);
      expect((await list(users.owner, { propertyId: pB })).counts.all).toBe(1);
    });

    it('a property that is not the owner\'s (neighbour, deleted, tenant, pending, unknown) answers 404', async () => {
      for (const [who, propertyId] of [['owner', p2], ['owner', pDeleted], ['owner', randomUUID()], ['tenant', p1], ['pending', p1], ['revoked', p1]] as const) {
        await expect(list(users[who], { propertyId })).rejects.toThrow(new NotFoundException('Propiedad no encontrada.'));
      }
    });
  });

  describe('«Nuevo» and «Marcar como leído»', () => {
    afterEach(() => db.resourceRead.deleteMany({ where: { userId: users.owner } }));

    it('marks read only documents the owner can see and ignores the rest', async () => {
      const result = await service.markRead(asC(users.owner), [docs['Carta 1A'], docs['Carta 2B'], docs['Ajeno'], docs['Solo gestora'], randomUUID()]);
      expect(result).toEqual({ marked: 1 });
      const rows = await db.resourceRead.findMany({ where: { userId: users.owner }, select: { sourceType: true, sourceId: true } });
      expect(rows).toEqual([{ sourceType: 'document', sourceId: docs['Carta 1A'] }]);
      const items = (await list(users.owner)).items;
      expect(items.find((d) => d.title === 'Carta 1A')!.isNew).toBe(false);
      expect(items.filter((d) => d.isNew)).toHaveLength(10);
      // Marking it again changes nothing.
      expect(await service.markRead(asC(users.owner), [docs['Carta 1A']])).toEqual({ marked: 0 });
    });

    it('«solo nuevos» leaves out what the owner already read', async () => {
      await service.markRead(asC(users.owner), [docs['Carta 1A'], docs['Estatutos']]);
      const onlyNew = await titles(users.owner, { onlyNew: true });
      expect(onlyNew).toHaveLength(9);
      expect(onlyNew).not.toContain('Carta 1A');
      expect(onlyNew).not.toContain('Estatutos');
    });

    it('another owner marking documents read does not change this owner\'s markers', async () => {
      await db.resourceRead.deleteMany({ where: { userId: users.neighbour } });
      await service.markRead(asC(users.neighbour), [docs['Acta junta ordinaria']]);
      try {
        expect((await list(users.owner)).items.every((d) => d.isNew)).toBe(true);
      } finally {
        await db.resourceRead.deleteMany({ where: { userId: users.neighbour } });
      }
    });
  });

  describe('existing behaviour still holds', () => {
    it('the manager still downloads «Solo gestora» documents of their estate', async () => {
      await expect(download(docs['Solo gestora'], roleB(fx, [estate]))).resolves.toBeUndefined();
      expect(audit.logAccess).toHaveBeenCalledWith(expect.objectContaining({ id: fx.userId }), 'document', 'download', docs['Solo gestora'], 'Solo gestora');
    });
  });
});
