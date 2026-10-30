import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ActaService, applyActaEdits } from './acta.service';
import { ActaNarrativeService } from './acta-narrative.service';
import { ActaPdfService } from './acta-pdf.service';
import { actaContentHash } from './acta-hash';
import type { ActaDocumentModel } from './acta-document.model';
import { sampleSnapshot } from '../../testing/acta-fixtures';
import { Prisma } from '../../prisma/client';
import { buildActaDocument } from './acta-document.builder';
import type { AuthenticatedUser } from '../../auth/auth.types';

const manager: AuthenticatedUser = { id: 'u1', role: 'B', estateIds: ['estate-1'], administratorId: 'admin-1' };
const owner: AuthenticatedUser = { id: 'u2', role: 'C', estateIds: ['estate-1'], administratorId: 'admin-1' };

interface Row {
  id: string;
  meetingId: string;
  versionNumber: number;
  status: string;
  generatedAt: Date | null;
  createdAt: Date;
  [key: string]: unknown;
}

/** Memoria mínima de `meeting_acta_versions` con los filtros que usa el servicio. */
function versionStore(initial: Row[] = []) {
  const rows: Row[] = [...initial];
  const match = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'generatedAt') return row.generatedAt !== null;
      if (key === 'status' && value && typeof value === 'object') {
        const filter = value as { not?: string; in?: string[] };
        return filter.not ? row.status !== filter.not : (filter.in ?? []).includes(row.status);
      }
      return row[key] === value;
    });
  const byNumberDesc = (a: Row, b: Row) => b.versionNumber - a.versionNumber;
  return {
    rows,
    findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => match(row, where)).sort(byNumberDesc)[0] ?? null),
    findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      rows.filter((row) => match(row, where)).sort(byNumberDesc).map((row) => ({ ...row, savedBy: { fullName: 'Ana Gestora' } })),
    ),
    updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = rows.filter((row) => match(row, where));
      hit.forEach((row) => Object.assign(row, data));
      return { count: hit.length };
    }),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `v${rows.length + 1}`, createdAt: new Date('2026-10-14T21:40:00Z'), savedBy: { fullName: 'Ana Gestora' }, preparedAt: null, pdfS3Key: null, ...data } as unknown as Row;
      rows.push(row);
      return row;
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => ({ ...rows.find((row) => row.id === where.id)!, savedBy: { fullName: 'Ana Gestora' } })),
  };
}

const meetingRow = (over: Record<string, unknown> = {}) => ({
  id: 'meeting-1',
  estateId: 'estate-1',
  title: 'Junta ordinaria 2026',
  status: 'celebrada',
  scheduledAt1: new Date('2026-10-14T17:00:00Z'),
  scheduledAt2: new Date('2026-10-14T17:30:00Z'),
  celebratedAt: new Date('2026-10-14T19:20:00Z'),
  actualStartAt: new Date('2026-10-14T17:10:00Z'),
  actualEndAt: new Date('2026-10-14T19:05:00Z'),
  effectiveConvocation: 'primera',
  location: 'Salón de actos',
  agenda: [
    { id: 'a1', title: 'Aprobación del presupuesto 2027', comments: 'Se presenta el presupuesto. Intervino la propiedad 1B.', hasVote: true },
    { id: 'a2', title: 'Ruegos y preguntas', comments: 'Se pide revisar la iluminación del portal.' },
    { id: 'a3', title: 'Informe del administrador', treatedAt: '2026-10-14T18:30:00Z' },
    { id: 'a4', title: 'Cambio de cerradura', hasVote: true },
  ],
  actaGeneralComments: 'La junta se desarrolló con normalidad.',
  actaNextSteps: 'Solicitar 3 presupuestos.\n\nRevisar la iluminación.',
  actaS3Key: null,
  actaSignedAt: null,
  ...over,
});

function setup(options: { meeting?: Record<string, unknown>; versions?: Row[]; pdfFromStorage?: Buffer } = {}) {
  let meeting = meetingRow(options.meeting);
  const versions = versionStore(options.versions);
  const propertyFindMany = jest.fn().mockResolvedValue([
    { id: 'p1', participationQuota: '2.50' },
    { id: 'p2', participationQuota: '2.90' },
    { id: 'p3', participationQuota: '3.10' },
    { id: 'p4', participationQuota: null },
  ]);
  const meetingUpdateMany = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
    meeting = { ...meeting, ...data };
    return { count: 1 };
  });
  const activityLogCreate = jest.fn().mockResolvedValue({});
  const tx = { meetingActaVersion: versions, activityLogEntry: { create: activityLogCreate } };
  const prisma = {
    meeting: { findFirst: jest.fn(async () => meeting), updateMany: meetingUpdateMany, findUniqueOrThrow: jest.fn(async () => meeting) },
    meetingActaVersion: versions,
    voteSession: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([{ agendaItemId: 'a1', questionIndex: 0 }]) },
    property: { findMany: propertyFindMany },
    meetingAttendance: { findMany: jest.fn().mockResolvedValue([{ propertyId: 'p1' }, { propertyId: 'p3' }]) },
    meetingVoteDelegation: { findMany: jest.fn().mockResolvedValue([{ propertyId: 'p2' }]) },
    activityLogEntry: { create: activityLogCreate },
    $transaction: jest.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
  };
  const estateAccess = { assertAccess: jest.fn() };
  const snapshots = {
    capture: jest.fn(async () => sampleSnapshot()),
    attendeeIdentities: jest.fn(async () => ({ names: new Map([['p1', 'Mónica Prieto Ruiz']]), dnis: new Map([['p1', '12345678Z']]) })),
  };
  const storage = { put: jest.fn().mockResolvedValue('stored-pdf-key'), get: jest.fn().mockResolvedValue(options.pdfFromStorage ?? Buffer.from('%PDF-stored')) };
  const pdf = new ActaPdfService();
  const render = jest.spyOn(pdf, 'render');
  const library = { registerSignedActa: jest.fn().mockResolvedValue('doc-1') };
  const service = new ActaService(prisma as never, estateAccess as never, snapshots as never, new ActaNarrativeService(), pdf, storage as never, library as never);
  return { service, library, prisma, tx, versions, snapshots, storage, render, activityLogCreate, propertyFindMany, meetingUpdateMany, setMeeting: (over: Record<string, unknown>) => (meeting = { ...meeting, ...over }) };
}

const full = (over: Partial<Row> = {}) => {
  const snapshot = sampleSnapshot();
  const model = buildActaDocument(snapshot, { items: {}, observations: null });
  return {
    id: 'v1', meetingId: 'meeting-1', versionNumber: 1, status: 'draft', generatedAt: new Date('2026-10-14T21:30:00Z'), createdAt: new Date('2026-10-14T21:30:00Z'),
    sourceSnapshot: snapshot, documentModel: model, narrative: { mode: 'fallback' }, versionHash: actaContentHash(model), pdfS3Key: null, preparedAt: null, ...over,
  } as Row;
};

describe('ActaService', () => {
  describe('acta subida', () => {
    const pdf = { originalname: 'acta firmada.pdf', mimetype: 'application/pdf', size: 12, buffer: Buffer.from('%PDF-uploaded') };
    const docx = { originalname: 'acta.docx', mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 8, buffer: Buffer.from('docx') };
    const withStorage = (options: Parameters<typeof setup>[0] = {}) => {
      const h = setup(options);
      const del = jest.fn().mockResolvedValue(undefined);
      Object.assign(h.storage, { delete: del, assertAllowed: jest.fn() });
      const meetingUpdate = jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.setMeeting(data);
        return {};
      });
      Object.assign(h.prisma.meeting, { update: meetingUpdate });
      Object.assign(h.tx, { meeting: { update: meetingUpdate } });
      return { ...h, del, meetingUpdate };
    };

    it('pendiente de firma: guarda el archivo con su SHA-256, la junta sigue celebrada y no toca el borrador generado', async () => {
      const { service, storage, meetingUpdate, versions, activityLogCreate } = withStorage({ versions: [full()] });
      const state = await service.uploadExisting('meeting-1', pdf, false, manager);
      expect(storage.put).toHaveBeenCalledWith('meetings/meeting-1/acta-upload', 'acta firmada.pdf', pdf.buffer);
      const data = meetingUpdate.mock.calls[0][0].data;
      expect(data).toMatchObject({ actaOrigin: 'uploaded', actaUploadFileName: 'acta firmada.pdf', actaUploadSizeBytes: 12 });
      expect(data.actaUploadSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(data.status).toBeUndefined();
      expect(data.actaSignedAt).toBeUndefined();
      expect(state.origin).toBe('uploaded');
      expect(state.upload).toMatchObject({ fileName: 'acta firmada.pdf', mimeType: 'application/pdf', sizeBytes: 12 });
      expect(state.version).not.toBeNull();
      expect(versions.rows).toHaveLength(1);
      expect(activityLogCreate).toHaveBeenCalled();
    });

    it('ya firmada: la junta pasa a firmada y el archivo es el documento definitivo', async () => {
      const { service, meetingUpdate, library } = withStorage();
      await service.uploadExisting('meeting-1', docx, true, manager);
      const data = meetingUpdate.mock.calls[0][0].data;
      expect(data).toMatchObject({ status: 'firmada', actaS3Key: 'stored-pdf-key' });
      expect(data.actaSignedAt).toBeInstanceOf(Date);
      // Already signed: it enters the estate document library right away.
      expect(library.registerSignedActa).toHaveBeenCalledWith('meeting-1');
    });

    it('al subir otro archivo mientras no haya firmas, retira el anterior', async () => {
      const { service, del, library } = withStorage({ meeting: { actaOrigin: 'uploaded', actaUploadS3Key: 'old-key' } });
      await service.uploadExisting('meeting-1', pdf, false, manager);
      expect(del).toHaveBeenCalledWith('old-key');
      // Pending signature: not in the library yet.
      expect(library.registerSignedActa).not.toHaveBeenCalled();
    });

    it.each([
      ['firmada', { status: 'firmada', actaSignedAt: new Date() }],
      ['cancelada', { status: 'cancelada' }],
      ['sin celebrar', { status: 'convocada' }],
      ['con una firma ya puesta', { actaSignedByPresidenteUserId: 'u9' }],
    ])('no se puede subir si la junta está %s', async (_label, meeting) => {
      const { service, storage } = withStorage({ meeting });
      await expect(service.uploadExisting('meeting-1', pdf, false, manager)).rejects.toThrow(ConflictException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('solo admite PDF o DOCX y exige archivo', async () => {
      const { service } = withStorage();
      await expect(service.uploadExisting('meeting-1', { ...pdf, mimetype: 'image/png' }, false, manager)).rejects.toThrow(BadRequestException);
      await expect(service.uploadExisting('meeting-1', undefined, false, manager)).rejects.toThrow(BadRequestException);
    });

    it('solo un administrador puede subirla', async () => {
      const { service } = withStorage();
      await expect(service.uploadExisting('meeting-1', pdf, false, owner)).rejects.toThrow(ForbiddenException);
    });

    it('devuelve el archivo subido con su nombre y tipo; sin subida es 404', async () => {
      const { service, storage } = withStorage({ meeting: { actaUploadS3Key: 'k', actaUploadFileName: 'a.pdf', actaUploadMimeType: 'application/pdf' } });
      storage.get.mockResolvedValueOnce(Buffer.from('x'));
      expect(await service.downloadUpload('meeting-1', manager)).toMatchObject({ fileName: 'a.pdf', mimeType: 'application/pdf' });
      const none = withStorage();
      await expect(none.service.downloadUpload('meeting-1', manager)).rejects.toThrow(NotFoundException);
    });

    it('preparar el borrador generado para la firma devuelve el acta al modo «generada» y retira el archivo', async () => {
      const { service, del, meetingUpdate } = withStorage({ meeting: { actaOrigin: 'uploaded', actaUploadS3Key: 'old-key' }, versions: [full()] });
      await service.prepareForSignature('meeting-1', manager);
      expect(meetingUpdate.mock.calls[0][0].data).toMatchObject({ actaOrigin: 'generated', actaUploadS3Key: null, actaUploadSha256: null });
      expect(del).toHaveBeenCalledWith('old-key');
    });

    it('también vuelve al borrador generado si esa versión ya estaba preparada (sin repetir PDF ni log de preparación)', async () => {
      const { service, del, meetingUpdate, storage, versions } = withStorage({
        meeting: { actaOrigin: 'uploaded', actaUploadS3Key: 'old-key' },
        versions: [full({ status: 'readyForSignature', pdfS3Key: 'ready-pdf-key', preparedAt: new Date('2026-10-14T22:00:00Z') })],
      });
      const view = await service.prepareForSignature('meeting-1', manager);
      expect(meetingUpdate.mock.calls[0][0].data).toMatchObject({ actaOrigin: 'generated', actaUploadS3Key: null });
      expect(del).toHaveBeenCalledWith('old-key');
      expect(storage.put).not.toHaveBeenCalled();
      expect(versions.rows[0]).toMatchObject({ status: 'readyForSignature', pdfS3Key: 'ready-pdf-key' });
      expect(view.status).toBe('readyForSignature');
    });

    it('si la transacción de la subida falla, retira el archivo recién guardado', async () => {
      const { service, del, prisma } = withStorage();
      (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error('boom'));
      await expect(service.uploadExisting('meeting-1', pdf, false, manager)).rejects.toThrow('boom');
      expect(del).toHaveBeenCalledWith('stored-pdf-key');
    });

    it('con firmas sobre el archivo subido no se puede volver al borrador generado', async () => {
      const { service } = withStorage({ meeting: { actaOrigin: 'uploaded', actaUploadS3Key: 'k', actaSignedByPresidenteUserId: 'u9' }, versions: [full()] });
      await expect(service.prepareForSignature('meeting-1', manager)).rejects.toThrow(ConflictException);
    });
  });

  describe('acceso', () => {
    it('solo un administrador puede preparar el acta', async () => {
      const { service } = setup();
      await expect(service.getCurrent('meeting-1', owner)).rejects.toThrow(ForbiddenException);
      await expect(service.generate('meeting-1', {}, owner)).rejects.toThrow(ForbiddenException);
    });

    it('una junta inexistente es 404', async () => {
      const { service, prisma } = setup();
      prisma.meeting.findFirst.mockResolvedValueOnce(null as never);
      await expect(service.getCurrent('nope', manager)).rejects.toThrow(NotFoundException);
    });
  });

  describe('lectura y compatibilidad con actas anteriores', () => {
    it('sin versión de documento devuelve null y no inventa nada (acta pendiente)', async () => {
      const { service } = setup();
      expect(await service.getCurrent('meeting-1', manager)).toEqual({ origin: 'generated', upload: null, version: null, legacy: { signed: false, hasDocx: false } });
    });

    it('acta histórica firmada con .docx heredado: se indica y no se reconstruye ningún snapshot', async () => {
      const { service, snapshots, versions } = setup({ meeting: { status: 'firmada', actaSignedAt: new Date(), actaS3Key: 'meetings/m1/acta/legacy.docx' } });
      expect(await service.getCurrent('meeting-1', manager)).toEqual({ origin: 'generated', upload: null, version: null, legacy: { signed: true, hasDocx: true } });
      expect(snapshots.capture).not.toHaveBeenCalled();
      expect(versions.create).not.toHaveBeenCalled();
    });

    it('en una acta firmada heredada no se puede generar una nueva', async () => {
      const { service } = setup({ meeting: { status: 'firmada', actaSignedAt: new Date(), actaS3Key: 'k' } });
      await expect(service.generate('meeting-1', {}, manager)).rejects.toThrow(ConflictException);
    });

    it('las versiones de solo textos del histórico no cuentan como acta canónica', async () => {
      const textOnly: Row = { id: 'vt', meetingId: 'meeting-1', versionNumber: 1, status: 'draft', generatedAt: null, createdAt: new Date() };
      const { service } = setup({ versions: [textOnly] });
      expect((await service.getCurrent('meeting-1', manager)).version).toBeNull();
    });
  });

  describe('versiones anteriores', () => {
    it('lista todas las versiones generadas, también las sustituidas, de la más reciente a la más antigua', async () => {
      const textOnly: Row = { id: 'vt', meetingId: 'meeting-1', versionNumber: 9, status: 'draft', generatedAt: null, createdAt: new Date() };
      const { service } = setup({
        versions: [full({ id: 'v1', versionNumber: 1, status: 'superseded' }), full({ id: 'v2', versionNumber: 2 }), textOnly],
      });
      const list = await service.listVersions('meeting-1', manager);
      expect(list.map((entry) => [entry.id, entry.versionNumber, entry.status, entry.statusLabel])).toEqual([
        ['v2', 2, 'draft', 'Borrador'],
        ['v1', 1, 'superseded', 'Sustituida'],
      ]);
      expect(list[0]).toMatchObject({ savedByName: 'Ana Gestora' });
    });

    it('devuelve una versión sustituida para consultarla, siempre en solo lectura', async () => {
      const { service } = setup({ versions: [full({ id: 'v1', versionNumber: 1, status: 'superseded' }), full({ id: 'v2', versionNumber: 2 })] });
      const view = await service.getVersion('meeting-1', 'v1', manager);
      expect(view).toMatchObject({ id: 'v1', versionNumber: 1, status: 'superseded', editable: false });
      expect(view.document).toBeDefined();
    });

    it('una versión que no es de esa junta (o no existe) es 404, y solo un administrador puede consultarlas', async () => {
      const { service } = setup({ versions: [full({ id: 'v1', meetingId: 'otra-junta' })] });
      await expect(service.getVersion('meeting-1', 'v1', manager)).rejects.toThrow(NotFoundException);
      await expect(service.getVersion('meeting-1', 'v1', owner)).rejects.toThrow(ForbiddenException);
      await expect(service.listVersions('meeting-1', owner)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('validación', () => {
    it('devuelve errores y datos pendientes cuando faltan los datos de la reunión', async () => {
      const { service } = setup({ meeting: { actualStartAt: null, actualEndAt: null, effectiveConvocation: null } });
      const validation = await service.validate('meeting-1', manager);
      expect(validation.canGenerate).toBe(false);
      expect(validation.missingFields).toEqual(['effectiveConvocation', 'actualStartAt', 'actualEndAt']);
    });

    it('detecta votaciones abiertas y sin coeficiente', async () => {
      const { service, prisma } = setup();
      prisma.voteSession.count.mockResolvedValueOnce(1);
      const validation = await service.validate('meeting-1', manager);
      expect(validation.errors.map((error) => error.code)).toEqual(['VOTES_OPEN']);
      expect(validation.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['MISSING_QUOTA']));
    });
  });

  describe('generar el borrador', () => {
    it('congela los datos, construye el documento y crea la versión 1 en borrador con su SHA-256', async () => {
      const { service, versions, snapshots } = setup();
      const view = await service.generate('meeting-1', {}, manager);
      expect(snapshots.capture).toHaveBeenCalledTimes(1);
      expect(view).toMatchObject({ versionNumber: 1, status: 'draft', statusLabel: 'Borrador', savedByName: 'Ana Gestora', editable: true, hasPdf: false });
      expect(view.versionHash).toMatch(/^[0-9a-f]{64}$/);
      expect(view.versionHash).toBe(actaContentHash(view.document));
      expect(view.document.header.title).toBe('ACTA DE LA JUNTA GENERAL ORDINARIA');
      const [stored] = versions.rows;
      expect(stored.sourceSnapshot).toMatchObject({ schemaVersion: 1, meeting: { effectiveConvocation: 'primera' } });
      expect(stored.documentModel).toEqual(view.document);
      expect(stored.generalComments).toBe('La junta se desarrolló con normalidad.');
      expect(stored.generatedAt).toBeInstanceOf(Date);
    });

    it('sin IA, el desarrollo de cada punto son las notas de la gestora y la versión lo registra', async () => {
      const { service } = setup();
      const view = await service.generate('meeting-1', {}, manager);
      expect(view.narrative?.mode).toBe('fallback');
      expect(view.document.items[0].narrative).toMatchObject({ text: 'Se presenta el presupuesto. Intervino la propiedad 1B.', origin: 'notes' });
      expect(view.document.observations.text).toBe('La junta se desarrolló con normalidad.');
    });

    it('confirma los datos de la reunión que faltan y los guarda en la junta', async () => {
      const { service, meetingUpdateMany, setMeeting } = setup({ meeting: { actualStartAt: null, actualEndAt: null, effectiveConvocation: null } });
      meetingUpdateMany.mockImplementationOnce(async ({ data }: { data: Record<string, unknown> }) => {
        setMeeting(data);
        return { count: 1 };
      });
      await service.generate('meeting-1', { actualStartAt: '2026-10-14T17:10:00Z', actualEndAt: '2026-10-14T19:05:00Z', effectiveConvocation: 'segunda' }, manager);
      expect(meetingUpdateMany).toHaveBeenCalledWith({
        where: { id: 'meeting-1', status: 'celebrada' },
        data: { actualStartAt: new Date('2026-10-14T17:10:00Z'), actualEndAt: new Date('2026-10-14T19:05:00Z'), effectiveConvocation: 'segunda' },
      });
    });

    it('sin los datos de la reunión responde 422 con el detalle de lo que falta, sin crear nada', async () => {
      const { service, versions, snapshots } = setup({ meeting: { actualStartAt: null, effectiveConvocation: null } });
      const error = await service.generate('meeting-1', {}, manager).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({ validation: { missingFields: ['effectiveConvocation', 'actualStartAt'] } });
      expect(versions.create).not.toHaveBeenCalled();
      expect(snapshots.capture).not.toHaveBeenCalled();
    });

    it('no confirma datos de la reunión si la junta no está celebrada', async () => {
      const { service } = setup({ meeting: { status: 'convocada', effectiveConvocation: null } });
      await expect(service.generate('meeting-1', { effectiveConvocation: 'primera' }, manager)).rejects.toThrow(ConflictException);
    });

    it('abrir el visor no versiona: si ya hay un borrador lo devuelve tal cual', async () => {
      const { service, versions, snapshots } = setup({ versions: [full()] });
      const first = await service.generate('meeting-1', {}, manager);
      const second = await service.generate('meeting-1', {}, manager);
      expect(first.id).toBe('v1');
      expect(second.id).toBe('v1');
      expect(versions.create).not.toHaveBeenCalled();
      expect(snapshots.capture).not.toHaveBeenCalled();
    });

    it('con refresh vuelve a congelar los datos, crea otra versión y deja la anterior como sustituida', async () => {
      const { service, versions, snapshots } = setup({ versions: [full()] });
      const view = await service.generate('meeting-1', { refresh: true }, manager);
      expect(snapshots.capture).toHaveBeenCalledTimes(1);
      expect(view.versionNumber).toBe(2);
      expect(versions.rows.map((row) => [row.versionNumber, row.status])).toEqual([[1, 'superseded'], [2, 'draft']]);
    });

    it('la numeración se comparte con el histórico de versiones de solo textos', async () => {
      const text1: Row = { id: 't1', meetingId: 'meeting-1', versionNumber: 1, status: 'draft', generatedAt: null, createdAt: new Date() };
      const text2: Row = { id: 't2', meetingId: 'meeting-1', versionNumber: 2, status: 'draft', generatedAt: null, createdAt: new Date() };
      const { service, versions } = setup({ versions: [text1, text2] });
      const view = await service.generate('meeting-1', {}, manager);
      expect(view.versionNumber).toBe(3);
      // Las versiones de textos no se tocan.
      expect(versions.rows.filter((row) => row.generatedAt === null).map((row) => row.status)).toEqual(['draft', 'draft']);
    });

    it('un conflicto de numeración (dos gestores a la vez) se explica en vez de romper', async () => {
      const { service, versions } = setup();
      const error = Object.assign(new Error('unique'), { code: 'P2002' });
      Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
      versions.create.mockRejectedValueOnce(error);
      await expect(service.generate('meeting-1', {}, manager)).rejects.toThrow(ConflictException);
    });
  });

  describe('edición', () => {
    async function withDraft() {
      const ctx = setup();
      const draft = await ctx.service.generate('meeting-1', {}, manager);
      return { ...ctx, draft };
    }

    it('guarda las ediciones de los bloques redactables como una versión nueva y sustituye la anterior', async () => {
      const { service, versions, draft } = await withDraft();
      const view = await service.saveEdits('meeting-1', { baseVersionId: draft.id, introduction: 'Previa.', items: [{ id: 'a1', narrative: 'Texto corregido del punto.' }], nextSteps: 'Solo esto' }, manager);
      expect(view.versionNumber).toBe(2);
      expect(view.document.constitution.introduction).toMatchObject({ text: 'Previa.', origin: 'edited' });
      expect(view.document.items[0].narrative).toMatchObject({ text: 'Texto corregido del punto.', origin: 'edited', generatedText: 'Se presenta el presupuesto. Intervino la propiedad 1B.', generatedOrigin: 'notes' });
      expect(view.document.nextSteps.text).toBe('Solo esto');
      expect(versions.rows.map((row) => row.status)).toEqual(['superseded', 'draft']);
      expect(view.versionHash).not.toBe(draft.versionHash);
    });

    it('lo factual no cambia con la edición: asistencia, votos y resultados salen del snapshot', async () => {
      const { service, draft } = await withDraft();
      const view = await service.saveEdits('meeting-1', { baseVersionId: draft.id, items: [{ id: 'a1', narrative: 'Otro.' }] }, manager);
      expect(view.document.attendance).toEqual(draft.document.attendance);
      expect(view.document.items[0].votes).toEqual(draft.document.items[0].votes);
      expect(view.document.agreements).toEqual(draft.document.agreements);
      expect(view.document.constitution.paragraph).toBe(draft.document.constitution.paragraph);
    });

    it('conserva la misma instantánea de datos (no se vuelve a congelar el censo al editar)', async () => {
      const { service, versions, snapshots, draft } = await withDraft();
      snapshots.capture.mockClear();
      await service.saveEdits('meeting-1', { baseVersionId: draft.id, introduction: 'Hola.' }, manager);
      expect(snapshots.capture).not.toHaveBeenCalled();
      expect(versions.rows[1].sourceSnapshot).toEqual(versions.rows[0].sourceSnapshot);
    });

    it('si nada cambia no crea una versión nueva', async () => {
      const { service, versions, draft } = await withDraft();
      const view = await service.saveEdits('meeting-1', { baseVersionId: draft.id, introduction: '', items: [{ id: 'a1', narrative: draft.document.items[0].narrative.text }] }, manager);
      expect(view.id).toBe(draft.id);
      expect(versions.rows).toHaveLength(1);
    });

    it('rechaza editar sobre una versión que ya no es la última', async () => {
      const { service, draft } = await withDraft();
      await service.saveEdits('meeting-1', { baseVersionId: draft.id, introduction: 'Uno.' }, manager);
      await expect(service.saveEdits('meeting-1', { baseVersionId: draft.id, introduction: 'Dos.' }, manager)).rejects.toThrow(ConflictException);
    });

    it('rechaza un punto inexistente, sin borrador, con el acta firmada o la junta cancelada', async () => {
      const { service, draft, setMeeting } = await withDraft();
      await expect(service.saveEdits('meeting-1', { baseVersionId: draft.id, items: [{ id: 'nope', narrative: 'x' }] }, manager)).rejects.toThrow(NotFoundException);
      setMeeting({ status: 'firmada' });
      await expect(service.saveEdits('meeting-1', { baseVersionId: draft.id, introduction: 'x' }, manager)).rejects.toThrow('ya está firmada');
      setMeeting({ status: 'cancelada' });
      await expect(service.saveEdits('meeting-1', { baseVersionId: draft.id, introduction: 'x' }, manager)).rejects.toThrow(ConflictException);
      const none = setup();
      await expect(none.service.saveEdits('meeting-1', { baseVersionId: 'x', introduction: 'x' }, manager)).rejects.toThrow(NotFoundException);
    });

    it('editar una versión lista para firma crea un borrador nuevo (la lista queda sustituida)', async () => {
      const { service, versions, draft } = await withDraft();
      await service.prepareForSignature('meeting-1', manager);
      expect(versions.rows[0].status).toBe('readyForSignature');
      const view = await service.saveEdits('meeting-1', { baseVersionId: draft.id, introduction: 'Cambio tras preparar.' }, manager);
      expect(view.status).toBe('draft');
      expect(versions.rows.map((row) => row.status)).toEqual(['superseded', 'draft']);
    });

    it('applyActaEdits trabaja sobre una copia y deshacer una edición recupera el origen', () => {
      const model = JSON.parse(JSON.stringify(setupModel())) as ActaDocumentModel;
      const edited = applyActaEdits(model, { items: [{ id: 'a1', narrative: 'Nuevo.' }] });
      expect(model.items[0].narrative.text).not.toBe('Nuevo.');
      const restored = applyActaEdits(edited, { items: [{ id: 'a1', narrative: model.items[0].narrative.text }] });
      expect(restored.items[0].narrative).toMatchObject({ text: model.items[0].narrative.text, origin: 'notes' });
    });
  });

  describe('regenerar la redacción', () => {
    it('recoge las notas que la gestora cambió después de generar, sin volver a congelar asistencia ni votos', async () => {
      const { service, versions, snapshots, setMeeting } = setup();
      const draft = await service.generate('meeting-1', {}, manager);
      expect(draft.notesChanged).toBe(false);

      setMeeting({ agenda: [{ id: 'a1', title: 'Aprobación del presupuesto 2027', comments: 'Notas NUEVAS del presupuesto.', hasVote: true }, { id: 'a2', title: 'Ruegos y preguntas', comments: 'Se pide revisar la iluminación del portal.' }, { id: 'a3', title: 'Informe del administrador', treatedAt: '2026-10-14T18:30:00Z' }, { id: 'a4', title: 'Cambio de cerradura', hasVote: true }] });
      const stale = (await service.getCurrent('meeting-1', manager)).version!;
      expect(stale.notesChanged).toBe(true);

      snapshots.capture.mockClear();
      const view = await service.regenerateNarrative('meeting-1', manager);
      expect(snapshots.capture).not.toHaveBeenCalled();
      expect(view.versionNumber).toBe(2);
      expect(view.document.items[0].narrative.text).toBe('Notas NUEVAS del presupuesto.');
      expect(view.notesChanged).toBe(false);
      expect(view.document.attendance).toEqual(draft.document.attendance);
      expect(versions.rows.map((row) => row.status)).toEqual(['superseded', 'draft']);
    });

    it('conserva el párrafo previo opcional y sustituye las ediciones de los bloques redactados', async () => {
      const { service, setMeeting } = setup();
      const draft = await service.generate('meeting-1', {}, manager);
      const edited = await service.saveEdits('meeting-1', { baseVersionId: draft.id, introduction: 'Mi párrafo previo.', items: [{ id: 'a1', narrative: 'Edición manual.' }] }, manager);
      setMeeting({ actaGeneralComments: 'Observaciones nuevas.' });
      const view = await service.regenerateNarrative('meeting-1', manager);
      expect(view.document.constitution.introduction.text).toBe('Mi párrafo previo.');
      expect(view.document.items[0].narrative.text).toBe('Se presenta el presupuesto. Intervino la propiedad 1B.');
      expect(view.document.observations.text).toBe('Observaciones nuevas.');
      expect(view.versionNumber).toBe(edited.versionNumber + 1);
    });

    it('si no hay cambios que recoger devuelve la misma versión', async () => {
      const { service, versions } = setup();
      const draft = await service.generate('meeting-1', {}, manager);
      const view = await service.regenerateNarrative('meeting-1', manager);
      expect(view.id).toBe(draft.id);
      expect(versions.rows).toHaveLength(1);
    });
  });

  describe('sincronizar las notas', () => {
    it('recoge comentarios generales, de los puntos y actuaciones nuevos sin volver a congelar asistencia ni votos', async () => {
      const { service, snapshots, setMeeting } = setup();
      const draft = await service.generate('meeting-1', {}, manager);
      setMeeting({
        actaGeneralComments: 'Observación general NUEVA.',
        actaNextSteps: 'Actuación NUEVA.',
        agenda: [{ id: 'a1', title: 'Aprobación del presupuesto 2027', comments: 'Comentario NUEVO del punto.', hasVote: true }, { id: 'a2', title: 'Ruegos y preguntas', comments: 'Se pide revisar la iluminación del portal.' }, { id: 'a3', title: 'Informe del administrador', treatedAt: '2026-10-14T18:30:00Z' }, { id: 'a4', title: 'Cambio de cerradura', hasVote: true }],
      });
      snapshots.capture.mockClear();
      const view = await service.syncNotes('meeting-1', manager);
      expect(snapshots.capture).not.toHaveBeenCalled();
      expect(view.document.observations.text).toBe('Observación general NUEVA.');
      expect(view.document.nextSteps.text).toBe('Actuación NUEVA.');
      expect(view.document.items[0].narrative.text).toBe('Comentario NUEVO del punto.');
      expect(view.document.attendance).toEqual(draft.document.attendance);
      expect(view.notesChanged).toBe(false);
    });

    it('no pisa lo que la gestora editó a mano en el visor', async () => {
      const { service, setMeeting } = setup();
      const draft = await service.generate('meeting-1', {}, manager);
      await service.saveEdits('meeting-1', { baseVersionId: draft.id, introduction: 'Mi párrafo.', items: [{ id: 'a1', narrative: 'Edición manual.' }] }, manager);
      setMeeting({ actaGeneralComments: 'Observación general NUEVA.' });
      const view = await service.syncNotes('meeting-1', manager);
      expect(view.document.items[0].narrative).toMatchObject({ text: 'Edición manual.', origin: 'edited' });
      expect(view.document.constitution.introduction.text).toBe('Mi párrafo.');
      expect(view.document.observations.text).toBe('Observación general NUEVA.');
    });

    it('completa nombre y DNI de los asistentes en un borrador anterior a incluirlos', async () => {
      const legacy = sampleSnapshot();
      legacy.attendance = legacy.attendance.map(({ attendeeName: _name, attendeeDni: _dni, ...row }) => row);
      const { service, snapshots } = setup();
      snapshots.capture.mockResolvedValueOnce(legacy);
      const draft = await service.generate('meeting-1', {}, manager);
      expect(draft.document.attendance.rows[0].attendee).toBe('—');
      const view = await service.syncNotes('meeting-1', manager);
      expect(snapshots.attendeeIdentities).toHaveBeenCalledWith('meeting-1');
      expect(view.document.attendance.rows[0]).toMatchObject({ attendee: 'Mónica Prieto Ruiz', attendeeDni: '12345678Z' });
    });

    it('si no hay notas nuevas devuelve la misma versión', async () => {
      const { service, versions } = setup();
      const draft = await service.generate('meeting-1', {}, manager);
      const view = await service.syncNotes('meeting-1', manager);
      expect(view.id).toBe(draft.id);
      expect(versions.rows).toHaveLength(1);
    });
  });

  describe('preparar para firma', () => {
    it('marca la versión como lista, guarda su PDF y mantiene la huella; NO firma nada', async () => {
      const { service, versions, storage, render } = setup();
      const draft = await service.generate('meeting-1', {}, manager);
      const view = await service.prepareForSignature('meeting-1', manager);
      expect(view).toMatchObject({ id: draft.id, status: 'readyForSignature', statusLabel: 'Lista para firma', hasPdf: true, versionHash: draft.versionHash });
      expect(view.preparedAt).not.toBeNull();
      expect(storage.put).toHaveBeenCalledWith('meetings/meeting-1/acta', 'acta-v1.pdf', expect.any(Buffer));
      expect(render).toHaveBeenCalledWith(draft.document, { footerNote: expect.stringMatching(/^SHA-256 [0-9a-f]{8}$/) });
      expect(versions.rows[0]).toMatchObject({ status: 'readyForSignature', pdfS3Key: 'stored-pdf-key' });
    });

    it('es idempotente', async () => {
      const { service, storage } = setup();
      await service.generate('meeting-1', {}, manager);
      await service.prepareForSignature('meeting-1', manager);
      await service.prepareForSignature('meeting-1', manager);
      expect(storage.put).toHaveBeenCalledTimes(1);
    });

    it('sin borrador, o con datos que faltan, no se puede preparar', async () => {
      const none = setup();
      await expect(none.service.prepareForSignature('meeting-1', manager)).rejects.toThrow(NotFoundException);
      const ctx = setup();
      await ctx.service.generate('meeting-1', {}, manager);
      ctx.setMeeting({ actualEndAt: null });
      await expect(ctx.service.prepareForSignature('meeting-1', manager)).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('PDF', () => {
    it('renderiza desde el modelo de la versión y no consulta datos vivos (censo, asistencia, delegaciones)', async () => {
      const { service, prisma, propertyFindMany, render } = setup();
      const draft = await service.generate('meeting-1', {}, manager);
      const queriesBefore = propertyFindMany.mock.calls.length;
      const attendanceBefore = prisma.meetingAttendance.findMany.mock.calls.length;
      const delegationsBefore = prisma.meetingVoteDelegation.findMany.mock.calls.length;
      const { content, filename } = await service.getPdf('meeting-1', manager);
      expect(content.subarray(0, 5).toString()).toBe('%PDF-');
      expect(filename).toBe('acta-v1.pdf');
      expect(render).toHaveBeenLastCalledWith(draft.document, expect.objectContaining({ footerNote: expect.stringMatching(/^SHA-256 [0-9a-f]{8}$/) }));
      expect(propertyFindMany.mock.calls.length).toBe(queriesBefore);
      expect(prisma.meetingAttendance.findMany.mock.calls.length).toBe(attendanceBefore);
      expect(prisma.meetingVoteDelegation.findMany.mock.calls.length).toBe(delegationsBefore);
    });

    it('el PDF de una versión no cambia aunque luego cambie el censo: siempre se renderiza el mismo modelo guardado', async () => {
      const { service, propertyFindMany, render } = setup();
      const draft = await service.generate('meeting-1', {}, manager);
      await service.getPdf('meeting-1', manager);
      propertyFindMany.mockResolvedValue([{ id: 'p1', participationQuota: '99' }]);
      await service.getPdf('meeting-1', manager);
      const models = render.mock.calls.map(([model]) => actaContentHash(model));
      expect(models).toEqual([draft.versionHash, draft.versionHash]);
    });

    it('una versión preparada sirve el PDF guardado, sin volver a renderizar', async () => {
      const stored = Buffer.from('%PDF-stored-bytes');
      const { service, storage, render } = setup({ pdfFromStorage: stored });
      await service.generate('meeting-1', {}, manager);
      await service.prepareForSignature('meeting-1', manager);
      render.mockClear();
      const { content } = await service.getPdf('meeting-1', manager);
      expect(content).toBe(stored);
      expect(storage.get).toHaveBeenCalledWith('stored-pdf-key');
      expect(render).not.toHaveBeenCalled();
    });

    it('sin acta generada es 404, y se puede pedir una versión concreta', async () => {
      const none = setup();
      await expect(none.service.getPdf('meeting-1', manager)).rejects.toThrow(NotFoundException);
      const { service } = setup({ versions: [full({ id: 'old', versionNumber: 1, status: 'superseded' }), full({ id: 'cur', versionNumber: 2 })] });
      expect((await service.getPdf('meeting-1', manager, 'old')).filename).toBe('acta-v1.pdf');
    });
  });
});

function setupModel(): ActaDocumentModel {
  return { items: [{ id: 'a1', narrative: { text: 'Original.', origin: 'notes', source: { fields: [] } } }], constitution: { introduction: { text: '', origin: 'edited', source: { fields: [] } } }, observations: { text: '', origin: 'notes', source: { fields: [] }, title: 'O' }, nextSteps: { text: '', origin: 'notes', source: { fields: [] }, title: 'N' } } as unknown as ActaDocumentModel;
}
