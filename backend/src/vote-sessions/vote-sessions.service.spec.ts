import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VoteSessionsService } from './vote-sessions.service';
import { MeetingEligibilityService } from '../meetings/meeting-eligibility.service';
import { VoteTallyService } from './vote-tally.service';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { MailService } from '../mail/mail.service';
import { VoteDebtService } from './vote-debt.service';
import { AuditService } from '../gdpr/audit.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';

function user(role: AppRole, estateIds: string[] = ['estate-1']): AuthenticatedUser {
  return { id: 'user-1', role, estateIds, administratorId: 'admin-1' };
}

const AGENDA = [
  {
    id: 'a1',
    title: 'Reforma del tejado',
    hasVote: true,
    voteTemplate: { questions: [{ title: '¿Aprobar?', type: 'single_choice', options: ['A favor', 'En contra'] }] },
  },
  { id: 'a2', title: 'Ruegos y preguntas' },
];

describe('VoteSessionsService', () => {
  let meetingFindFirst: jest.Mock;
  let voteSessionCreate: jest.Mock;
  let voteSessionFindFirst: jest.Mock;
  let voteSessionUpdateMany: jest.Mock;
  let voteSessionUpdate: jest.Mock;
  let voteResponseUpsert: jest.Mock;
  let voteResponseFindMany: jest.Mock;
  let delegationFindFirst: jest.Mock;
  let attendanceFindFirst: jest.Mock;
  let attendanceFindMany: jest.Mock;
  let delegationFindMany: jest.Mock;
  let propertyFindFirst: jest.Mock;
  let activityLogCreate: jest.Mock;
  let eligibilitySpy: jest.SpyInstance;
  let tallySpy: jest.SpyInstance;
  let twoFactorVerifySpy: jest.SpyInstance;
  let service: VoteSessionsService;
  let overdueSpy: jest.Mock;
  let auditLogAccess: jest.Mock;

  const meeting = { id: 'meeting-1', estateId: 'estate-1', title: 'Junta Ordinaria', agenda: AGENDA };

  beforeEach(() => {
    meetingFindFirst = jest.fn().mockResolvedValue(meeting);
    voteSessionCreate = jest.fn().mockResolvedValue({ id: 'session-1', meetingId: 'meeting-1', status: 'abierta' });
    voteSessionFindFirst = jest.fn().mockResolvedValue({
      id: 'session-1',
      meetingId: 'meeting-1',
      agendaItemId: 'a1',
      questionIndex: 0,
      majorityType: 'mayoriaSimple',
      status: 'abierta',
    });
    voteSessionUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    voteSessionUpdate = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'session-1', ...data }));
    voteResponseUpsert = jest.fn().mockResolvedValue({ id: 'response-1' });
    voteResponseFindMany = jest.fn().mockResolvedValue([]);
    delegationFindFirst = jest.fn().mockResolvedValue(null);
    attendanceFindFirst = jest.fn().mockResolvedValue(null);
    attendanceFindMany = jest.fn().mockResolvedValue([{ propertyId: 'p1' }]);
    delegationFindMany = jest.fn().mockResolvedValue([]);
    propertyFindFirst = jest.fn().mockResolvedValue({ id: 'p1', ref: '1A' });
    activityLogCreate = jest.fn().mockResolvedValue({});

    const prisma = {
      meeting: { findFirst: meetingFindFirst },
      voteSession: {
        create: voteSessionCreate,
        findFirst: voteSessionFindFirst,
        updateMany: voteSessionUpdateMany,
        update: voteSessionUpdate,
      },
      voteResponse: { upsert: voteResponseUpsert, findMany: voteResponseFindMany },
      meetingVoteDelegation: { findFirst: delegationFindFirst, findMany: delegationFindMany },
      meetingAttendance: { findFirst: attendanceFindFirst, findMany: attendanceFindMany },
      property: { findFirst: propertyFindFirst },
      propertyMembership: { findMany: jest.fn().mockResolvedValue([]) },
      activityLogEntry: { create: activityLogCreate },
    } as unknown as PrismaService;

    const estateAccess = new EstateAccessService();
    jest.spyOn(estateAccess, 'assertAccess');

    const eligibility = { assertEligibleForProperty: jest.fn().mockResolvedValue(undefined) } as unknown as MeetingEligibilityService;
    eligibilitySpy = eligibility.assertEligibleForProperty as unknown as jest.SpyInstance;

    const tally = { tally: jest.fn().mockResolvedValue({ passed: true, ownersFavorablePct: 100, quotaFavorablePct: 100 }) } as unknown as VoteTallyService;
    tallySpy = tally.tally as unknown as jest.SpyInstance;

    const twoFactor = { verifyCode: jest.fn().mockResolvedValue(true) } as unknown as TwoFactorService;
    twoFactorVerifySpy = twoFactor.verifyCode as unknown as jest.SpyInstance;

    const mail = { sendVoteSessionOpened: jest.fn().mockResolvedValue(undefined) } as unknown as MailService;

    // Por defecto nadie debe nada: los casos de deuda lo cambian.
    overdueSpy = jest.fn().mockResolvedValue(new Map<string, number>());
    const debt = { overdueByProperty: overdueSpy } as unknown as VoteDebtService;
    auditLogAccess = jest.fn().mockResolvedValue(undefined);
    const audit = { logAccess: auditLogAccess } as unknown as AuditService;

    service = new VoteSessionsService(prisma, estateAccess, eligibility, tally, twoFactor, mail, debt, audit);
  });

  describe('open', () => {
    it('rechaza a un propietario (rol C): abrir votación es solo de Rol B/A', async () => {
      await expect(
        service.open('meeting-1', { agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple' }, user('C')),
      ).rejects.toThrow(ForbiddenException);
      expect(voteSessionCreate).not.toHaveBeenCalled();
    });

    it('rechaza abrir sobre un punto sin votación configurada', async () => {
      await expect(
        service.open('meeting-1', { agendaItemId: 'a2', questionIndex: 0, majorityType: 'mayoriaSimple' }, user('B')),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza abrir sobre un agendaItemId inexistente', async () => {
      await expect(
        service.open('meeting-1', { agendaItemId: 'no-existe', questionIndex: 0, majorityType: 'mayoriaSimple' }, user('B')),
      ).rejects.toThrow(NotFoundException);
    });

    it('usa la mayoría fijada en la plantilla de la pregunta e ignora la que llegue en la petición', async () => {
      const withMajority = [
        { ...AGENDA[0], voteTemplate: { questions: [{ ...AGENDA[0].voteTemplate!.questions[0], majorityType: 'unanimidad' }] } },
        AGENDA[1],
      ];
      meetingFindFirst.mockResolvedValue({ ...meeting, agenda: withMajority });
      await service.open('meeting-1', { agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple' }, user('B'));
      expect(voteSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ majorityType: 'unanimidad' }) }),
      );
      await service.open('meeting-1', { agendaItemId: 'a1', questionIndex: 0 }, user('B'));
      expect(voteSessionCreate).toHaveBeenLastCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ majorityType: 'unanimidad' }) }),
      );
    });

    it('una pregunta antigua sin mayoría exige que la petición la traiga', async () => {
      await expect(service.open('meeting-1', { agendaItemId: 'a1', questionIndex: 0 }, user('B'))).rejects.toThrow(BadRequestException);
      expect(voteSessionCreate).not.toHaveBeenCalled();
    });

    it('con datos válidos, crea la sesión y registra actividad', async () => {
      await service.open('meeting-1', { agendaItemId: 'a1', questionIndex: 0, majorityType: 'tresQuintos' }, user('B'));
      expect(voteSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ meetingId: 'meeting-1', agendaItemId: 'a1', majorityType: 'tresQuintos', openedByUserId: 'user-1' }),
        }),
      );
      expect(activityLogCreate).toHaveBeenCalled();
    });

    it('rechaza abrir la votación si no hay propietarios presentes ni representados', async () => {
      attendanceFindMany.mockResolvedValue([]);
      delegationFindMany.mockResolvedValue([]);
      await expect(
        service.open('meeting-1', { agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple' }, user('B')),
      ).rejects.toThrow(ConflictException);
      expect(voteSessionCreate).not.toHaveBeenCalled();
    });

    it('permite abrir la votación si solo hay una propiedad representada', async () => {
      attendanceFindMany.mockResolvedValue([]);
      delegationFindMany.mockResolvedValue([{ propertyId: 'p2' }]);
      await service.open('meeting-1', { agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple' }, user('B'));
      expect(voteSessionCreate).toHaveBeenCalled();
    });

    it('toma require2fa como snapshot de Meeting.require2faForVoting en ese instante', async () => {
      meetingFindFirst.mockResolvedValue({ ...meeting, require2faForVoting: true });
      await service.open('meeting-1', { agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple' }, user('B'));
      expect(voteSessionCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ require2fa: true }) }),
      );
    });
  });

  describe('castVote', () => {
    it('verifica elegibilidad de la propiedad antes de aceptar el voto', async () => {
      await service.castVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 0 }, user('C'));
      expect(eligibilitySpy).toHaveBeenCalledWith('meeting-1', 'p1', 'user-1');
    });

    it('rechaza votar sobre una sesión ya cerrada', async () => {
      voteSessionFindFirst.mockResolvedValue({
        id: 'session-1', meetingId: 'meeting-1', agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple', status: 'cerrada',
      });
      await expect(
        service.castVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 0 }, user('C')),
      ).rejects.toThrow(ConflictException);
      expect(voteResponseUpsert).not.toHaveBeenCalled();
    });

    it('rechaza un optionIndex fuera de rango', async () => {
      await expect(
        service.castVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 5 }, user('C')),
      ).rejects.toThrow(BadRequestException);
    });

    it('sin optionIndex en una pregunta single_choice, rechaza', async () => {
      await expect(
        service.castVote('meeting-1', 'session-1', { propertyId: 'p1' }, user('C')),
      ).rejects.toThrow(BadRequestException);
    });

    it('un voto propio sustituye al que hubiera registrado la gestora', async () => {
      await service.castVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 0 }, user('C'));
      expect(voteResponseUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ registeredByUserId: null, voterName: null }) }),
      );
    });

    it('con datos válidos, hace upsert sobre (voteSessionId, propertyId)', async () => {
      await service.castVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 0 }, user('C'));
      expect(voteResponseUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { voteSessionId_propertyId: { voteSessionId: 'session-1', propertyId: 'p1' } },
        }),
      );
    });

    describe('require2fa (Fase 2.3)', () => {
      beforeEach(() => {
        voteSessionFindFirst.mockResolvedValue({
          id: 'session-1', meetingId: 'meeting-1', agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple', status: 'abierta', require2fa: true,
        });
      });

      it('sin totpCode, rechaza sin llegar a validar nada', async () => {
        await expect(
          service.castVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 0 }, user('C')),
        ).rejects.toThrow(ForbiddenException);
        expect(twoFactorVerifySpy).not.toHaveBeenCalled();
        expect(voteResponseUpsert).not.toHaveBeenCalled();
      });

      it('con totpCode inválido (o cuenta sin 2FA activado), rechaza', async () => {
        twoFactorVerifySpy.mockResolvedValue(false);
        await expect(
          service.castVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 0, totpCode: '000000' }, user('C')),
        ).rejects.toThrow(ForbiddenException);
        expect(voteResponseUpsert).not.toHaveBeenCalled();
      });

      it('con totpCode válido, vota normalmente', async () => {
        twoFactorVerifySpy.mockResolvedValue(true);
        await service.castVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 0, totpCode: '123456' }, user('C'));
        expect(twoFactorVerifySpy).toHaveBeenCalledWith('user-1', '123456');
        expect(voteResponseUpsert).toHaveBeenCalled();
      });
    });
  });

  describe('deuda pendiente (art. 15.2 LPH)', () => {
    const owes = () => overdueSpy.mockResolvedValue(new Map([['p1', 350.5]]));

    it('un propietario con deuda vencida no puede votar: se rechaza y no se guarda el voto', async () => {
      owes();
      await expect(service.castVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 0 }, user('C'))).rejects.toThrow(ForbiddenException);
      await expect(service.castVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 0 }, user('C'))).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'DEBT_PENDING' }),
      });
      expect(voteResponseUpsert).not.toHaveBeenCalled();
    });

    it('la gestora no puede registrar el voto de una propiedad con deuda sin anularlo: devuelve el importe adeudado', async () => {
      owes();
      attendanceFindFirst.mockResolvedValue({ userId: 'u-owner' });
      await expect(service.registerVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 1 }, user('B'))).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'DEBT_PENDING', debt: 350.5 }),
      });
      expect(voteResponseUpsert).not.toHaveBeenCalled();
    });

    it('con la anulación confirmada la gestora sí registra el voto y queda constancia de la deuda en el registro de actividad', async () => {
      owes();
      attendanceFindFirst.mockResolvedValue({ userId: 'u-owner' });
      await service.registerVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 1, overrideDebt: true }, user('B'));
      expect(voteResponseUpsert).toHaveBeenCalled();
      expect(activityLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ summary: expect.stringContaining('deuda vencida de 350.50') }) }),
      );
    });

    it('una propiedad al corriente vota con normalidad', async () => {
      await service.castVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 0 }, user('C'));
      expect(voteResponseUpsert).toHaveBeenCalled();
    });

    it('listDebts: solo la gestora y con acceso auditado', async () => {
      owes();
      await expect(service.listDebts('meeting-1', user('C'))).rejects.toThrow(ForbiddenException);
      expect(await service.listDebts('meeting-1', user('B'))).toEqual([{ propertyId: 'p1', amount: 350.5 }]);
      expect(auditLogAccess).toHaveBeenCalledWith(expect.anything(), 'debtors', 'list', 'estate-1', 'vote-debts');
    });

    it('getVotingRight: comprueba la elegibilidad (la deuda no se revela a terceros) y avisa solo al afectado', async () => {
      owes();
      expect(await service.getVotingRight('meeting-1', 'p1', user('C'))).toEqual({ canVote: false, reason: 'debt' });
      expect(eligibilitySpy).toHaveBeenCalledWith('meeting-1', 'p1', 'user-1');
      overdueSpy.mockResolvedValue(new Map());
      expect(await service.getVotingRight('meeting-1', 'p1', user('C'))).toEqual({ canVote: true, reason: null });
    });

    it('getVotingRight: sin propertyId responde 400 en lugar de llegar a la consulta de elegibilidad', async () => {
      eligibilitySpy.mockClear();
      await expect(service.getVotingRight('meeting-1', undefined as unknown as string, user('C'))).rejects.toThrow(BadRequestException);
      expect(eligibilitySpy).not.toHaveBeenCalled();
    });
  });

  describe('registerVote', () => {
    const dto = { propertyId: 'p1', optionIndex: 1 };

    it('rechaza a un propietario (rol C): registrar votos ajenos es solo de la gestora', async () => {
      await expect(service.registerVote('meeting-1', 'session-1', dto, user('C'))).rejects.toThrow(ForbiddenException);
      expect(voteResponseUpsert).not.toHaveBeenCalled();
    });

    it('rechaza fuera de la votación: con la sesión cerrada no se puede registrar ni cambiar un voto', async () => {
      voteSessionFindFirst.mockResolvedValue({
        id: 'session-1', meetingId: 'meeting-1', agendaItemId: 'a1', questionIndex: 0, majorityType: 'mayoriaSimple', status: 'cerrada',
      });
      await expect(service.registerVote('meeting-1', 'session-1', dto, user('B'))).rejects.toThrow(ConflictException);
      expect(voteResponseUpsert).not.toHaveBeenCalled();
    });

    it('rechaza una propiedad ausente (sin asistencia ni representante)', async () => {
      await expect(service.registerVote('meeting-1', 'session-1', dto, user('B'))).rejects.toThrow('ausente');
      expect(voteResponseUpsert).not.toHaveBeenCalled();
    });

    it('rechaza una propiedad que no es de la finca', async () => {
      propertyFindFirst.mockResolvedValue(null);
      await expect(service.registerVote('meeting-1', 'session-1', dto, user('B'))).rejects.toThrow(NotFoundException);
    });

    it('rechaza una opción fuera de rango', async () => {
      attendanceFindFirst.mockResolvedValue({ userId: 'u-owner' });
      await expect(
        service.registerVote('meeting-1', 'session-1', { propertyId: 'p1', optionIndex: 9 }, user('B')),
      ).rejects.toThrow(BadRequestException);
    });

    it('propiedad presente: el voto consta a nombre de quien pasó lista y de la gestora que lo registró', async () => {
      attendanceFindFirst.mockResolvedValue({ userId: 'u-owner' });
      await service.registerVote('meeting-1', 'session-1', dto, user('B'));
      expect(voteResponseUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { voteSessionId_propertyId: { voteSessionId: 'session-1', propertyId: 'p1' } },
          create: expect.objectContaining({ userId: 'u-owner', voterName: null, registeredByUserId: 'user-1', optionIndex: 1 }),
          update: expect.objectContaining({ userId: 'u-owner', registeredByUserId: 'user-1', optionIndex: 1 }),
        }),
      );
      expect(activityLogCreate).toHaveBeenCalled();
    });

    it('propiedad representada por un usuario: vota el representante, aunque el titular también haya pasado lista', async () => {
      delegationFindFirst.mockResolvedValue({ representativeUser: { id: 'u-rep' }, representativeName: null });
      attendanceFindFirst.mockResolvedValue({ userId: 'u-owner' });
      await service.registerVote('meeting-1', 'session-1', dto, user('A'));
      expect(voteResponseUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ userId: 'u-rep', voterName: null }) }),
      );
    });

    it('propiedad representada por un externo sin cuenta: guarda su nombre y ningún usuario', async () => {
      delegationFindFirst.mockResolvedValue({ representativeUser: null, representativeName: 'Marta Gil' });
      await service.registerVote('meeting-1', 'session-1', dto, user('B'));
      expect(voteResponseUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ userId: null, voterName: 'Marta Gil', registeredByUserId: 'user-1' }),
        }),
      );
    });
  });

  describe('listResponses', () => {
    it('rechaza a un propietario (rol C): el voto individual es solo de la gestora', async () => {
      await expect(service.listResponses('meeting-1', 'session-1', user('C'))).rejects.toThrow(ForbiddenException);
      expect(voteResponseFindMany).not.toHaveBeenCalled();
    });

    it('rechaza una sesión que no es de esa junta', async () => {
      voteSessionFindFirst.mockResolvedValue(null);
      await expect(service.listResponses('meeting-1', 'otra', user('B'))).rejects.toThrow(NotFoundException);
    });

    it('devuelve propiedad, votante y opción de cada voto', async () => {
      const castAt = new Date('2026-10-22T20:30:00Z');
      voteResponseFindMany.mockResolvedValue([
        {
          propertyId: 'p1',
          optionIndex: 0,
          optionIndexes: [],
          castAt,
          property: { ref: '1A' },
          user: { fullName: 'Ana Pérez' },
          registeredByUser: null,
        },
        {
          propertyId: 'p2',
          optionIndex: 1,
          optionIndexes: [],
          castAt,
          property: { ref: '1B' },
          user: null,
          voterName: 'Marta Gil',
          registeredByUser: { fullName: 'Gestora' },
        },
      ]);
      await expect(service.listResponses('meeting-1', 'session-1', user('B'))).resolves.toEqual([
        { propertyId: 'p1', propertyRef: '1A', voterName: 'Ana Pérez', registeredByName: null, optionIndex: 0, optionIndexes: [], castAt },
        { propertyId: 'p2', propertyRef: '1B', voterName: 'Marta Gil', registeredByName: 'Gestora', optionIndex: 1, optionIndexes: [], castAt },
      ]);
      expect(voteResponseFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { voteSessionId: 'session-1' } }));
    });
  });

  describe('close', () => {
    it('rechaza a un propietario (rol C): cerrar votación es solo de Rol B/A', async () => {
      await expect(service.close('meeting-1', 'session-1', user('C'))).rejects.toThrow(ForbiddenException);
      expect(voteSessionUpdateMany).not.toHaveBeenCalled();
    });

    it('cierra con guarda transaccional (updateMany where status=abierta) y talla el resultado', async () => {
      await service.close('meeting-1', 'session-1', user('B'));
      expect(voteSessionUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'session-1', meetingId: 'meeting-1', status: 'abierta' } }),
      );
      expect(tallySpy).toHaveBeenCalledWith('meeting-1', 'session-1', 'mayoriaSimple', 'single_choice');
      expect(voteSessionUpdate).toHaveBeenCalled();
      expect(activityLogCreate).toHaveBeenCalled();
    });

    it('si el updateMany no afecta ninguna fila (ya cerrada por otra gestora), rechaza con ConflictException', async () => {
      voteSessionUpdateMany.mockResolvedValue({ count: 0 });
      voteSessionFindFirst.mockResolvedValue({ id: 'session-1', meetingId: 'meeting-1', status: 'cerrada' });
      await expect(service.close('meeting-1', 'session-1', user('B'))).rejects.toThrow(ConflictException);
    });
  });
});
