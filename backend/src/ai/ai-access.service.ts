import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class AiAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estates: EstateAccessService,
  ) {}
  async manager(estateId: string, user: AuthenticatedUser) {
    if (!estateId || !['A', 'B'].includes(user.role))
      throw new ForbiddenException('Solo administradores.');
    this.estates.assertAccess(estateId, user);
    const estate = await this.prisma.estate.findFirst({
      where: {
        id: estateId,
        deletedAt: null,
        administrator: { deletedAt: null },
      },
      select: {
        id: true,
        administratorId: true,
        name: true,
        administrator: { select: { contactEmail: true } },
      },
    });
    if (!estate) throw new NotFoundException('Finca no encontrada.');
    const actor = await this.prisma.user.findFirst({
      where: { id: user.id, deletedAt: null },
      select: { role: true, administratorId: true },
    });
    if (
      !actor ||
      actor.role !== user.role ||
      (user.role === 'B' &&
        (user.administratorId !== estate.administratorId ||
          actor.administratorId !== estate.administratorId))
    )
      throw new ForbiddenException('Acceso denegado.');
    return estate;
  }
}
