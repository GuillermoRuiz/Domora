import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateExternalOwnerDto, UpdateExternalOwnerDto } from './dto/external-owner.dto';

@Injectable()
export class ExternalOwnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  /**
   * ExternalOwner no tiene `estateId` propio — solo `propertyId` — así que
   * el filtro por finca es en dos pasos: propiedades de la finca, luego
   * titulares externos de esas propiedades. Igual que
   * `DataService.listExternalOwnersByEstate` en el mock Angular.
   */
  async listByEstate(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const properties = await this.prisma.property.findMany({
      where: { estateId, deletedAt: null },
      select: { id: true },
    });
    return this.prisma.externalOwner.findMany({
      where: { propertyId: { in: properties.map((p) => p.id) } },
    });
  }

  /** Solo devuelve titulares que no se hayan promovido ya a usuario real. */
  async findById(id: string, user: AuthenticatedUser) {
    const owner = await this.prisma.externalOwner.findFirst({
      where: { id, promotedToUserId: null },
      include: { property: true },
    });
    if (!owner) {
      throw new NotFoundException(`Titular externo ${id} no encontrado.`);
    }
    this.estateAccess.assertAccess(owner.property.estateId, user);
    return owner;
  }

  async create(propertyId: string, dto: CreateExternalOwnerDto, user: AuthenticatedUser) {
    const property = await this.prisma.property.findFirst({
      where: { id: propertyId, deletedAt: null },
      select: { estateId: true },
    });
    if (!property) {
      throw new NotFoundException(`Propiedad ${propertyId} no encontrada.`);
    }
    this.estateAccess.assertAccess(property.estateId, user);
    return this.prisma.externalOwner.create({
      data: { ...dto, propertyId, roleType: 'Propietario', createdByUserId: user.id },
    });
  }

  /**
   * Solo titulares aún sin promover: uno promovido ya es un usuario real
   * con sus propios datos, y sus recibos pasados conservan el snapshot.
   */
  async update(id: string, dto: UpdateExternalOwnerDto, user: AuthenticatedUser) {
    await this.findById(id, user);
    return this.prisma.externalOwner.update({ where: { id }, data: dto });
  }

  /**
   * Un titular promovido no llega aquí (`findById` lo excluye). Sus
   * invitaciones pendientes se borran con él: sin titular, el enlace no
   * tiene a quién vincular (la FK es `Restrict` para que nunca se pierdan
   * en silencio).
   */
  async remove(id: string, user: AuthenticatedUser) {
    await this.findById(id, user);
    await this.prisma.$transaction([
      this.prisma.propertyMembershipInvite.deleteMany({ where: { externalOwnerId: id, usedAt: null } }),
      this.prisma.externalOwner.delete({ where: { id } }),
    ]);
  }
}
