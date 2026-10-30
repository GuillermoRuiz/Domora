import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { pgErrorCode } from '../prisma/prisma-errors';
import type { AppointOfficeTermDto, EndOfficeTermDto } from './dto/estate-office-term.dto';

@Injectable()
export class EstateGovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** JWT scope is never authoritative for maintenance of community officers. */
  async authorize(estateId: string, user: AuthenticatedUser) {
    const actor = await this.prisma.user.findFirst({
      where: { id: user.id, deletedAt: null, role: { in: ['A', 'B'] } },
      select: { id: true, role: true, administratorId: true },
    });
    if (!actor || (actor.role === 'B' && !actor.administratorId)) throw new ForbiddenException('Sin acceso a la comunidad.');
    const estate = await this.prisma.estate.findFirst({
      where: {
        id: estateId, deletedAt: null,
        ...(actor.role === 'B' ? { administratorId: actor.administratorId! } : {}),
        administrator: { deletedAt: null },
      }, select: { id: true },
    });
    if (!estate) throw new ForbiddenException('Sin acceso a la comunidad.');
    return actor;
  }

  async list(estateId: string, user: AuthenticatedUser) {
    await this.authorize(estateId, user);
    const terms = await this.prisma.estateOfficeTerm.findMany({ where: { estateId }, orderBy: { startsAt: 'desc' } });
    const properties = await this.prisma.property.findMany({
      where: { estateId, id: { in: terms.flatMap(term => term.propertyId ? [term.propertyId] : []) } },
      select: { id: true, ref: true },
    });
    const refs = new Map(properties.map(property => [property.id, property.ref]));
    return terms.map(term => ({ ...term, propertyReference: term.propertyId ? refs.get(term.propertyId) ?? null : null }));
  }

  async candidates(estateId: string, user: AuthenticatedUser) {
    await this.authorize(estateId, user);
    // Only name and association: no tax IDs, bank details, email or phone.
    const properties = await this.prisma.property.findMany({
      where: { estateId, deletedAt: null },
      select: { id: true, ref: true,
        memberships: { where: { status: 'linked', roleType: 'Propietario', user: { deletedAt: null } }, select: { userId: true, isKeyContact: true, user: { select: { fullName: true } } } },
        externalOwners: { where: { promotedToUserId: null, OR: [{ roleType: 'Propietario' }, { roleType: null }] }, select: { id: true, fullName: true, isKeyContact: true } },
      }, orderBy: { ref: 'asc' },
    });
    return properties.map(p => ({ id: p.id, ref: p.ref, holders: [
      ...p.memberships.map(m => ({ userId: m.userId, externalOwnerId: null, name: m.user.fullName, keyContact: m.isKeyContact })),
      ...p.externalOwners.map(o => ({ userId: null, externalOwnerId: o.id, name: o.fullName, keyContact: o.isKeyContact })),
    ] }));
  }

  async appoint(estateId: string, dto: AppointOfficeTermDto, user: AuthenticatedUser) {
    const actor = await this.authorize(estateId, user);
    const role = dto.role ?? 'PRESIDENT';
    const startsAt = new Date(`${dto.startsAt}T00:00:00.000Z`);
    const endsAt = dto.endsAt ? new Date(`${dto.endsAt}T00:00:00.000Z`) : null;
    if (!Number.isFinite(startsAt.getTime()) || (endsAt && (!Number.isFinite(endsAt.getTime()) || startsAt >= endsAt))) {
      throw new BadRequestException('La fecha de fin debe ser posterior al inicio.');
    }
    if (dto.userId && dto.externalOwnerId) throw new BadRequestException('Selecciona un único titular.');

    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT 1 FROM "estates" WHERE "id" = ${estateId}::uuid FOR UPDATE`;
        let propertyId = dto.propertyId ?? null;
        let name = dto.holderNameSnapshot?.trim();
        if (propertyId && !await tx.property.findFirst({ where: { id: propertyId, estateId, deletedAt: null }, select: { id: true } })) throw new BadRequestException('Propiedad ajena a la comunidad.');
        if (dto.userId) {
          const membership = await tx.propertyMembership.findFirst({
            where: { userId: dto.userId, status: 'linked', roleType: 'Propietario', user: { deletedAt: null }, property: { estateId, deletedAt: null, ...(propertyId ? { id: propertyId } : {}) } },
            select: { propertyId: true, user: { select: { fullName: true } } },
          });
          if (!membership) throw new BadRequestException('El titular no pertenece a esta comunidad.');
          propertyId = membership.propertyId;
          name = membership.user.fullName;
        } else if (dto.externalOwnerId) {
          const owner = await tx.externalOwner.findFirst({
            where: { id: dto.externalOwnerId, promotedToUserId: null, OR: [{ roleType: 'Propietario' }, { roleType: null }], property: { estateId, deletedAt: null, ...(propertyId ? { id: propertyId } : {}) } },
            select: { propertyId: true, fullName: true },
          });
          if (!owner) throw new BadRequestException('El titular no pertenece a esta comunidad.');
          propertyId = owner.propertyId;
          name = owner.fullName;
        }
        if (!name || name.length > 200) throw new BadRequestException('Indica el nombre del titular del cargo.');
        if (dto.appointedByMeetingId && !await tx.meeting.findFirst({ where: { id: dto.appointedByMeetingId, estateId }, select: { id: true } })) throw new BadRequestException('Junta ajena a la comunidad.');
        const coversStart = { startsAt: { lte: startsAt }, OR: [{ endsAt: null }, { endsAt: { gt: startsAt } }] };
        const holderId = dto.userId ? { userId: dto.userId } : dto.externalOwnerId ? { externalOwnerId: dto.externalOwnerId } : null;
        const currentOffice = holderId ? await tx.estateOfficeTerm.findFirst({ where: { estateId, ...holderId, ...coversStart } }) : null;
        if (currentOffice) {
          // Only a vice-president moving up to president vacates the old office; any other second office is refused.
          if (currentOffice.role !== 'VICE_PRESIDENT' || role !== 'PRESIDENT') {
            throw new ConflictException(`${name} ya es ${currentOffice.role === 'PRESIDENT' ? 'presidente' : 'vicepresidente'} de la comunidad.`);
          }
          if (currentOffice.startsAt.getTime() === startsAt.getTime()) throw new ConflictException('Su vicepresidencia empieza esa misma fecha. Usa una fecha posterior.');
          await tx.estateOfficeTerm.update({ where: { id: currentOffice.id }, data: { endsAt: startsAt } });
        }
        if (role === 'PRESIDENT') {
          const predecessor = await tx.estateOfficeTerm.findFirst({ where: { estateId, role: 'PRESIDENT', ...coversStart } });
          if (predecessor) {
            if (predecessor.startsAt.getTime() === startsAt.getTime()) throw new ConflictException('Ya existe un mandato con ese inicio. Finalízalo o usa una fecha posterior.');
            await tx.estateOfficeTerm.update({ where: { id: predecessor.id }, data: { endsAt: startsAt } });
          }
        }
        return tx.estateOfficeTerm.create({ data: {
          estateId, role, propertyId, userId: dto.userId ?? null, externalOwnerId: dto.externalOwnerId ?? null,
          holderNameSnapshot: name, startsAt, endsAt,
          appointedByMeetingId: dto.appointedByMeetingId ?? null, createdByUserId: actor.id,
        } });
      });
    } catch (error) {
      // Exclusion violations (SQLSTATE 23P01) reach Prisma 6 as an unknown request error without a code.
      const exclusion = pgErrorCode(error) === '23P01' || (error instanceof Prisma.PrismaClientUnknownRequestError && error.message.includes('23P01'));
      if (exclusion || (error instanceof Prisma.PrismaClientKnownRequestError && ['P2004', 'P2002'].includes(error.code))) throw new ConflictException('El mandato se solapa con otro presidente o con otro cargo del mismo titular.');
      throw error;
    }
  }

  async end(estateId: string, termId: string, dto: EndOfficeTermDto, user: AuthenticatedUser) {
    await this.authorize(estateId, user);
    const endsAt = new Date(`${dto.endsAt}T00:00:00.000Z`);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 FROM "estates" WHERE "id" = ${estateId}::uuid FOR UPDATE`;
      const term = await tx.estateOfficeTerm.findFirst({ where: { id: termId, estateId } });
      if (!term) throw new ForbiddenException('Sin acceso al mandato.');
      if (!Number.isFinite(endsAt.getTime()) || endsAt <= term.startsAt) throw new BadRequestException('La fecha de fin debe ser posterior al inicio.');
      // This action only terminates a mandate. Re-extending an ended term
      // would rewrite succession history and is intentionally not supported.
      if (term.endsAt && endsAt > term.endsAt) throw new BadRequestException('No se puede ampliar un mandato finalizado.');
      return tx.estateOfficeTerm.update({ where: { id: term.id }, data: { endsAt } });
    });
  }
}
