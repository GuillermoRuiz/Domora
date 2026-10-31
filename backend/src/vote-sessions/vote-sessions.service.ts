import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { MeetingEligibilityService } from '../meetings/meeting-eligibility.service';
import { listPresentPropertyIds } from '../meetings/meeting-quorum.service';
import { VoteTallyService } from './vote-tally.service';
import { VoteDebtService } from './vote-debt.service';
import { AuditService } from '../gdpr/audit.service';
import { TwoFactorService } from '../two-factor/two-factor.service';
import { MailService } from '../mail/mail.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { OpenVoteSessionDto } from './dto/open-vote-session.dto';
import type { CastVoteDto } from './dto/cast-vote.dto';
import type { RegisterVoteDto } from './dto/register-vote.dto';

interface VoteQuestionShape {
  title: string;
  type: 'single_choice' | 'multiple_choice' | 'text';
  options?: string[];
  majorityType?: 'unanimidad' | 'tresQuintos' | 'mayoriaSimple';
}

interface AgendaItemShape {
  id: string;
  title: string;
  hasVote?: boolean;
  voteTemplate?: { questions: VoteQuestionShape[] };
}

/**
 * Motor de votación real (Fase 2.1 — "Juntas al máximo"). Módulo hermano de
 * `meeting-vote-delegations/`, no importa `MeetingsModule` para el ciclo de
 * vida de la junta (replica localmente `findMeetingOrThrow`/`assertManager`,
 * mismo criterio que ese módulo), pero SÍ importa `MeetingsModule` para
 * reutilizar `MeetingEligibilityService` — la única fuente de verdad sobre
 * "quién puede actuar por esta propiedad en esta junta", ya usada por la
 * asistencia y el pase de lista.
 */
@Injectable()
export class VoteSessionsService {
  private readonly logger = new Logger(VoteSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly eligibility: MeetingEligibilityService,
    private readonly tally: VoteTallyService,
    private readonly twoFactor: TwoFactorService,
    private readonly mail: MailService,
    private readonly debt: VoteDebtService,
    private readonly audit: AuditService,
  ) {}

  /** Réplica local de `MeetingsService.listEstateOwnerEmails` — evita un ciclo de módulos por una sola query. */
  private async listEstateOwnerEmails(
    estateId: string,
  ): Promise<{ email: string; fullName: string }[]> {
    const memberships = await this.prisma.propertyMembership.findMany({
      where: { status: 'linked', property: { estateId, deletedAt: null } },
      include: { user: { select: { email: true, fullName: true } } },
    });
    const byEmail = new Map<string, string>();
    for (const m of memberships) {
      if (m.user?.email) byEmail.set(m.user.email, m.user.fullName);
    }
    return [...byEmail.entries()].map(([email, fullName]) => ({
      email,
      fullName,
    }));
  }

  private async findMeetingOrThrow(meetingId: string, user: AuthenticatedUser) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId },
    });
    if (!meeting) {
      throw new NotFoundException(`Junta ${meetingId} no encontrada.`);
    }
    this.estateAccess.assertAccess(meeting.estateId, user);
    return meeting;
  }

  /** Abrir/cerrar sesiones de voto es Rol A/B — igual criterio que gestionar la junta en MeetingsService. */
  private assertManager(user: AuthenticatedUser): void {
    if (user.role !== 'A' && user.role !== 'B') {
      throw new ForbiddenException(
        'Solo un administrador de finca puede abrir o cerrar una votación.',
      );
    }
  }

  private resolveQuestion(
    agenda: unknown,
    agendaItemId: string,
    questionIndex: number,
  ): VoteQuestionShape {
    const items = (agenda as AgendaItemShape[] | null) ?? [];
    const item = items.find((i) => i.id === agendaItemId);
    if (!item) {
      throw new NotFoundException(
        `No hay ningún punto del orden del día con id "${agendaItemId}".`,
      );
    }
    if (!item.hasVote || !item.voteTemplate) {
      throw new BadRequestException(
        `El punto "${item.title}" no tiene votación configurada.`,
      );
    }
    const question = item.voteTemplate.questions[questionIndex];
    if (!question) {
      throw new NotFoundException(
        `El punto "${item.title}" no tiene una pregunta en el índice ${questionIndex}.`,
      );
    }
    return question;
  }

  async list(meetingId: string, user: AuthenticatedUser) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    const sessions = await this.prisma.voteSession.findMany({
      where: { meetingId },
      orderBy: { openedAt: 'asc' },
    });
    return Promise.all(
      sessions.map(async (session) => {
        if (session.status === 'cerrada') {
          return { ...session, liveTally: null };
        }
        const question = this.resolveQuestion(
          meeting.agenda,
          session.agendaItemId,
          session.questionIndex,
        );
        const liveTally = await this.tally.tally(
          meetingId,
          session.id,
          session.majorityType,
          question.type as 'single_choice' | 'multiple_choice',
        );
        return { ...session, liveTally };
      }),
    );
  }

  /**
   * Qué votó cada propiedad en una sesión — solo la gestora (A/B): el voto
   * individual consta en el acta, pero no se muestra a otros vecinos.
   */
  async listResponses(
    meetingId: string,
    sessionId: string,
    user: AuthenticatedUser,
  ) {
    await this.findMeetingOrThrow(meetingId, user);
    if (user.role !== 'A' && user.role !== 'B') {
      throw new ForbiddenException(
        'Solo un administrador de finca puede ver el detalle de los votos.',
      );
    }
    await this.findSessionOrThrow(meetingId, sessionId);
    const responses = await this.prisma.voteResponse.findMany({
      where: { voteSessionId: sessionId },
      include: {
        property: { select: { ref: true } },
        user: { select: { fullName: true } },
        registeredByUser: { select: { fullName: true } },
      },
      orderBy: { castAt: 'asc' },
    });
    return responses.map((response) => ({
      propertyId: response.propertyId,
      propertyRef: response.property.ref,
      voterName: response.user?.fullName ?? response.voterName ?? '—',
      registeredByName: response.registeredByUser?.fullName ?? null,
      optionIndex: response.optionIndex,
      optionIndexes: response.optionIndexes,
      castAt: response.castAt,
    }));
  }

  async open(
    meetingId: string,
    dto: OpenVoteSessionDto,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);

    const question = this.resolveQuestion(
      meeting.agenda,
      dto.agendaItemId,
      dto.questionIndex,
    );
    if (question.type === 'text') {
      throw new BadRequestException(
        'Una pregunta de texto libre no tiene semántica de aprobado/rechazado — no se puede abrir como votación.',
      );
    }

    // La mayoría se decide al preparar la junta (paso 2 del asistente); `dto` solo cubre juntas anteriores.
    const majorityType = question.majorityType ?? dto.majorityType;
    if (!majorityType) {
      throw new BadRequestException(
        'Esta pregunta no tiene tipo de mayoría: indícalo al abrir la votación o edita la junta.',
      );
    }

    // Sin nadie presente ni representado no hay quién vote: abrir la votación no tendría sentido.
    if ((await listPresentPropertyIds(this.prisma, meetingId)).size === 0) {
      throw new ConflictException(
        'No se puede iniciar la votación: no hay propietarios presentes ni representados.',
      );
    }

    const session = await this.prisma.voteSession.create({
      data: {
        meetingId,
        agendaItemId: dto.agendaItemId,
        questionIndex: dto.questionIndex,
        majorityType,
        openedByUserId: user.id,
        // Snapshot al abrir — cambiar el requisito global de la junta
        // después no debe alterar una sesión ya abierta con otra regla.
        require2fa: meeting.require2faForVoting,
      },
    });
    await this.prisma.activityLogEntry.create({
      data: {
        actorUserId: user.id,
        subjectType: 'meeting',
        subjectId: meetingId,
        verb: 'created',
        summary: `Votación abierta: "${question.title}" (${meeting.title})`,
        occurredAt: new Date(),
        estateId: meeting.estateId,
      },
    });

    // Fase 2.4 — evento síncrono, no pasa por el cron. Un fallo de envío
    // nunca debe tumbar la apertura de la votación, que ya persistió.
    const recipients = await this.listEstateOwnerEmails(meeting.estateId);
    void Promise.all(
      recipients.map((r) =>
        this.mail
          .sendVoteSessionOpened(r.email, meeting.title, question.title)
          .catch((error: unknown) =>
            this.logger.warn(
              `No se pudo avisar a ${r.email} de la votación abierta: ${String(error)}`,
            ),
          ),
      ),
    );

    return session;
  }

  private async findSessionOrThrow(meetingId: string, id: string) {
    const session = await this.prisma.voteSession.findFirst({
      where: { id, meetingId },
    });
    if (!session) {
      throw new NotFoundException(`Sesión de voto ${id} no encontrada.`);
    }
    return session;
  }

  /** Valida que la opción elegida exista y que el formato (una o varias) coincida con el tipo de pregunta. */
  private assertValidChoice(
    question: VoteQuestionShape,
    dto: { optionIndex?: number; optionIndexes?: number[] },
  ): void {
    if (question.type === 'multiple_choice') {
      if (!dto.optionIndexes || dto.optionIndexes.length === 0) {
        throw new BadRequestException(
          'Esta pregunta admite varias opciones — envía "optionIndexes".',
        );
      }
      const outOfRange = dto.optionIndexes.some(
        (i) => i < 0 || i >= (question.options?.length ?? 0),
      );
      if (outOfRange) {
        throw new BadRequestException(
          'Una de las opciones elegidas no existe para esta pregunta.',
        );
      }
    } else {
      if (dto.optionIndex == null) {
        throw new BadRequestException(
          'Esta pregunta admite una sola opción — envía "optionIndex".',
        );
      }
      if (
        dto.optionIndex < 0 ||
        dto.optionIndex >= (question.options?.length ?? 0)
      ) {
        throw new BadRequestException(
          'La opción elegida no existe para esta pregunta.',
        );
      }
    }
  }

  /**
   * La gestora emite o cambia el voto de una propiedad presente o representada
   * (art. 15.1 LPH: el representante vota por el titular, aunque no tenga cuenta
   * en Domora). Solo con la votación abierta, nunca antes ni después, y nunca por
   * una propiedad ausente. Consta quién lo registró.
   */
  async registerVote(
    meetingId: string,
    sessionId: string,
    dto: RegisterVoteDto,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    if (user.role !== 'A' && user.role !== 'B') {
      throw new ForbiddenException(
        'Solo un administrador de finca puede registrar el voto de un vecino.',
      );
    }
    const session = await this.findSessionOrThrow(meetingId, sessionId);
    if (session.status !== 'abierta') {
      throw new ConflictException(
        'Solo se puede registrar o cambiar un voto mientras la votación está abierta.',
      );
    }
    const property = await this.prisma.property.findFirst({
      where: {
        id: dto.propertyId,
        estateId: meeting.estateId,
        deletedAt: null,
      },
      select: { id: true, ref: true },
    });
    if (!property) {
      throw new NotFoundException(
        `Propiedad ${dto.propertyId} no encontrada en esta finca.`,
      );
    }
    const question = this.resolveQuestion(
      meeting.agenda,
      session.agendaItemId,
      session.questionIndex,
    );
    this.assertValidChoice(question, dto);

    // Art. 15.2 LPH: con deuda vencida no hay derecho de voto, salvo que la gestora lo anule a conciencia.
    const owed =
      (await this.debt.overdueByProperty(meeting.estateId, [property.id])).get(
        property.id,
      ) ?? 0;
    if (owed > 0 && !dto.overrideDebt) {
      throw new ConflictException({
        code: 'DEBT_PENDING',
        debt: owed,
        message: `La propiedad ${property.ref ?? property.id} tiene una deuda vencida de ${owed.toFixed(2)} € con la comunidad: según el art. 15.2 LPH no tiene derecho de voto.`,
      });
    }

    const voter = await this.resolveVoter(meetingId, dto.propertyId);
    const choice = {
      optionIndex: question.type === 'multiple_choice' ? null : dto.optionIndex,
      optionIndexes:
        question.type === 'multiple_choice' ? (dto.optionIndexes ?? []) : [],
    };
    const data = {
      userId: voter.userId,
      voterName: voter.name,
      registeredByUserId: user.id,
      ...choice,
    };
    const saved = await this.prisma.voteResponse.upsert({
      where: {
        voteSessionId_propertyId: {
          voteSessionId: sessionId,
          propertyId: dto.propertyId,
        },
      },
      update: { ...data, castAt: new Date() },
      create: { voteSessionId: sessionId, propertyId: dto.propertyId, ...data },
    });
    await this.prisma.activityLogEntry.create({
      data: {
        actorUserId: user.id,
        subjectType: 'meeting',
        subjectId: meetingId,
        verb: 'updated',
        summary:
          `Voto de la propiedad ${property.ref ?? property.id} registrado por la gestora en "${meeting.title}"` +
          (owed > 0
            ? ` pese a una deuda vencida de ${owed.toFixed(2)} € (anulación del art. 15.2 LPH confirmada)`
            : ''),
        occurredAt: new Date(),
        estateId: meeting.estateId,
        propertyId: dto.propertyId,
      },
    });
    return saved;
  }

  /**
   * Quién vota por la propiedad: el representante si hay una delegación vigente
   * (con cuenta, o externo por nombre) y, si no, quien pasó lista. Una propiedad
   * sin ninguna de las dos está ausente y no puede votar.
   */
  private async resolveVoter(
    meetingId: string,
    propertyId: string,
  ): Promise<{ userId: string | null; name: string | null }> {
    const delegation = await this.prisma.meetingVoteDelegation.findFirst({
      where: { meetingId, propertyId, revokedAt: null },
      include: { representativeUser: { select: { id: true } } },
    });
    if (delegation) {
      return delegation.representativeUser
        ? { userId: delegation.representativeUser.id, name: null }
        : { userId: null, name: delegation.representativeName };
    }
    const attendee = await this.prisma.meetingAttendance.findFirst({
      where: { meetingId, propertyId },
      orderBy: { joinedAt: 'asc' },
    });
    if (attendee) return { userId: attendee.userId, name: null };
    throw new ConflictException(
      'La propiedad está ausente: solo se puede registrar el voto de propiedades presentes o representadas.',
    );
  }

  async castVote(
    meetingId: string,
    sessionId: string,
    dto: CastVoteDto,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    const session = await this.findSessionOrThrow(meetingId, sessionId);
    if (session.status !== 'abierta') {
      throw new ConflictException('Esta votación ya está cerrada.');
    }
    await this.eligibility.assertEligibleForProperty(
      meetingId,
      dto.propertyId,
      user.id,
    );

    // Art. 15.2 LPH: quien debe cuotas vencidas no vota. Solo la gestora puede anularlo, al registrar el voto.
    const owed =
      (
        await this.debt.overdueByProperty(meeting.estateId, [dto.propertyId])
      ).get(dto.propertyId) ?? 0;
    if (owed > 0) {
      throw new ForbiddenException({
        code: 'DEBT_PENDING',
        message:
          'Tienes una deuda pendiente con la comunidad: según el art. 15.2 LPH no puedes votar hasta regularizarla.',
      });
    }

    if (session.require2fa) {
      if (!dto.totpCode) {
        throw new ForbiddenException(
          'Esta junta exige verificación en dos pasos para votar. Introduce tu código.',
        );
      }
      const valid = await this.twoFactor.verifyCode(user.id, dto.totpCode);
      if (!valid) {
        throw new ForbiddenException(
          'Código de verificación en dos pasos incorrecto o tu cuenta no lo tiene activado. Actívalo en Ajustes.',
        );
      }
    }

    const question = this.resolveQuestion(
      meeting.agenda,
      session.agendaItemId,
      session.questionIndex,
    );
    this.assertValidChoice(question, dto);

    return this.prisma.voteResponse.upsert({
      where: {
        voteSessionId_propertyId: {
          voteSessionId: sessionId,
          propertyId: dto.propertyId,
        },
      },
      update: {
        userId: user.id,
        voterName: null,
        registeredByUserId: null,
        optionIndex:
          question.type === 'multiple_choice' ? null : dto.optionIndex,
        optionIndexes:
          question.type === 'multiple_choice' ? (dto.optionIndexes ?? []) : [],
        castAt: new Date(),
      },
      create: {
        voteSessionId: sessionId,
        propertyId: dto.propertyId,
        userId: user.id,
        optionIndex:
          question.type === 'multiple_choice' ? null : dto.optionIndex,
        optionIndexes:
          question.type === 'multiple_choice' ? (dto.optionIndexes ?? []) : [],
      },
    });
  }

  /** Deuda vencida de cada propiedad de la finca (solo la gestora): alimenta el botón «Deuda pendiente». */
  async listDebts(
    meetingId: string,
    user: AuthenticatedUser,
  ): Promise<{ propertyId: string; amount: number }[]> {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    if (user.role !== 'A' && user.role !== 'B') {
      throw new ForbiddenException(
        'Solo un administrador de finca puede consultar las deudas de la junta.',
      );
    }
    // Datos de morosidad = datos personales delicados: el acceso queda registrado.
    await this.audit.logAccess(
      user,
      'debtors',
      'list',
      meeting.estateId,
      'vote-debts',
    );
    const debts = await this.debt.overdueByProperty(meeting.estateId);
    return [...debts.entries()].map(([propertyId, amount]) => ({
      propertyId,
      amount,
    }));
  }

  /**
   * Si quien consulta puede votar por la propiedad. Solo responde a quien puede actuar por ella (misma
   * elegibilidad que votar): la deuda de un vecino nunca se revela a los demás.
   */
  async getVotingRight(
    meetingId: string,
    propertyId: string,
    user: AuthenticatedUser,
  ): Promise<{ canVote: boolean; reason: 'debt' | null }> {
    if (!propertyId)
      throw new BadRequestException('Indica la propiedad (propertyId).');
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    await this.eligibility.assertEligibleForProperty(
      meetingId,
      propertyId,
      user.id,
    );
    const owed =
      (await this.debt.overdueByProperty(meeting.estateId, [propertyId])).get(
        propertyId,
      ) ?? 0;
    return owed > 0
      ? { canVote: false, reason: 'debt' }
      : { canVote: true, reason: null };
  }

  async close(meetingId: string, sessionId: string, user: AuthenticatedUser) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertManager(user);

    // Mismo patrón transaccional que MeetingsService.updateStatus: guarda
    // condicional contra un cierre concurrente (dos gestoras cerrando a la
    // vez la misma sesión).
    const { count } = await this.prisma.voteSession.updateMany({
      where: { id: sessionId, meetingId, status: 'abierta' },
      data: {
        status: 'cerrada',
        closedAt: new Date(),
        closedByUserId: user.id,
      },
    });
    if (count === 0) {
      const existing = await this.findSessionOrThrow(meetingId, sessionId);
      if (existing.status === 'cerrada') {
        throw new ConflictException('Esta votación ya estaba cerrada.');
      }
      throw new NotFoundException(`Sesión de voto ${sessionId} no encontrada.`);
    }

    const session = await this.findSessionOrThrow(meetingId, sessionId);
    const question = this.resolveQuestion(
      meeting.agenda,
      session.agendaItemId,
      session.questionIndex,
    );
    const result = await this.tally.tally(
      meetingId,
      sessionId,
      session.majorityType,
      question.type as 'single_choice' | 'multiple_choice',
    );

    const updated = await this.prisma.voteSession.update({
      where: { id: sessionId },
      data: { resultSummary: result as unknown as object },
    });

    await this.prisma.activityLogEntry.create({
      data: {
        actorUserId: user.id,
        subjectType: 'meeting',
        subjectId: meetingId,
        verb: 'status_changed',
        summary: `Votación cerrada: "${question.title}" — ${result.passed === null ? 'sin veredicto (selección múltiple)' : result.passed ? 'aprobado' : 'rechazado'}`,
        occurredAt: new Date(),
        estateId: meeting.estateId,
      },
    });

    return { ...updated, liveTally: result };
  }
}
