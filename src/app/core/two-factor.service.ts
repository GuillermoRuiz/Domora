import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import { TwoFactorEnrollment, TwoFactorBackupCodes } from './models';

/**
 * 2FA opcional por TOTP (Fase 2.3) — cada usuario lo activa o no sobre su
 * propia cuenta, nunca obligatorio globalmente. El secreto viaja al
 * frontend en `enroll()` y vuelve en `verifyAndEnable()`: no se persiste
 * hasta que el código introducido lo confirma.
 */
@Injectable({ providedIn: 'root' })
export class TwoFactorService {
  private api = inject(ApiClientService);

  async status(): Promise<{ enabled: boolean }> {
    return this.api.get<{ enabled: boolean }>('/auth/2fa/status');
  }

  async enroll(): Promise<TwoFactorEnrollment> {
    return this.api.post<TwoFactorEnrollment>('/auth/2fa/enroll', {});
  }

  async verifyAndEnable(secret: string, code: string): Promise<TwoFactorBackupCodes> {
    return this.api.post<TwoFactorBackupCodes>('/auth/2fa/verify-enable', { secret, code });
  }

  async disable(): Promise<void> {
    await this.api.post('/auth/2fa/disable', {});
  }

  async regenerateBackupCodes(): Promise<TwoFactorBackupCodes> {
    return this.api.post<TwoFactorBackupCodes>('/auth/2fa/backup-codes/regenerate', {});
  }
}
