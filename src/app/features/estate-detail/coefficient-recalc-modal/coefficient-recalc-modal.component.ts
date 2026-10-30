import { Component, EventEmitter, Input, Output, effect, inject, signal, untracked } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { PropertiesService } from '../../../core/properties.service';
import { formatQuota } from '../../../core/format';
import { CoefficientAreaPreview, OwnerProperty } from '../../../core/models';

/**
 * Reparte 100% de coeficiente de participación proporcional a la
 * superficie construida (LPH art. 5) — previsualiza y, tras confirmar,
 * aplica. Nunca escribe sin que el admin vea antes la tabla de propuestos.
 */
@Component({
  selector: 'app-coefficient-recalc-modal',
  standalone: true,
  imports: [BtnComponent, IconComponent, DecimalPipe],
  templateUrl: './coefficient-recalc-modal.component.html',
  styleUrl: './coefficient-recalc-modal.component.scss',
})
export class CoefficientRecalcModalComponent {
  @Input({ required: true }) estateId!: string;

  @Input()
  set open(value: boolean) {
    this.openSignal.set(value);
  }
  get open(): boolean {
    return this.openSignal();
  }

  @Output() closed = new EventEmitter<void>();
  @Output() applied = new EventEmitter<OwnerProperty[]>();
  @Output() reviewProperties = new EventEmitter<void>();

  private readonly properties = inject(PropertiesService);
  private readonly openSignal = signal(false);

  readonly formatQuota = formatQuota;

  loading = signal(false);
  applying = signal(false);
  errorMsg = signal<string | null>(null);
  preview = signal<CoefficientAreaPreview | null>(null);

  constructor() {
    effect(() => {
      if (this.openSignal()) untracked(() => void this.load());
    });
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.errorMsg.set(null);
    this.preview.set(null);
    try {
      this.preview.set(await this.properties.previewQuotasByArea(this.estateId));
    } catch (err) {
      this.errorMsg.set(this.messageFrom(err, 'No se pudo calcular el reparto por m².'));
    } finally {
      this.loading.set(false);
    }
  }

  async apply(): Promise<void> {
    if (this.applying()) return;
    this.applying.set(true);
    this.errorMsg.set(null);
    try {
      const updated = await this.properties.applyQuotasByArea(this.estateId);
      this.applied.emit(updated);
      this.close();
    } catch (err) {
      this.errorMsg.set(this.messageFrom(err, 'No se pudo aplicar el reparto.'));
    } finally {
      this.applying.set(false);
    }
  }

  goToProperties(): void {
    this.reviewProperties.emit();
    this.close();
  }

  close(): void {
    this.closed.emit();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private messageFrom(err: any, fallback: string): string {
    const msg = err?.error?.message;
    if (typeof msg === 'string' && msg) return msg;
    if (Array.isArray(msg) && msg.length > 0) return msg.join(' ');
    return fallback;
  }
}
