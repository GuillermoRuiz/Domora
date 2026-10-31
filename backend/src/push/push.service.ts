import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

export interface PushPayload {
  title: string;
  body?: string | null;
  url: string;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string | null;
}

/**
 * Envío de push real (Web Push API). Mismo criterio que MailService con
 * SMTP_HOST: sin VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY (caso por defecto en
 * desarrollo y hasta que se configuren en producción), degrada a loguear en
 * vez de fallar — nunca bloquea el arranque ni el resto de notificaciones.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const publicKey = this.configService.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.configService.get<string>('VAPID_PRIVATE_KEY');
    const subject =
      this.configService.get<string>('VAPID_SUBJECT') ??
      'mailto:soporte@domora.app';

    this.enabled = Boolean(publicKey && privateKey);
    if (this.enabled) {
      webpush.setVapidDetails(subject, publicKey!, privateKey!);
    }
  }

  getPublicKey(): string | null {
    return this.configService.get<string>('VAPID_PUBLIC_KEY') ?? null;
  }

  async saveSubscription(
    userId: string,
    sub: SubscriptionInput,
  ): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      update: {
        userId,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: sub.userAgent ?? null,
      },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: sub.userAgent ?? null,
      },
    });
  }

  async removeSubscription(userId: string, endpoint?: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId, ...(endpoint ? { endpoint } : {}) },
    });
  }

  /**
   * Nunca lanza — mismo criterio que NotificationsService.notify(): un push
   * que falla (o un hipo al consultar las suscripciones) no debe tumbar la
   * operación de negocio que lo originó. El try/catch envuelve la función
   * ENTERA, no solo el envío — un fallo de `findMany` no está más
   * justificado para colarse que uno de `sendNotification`.
   */
  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    try {
      await this.doSendToUser(userId, payload);
    } catch (error) {
      this.logger.error(`No se pudo procesar el push para ${userId}`, error);
    }
  }

  private async doSendToUser(
    userId: string,
    payload: PushPayload,
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(
        `VAPID_* no configurado — push NO enviado de verdad. Para: ${userId} · "${payload.title}"`,
      );
      return;
    }
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (subscriptions.length === 0) return;

    const body = JSON.stringify(payload);
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            body,
          );
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // Suscripción caducada o revocada por el navegador: ya no sirve de nada.
            await this.prisma.pushSubscription
              .delete({ where: { id: sub.id } })
              .catch(() => undefined);
            return;
          }
          this.logger.warn(
            `No se pudo enviar el push a la suscripción ${sub.id} del usuario ${userId}`,
            error,
          );
        }
      }),
    );
  }
}
