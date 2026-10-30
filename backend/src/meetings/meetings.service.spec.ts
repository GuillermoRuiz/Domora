import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { MeetingEligibilityService } from './meeting-eligibility.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';
import type { CreateMeetingDto } from './dto/create-meeting.dto';

function user(role: AppRole, estateIds: string[] = ['estate-1']): AuthenticatedUser {
  return { id: 'user-1', role, estateIds, administratorId: 'admin-1' };
}

function baseDto(overrides: Partial<CreateMeetingDto> = {}): CreateMeetingDto {
  return {
    title: 'Junta Ordinaria',
    type: 'ordinaria',
    scheduledAt1: '2026-09-01T18:00:00.000Z',
    scheduledAt2: '2026-09-01T18:30:00.000Z',
    agenda: [{ id: 'a1', title: 'Aprobación de cuentas' }],
    convokedBy: 'presidente',
    signerRole: 'administrador',
    attendeeEmails: ['vecino@example.com'],
    includeJitsi: false,
    ...overrides,
  } as CreateMeetingDto;
}

describe('MeetingsService', () => {
  let meetingCreate: jest.Mock;
  let library: { registerSignedActa: jest.Mock; publishActa: jest.Mock };
  let meetingUpdate: jest.Mock;
  let meetingStateCreate: jest.Mock;
  let meetingStateUpdateMany: jest.Mock;
  let meetingFindFirst: jest.Mock;
  let meetingUpdateMany: jest.Mock;
  let meetingFindUniqueOrThrow: jest.Mock;
  let activityLogCreate: jest.Mock;
  let propertyMembershipFindMany: jest.Mock;
  let voteDelegationFindMany: jest.Mock;
  let attendanceUpsert: jest.Mock;
  let attendanceFindFirst: jest.Mock;
  let attendanceDelete: jest.Mock;
  let attendanceFindMany: jest.Mock;
  let voteSessionFindMany: jest.Mock;
  let voteSessionCount: jest.Mock;
  let meetingFindMany: jest.Mock;
  let voteDelegationCount: jest.Mock;
  let propertyCount: jest.Mock;
  let meetingUpdateTopLevel: jest.Mock;
  let userFindUniqueOrThrow: jest.Mock;
  let storagePut: jest.Mock;
  let storageDelete: jest.Mock;
  let attachmentCreate: jest.Mock;
  let attachmentFindFirst: jest.Mock;
  let attachmentDelete: jest.Mock;
  let storageGet: jest.Mock;
  let quorumCompute: jest.Mock;
  let actaGenerate: jest.Mock;
  let actaGenerateFromModel: jest.Mock;
  let canonicalVersionFindFirst: jest.Mock;
  let officeTermFindFirst: jest.Mock;
  let canonicalVersionUpdate: jest.Mock;
  let mailSendActaNotice: jest.Mock;
  let actaVersionFindFirst: jest.Mock;
  let actaVersionFindMany: jest.Mock;
  let actaVersionCreate: jest.Mock;
  let prisma: PrismaService;
  let service: MeetingsService;
  let assertAccessSpy: jest.SpyInstance;

  beforeEach(() => {
    meetingFindFirst = jest.fn();
    meetingUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    meetingFindUniqueOrThrow = jest
      .fn()
      .mockResolvedValue({ id: 'meeting-1', estateId: 'estate-1', status: 'celebrada', jitsiRoomName: null });
    activityLogCreate = jest.fn().mockResolvedValue({});

    meetingCreate = jest.fn().mockResolvedValue({
      id: 'meeting-1',
      estateId: 'estate-1',
      jitsiRoomName: null,
      jitsiAccessPassword: null,
    });
    meetingUpdate = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ id: 'meeting-1', estateId: 'estate-1', ...data }),
    );
    meetingStateCreate = jest.fn().mockResolvedValue({});
    meetingStateUpdateMany = jest.fn().mockResolvedValue({ count: 1 });

    actaVersionFindFirst = jest.fn().mockResolvedValue(null);
    actaVersionFindMany = jest.fn().mockResolvedValue([]);
    actaVersionCreate = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ id: 'version-1', createdAt: new Date('2026-10-22T10:00:00Z'), savedBy: { fullName: 'Ana' }, ...data }),
    );
    const tx = {
      meetingActaVersion: { findFirst: actaVersionFindFirst, create: actaVersionCreate },
      meeting: {
        create: meetingCreate,
        update: meetingUpdate,
        updateMany: meetingUpdateMany,
        findUniqueOrThrow: meetingFindUniqueOrThrow,
      },
      meetingState: { create: meetingStateCreate, updateMany: meetingStateUpdateMany },
      activityLogEntry: { create: activityLogCreate },
    };

    propertyMembershipFindMany = jest.fn().mockResolvedValue([]);
    voteDelegationFindMany = jest.fn().mockResolvedValue([]);
    attendanceUpsert = jest.fn().mockResolvedValue({ id: 'attendance-1' });
    attendanceFindFirst = jest.fn();
    attendanceDelete = jest.fn().mockResolvedValue({});
    attendanceFindMany = jest.fn().mockResolvedValue([]);
    voteSessionFindMany = jest.fn().mockResolvedValue([]);
    voteSessionCount = jest.fn().mockResolvedValue(0);
    meetingFindMany = jest.fn().mockResolvedValue([]);
    voteDelegationCount = jest.fn().mockResolvedValue(0);
    propertyCount = jest.fn().mockResolvedValue(4);
    meetingUpdateTopLevel = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ id: 'meeting-1', estateId: 'estate-1', title: 'Junta Ordinaria', status: 'celebrada', ...data }),
    );
    userFindUniqueOrThrow = jest.fn().mockResolvedValue({ fullName: 'Firmante' });
    storagePut = jest.fn().mockResolvedValue('storage-key-1');
    storageDelete = jest.fn().mockResolvedValue(undefined);
    attachmentCreate = jest.fn().mockResolvedValue({ id: 'att-1' });
    attachmentFindFirst = jest.fn();
    attachmentDelete = jest.fn().mockResolvedValue({});
    storageGet = jest.fn().mockResolvedValue(Buffer.from('acta'));
    quorumCompute = jest.fn().mockResolvedValue({ convocatoria: 'primera', quorumRequired: true, quorumMet: true, owners: { present: 1, total: 1, percent: 100 }, quota: { present: 100, total: 100, percent: 100 }, missingParticipationQuotaCount: 0, attendingProperties: [] });
    actaGenerate = jest.fn().mockResolvedValue(Buffer.from('docx'));
    actaGenerateFromModel = jest.fn().mockResolvedValue(Buffer.from('docx-from-model'));
    canonicalVersionFindFirst = jest.fn().mockResolvedValue(null);
    canonicalVersionUpdate = jest.fn().mockResolvedValue({});
    officeTermFindFirst = jest.fn().mockResolvedValue(null);
    mailSendActaNotice = jest.fn().mockResolvedValue(undefined);

    prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1', fullName: 'Ana' }), findUniqueOrThrow: userFindUniqueOrThrow },
      estateOfficeTerm: { findFirst: (...args: unknown[]) => officeTermFindFirst(...args) },
      meetingActaVersion: { findMany: actaVersionFindMany, findFirst: (...args: unknown[]) => canonicalVersionFindFirst(...args), update: (...args: unknown[]) => canonicalVersionUpdate(...args) },
      meeting: { findFirst: meetingFindFirst, update: meetingUpdateTopLevel, findMany: meetingFindMany },
      propertyMembership: { findMany: propertyMembershipFindMany },
      meetingVoteDelegation: { findMany: voteDelegationFindMany, count: voteDelegationCount },
      meetingAttendance: {
        upsert: attendanceUpsert,
        findFirst: attendanceFindFirst,
        delete: attendanceDelete,
        findMany: attendanceFindMany,
      },
      property: { count: propertyCount },
      voteSession: { findMany: voteSessionFindMany, count: voteSessionCount },
      meetingAttachment: { create: attachmentCreate, findFirst: attachmentFindFirst, delete: attachmentDelete },
      activityLogEntry: { create: activityLogCreate },
    } as unknown as PrismaService;

    const estateAccess = new EstateAccessService();
    assertAccessSpy = jest.spyOn(estateAccess, 'assertAccess');

    const config = { get: () => 'http://localhost:4200' } as any;
    const storage = { put: storagePut, get: storageGet, delete: storageDelete, assertAllowed: jest.fn() } as any;
    const mail = { sendActaNotice: mailSendActaNotice } as any;
    const docx = {} as any;
    const notifications = {
      notify: jest.fn().mockResolvedValue(undefined),
      managerIdsOfEstate: jest.fn().mockResolvedValue([]),
      residentIds: jest.fn().mockResolvedValue([]),
    } as any;
    const actaDocx = { generate: actaGenerate, generateFromModel: actaGenerateFromModel } as any;
    const quorum = { computeQuorum: quorumCompute } as any;
    const eligibility = new MeetingEligibilityService(prisma);

    library = { registerSignedActa: jest.fn().mockResolvedValue('doc-1'), publishActa: jest.fn().mockResolvedValue([]) };
    service = new MeetingsService(prisma, estateAccess, config, storage, mail, docx, notifications, quorum, eligibility, actaDocx, library as any);
  });

  describe('create', () => {
    it('persists ordinary point metadata and returns it when reopening', async () => {
      const agenda: CreateMeetingDto['agenda'] = [
        { id: 'a', title: 'Cuentas editadas', systemKey: 'annual_accounts_approval', systemGenerated: true, hasVote: false, comments: 'Notas' },
        { id: 'b', title: 'Presupuesto', systemKey: 'annual_budget_approval', systemGenerated: true, hasVote: false },
        { id: 'c', title: 'Cargos', systemKey: 'community_officers_appointment', systemGenerated: true, hasVote: false },
      ];
      await service.create('estate-1', baseDto({ agenda }), user('B'));
      const stored = JSON.parse(JSON.stringify(meetingCreate.mock.calls[0][0].data));
      expect(stored.agenda).toEqual(agenda);
      meetingFindFirst.mockResolvedValue({ id: 'meeting-1', ...stored });
      const reopened = await service.findOne('meeting-1', user('B'));
      expect(reopened.agenda).toEqual(agenda);
    });
    it('no genera sala de Jitsi cuando includeJitsi es false', async () => {
      await service.create('estate-1', baseDto({ includeJitsi: false }), user('B'));
      expect(meetingUpdate).not.toHaveBeenCalled();
      expect(meetingCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ includeJitsi: false }),
        }),
      );
    });

    it('genera sala y password cuando includeJitsi es true, y actualiza la junta ya creada', async () => {
      await service.create('estate-1', baseDto({ includeJitsi: true }), user('B'));
      expect(meetingUpdate).toHaveBeenCalledTimes(1);
      const [{ where, data }] = meetingUpdate.mock.calls[0];
      expect(where).toEqual({ id: 'meeting-1' });
      expect(data.jitsiRoomName).toEqual(expect.stringContaining('domora-'));
      expect(data.jitsiAccessPassword).toBeTruthy();
    });

    it('crea siempre meeting_state, tenga o no videollamada', async () => {
      await service.create('estate-1', baseDto({ includeJitsi: false }), user('B'));
      expect(meetingStateCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ meetingId: 'meeting-1' }) }),
      );
    });

    it('deriva el nombre de sala del meetingId, no del estateId (dos juntas simultáneas no comparten sala)', async () => {
      meetingCreate
        .mockResolvedValueOnce({ id: 'meeting-A', estateId: 'estate-1', jitsiRoomName: null, jitsiAccessPassword: null })
        .mockResolvedValueOnce({ id: 'meeting-B', estateId: 'estate-1', jitsiRoomName: null, jitsiAccessPassword: null });

      await service.create('estate-1', baseDto({ includeJitsi: true }), user('B'));
      const roomA = meetingUpdate.mock.calls[0][0].data.jitsiRoomName;

      await service.create('estate-1', baseDto({ includeJitsi: true }), user('B'));
      const roomB = meetingUpdate.mock.calls[1][0].data.jitsiRoomName;

      expect(roomA).not.toBe(roomB);
    });

    it('valida el acceso a la finca antes de crear', async () => {
      await service.create('estate-1', baseDto(), user('B', ['estate-1']));
      expect(assertAccessSpy).toHaveBeenCalledWith('estate-1', expect.objectContaining({ id: 'user-1' }));
    });

    it('rechaza a un propietario (rol C): gestionar juntas es solo de Rol B/A', async () => {
      await expect(
        service.create('estate-1', baseDto(), user('C', ['estate-1'])),
      ).rejects.toThrow(ForbiddenException);
      expect(meetingCreate).not.toHaveBeenCalled();
    });

    it('rechaza el alta sobre una finca ajena', async () => {
      await expect(
        service.create('estate-otra', baseDto(), user('B', ['estate-1'])),
      ).rejects.toThrow(ForbiddenException);
    });

    it('con Jitsi y respaldo estatutario confirmado, registra quién y cuándo', async () => {
      await service.create('estate-1', baseDto({ includeJitsi: true, telematicBackingConfirmed: true }), user('B'));
      const { data } = meetingCreate.mock.calls[0][0];
      expect(data.telematicBackingConfirmedAt).toBeInstanceOf(Date);
      expect(data.telematicBackingConfirmedByUserId).toBe('user-1');
    });

    it('con Jitsi y SIN respaldo estatutario, no registra nada (pero tampoco bloquea la creación)', async () => {
      await service.create('estate-1', baseDto({ includeJitsi: true, telematicBackingConfirmed: false }), user('B'));
      const { data } = meetingCreate.mock.calls[0][0];
      expect(data.telematicBackingConfirmedAt).toBeNull();
      expect(data.telematicBackingConfirmedByUserId).toBeNull();
    });

    it('sin Jitsi, ignora telematicBackingConfirmed aunque venga en true (no aplica)', async () => {
      await service.create('estate-1', baseDto({ includeJitsi: false, telematicBackingConfirmed: true }), user('B'));
      const { data } = meetingCreate.mock.calls[0][0];
      expect(data.telematicBackingConfirmedAt).toBeNull();
      expect(data.telematicBackingConfirmedByUserId).toBeNull();
    });
  });

  describe('adjuntos', () => {
    const file = { originalname: 'Presupuesto 2027.pdf', mimetype: 'application/pdf', size: 1234, buffer: Buffer.from('x') };

    beforeEach(() => {
      meetingFindFirst.mockResolvedValue({ id: 'meeting-1', estateId: 'estate-1', title: 'Junta Ordinaria', status: 'convocada' });
    });

    it('guarda el tipo y el tamaño al subir un adjunto', async () => {
      await service.uploadAttachment('meeting-1', file, undefined, user('B'));

      expect(attachmentCreate).toHaveBeenCalledWith({
        data: {
          meetingId: 'meeting-1',
          title: 'Presupuesto 2027.pdf',
          s3Key: 'storage-key-1',
          mimeType: 'application/pdf',
          sizeBytes: 1234,
        },
      });
    });

    it('elimina el registro y el fichero, y deja constancia en el log', async () => {
      attachmentFindFirst.mockResolvedValue({ id: 'att-1', meetingId: 'meeting-1', title: 'Doc.pdf', s3Key: 'meetings/meeting-1/doc.pdf' });

      await service.deleteAttachment('meeting-1', 'att-1', user('B'));

      expect(attachmentDelete).toHaveBeenCalledWith({ where: { id: 'att-1' } });
      expect(storageDelete).toHaveBeenCalledWith('meetings/meeting-1/doc.pdf');
      expect(activityLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ verb: 'deleted', subjectId: 'meeting-1', summary: 'Documento "Doc.pdf" eliminado de "Junta Ordinaria"' }),
      });
    });

    it('lanza NotFound si el adjunto no existe y no borra nada', async () => {
      attachmentFindFirst.mockResolvedValue(null);

      await expect(service.deleteAttachment('meeting-1', 'nope', user('B'))).rejects.toBeInstanceOf(NotFoundException);
      expect(attachmentDelete).not.toHaveBeenCalled();
      expect(storageDelete).not.toHaveBeenCalled();
    });

    it('rechaza a un propietario (rol C) al subir o eliminar', async () => {
      await expect(service.uploadAttachment('meeting-1', file, undefined, user('C'))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.deleteAttachment('meeting-1', 'att-1', user('C'))).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('update — edición de la junta', () => {
    const existing = (overrides: Record<string, unknown> = {}) => ({
      id: 'meeting-1',
      estateId: 'estate-1',
      title: 'Junta Ordinaria',
      status: 'convocada',
      scheduledAt1: new Date('2026-09-01T18:00:00.000Z'),
      scheduledAt2: new Date('2026-09-01T18:30:00.000Z'),
      ...overrides,
    });

    it('actualiza solo los campos recibidos y deja constancia en el log', async () => {
      meetingFindFirst.mockResolvedValue(existing());

      await service.update('meeting-1', { title: 'Junta nueva', location: 'Calle Mayor 1' }, user('B'));

      expect(meetingUpdateMany).toHaveBeenCalledWith({
        where: { id: 'meeting-1', status: 'convocada' },
        data: {
          title: 'Junta nueva',
          location: 'Calle Mayor 1',
          locationPlaceId: null,
          locationLat: null,
          locationLng: null,
        },
      });
      expect(meetingStateUpdateMany).not.toHaveBeenCalled();
      expect(activityLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ verb: 'updated', subjectId: 'meeting-1', summary: 'Junta "Junta nueva" editada' }),
      });
    });

    it('al cambiar la 1ª convocatoria actualiza también la hora de inicio del estado', async () => {
      meetingFindFirst.mockResolvedValue(existing());

      await service.update(
        'meeting-1',
        { scheduledAt1: '2026-09-02T18:00:00.000Z', scheduledAt2: '2026-09-02T18:30:00.000Z' },
        user('B'),
      );

      expect(meetingStateUpdateMany).toHaveBeenCalledWith({
        where: { meetingId: 'meeting-1' },
        data: { scheduledStartAt: new Date('2026-09-02T18:00:00.000Z') },
      });
    });

    it('rechaza una 2ª convocatoria que no es posterior a la 1ª', async () => {
      meetingFindFirst.mockResolvedValue(existing());

      await expect(
        service.update('meeting-1', { scheduledAt1: '2026-09-01T19:00:00.000Z' }, user('B')),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(meetingUpdateMany).not.toHaveBeenCalled();
    });

    it('rechaza editar una junta ya celebrada o cancelada', async () => {
      meetingFindFirst.mockResolvedValue(existing({ status: 'celebrada' }));

      await expect(service.update('meeting-1', { title: 'X' }, user('B'))).rejects.toBeInstanceOf(ConflictException);
      expect(meetingUpdateMany).not.toHaveBeenCalled();
    });

    it('rechaza cualquier edición si ya hay votaciones iniciadas o completadas', async () => {
      meetingFindFirst.mockResolvedValue(existing());
      voteSessionCount.mockResolvedValue(1);

      await expect(
        service.update('meeting-1', { agenda: [{ id: 'a1', title: 'Otro' }] }, user('B')),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(service.update('meeting-1', { title: 'Otro título' }, user('B'))).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(meetingUpdateMany).not.toHaveBeenCalled();
    });

    it('permite cambiar el orden del día si no hay votaciones', async () => {
      meetingFindFirst.mockResolvedValue(existing());

      await service.update('meeting-1', { agenda: [{ id: 'a1', title: 'Otro' }] }, user('B'));

      expect(meetingUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { agenda: [{ id: 'a1', title: 'Otro' }] } }),
      );
    });

    it('al editar una junta con convocatoria editada a mano, la descarta para volver a redactarla con los nuevos datos', async () => {
      meetingFindFirst.mockResolvedValue({ ...existing(), convocatoriaDoc: { header: { community: 'X', title: 'Y' } } });

      await service.update('meeting-1', { title: 'Otro título' }, user('B'));

      const { data } = meetingUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data).toHaveProperty('convocatoriaDoc');
      expect(data['title']).toBe('Otro título');
    });

    it('reenviar los mismos datos (el asistente manda todos los campos) conserva la convocatoria editada a mano', async () => {
      const agenda = [{ id: 'a1', title: 'Cuentas' }];
      meetingFindFirst.mockResolvedValue({
        ...existing(),
        type: 'ordinaria',
        convokedBy: 'presidente',
        location: 'Calle Mayor 1',
        signerRole: 'administrador',
        signerName: 'Ana',
        agenda,
        convocatoriaDoc: { header: { community: 'X', title: 'Y' } },
      });

      await service.update(
        'meeting-1',
        {
          title: 'Junta Ordinaria',
          type: 'ordinaria',
          convokedBy: 'presidente',
          scheduledAt1: '2026-09-01T18:00:00.000Z',
          scheduledAt2: '2026-09-01T18:30:00.000Z',
          location: 'Calle Mayor 1',
          signerRole: 'administrador',
          signerName: 'Ana',
          agenda: [{ id: 'a1', title: ' Cuentas ', description: 'Nueva descripción' }],
        } as never,
        user('B'),
      );

      const { data } = meetingUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data).not.toHaveProperty('convocatoriaDoc');
    });

    it('cambiar el título de un punto sí descarta la convocatoria editada a mano', async () => {
      meetingFindFirst.mockResolvedValue({ ...existing(), agenda: [{ id: 'a1', title: 'Cuentas' }], convocatoriaDoc: { header: { community: 'X', title: 'Y' } } });

      await service.update('meeting-1', { agenda: [{ id: 'a1', title: 'Presupuesto' }] } as never, user('B'));

      const { data } = meetingUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data).toHaveProperty('convocatoriaDoc');
    });

    it('sin convocatoria guardada, editar la junta no toca ese campo', async () => {
      meetingFindFirst.mockResolvedValue({ ...existing(), convocatoriaDoc: null });

      await service.update('meeting-1', { title: 'Otro título' }, user('B'));

      const { data } = meetingUpdateMany.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(data).not.toHaveProperty('convocatoriaDoc');
    });

    it('si otro gestor cierra la junta a la vez (el UPDATE no toca ninguna fila), lanza conflicto y no deja rastro en el log', async () => {
      meetingFindFirst.mockResolvedValue(existing());
      meetingUpdateMany.mockResolvedValue({ count: 0 });

      await expect(service.update('meeting-1', { title: 'X' }, user('B'))).rejects.toBeInstanceOf(ConflictException);
      expect(activityLogCreate).not.toHaveBeenCalled();
    });

    it('rechaza a un propietario (rol C)', async () => {
      meetingFindFirst.mockResolvedValue(existing());

      await expect(service.update('meeting-1', { title: 'X' }, user('C'))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rechaza editar la junta de una finca ajena', async () => {
      meetingFindFirst.mockResolvedValue(existing({ estateId: 'estate-2' }));

      await expect(service.update('meeting-1', { title: 'X' }, user('B'))).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('puntos del orden del día — tratado y comentarios', () => {
    const agenda = [
      { id: 'a1', title: 'Ruegos y preguntas' },
      { id: 'a2', title: 'Presupuesto', hasVote: true, voteTemplate: { questions: [{ title: '¿Aprueba?', type: 'single_choice', options: ['Sí', 'No'] }] } },
      { id: 'a3', title: 'Informe', comments: 'Nota previa' },
    ];
    const meetingWith = (overrides: Record<string, unknown> = {}) => ({
      id: 'meeting-1', estateId: 'estate-1', title: 'Junta Ordinaria', status: 'convocada', actaSignedAt: null, agenda, ...overrides,
    });
    const writtenAgenda = () => meetingUpdateMany.mock.calls.at(-1)![0].data.agenda as Record<string, unknown>[];

    describe('markAgendaItemTreated', () => {
      it('da por tratado un punto sin votación, con la guarda de estado en el propio UPDATE', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith());
        await service.markAgendaItemTreated('meeting-1', 'a1', user('B'));
        expect(meetingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'meeting-1', status: 'convocada' } }));
        expect(writtenAgenda()[0]).toEqual(expect.objectContaining({ id: 'a1', treatedAt: expect.any(String) }));
        expect(writtenAgenda()[1]).toEqual(agenda[1]);
        expect(activityLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ verb: 'updated', subjectId: 'meeting-1' }) });
      });

      it('rechaza un punto con votación, uno inexistente, una junta ya cerrada y a un propietario', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith());
        await expect(service.markAgendaItemTreated('meeting-1', 'a2', user('B'))).rejects.toThrow(BadRequestException);
        await expect(service.markAgendaItemTreated('meeting-1', 'nope', user('B'))).rejects.toThrow(NotFoundException);
        await expect(service.markAgendaItemTreated('meeting-1', 'a1', user('C'))).rejects.toThrow(ForbiddenException);
        meetingFindFirst.mockResolvedValue(meetingWith({ status: 'celebrada' }));
        await expect(service.markAgendaItemTreated('meeting-1', 'a1', user('B'))).rejects.toThrow(ConflictException);
        expect(meetingUpdateMany).not.toHaveBeenCalled();
      });

      it('es idempotente: un punto ya tratado no se vuelve a escribir', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith({ agenda: [{ id: 'a1', title: 'Ruegos', treatedAt: '2026-10-20T10:00:00.000Z' }] }));
        await service.markAgendaItemTreated('meeting-1', 'a1', user('B'));
        expect(meetingUpdateMany).not.toHaveBeenCalled();
      });
    });

    describe('clearAgendaItemTreated', () => {
      const treated = [{ id: 'a1', title: 'Ruegos', treatedAt: '2026-10-22T20:00:00.000Z', comments: 'Nota' }];

      it('quita la marca sin dejar la clave en el JSON y conserva el resto del punto', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith({ agenda: treated }));
        await service.clearAgendaItemTreated('meeting-1', 'a1', user('B'));
        expect(meetingUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'meeting-1', status: 'convocada' } }));
        expect(writtenAgenda()[0]).toEqual({ id: 'a1', title: 'Ruegos', comments: 'Nota' });
        expect('treatedAt' in writtenAgenda()[0]).toBe(false);
        expect(activityLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ summary: expect.stringContaining('quitada') }) });
      });

      it('es idempotente y rechaza junta cerrada, punto inexistente y a un propietario', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith());
        await service.clearAgendaItemTreated('meeting-1', 'a1', user('B'));
        expect(meetingUpdateMany).not.toHaveBeenCalled();
        await expect(service.clearAgendaItemTreated('meeting-1', 'nope', user('B'))).rejects.toThrow(NotFoundException);
        await expect(service.clearAgendaItemTreated('meeting-1', 'a1', user('C'))).rejects.toThrow(ForbiddenException);
        meetingFindFirst.mockResolvedValue(meetingWith({ status: 'celebrada', agenda: treated }));
        await expect(service.clearAgendaItemTreated('meeting-1', 'a1', user('B'))).rejects.toThrow(ConflictException);
        expect(meetingUpdateMany).not.toHaveBeenCalled();
      });
    });

    describe('setAgendaItemComments', () => {
      it('guarda los comentarios (recortados) de cualquier punto, también de los que llevan votación', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith());
        await service.setAgendaItemComments('meeting-1', 'a2', '  Se aprueba con una reserva.  ', user('B'));
        expect(writtenAgenda()[1]).toEqual(expect.objectContaining({ id: 'a2', comments: 'Se aprueba con una reserva.' }));
        expect(meetingUpdateMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { id: 'meeting-1', status: { in: ['convocada', 'celebrada'] } } }),
        );
      });

      it('también con la junta celebrada y el acta sin firmar', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith({ status: 'celebrada' }));
        await service.setAgendaItemComments('meeting-1', 'a1', 'Intervino un vecino.', user('A'));
        expect(writtenAgenda()[0]).toEqual(expect.objectContaining({ comments: 'Intervino un vecino.' }));
      });

      it('un texto vacío borra los comentarios', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith());
        await service.setAgendaItemComments('meeting-1', 'a3', '   ', user('B'));
        expect('comments' in writtenAgenda()[2]).toBe(false);
        expect(activityLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ summary: expect.stringContaining('eliminados') }) });
      });

      it('rechaza con la junta cancelada, con el acta firmada, un punto inexistente y a un propietario', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith({ status: 'cancelada' }));
        await expect(service.setAgendaItemComments('meeting-1', 'a1', 'x', user('B'))).rejects.toThrow(ConflictException);
        meetingFindFirst.mockResolvedValue(meetingWith({ status: 'firmada', actaSignedAt: new Date() }));
        await expect(service.setAgendaItemComments('meeting-1', 'a1', 'x', user('B'))).rejects.toThrow(ConflictException);
        meetingFindFirst.mockResolvedValue(meetingWith());
        await expect(service.setAgendaItemComments('meeting-1', 'nope', 'x', user('B'))).rejects.toThrow(NotFoundException);
        await expect(service.setAgendaItemComments('meeting-1', 'a1', 'x', user('C'))).rejects.toThrow(ForbiddenException);
        expect(meetingUpdateMany).not.toHaveBeenCalled();
      });

      it('si el acta se firma a la vez (el UPDATE no toca ninguna fila), lanza conflicto y no deja rastro en el log', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith());
        meetingUpdateMany.mockResolvedValue({ count: 0 });
        await expect(service.setAgendaItemComments('meeting-1', 'a1', 'x', user('B'))).rejects.toThrow(ConflictException);
        expect(activityLogCreate).not.toHaveBeenCalled();
      });

      it('no escribe nada si el texto no cambia', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith());
        await service.setAgendaItemComments('meeting-1', 'a3', 'Nota previa', user('B'));
        expect(meetingUpdateMany).not.toHaveBeenCalled();
      });
    });

    describe('versiones del acta', () => {
      const agendaWithComments = [
        { id: 'p1', title: 'Cuentas', comments: 'Antes' },
        { id: 'p2', title: 'Ruegos' },
      ];
      const version = (over: Record<string, unknown> = {}) => ({
        id: 'version-0', versionNumber: 1, generalComments: null, nextSteps: null,
        pointComments: [{ id: 'p1', title: 'Cuentas', comments: 'Antes' }, { id: 'p2', title: 'Ruegos', comments: '' }],
        createdAt: new Date('2026-10-21T10:00:00Z'), savedBy: { fullName: 'Ana' }, ...over,
      });

      it('la primera versión deja los textos como vigentes (junta, puntos) y registra quién y cuándo', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith({ agenda: agendaWithComments }));
        const result = await service.saveActaVersion(
          'meeting-1',
          { generalComments: '  Sin incidencias.  ', nextSteps: 'Pedir presupuestos.', pointComments: [{ itemId: 'p2', comments: ' Intervino 2B ' }, { itemId: 'p1', comments: '' }] },
          user('B'),
        );
        expect(meetingUpdateMany).toHaveBeenCalledWith({
          where: { id: 'meeting-1', status: { in: ['convocada', 'celebrada'] } },
          data: { actaGeneralComments: 'Sin incidencias.', actaNextSteps: 'Pedir presupuestos.', agenda: [{ id: 'p1', title: 'Cuentas' }, { id: 'p2', title: 'Ruegos', comments: 'Intervino 2B' }] },
        });
        expect(actaVersionCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              meetingId: 'meeting-1', versionNumber: 1, generalComments: 'Sin incidencias.', nextSteps: 'Pedir presupuestos.',
              pointComments: [{ id: 'p1', title: 'Cuentas', comments: '' }, { id: 'p2', title: 'Ruegos', comments: 'Intervino 2B' }],
              savedByUserId: 'user-1',
            },
          }),
        );
        expect(result).toMatchObject({ versionNumber: 1, savedByName: 'Ana' });
        expect(activityLogCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ summary: expect.stringContaining('versión 1') }) });
      });

      it('numera la versión siguiente y conserva lo que no llega', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith({ agenda: agendaWithComments, actaGeneralComments: 'Vigente', actaNextSteps: 'Paso' }));
        actaVersionFindFirst.mockResolvedValue(version({ versionNumber: 4 }));
        await service.saveActaVersion('meeting-1', { nextSteps: 'Otro paso' }, user('A'));
        expect(actaVersionCreate).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ versionNumber: 5, generalComments: 'Vigente', nextSteps: 'Otro paso' }) }),
        );
      });

      it('si nada cambia desde la última versión, no crea otra y devuelve esa', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith({ agenda: agendaWithComments }));
        actaVersionFindFirst.mockResolvedValue(version());
        const result = await service.saveActaVersion('meeting-1', { pointComments: [{ itemId: 'p1', comments: 'Antes' }] }, user('B'));
        expect(result).toMatchObject({ id: 'version-0', versionNumber: 1 });
        expect(actaVersionCreate).not.toHaveBeenCalled();
        expect(meetingUpdateMany).not.toHaveBeenCalled();
      });

      it('rechaza un punto inexistente, la junta cancelada, el acta firmada y a un propietario', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith({ agenda: agendaWithComments }));
        await expect(service.saveActaVersion('meeting-1', { pointComments: [{ itemId: 'nope', comments: 'x' }] }, user('B'))).rejects.toThrow(NotFoundException);
        meetingFindFirst.mockResolvedValue(meetingWith({ status: 'cancelada' }));
        await expect(service.saveActaVersion('meeting-1', { nextSteps: 'x' }, user('B'))).rejects.toThrow(ConflictException);
        meetingFindFirst.mockResolvedValue(meetingWith({ status: 'firmada', actaSignedAt: new Date() }));
        await expect(service.saveActaVersion('meeting-1', { nextSteps: 'x' }, user('B'))).rejects.toThrow('ya está firmada');
        meetingFindFirst.mockResolvedValue(meetingWith());
        await expect(service.saveActaVersion('meeting-1', { nextSteps: 'x' }, user('C'))).rejects.toThrow(ForbiddenException);
        expect(actaVersionCreate).not.toHaveBeenCalled();
      });

      it('si el acta se firma a la vez (el UPDATE no toca ninguna fila), lanza conflicto y no crea la versión', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith());
        meetingUpdateMany.mockResolvedValue({ count: 0 });
        await expect(service.saveActaVersion('meeting-1', { nextSteps: 'x' }, user('B'))).rejects.toThrow(ConflictException);
        expect(actaVersionCreate).not.toHaveBeenCalled();
        expect(activityLogCreate).not.toHaveBeenCalled();
      });

      it('lista el histórico con quién guardó cada versión y solo para gestores', async () => {
        meetingFindFirst.mockResolvedValue(meetingWith());
        actaVersionFindMany.mockResolvedValue([version({ versionNumber: 2, id: 'v2' }), version({ savedBy: null })]);
        const result = await service.listActaVersions('meeting-1', user('B'));
        expect(actaVersionFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { meetingId: 'meeting-1' }, orderBy: { versionNumber: 'desc' } }));
        expect(result.map((v) => [v.versionNumber, v.savedByName])).toEqual([[2, 'Ana'], [1, null]]);
        await expect(service.listActaVersions('meeting-1', user('C'))).rejects.toThrow(ForbiddenException);
      });
    });
  });

  describe('updateStatus — cierre de la junta', () => {
    const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const meeting = (overrides: Record<string, unknown> = {}) => ({
      id: 'meeting-1',
      estateId: 'estate-1',
      title: 'Junta Ordinaria',
      status: 'convocada',
      scheduledAt1: PAST,
      ...overrides,
    });

    it('marca la junta como celebrada y deja constancia en el log de actividad', async () => {
      meetingFindFirst.mockResolvedValue(meeting());

      const result = await service.updateStatus('meeting-1', { status: 'celebrada' }, user('B'));

      expect(meetingUpdateMany).toHaveBeenCalledWith({
        where: { id: 'meeting-1', status: 'convocada' },
        data: { status: 'celebrada', celebratedAt: expect.any(Date) },
      });
      expect(activityLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          subjectType: 'meeting',
          subjectId: 'meeting-1',
          verb: 'status_changed',
          estateId: 'estate-1',
          propertyId: null,
          actorUserId: 'user-1',
          summary: 'Junta "Junta Ordinaria" celebrada',
        }),
      });
      expect(result.status).toBe('celebrada');
    });

    it('al cancelar (no celebrar), no fija celebratedAt', async () => {
      meetingFindFirst.mockResolvedValue(meeting({ scheduledAt1: FUTURE }));

      await service.updateStatus('meeting-1', { status: 'cancelada' }, user('B'));

      expect(meetingUpdateMany).toHaveBeenCalledWith({
        where: { id: 'meeting-1', status: 'convocada' },
        data: { status: 'cancelada', celebratedAt: undefined },
      });
    });

    it('permite cancelar una junta futura', async () => {
      meetingFindFirst.mockResolvedValue(meeting({ scheduledAt1: FUTURE }));

      await service.updateStatus('meeting-1', { status: 'cancelada' }, user('B'));

      expect(meetingUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'cancelada' } }),
      );
    });

    it('rechaza marcar como celebrada una junta cuya primera convocatoria aún no ha llegado', async () => {
      meetingFindFirst.mockResolvedValue(meeting({ scheduledAt1: FUTURE }));

      await expect(
        service.updateStatus('meeting-1', { status: 'celebrada' }, user('B')),
      ).rejects.toThrow(ConflictException);
      expect(meetingUpdateMany).not.toHaveBeenCalled();
    });

    it.each(['celebrada', 'cancelada'])(
      'los estados son terminales: una junta ya %s no se puede volver a cerrar',
      async (current) => {
        meetingFindFirst.mockResolvedValue(meeting({ status: current }));

        await expect(
          service.updateStatus('meeting-1', { status: 'cancelada' }, user('B')),
        ).rejects.toThrow(ConflictException);
        expect(meetingUpdateMany).not.toHaveBeenCalled();
      },
    );

    it('si otro gestor cierra la junta a la vez (el UPDATE no toca ninguna fila), lanza conflicto y no deja rastro en el log', async () => {
      meetingFindFirst.mockResolvedValue(meeting());
      meetingUpdateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.updateStatus('meeting-1', { status: 'celebrada' }, user('B')),
      ).rejects.toThrow(ConflictException);
      expect(activityLogCreate).not.toHaveBeenCalled();
    });

    it('rechaza a un propietario (rol C)', async () => {
      meetingFindFirst.mockResolvedValue(meeting());

      await expect(
        service.updateStatus('meeting-1', { status: 'celebrada' }, user('C', ['estate-1'])),
      ).rejects.toThrow(ForbiddenException);
      expect(meetingUpdateMany).not.toHaveBeenCalled();
    });

    it('rechaza cerrar la junta de una finca ajena', async () => {
      meetingFindFirst.mockResolvedValue(meeting({ estateId: 'estate-otra' }));

      await expect(
        service.updateStatus('meeting-1', { status: 'celebrada' }, user('B', ['estate-1'])),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lanza NotFound si la junta no existe', async () => {
      meetingFindFirst.mockResolvedValue(null);

      await expect(
        service.updateStatus('meeting-x', { status: 'celebrada' }, user('B')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('asistencia y pase de lista', () => {
    const meeting = (overrides: Record<string, unknown> = {}) => ({
      id: 'meeting-1',
      estateId: 'estate-1',
      includeJitsi: true,
      ...overrides,
    });

    describe('recordAttendance — autodeclaración', () => {
      it('rechaza si la junta no tiene videollamada activada', async () => {
        meetingFindFirst.mockResolvedValue(meeting({ includeJitsi: false }));

        await expect(
          service.recordAttendance('meeting-1', { propertyIds: ['prop-1'] }, user('C')),
        ).rejects.toThrow(ForbiddenException);
      });

      it('rechaza si el usuario no tiene vínculo ni delegación con la propiedad', async () => {
        meetingFindFirst.mockResolvedValue(meeting());
        propertyMembershipFindMany.mockResolvedValue([]);
        voteDelegationFindMany.mockResolvedValue([]);

        await expect(
          service.recordAttendance('meeting-1', { propertyIds: ['prop-1'] }, user('C')),
        ).rejects.toThrow(ForbiddenException);
        expect(attendanceUpsert).not.toHaveBeenCalled();
      });

      it('registra asistencia por cada propiedad elegible (propia o delegada)', async () => {
        meetingFindFirst.mockResolvedValue(meeting());
        propertyMembershipFindMany.mockResolvedValue([
          { user: { id: 'user-1', fullName: 'Ana' } },
        ]);

        await service.recordAttendance('meeting-1', { propertyIds: ['prop-1'] }, user('C'));

        expect(attendanceUpsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { meetingId_propertyId_userId: { meetingId: 'meeting-1', propertyId: 'prop-1', userId: 'user-1' } },
            create: expect.objectContaining({ source: 'jitsi' }),
          }),
        );
      });
    });

    describe('markRollCall — pase de lista de la gestora', () => {
      it('rechaza a un propietario (rol C)', async () => {
        meetingFindFirst.mockResolvedValue(meeting());

        await expect(
          service.markRollCall('meeting-1', { propertyId: 'prop-1', userId: 'user-2' }, user('C')),
        ).rejects.toThrow(ForbiddenException);
      });

      it('marca presente con source manual y deja constancia en el log', async () => {
        meetingFindFirst.mockResolvedValue(meeting());
        propertyMembershipFindMany.mockResolvedValue([
          { user: { id: 'user-2', fullName: 'Bea' } },
        ]);

        await service.markRollCall('meeting-1', { propertyId: 'prop-1', userId: 'user-2' }, user('B'));

        expect(attendanceUpsert).toHaveBeenCalledWith(
          expect.objectContaining({
            create: expect.objectContaining({ source: 'manual', markedByUserId: 'user-1' }),
          }),
        );
        expect(activityLogCreate).toHaveBeenCalled();
      });

      it('funciona igual en una junta sin videollamada (includeJitsi: false)', async () => {
        meetingFindFirst.mockResolvedValue(meeting({ includeJitsi: false }));
        propertyMembershipFindMany.mockResolvedValue([
          { user: { id: 'user-2', fullName: 'Bea' } },
        ]);

        await expect(
          service.markRollCall('meeting-1', { propertyId: 'prop-1', userId: 'user-2' }, user('B')),
        ).resolves.toBeDefined();
      });
    });

    describe('undoRollCall', () => {
      it('rechaza a un propietario (rol C)', async () => {
        meetingFindFirst.mockResolvedValue(meeting());

        await expect(
          service.undoRollCall('meeting-1', 'attendance-1', user('C')),
        ).rejects.toThrow(ForbiddenException);
      });

      it('borra la fila y deja constancia en el log', async () => {
        meetingFindFirst.mockResolvedValue(meeting());
        attendanceFindFirst.mockResolvedValue({ id: 'attendance-1', propertyId: 'prop-1' });

        await service.undoRollCall('meeting-1', 'attendance-1', user('B'));

        expect(attendanceDelete).toHaveBeenCalledWith({ where: { id: 'attendance-1' } });
        expect(activityLogCreate).toHaveBeenCalled();
      });

      it('lanza NotFound si la asistencia no existe', async () => {
        meetingFindFirst.mockResolvedValue(meeting());
        attendanceFindFirst.mockResolvedValue(null);

        await expect(
          service.undoRollCall('meeting-1', 'attendance-x', user('B')),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('acta digital', () => {
    function celebrada(overrides: Record<string, unknown> = {}) {
      return {
        id: 'meeting-1', estateId: 'estate-1', title: 'Junta Ordinaria', status: 'celebrada',
        agenda: [], actaSignedByPresidenteUserId: null, actaSignedBySecretarioUserId: null, actaSignedAt: null,
        ...overrides,
      };
    }

    const READY = { id: 'version-9', documentModel: { header: { title: 'ACTA' } } };
    beforeEach(() => canonicalVersionFindFirst.mockResolvedValue(READY));

    it('rechaza firmar una junta que todavía no está celebrada', async () => {
      meetingFindFirst.mockResolvedValue(celebrada({ status: 'convocada' }));
      await expect(
        service.signActa('meeting-1', { role: 'presidente', signerEmail: 'presi@x.com' }, user('B')),
      ).rejects.toThrow(ConflictException);
    });

    it('rechaza firmar un acta que ya está firmada (la junta es `firmada`, estado terminal)', async () => {
      meetingFindFirst.mockResolvedValue(celebrada({ status: 'firmada', actaSignedAt: new Date() }));
      await expect(
        service.signActa('meeting-1', { role: 'presidente', signerEmail: 'presi@x.com' }, user('B')),
      ).rejects.toThrow('El acta ya está firmada.');
      expect(meetingUpdateTopLevel).not.toHaveBeenCalled();
    });

    it('rechaza firmar si el email no corresponde a ninguna cuenta de Domora', async () => {
      meetingFindFirst.mockResolvedValue(celebrada());
      (prisma.user.findUnique as jest.Mock).mockResolvedValueOnce(null);
      await expect(
        service.signActa('meeting-1', { role: 'presidente', signerEmail: 'nadie@x.com' }, user('B')),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza firmar si el acta aún no está preparada para la firma (sin versión lista)', async () => {
      canonicalVersionFindFirst.mockResolvedValue(null);
      meetingFindFirst.mockResolvedValue(celebrada());
      await expect(
        service.signActa('meeting-1', { role: 'presidente', signerEmail: 'presi@x.com' }, user('B')),
      ).rejects.toThrow('El acta aún no está enviada a firma');
      expect(canonicalVersionFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { meetingId: 'meeting-1', generatedAt: { not: null }, status: 'readyForSignature' } }),
      );
      expect(meetingUpdateTopLevel).not.toHaveBeenCalled();
    });

    it('rechaza que el secretario firme antes que el presidente', async () => {
      meetingFindFirst.mockResolvedValue(celebrada());
      await expect(
        service.signActa('meeting-1', { role: 'secretario', signerEmail: 'secre@x.com' }, user('B')),
      ).rejects.toThrow('El presidente debe firmar');
      expect(meetingUpdateTopLevel).not.toHaveBeenCalled();
    });

    it('con solo una firma puesta, registra la firma pero NO genera el docx todavía', async () => {
      meetingFindFirst.mockResolvedValue(celebrada());
      await service.signActa('meeting-1', { role: 'presidente', signerEmail: 'presi@x.com' }, user('B'));

      expect(meetingUpdateTopLevel).toHaveBeenCalledWith({
        where: { id: 'meeting-1' },
        data: { actaSignedByPresidenteUserId: 'u1' },
      });
      expect(actaGenerate).not.toHaveBeenCalled();
      expect(storagePut).not.toHaveBeenCalled();
    });

    it('con AMBAS firmas puestas, genera y persiste el docx', async () => {
      meetingFindFirst.mockResolvedValue(celebrada({ actaSignedByPresidenteUserId: 'u1' }));
      meetingUpdateTopLevel.mockResolvedValueOnce({
        id: 'meeting-1', estateId: 'estate-1', title: 'Junta Ordinaria', status: 'celebrada',
        actaSignedByPresidenteUserId: 'u1', actaSignedBySecretarioUserId: 'u2', actaSignedAt: null,
      });

      await service.signActa('meeting-1', { role: 'secretario', signerEmail: 'secre@x.com' }, user('B'));

      expect(actaGenerateFromModel).toHaveBeenCalledTimes(1);
      expect(storagePut).toHaveBeenCalledWith('meetings/meeting-1/acta', expect.stringContaining('acta-'), expect.any(Buffer));
      const lastUpdate = meetingUpdateTopLevel.mock.calls[meetingUpdateTopLevel.mock.calls.length - 1][0];
      expect(lastUpdate.data.actaS3Key).toBe('storage-key-1');
      expect(lastUpdate.data.actaSignedAt).toBeInstanceOf(Date);
      expect(lastUpdate.data.status).toBe('firmada');
      expect(activityLogCreate).toHaveBeenCalled();
      // The signed acta enters the estate document library.
      expect(library.registerSignedActa).toHaveBeenCalledWith('meeting-1');
    });

    it('si la biblioteca de documentos falla, la firma se mantiene', async () => {
      meetingFindFirst.mockResolvedValue(celebrada({ actaSignedByPresidenteUserId: 'u1' }));
      meetingUpdateTopLevel.mockResolvedValueOnce({
        id: 'meeting-1', estateId: 'estate-1', title: 'Junta Ordinaria', status: 'celebrada',
        actaSignedByPresidenteUserId: 'u1', actaSignedBySecretarioUserId: 'u2', actaSignedAt: null,
      });
      library.registerSignedActa.mockRejectedValueOnce(new Error('library down'));
      await expect(service.signActa('meeting-1', { role: 'secretario', signerEmail: 'secre@x.com' }, user('B'))).resolves.toBeDefined();
    });

    it('el .docx sale del modelo de la versión canónica y la versión queda firmada', async () => {
      const model = { header: { title: 'ACTA DE LA JUNTA GENERAL ORDINARIA' } };
      canonicalVersionFindFirst.mockResolvedValue({ id: 'version-9', documentModel: model });
      meetingFindFirst.mockResolvedValue(celebrada({ actaSignedByPresidenteUserId: 'u1' }));
      meetingUpdateTopLevel.mockResolvedValueOnce({
        id: 'meeting-1', estateId: 'estate-1', title: 'Junta Ordinaria', status: 'celebrada',
        actaSignedByPresidenteUserId: 'u1', actaSignedBySecretarioUserId: 'u2', actaSignedAt: null,
      });

      await service.signActa('meeting-1', { role: 'secretario', signerEmail: 'secre@x.com' }, user('B'));

      expect(actaGenerateFromModel).toHaveBeenCalledWith(model);
      expect(storagePut).toHaveBeenCalledWith('meetings/meeting-1/acta', expect.stringContaining('acta-'), Buffer.from('docx-from-model'));
      expect(canonicalVersionUpdate).toHaveBeenCalledWith({ where: { id: 'version-9' }, data: { status: 'signed' } });
    });

    describe('acta subida pendiente de firma', () => {
      const uploaded = (over: Record<string, unknown> = {}) =>
        celebrada({ actaOrigin: 'uploaded', actaUploadS3Key: 'meetings/meeting-1/acta-upload/acta.pdf', actaUploadFileName: 'acta.pdf', actaUploadMimeType: 'application/pdf', ...over });

      it('se firma sin versión generada lista: el acta es el archivo', async () => {
        canonicalVersionFindFirst.mockResolvedValue(null);
        meetingFindFirst.mockResolvedValue(uploaded());
        await service.signActa('meeting-1', { role: 'presidente', signerEmail: 'presi@x.com' }, user('B'));
        expect(meetingUpdateTopLevel).toHaveBeenCalledWith({ where: { id: 'meeting-1' }, data: { actaSignedByPresidenteUserId: 'u1' } });
      });

      it('con las dos firmas la junta queda firmada con el propio archivo, sin generar ningún Word', async () => {
        canonicalVersionFindFirst.mockResolvedValue(null);
        meetingFindFirst.mockResolvedValue(uploaded({ actaSignedByPresidenteUserId: 'u1' }));
        meetingUpdateTopLevel.mockResolvedValueOnce({
          id: 'meeting-1', estateId: 'estate-1', title: 'Junta Ordinaria', status: 'celebrada',
          actaSignedByPresidenteUserId: 'u1', actaSignedBySecretarioUserId: 'u2', actaSignedAt: null,
          actaUploadS3Key: 'meetings/meeting-1/acta-upload/acta.pdf',
        });
        await service.signActa('meeting-1', { role: 'secretario', signerEmail: 'secre@x.com' }, user('B'));
        expect(actaGenerateFromModel).not.toHaveBeenCalled();
        expect(storagePut).not.toHaveBeenCalled();
        expect(canonicalVersionUpdate).not.toHaveBeenCalled();
        const lastUpdate = meetingUpdateTopLevel.mock.calls[meetingUpdateTopLevel.mock.calls.length - 1][0];
        expect(lastUpdate.data).toMatchObject({ actaS3Key: 'meetings/meeting-1/acta-upload/acta.pdf', status: 'firmada' });
      });

      it('el estado de firmas lo da por listo y deja firmar al presidente', async () => {
        canonicalVersionFindFirst.mockResolvedValue(null);
        meetingFindFirst.mockResolvedValue(uploaded());
        officeTermFindFirst.mockResolvedValue({ id: 'term-1' });
        const state = await service.getActaSigning('meeting-1', { id: 'u-presi', role: 'C', estateIds: ['estate-1'], administratorId: null });
        expect(state).toMatchObject({ readyForSignature: true, canSign: { presidente: true, secretario: false } });
      });

      it('la descarga del acta firmada devuelve el archivo con su nombre y tipo', async () => {
        meetingFindFirst.mockResolvedValue(uploaded({ status: 'firmada', actaS3Key: 'meetings/meeting-1/acta-upload/acta.pdf' }));
        const file = await service.downloadActa('meeting-1', user('B'));
        expect(file).toMatchObject({ fileName: 'acta.pdf', mimeType: 'application/pdf' });
      });
    });

    describe('firmar con la propia sesión', () => {
      const owner = (id = 'u-presi'): AuthenticatedUser => ({ id, role: 'C', estateIds: ['estate-1'], administratorId: null });

      it('el presidente de la comunidad (mandato vigente) firma como presidente', async () => {
        meetingFindFirst.mockResolvedValue(celebrada());
        officeTermFindFirst.mockResolvedValue({ id: 'term-1' });
        await service.signActaAsSelf('meeting-1', 'presidente', owner());
        expect(officeTermFindFirst).toHaveBeenCalledWith(
          expect.objectContaining({ where: expect.objectContaining({ estateId: 'estate-1', role: 'PRESIDENT', userId: 'u-presi' }) }),
        );
        expect(meetingUpdateTopLevel).toHaveBeenCalledWith({ where: { id: 'meeting-1' }, data: { actaSignedByPresidenteUserId: 'u-presi' } });
      });

      it('un propietario que no es el presidente no puede firmar como presidente', async () => {
        meetingFindFirst.mockResolvedValue(celebrada());
        await expect(service.signActaAsSelf('meeting-1', 'presidente', owner('u-otro'))).rejects.toThrow(ForbiddenException);
        expect(meetingUpdateTopLevel).not.toHaveBeenCalled();
      });

      it('el presidente no puede firmar como secretario', async () => {
        meetingFindFirst.mockResolvedValue(celebrada({ actaSignedByPresidenteUserId: 'u-presi' }));
        officeTermFindFirst.mockResolvedValue({ id: 'term-1' });
        await expect(service.signActaAsSelf('meeting-1', 'secretario', owner())).rejects.toThrow(ForbiddenException);
      });

      it('un administrador firma como secretario cuando el presidente ya firmó', async () => {
        meetingFindFirst.mockResolvedValue(celebrada({ actaSignedByPresidenteUserId: 'u-presi' }));
        await service.signActaAsSelf('meeting-1', 'secretario', user('B'));
        expect(meetingUpdateTopLevel).toHaveBeenCalledWith({ where: { id: 'meeting-1' }, data: { actaSignedBySecretarioUserId: 'user-1' } });
      });

      it('el administrador no puede firmar antes que el presidente', async () => {
        meetingFindFirst.mockResolvedValue(celebrada());
        await expect(service.signActaAsSelf('meeting-1', 'secretario', user('B'))).rejects.toThrow('El presidente debe firmar');
      });

      it('no se firma si el acta no está enviada a firma', async () => {
        canonicalVersionFindFirst.mockResolvedValue(null);
        meetingFindFirst.mockResolvedValue(celebrada());
        officeTermFindFirst.mockResolvedValue({ id: 'term-1' });
        await expect(service.signActaAsSelf('meeting-1', 'presidente', owner())).rejects.toThrow('aún no está enviada a firma');
      });

      it('no se firma dos veces el mismo cargo', async () => {
        meetingFindFirst.mockResolvedValue(celebrada({ actaSignedByPresidenteUserId: 'u-presi' }));
        officeTermFindFirst.mockResolvedValue({ id: 'term-1' });
        await expect(service.signActaAsSelf('meeting-1', 'presidente', owner())).rejects.toThrow('ya está registrada');
      });
    });

    describe('estado de las firmas', () => {
      const owner = (): AuthenticatedUser => ({ id: 'u-presi', role: 'C', estateIds: ['estate-1'], administratorId: null });

      it('el presidente ve que puede firmar cuando el acta está lista; el secretario aún no', async () => {
        meetingFindFirst.mockResolvedValue(celebrada());
        officeTermFindFirst.mockResolvedValue({ id: 'term-1' });
        expect(await service.getActaSigning('meeting-1', owner())).toEqual({
          readyForSignature: true, presidenteSigned: false, secretarioSigned: false, canSign: { presidente: true, secretario: false },
        });
      });

      it('un administrador puede firmar cuando el presidente ya firmó', async () => {
        meetingFindFirst.mockResolvedValue(celebrada({ actaSignedByPresidenteUserId: 'u-presi' }));
        const state = await service.getActaSigning('meeting-1', user('B'));
        expect(state.canSign).toEqual({ presidente: false, secretario: true });
      });

      it('con el acta sin enviar a firma nadie puede firmar', async () => {
        canonicalVersionFindFirst.mockResolvedValue(null);
        meetingFindFirst.mockResolvedValue(celebrada());
        officeTermFindFirst.mockResolvedValue({ id: 'term-1' });
        const state = await service.getActaSigning('meeting-1', owner());
        expect(state).toMatchObject({ readyForSignature: false, canSign: { presidente: false, secretario: false } });
      });
    });

    it('downloadActa sin acta firmada, lanza NotFound', async () => {
      meetingFindFirst.mockResolvedValue(celebrada({ actaS3Key: null }));
      await expect(service.downloadActa('meeting-1', user('B'))).rejects.toThrow(NotFoundException);
    });

    it('sendActaNotice sin acta firmada, lanza Conflict', async () => {
      meetingFindFirst.mockResolvedValue(celebrada({ actaSignedAt: null }));
      await expect(service.sendActaNotice('meeting-1', user('B'))).rejects.toThrow(ConflictException);
      expect(mailSendActaNotice).not.toHaveBeenCalled();
    });

    it('sendActaNotice con acta firmada, manda a todos los propietarios vinculados y marca actaDistributedAt', async () => {
      meetingFindFirst.mockResolvedValue(celebrada({ actaSignedAt: new Date() }));
      propertyMembershipFindMany.mockResolvedValue([
        { user: { email: 'a@x.com', fullName: 'Ana' } },
        { user: { email: 'b@x.com', fullName: 'Bruno' } },
      ]);

      const result = await service.sendActaNotice('meeting-1', user('B'));

      expect(mailSendActaNotice).toHaveBeenCalledTimes(2);
      expect(result.sentCount).toBe(2);
      expect(meetingUpdateTopLevel).toHaveBeenCalledWith({
        where: { id: 'meeting-1' },
        data: { actaDistributedAt: expect.any(Date) },
      });
      // Sending the acta opens it to the owners in the library (D4).
      expect(library.publishActa).toHaveBeenCalledWith('meeting-1');
    });
  });

  describe('updateRequire2fa', () => {
    it('rechaza a un propietario (rol C)', async () => {
      meetingFindFirst.mockResolvedValue({ id: 'meeting-1', estateId: 'estate-1' });
      await expect(
        service.updateRequire2fa('meeting-1', { require2faForVoting: true }, user('C')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('sin votaciones todavía, lo actualiza', async () => {
      meetingFindFirst.mockResolvedValue({ id: 'meeting-1', estateId: 'estate-1' });
      await service.updateRequire2fa('meeting-1', { require2faForVoting: true }, user('B'));
      expect(meetingUpdateTopLevel).toHaveBeenCalledWith({
        where: { id: 'meeting-1' },
        data: { require2faForVoting: true },
      });
    });

    it('con votaciones ya abiertas, rechaza el cambio', async () => {
      meetingFindFirst.mockResolvedValue({ id: 'meeting-1', estateId: 'estate-1' });
      voteSessionCount.mockResolvedValue(1);
      await expect(
        service.updateRequire2fa('meeting-1', { require2faForVoting: true }, user('B')),
      ).rejects.toThrow(ConflictException);
      expect(meetingUpdateTopLevel).not.toHaveBeenCalled();
    });
  });

  describe('getParticipationHistory', () => {
    it('valida acceso a la finca y agrega quórum + tasa de delegación por junta', async () => {
      meetingFindMany.mockResolvedValue([
        { id: 'meeting-1', title: 'Junta 1', celebratedAt: new Date('2026-01-01'), scheduledAt2: new Date('2026-01-01') },
      ]);
      voteDelegationCount.mockResolvedValue(1);
      propertyCount.mockResolvedValue(4);
      quorumCompute.mockResolvedValue({ quorumMet: true });

      const result = await service.getParticipationHistory('estate-1', user('B'));

      expect(assertAccessSpy).toHaveBeenCalledWith('estate-1', expect.objectContaining({ id: 'user-1' }));
      expect(meetingFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { estateId: 'estate-1', status: { in: ['celebrada', 'firmada'] } } }),
      );
      expect(result).toEqual([
        { meetingId: 'meeting-1', title: 'Junta 1', celebratedAt: new Date('2026-01-01'), quorumMet: true, delegationUsageRate: 25 },
      ]);
    });

    it('sin propiedades en el censo, no divide por cero', async () => {
      meetingFindMany.mockResolvedValue([
        { id: 'meeting-1', title: 'Junta 1', celebratedAt: new Date('2026-01-01'), scheduledAt2: new Date('2026-01-01') },
      ]);
      propertyCount.mockResolvedValue(0);

      const result = await service.getParticipationHistory('estate-1', user('B'));

      expect(result[0].delegationUsageRate).toBe(0);
    });
  });
});
