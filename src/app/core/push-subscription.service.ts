import { Injectable, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import { ApiClientService } from './api-client.service';

/**
 * Envuelve `SwPush` (push real del navegador) + los endpoints de `/push`.
 * "Activar push" es un concepto por-DISPOSITIVO (permiso del navegador),
 * no por-propiedad ni por-categoría — por eso vive separado de las
 * matrices de preferencia existentes en ajustes.
 */
@Injectable({ providedIn: 'root' })
export class PushSubscriptionService {
  // Opcional: en tests (y en cualquier entorno sin provideServiceWorker())
  // no hay provider de SwPush en absoluto — sin esto, inyectar este
  // servicio en CUALQUIER componente (ajustes, ajustes-c) revienta con
  // NG0201 aunque ese test no toque push para nada.
  private readonly swPush = inject(SwPush, { optional: true });
  private readonly apiClient = inject(ApiClientService);

  readonly isSupported = this.swPush?.isEnabled ?? false;
  readonly isSubscribed = signal(false);
  readonly busy = signal(false);

  constructor() {
    if (this.isSupported) {
      this.swPush!.subscription.subscribe((sub) => this.isSubscribed.set(sub !== null));
    }
  }

  async subscribe(): Promise<void> {
    if (!this.isSupported) return;
    this.busy.set(true);
    try {
      const { publicKey } = await this.apiClient.get<{ publicKey: string | null }>('/push/vapid-public-key');
      if (!publicKey) return;
      const sub = await this.swPush!.requestSubscription({ serverPublicKey: publicKey });
      const keys = sub.toJSON().keys;
      await this.apiClient.post('/push/subscriptions', {
        endpoint: sub.endpoint,
        keys: { p256dh: keys?.['p256dh'], auth: keys?.['auth'] },
        userAgent: navigator.userAgent,
      });
    } finally {
      this.busy.set(false);
    }
  }

  async unsubscribe(): Promise<void> {
    if (!this.isSupported) return;
    this.busy.set(true);
    try {
      const sub = await firstValueFrom(this.swPush!.subscription);
      const endpoint = sub?.endpoint;
      await this.swPush!.unsubscribe();
      await this.apiClient.delete('/push/subscriptions', endpoint ? { endpoint } : {});
    } finally {
      this.busy.set(false);
    }
  }
}
