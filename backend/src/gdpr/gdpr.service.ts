import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';

/**
 * Derechos RGPD del interesado (Fase 13): portabilidad (art. 20) y
 * supresión (art. 17) con la matización clave de las obligaciones de
 * conservación mercantiles/fiscales — ver doc/compliance/rgpd.md.
 */
@Injectable()
export class GdprService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Export de portabilidad: todos los datos personales del usuario, en JSON. */
  async exportMyData(user: AuthenticatedUser) {
    const [
      profile,
      memberships,
      representations,
      issues,
      receipts,
      bookings,
      actions,
      reads,
      dailyActivity,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          phone: true,
          taxIdCountry: true,
          taxId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.propertyMembership.findMany({
        where: { userId: user.id },
        include: { property: { select: { ref: true, estateId: true } } },
      }),
      this.prisma.userRepresentation.findMany({
        where: {
          OR: [
            { representativeUserId: user.id },
            { representedUserId: user.id },
          ],
        },
      }),
      // Issues and requests the user raised, with the public part of their follow-up.
      this.prisma.issue.findMany({
        where: { reports: { some: { reporterUserId: user.id } } },
        include: { timeline: { where: { internal: false } } },
      }),
      this.prisma.accountingReceipt.findMany({
        where: { ownerUserId: user.id },
      }),
      this.prisma.booking.findMany({ where: { userId: user.id } }),
      this.prisma.debtorAction.findMany({ where: { authorUserId: user.id } }),
      this.prisma.resourceRead.findMany({ where: { userId: user.id } }),
      // Days the user used the platform and in which modules (usage metrics of the role A panel).
      this.prisma.userDailyActivity.findMany({ where: { userId: user.id }, orderBy: { day: 'asc' } }),
    ]);

    await this.audit.logAccess(user, 'gdpr_export', 'export', user.id);

    return {
      generatedAt: new Date().toISOString(),
      subject: profile,
      memberships,
      representations,
      issues,
      receipts,
      bookings,
      debtorActions: actions,
      resourceReads: reads,
      dailyActivity,
    };
  }

  /**
   * Derecho de supresión con retención legal: los documentos fiscales
   * (recibos, líneas de remesa) NO se borran — se seudonimiza la cuenta y
   * se anula la FK viva; los snapshots legales se conservan hasta que
   * venza su plazo (6 años, art. 30 CCom). Membresías revocadas, refresh
   * tokens invalidados y perfil anonimizado de forma irreversible.
   */
  async eraseMyAccount(user: AuthenticatedUser) {
    const existing = await this.prisma.user.findFirst({
      where: { id: user.id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Cuenta no encontrada o ya suprimida.');
    }
    if (user.role === 'B' || user.role === 'A') {
      // Una cuenta de gestora/plataforma no puede autosuprimirse mientras
      // sea la vía de administración: requiere baja gestionada (soporte).
      throw new ConflictException(
        'Las cuentas de administración requieren un proceso de baja gestionado.',
      );
    }

    const anonymousTag = `erased-${crypto.randomUUID().slice(0, 8)}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.propertyMembership.updateMany({
        where: { userId: user.id, status: { not: 'revoked' } },
        data: { status: 'revoked', revokedAt: new Date() },
      });
      await tx.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      // FK viva de documentos fiscales → null; el snapshot inmutable ya
      // contiene lo que exige conservación (se seudonimizará al vencer el
      // plazo por el job de retención — ver doc/compliance/rgpd.md §5).
      await tx.accountingReceipt.updateMany({
        where: { ownerUserId: user.id },
        data: { ownerUserId: null },
      });
      await tx.remesaLine.updateMany({
        where: { ownerUserId: user.id },
        data: { ownerUserId: null },
      });
      await tx.resourceRead.deleteMany({ where: { userId: user.id } });
      await tx.userDailyActivity.deleteMany({ where: { userId: user.id } });
      await tx.user.update({
        where: { id: user.id },
        data: {
          email: `${anonymousTag}@anon.invalid`,
          fullName: 'Usuario suprimido',
          phone: null,
          taxId: null,
          taxIdCountry: null,
          passwordHash: crypto.randomBytes(32).toString('hex'),
          deletedAt: new Date(),
        },
      });
    });

    await this.audit.logAccess(user, 'gdpr_erasure', 'erase', user.id);
    return { erased: true };
  }
}
