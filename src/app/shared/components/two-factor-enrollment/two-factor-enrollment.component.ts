import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { BtnComponent } from '../btn/btn.component';
import { BadgeComponent } from '../badge/badge.component';
import { TwoFactorService } from '../../../core/two-factor.service';

/**
 * Verificación en dos pasos (2FA opcional por TOTP, Fase 2.3) — mismo
 * bloque usado tanto en `ajustes` (rol B) como en `ajustes-c` (rol C), ya
 * que ambos roles pueden votar en juntas (B a veces por delegación). El
 * secreto viaja del backend al frontend en `enroll()` y vuelve en
 * `verifyAndEnable()` — nunca se persiste hasta que el código lo confirma.
 */
@Component({
  selector: 'app-two-factor-enrollment',
  standalone: true,
  imports: [FormsModule, IconComponent, BtnComponent, BadgeComponent],
  templateUrl: './two-factor-enrollment.component.html',
  styleUrl: './two-factor-enrollment.component.scss',
})
export class TwoFactorEnrollmentComponent implements OnInit {
  private readonly twoFactorSvc = inject(TwoFactorService);

  loading = signal(true);
  enabled = signal(false);
  enrolling = signal(false);
  pendingSecret = signal<string | null>(null);
  qrDataUrl = signal<string | null>(null);
  code = signal('');
  backupCodes = signal<string[] | null>(null);
  errorMsg = signal<string | null>(null);
  busy = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      const { enabled } = await this.twoFactorSvc.status();
      this.enabled.set(enabled);
    } catch (error) {
      console.error('Error consultando el estado del 2FA', error);
    } finally {
      this.loading.set(false);
    }
  }

  async startEnroll(): Promise<void> {
    this.errorMsg.set(null);
    this.busy.set(true);
    try {
      const { secret, qrDataUrl } = await this.twoFactorSvc.enroll();
      this.pendingSecret.set(secret);
      this.qrDataUrl.set(qrDataUrl);
      this.enrolling.set(true);
    } catch (error) {
      console.error('Error iniciando el enrolamiento 2FA', error);
      this.errorMsg.set('No se pudo iniciar el enrolamiento.');
    } finally {
      this.busy.set(false);
    }
  }

  cancelEnroll(): void {
    this.enrolling.set(false);
    this.pendingSecret.set(null);
    this.qrDataUrl.set(null);
    this.code.set('');
    this.errorMsg.set(null);
  }

  async confirmEnroll(): Promise<void> {
    const secret = this.pendingSecret();
    const code = this.code().trim();
    if (!secret || !code) return;
    this.busy.set(true);
    this.errorMsg.set(null);
    try {
      const { backupCodes } = await this.twoFactorSvc.verifyAndEnable(secret, code);
      this.backupCodes.set(backupCodes);
      this.enabled.set(true);
      this.enrolling.set(false);
      this.pendingSecret.set(null);
      this.qrDataUrl.set(null);
      this.code.set('');
    } catch (error: any) {
      console.error('Error confirmando el 2FA', error);
      const msg = error?.error?.message;
      this.errorMsg.set(typeof msg === 'string' ? msg : 'Código incorrecto.');
    } finally {
      this.busy.set(false);
    }
  }

  async disable(): Promise<void> {
    if (!confirm('¿Desactivar la verificación en dos pasos?')) return;
    this.busy.set(true);
    try {
      await this.twoFactorSvc.disable();
      this.enabled.set(false);
      this.backupCodes.set(null);
    } catch (error) {
      console.error('Error desactivando el 2FA', error);
    } finally {
      this.busy.set(false);
    }
  }

  async regenerateBackupCodes(): Promise<void> {
    if (!confirm('¿Generar nuevos códigos de respaldo? Los anteriores dejarán de servir.')) return;
    this.busy.set(true);
    try {
      const { backupCodes } = await this.twoFactorSvc.regenerateBackupCodes();
      this.backupCodes.set(backupCodes);
    } catch (error) {
      console.error('Error regenerando los códigos de respaldo', error);
    } finally {
      this.busy.set(false);
    }
  }

  dismissBackupCodes(): void {
    this.backupCodes.set(null);
  }
}
