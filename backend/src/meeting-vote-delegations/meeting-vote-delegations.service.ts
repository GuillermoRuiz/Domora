import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { StorageService } from '../files/storage.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { isValidDniOrNie, normalizeSpanishId } from '../common/spanish-id';
import type { CreateVoteDelegationDto } from './dto/create-vote-delegation.dto';
import type { RevokeVoteDelegationDto } from './dto/revoke-vote-delegation.dto';

/** Fichero multipart tal y como lo entrega multer — mismo tipo que en meetings.service.ts. */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Delegación de voto para una junta y una propiedad (art. 15.1 LPH). Módulo
 * hermano de `user-representations/` (representación legal pesada, sin
 * relación con esto) — no importa `MeetingsModule` para evitar un ciclo,
 * replica localmente la resolución de junta+alcance.
 */
@Injectable()
export class MeetingVoteDelegationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly storage: StorageService,
  ) {}

  private async findMeetingOrThrow(meetingId: string, user: AuthenticatedUser) {
    const meeting = await this.prisma.meeting.findFirst({ where: { id: meetingId } });
    if (!meeting) {
      throw new NotFoundException(`Junta ${meetingId} no encontrada.`);
    }
    this.estateAccess.assertAccess(meeting.estateId, user);
    return meeting;
  }

  /** Rol A/B siempre; rol C solo puede actuar por sí mismo. */
  private assertCanActFor(delegatorUserId: string, user: AuthenticatedUser): void {
    if (user.role === 'A' || user.role === 'B') return;
    if (user.id !== delegatorUserId) {
      throw new ForbiddenException('Solo el titular puede delegar su propio voto.');
    }
  }

  async list(meetingId: string, user: AuthenticatedUser) {
    await this.findMeetingOrThrow(meetingId, user);
    const where =
      user.role === 'A' || user.role === 'B'
        ? { meetingId }
        : {
            meetingId,
            OR: [{ delegatorUserId: user.id }, { representativeUserId: user.id }],
          };
    return this.prisma.meetingVoteDelegation.findMany({
      where,
      include: {
        property: { select: { ref: true } },
        delegatorUser: { select: { fullName: true, email: true } },
        representativeUser: { select: { fullName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Titulares con voto (Propietario/Representante vinculados) de una propiedad — puebla el selector de delegador de la gestora. */
  async listEligibleDelegators(meetingId: string, propertyId: string, user: AuthenticatedUser) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, estateId: meeting.estateId },
    });
    if (!property) {
      throw new NotFoundException(`Propiedad ${propertyId} no encontrada en esta finca.`);
    }
    const memberships = await this.prisma.propertyMembership.findMany({
      where: { propertyId, status: 'linked', roleType: { in: ['Propietario', 'Representante'] } },
      include: { user: { select: { id: true, fullName: true } } },
    });
    return memberships.map((m) => ({ userId: m.user.id, name: m.user.fullName }));
  }

  async create(meetingId: string, dto: CreateVoteDelegationDto, user: AuthenticatedUser) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    this.assertCanActFor(dto.delegatorUserId, user);

    if (meeting.status !== 'convocada') {
      throw new ConflictException('No se puede delegar el voto de una junta que ya no está convocada.');
    }

    const representative = await this.resolveRepresentative(dto);
    if (representative.userId === dto.delegatorUserId) {
      throw new BadRequestException('No puedes delegarte el voto a ti mismo.');
    }

    const property = await this.prisma.property.findFirst({
      where: { id: dto.propertyId, estateId: meeting.estateId },
    });
    if (!property) {
      throw new NotFoundException(`Propiedad ${dto.propertyId} no encontrada en esta finca.`);
    }

    const eligible = await this.prisma.propertyMembership.findFirst({
      where: {
        propertyId: dto.propertyId,
        userId: dto.delegatorUserId,
        status: 'linked',
        roleType: { in: ['Propietario', 'Representante'] },
      },
    });
    if (!eligible) {
      throw new ForbiddenException('El delegante no es titular con derecho de voto de esta propiedad.');
    }

    return this.prisma.$transaction(async (tx) => {
      // Superseder cualquier delegación activa previa para esta junta+propiedad
      // (sin índice único parcial en el schema — ver comentario en el modelo).
      await tx.meetingVoteDelegation.updateMany({
        where: { meetingId, propertyId: dto.propertyId, revokedAt: null },
        data: {
          revokedAt: new Date(),
          revokedByUserId: user.id,
          revocationReason: 'Sustituida por una nueva delegación',
        },
      });
      const created = await tx.meetingVoteDelegation.create({
        data: {
          meetingId,
          propertyId: dto.propertyId,
          delegatorUserId: dto.delegatorUserId,
          representativeUserId: representative.userId,
          representativeName: representative.name,
          representativeDni: representative.dni,
          notes: dto.notes,
          createdByUserId: user.id,
        },
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'meeting',
          subjectId: meetingId,
          verb: 'created',
          summary: `Delegación de voto registrada para la propiedad ${property.ref ?? dto.propertyId}`,
          occurredAt: new Date(),
          estateId: meeting.estateId,
          propertyId: dto.propertyId,
        },
      });
      return created;
    });
  }

  /** Cuenta existente (por email) o persona externa (nombre + DNI/NIE) — exactamente una de las dos. */
  private async resolveRepresentative(
    dto: CreateVoteDelegationDto,
  ): Promise<{ userId: string | null; name: string | null; dni: string | null }> {
    const external = dto.representativeName !== undefined || dto.representativeDni !== undefined;
    if (dto.representativeEmail !== undefined && external) {
      throw new BadRequestException('Indica el representante por email o por nombre y DNI, no ambos.');
    }
    if (dto.representativeEmail !== undefined) {
      const user = await this.prisma.user.findUnique({
        where: { email: dto.representativeEmail },
        select: { id: true },
      });
      if (!user) {
        throw new NotFoundException(
          `No hay ninguna cuenta de Domora con el email ${dto.representativeEmail}.`,
        );
      }
      return { userId: user.id, name: null, dni: null };
    }
    const name = dto.representativeName?.trim();
    if (!name || !dto.representativeDni) {
      throw new BadRequestException('Indica el email del representante, o su nombre completo y su DNI.');
    }
    if (!isValidDniOrNie(dto.representativeDni)) {
      throw new BadRequestException('El DNI/NIE del representante no es válido.');
    }
    return { userId: null, name, dni: normalizeSpanishId(dto.representativeDni) };
  }

  private async assertCanRevoke(delegation: { delegatorUserId: string }, user: AuthenticatedUser) {
    if (user.role === 'A' || user.role === 'B') return;
    if (user.id !== delegation.delegatorUserId) {
      throw new ForbiddenException('Solo el titular que delegó puede revocar su delegación.');
    }
  }

  async revoke(
    meetingId: string,
    id: string,
    dto: RevokeVoteDelegationDto,
    user: AuthenticatedUser,
  ) {
    const meeting = await this.findMeetingOrThrow(meetingId, user);
    const delegation = await this.prisma.meetingVoteDelegation.findFirst({
      where: { id, meetingId },
    });
    if (!delegation) {
      throw new NotFoundException(`Delegación ${id} no encontrada.`);
    }
    await this.assertCanRevoke(delegation, user);
    if (delegation.revokedAt) {
      throw new ConflictException('Esta delegación ya estaba revocada.');
    }
    const updated = await this.prisma.meetingVoteDelegation.update({
      where: { id },
      data: { revokedAt: new Date(), revokedByUserId: user.id, revocationReason: dto.reason },
    });
    await this.prisma.activityLogEntry.create({
      data: {
        actorUserId: user.id,
        subjectType: 'meeting',
        subjectId: meetingId,
        verb: 'deleted',
        summary: `Delegación de voto revocada en "${meeting.title}"`,
        occurredAt: new Date(),
        estateId: meeting.estateId,
        propertyId: delegation.propertyId,
      },
    });
    return updated;
  }

  private async findDelegationOrThrow(meetingId: string, id: string, user: AuthenticatedUser) {
    await this.findMeetingOrThrow(meetingId, user);
    const delegation = await this.prisma.meetingVoteDelegation.findFirst({
      where: { id, meetingId },
    });
    if (!delegation) {
      throw new NotFoundException(`Delegación ${id} no encontrada.`);
    }
    return delegation;
  }

  /** Subir el escrito firmado es autoservicio (delegador) o gestora — mismo criterio que revocar. */
  async uploadDocument(
    meetingId: string,
    id: string,
    file: UploadedMulterFile,
    user: AuthenticatedUser,
  ) {
    const delegation = await this.findDelegationOrThrow(meetingId, id, user);
    await this.assertCanRevoke(delegation, user);
    this.storage.assertAllowed(file.mimetype, file.size);
    const s3Key = await this.storage.put(
      `meetings/${meetingId}/delegations`,
      file.originalname,
      file.buffer,
    );
    return this.prisma.meetingVoteDelegation.update({
      where: { id },
      data: { documentS3Key: s3Key },
    });
  }

  async downloadDocument(
    meetingId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<{ content: Buffer }> {
    const delegation = await this.findDelegationOrThrow(meetingId, id, user);
    if (user.role === 'C' && user.id !== delegation.delegatorUserId && user.id !== delegation.representativeUserId) {
      throw new ForbiddenException('No tienes acceso a este documento.');
    }
    if (!delegation.documentS3Key) {
      throw new NotFoundException('Esta delegación no tiene ningún escrito adjunto.');
    }
    const content = await this.storage.get(delegation.documentS3Key);
    return { content };
  }
}
