import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import { dbErrorText } from '../../prisma/prisma-errors';
import type {
  CloseLatePaymentInterestPolicyDto,
  CreateLatePaymentInterestPolicyDto,
} from './late-interest.dto';

function day(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

/**
 * Tipos de interés de demora de una finca (fase 10, ADR D7). Una vigencia
 * ya usada nunca se edita ni se borra — se cierra (`validTo`) y se abre una
 * nueva. El no-solape entre vigencias es la garantía T11 de la base de
 * datos (EXCLUDE gist), no una comprobación de este servicio.
 */
@Injectable()
export class LatePaymentInterestPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
  ) {}

  async list(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    return this.prisma.latePaymentInterestPolicy.findMany({
      where: { estateId },
      orderBy: { validFrom: 'desc' },
    });
  }

  async create(
    estateId: string,
    dto: CreateLatePaymentInterestPolicyDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    try {
      return await this.prisma.latePaymentInterestPolicy.create({
        data: {
          estateId,
          annualRatePct: dto.annualRatePct,
          graceDays: dto.graceDays ?? 0,
          validFrom: day(dto.validFrom),
          meetingReference: dto.meetingReference,
          createdByUserId: user.id,
        },
      });
    } catch (error) {
      if (
        error instanceof Error &&
        dbErrorText(error).includes('excl_interest_policy_no_overlap')
      ) {
        throw new ConflictException(
          'Ya hay un tipo vigente en esas fechas para esta finca: cierra antes el anterior.',
        );
      }
      throw error;
    }
  }

  /** Cierra la vigencia de un tipo (para dar paso a uno nuevo). */
  async close(
    estateId: string,
    id: string,
    dto: CloseLatePaymentInterestPolicyDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    const policy = await this.prisma.latePaymentInterestPolicy.findFirst({
      where: { id, estateId },
    });
    if (!policy) {
      throw new NotFoundException(`Tipo de interés ${id} no encontrado.`);
    }
    return this.prisma.latePaymentInterestPolicy.update({
      where: { id },
      data: { validTo: day(dto.validTo) },
    });
  }
}
