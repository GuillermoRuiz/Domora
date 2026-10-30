import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Purga periódica de tokens que ya no sirven para nada.
 *
 * Sin esto, `refresh_tokens` y `password_reset_tokens` crecen para siempre:
 * en la base de desarrollo, 339 de 533 filas (un 64%) ya estaban caducadas o
 * revocadas. El coste es doble — degrada la ruta de renovación de sesión, que
 * es la más frecuente de la API, y mantiene indefinidamente el historial de
 * sesiones de todos los usuarios, ampliando el daño de un volcado de la base.
 *
 * Se conserva una ventana corta después de caducar/revocar para poder
 * investigar un incidente reciente; pasado ese plazo, la fila no aporta nada.
 *
 * En despliegues con varias réplicas el cron corre en todas, pero `deleteMany`
 * con estos filtros es idempotente: la primera pasada borra y las demás no
 * encuentran nada. No hace falta coordinación entre instancias.
 */
@Injectable()
export class TokenCleanupService {
  private readonly logger = new Logger(TokenCleanupService.name);

  /** Días que se conservan los tokens ya inútiles, por trazabilidad forense. */
  private static readonly RETENTION_DAYS = 7;

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeStaleTokens(): Promise<void> {
    const cutoff = new Date(
      Date.now() - TokenCleanupService.RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    try {
      const [refresh, reset] = await Promise.all([
        this.prisma.refreshToken.deleteMany({
          where: {
            OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
          },
        }),
        this.prisma.passwordResetToken.deleteMany({
          where: {
            OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }],
          },
        }),
      ]);

      if (refresh.count > 0 || reset.count > 0) {
        this.logger.log(
          `Purga de tokens: ${refresh.count} de refresco y ${reset.count} de restablecimiento eliminados (anteriores a ${cutoff.toISOString()}).`,
        );
      }
    } catch (error) {
      // Un fallo de purga no debe tumbar el proceso: se registra y se
      // reintenta en la siguiente pasada.
      this.logger.error('Error purgando tokens caducados', error);
    }
  }
}
