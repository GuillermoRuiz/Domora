import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AccountingEstate, ClosePreconditionsView, FiscalYear, ResultApplicationTarget } from '../../../core/models';
import { FiscalYearsService } from '../../../core/fiscal-years.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

const RESERVE_MODE_LABELS: Record<string, string> = {
  none: 'sin dotación automática',
  receipt_share: 'una parte de cada cuota ordinaria',
  year_end_allocation: 'dotación al cierre del ejercicio',
  both: 'una parte de cada cuota + dotación al cierre',
};

const APPLY_TARGETS: { value: ResultApplicationTarget; label: string }[] = [
  { value: 'retained', label: 'Remanente (120)' },
  { value: 'reserve_fund', label: 'Fondo de reserva (117)' },
];

/**
 * Cierre de ejercicio real (fase 11 de doc/contabilidad/roadmap-partida-doble.md):
 * checklist de precondiciones, cierre (regularización + dotación + cierre por
 * dimensión + apertura de N+1 en un único paso irreversible salvo reapertura),
 * reapertura con motivo y aplicación del resultado tras la aprobación en junta.
 */
@Component({
  selector: 'app-cierre-tab',
  standalone: true,
  imports: [PageActionDirective, FormsModule, BadgeComponent, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './cierre-tab.component.html',
  styleUrls: [
    '../cuentas-contables-tab/cuentas-contables-tab.component.scss',
    '../ajustes-contables-tab/ajustes-contables-tab.component.scss',
    './cierre-tab.component.scss',
  ],
})
export class CierreTabComponent implements OnInit {
  @Input() estate!: AccountingEstate;

  private fiscalYearsSvc = inject(FiscalYearsService);

  readonly applyTargets = APPLY_TARGETS;

  loading = signal(true);
  loadError = signal<string | null>(null);
  toastMessage = signal<string | null>(null);

  fiscalYears = signal<FiscalYear[]>([]);
  year = signal(new Date().getFullYear());
  currentFiscalYear = computed(() => this.fiscalYears().find(f => f.year === this.year()) ?? null);

  reserveModeLabel = computed(() => {
    const fy = this.currentFiscalYear();
    return RESERVE_MODE_LABELS[fy?.reserveMode ?? 'receipt_share'] ?? '—';
  });

  preconditions = signal<ClosePreconditionsView | null>(null);
  loadingPreconditions = signal(false);
  preconditionsError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.fiscalYears.set(await this.fiscalYearsSvc.listFiscalYears(this.estate.id));
      await this.loadPreconditions();
    } catch (error) {
      console.error('Error cargando los ejercicios', error);
      this.loadError.set('No se pudieron cargar los ejercicios.');
    } finally {
      this.loading.set(false);
    }
  }

  async onYearChange(year: string | number): Promise<void> {
    this.year.set(Number(year));
    await this.loadPreconditions();
  }

  private async loadPreconditions(): Promise<void> {
    this.loadingPreconditions.set(true);
    this.preconditionsError.set(null);
    try {
      this.preconditions.set(await this.fiscalYearsSvc.closePreconditions(this.estate.id, this.year()));
    } catch (error: any) {
      this.preconditions.set(null);
      this.preconditionsError.set(apiMessage(error, 'No se pudieron comprobar las condiciones del cierre.'));
    } finally {
      this.loadingPreconditions.set(false);
    }
  }

  private setFiscalYear(updated: FiscalYear): void {
    this.fiscalYears.set([...this.fiscalYears().filter(f => f.year !== updated.year), updated]);
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 3000);
  }

  fmtDate(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleDateString('es-ES') : '—';
  }

  // ── Cerrar ────────────────────────────────────────────────────────────
  showCloseConfirm = signal(false);
  closing = signal(false);
  closeError = signal<string | null>(null);

  openCloseConfirm(): void {
    this.closeError.set(null);
    this.showCloseConfirm.set(true);
  }

  closeCloseConfirm(): void {
    this.showCloseConfirm.set(false);
  }

  async confirmClose(): Promise<void> {
    this.closing.set(true);
    this.closeError.set(null);
    try {
      const updated = await this.fiscalYearsSvc.closeFiscalYear(this.estate.id, this.year());
      this.setFiscalYear(updated);
      this.showCloseConfirm.set(false);
      this.showToast(`Ejercicio ${this.year()} cerrado`);
      await this.loadPreconditions();
    } catch (error: any) {
      this.closeError.set(apiMessage(error, 'No se pudo cerrar el ejercicio.'));
    } finally {
      this.closing.set(false);
    }
  }

  // ── Reabrir ───────────────────────────────────────────────────────────
  showReopenModal = signal(false);
  reopenReason = signal('');
  reopening = signal(false);
  reopenError = signal<string | null>(null);

  openReopenModal(): void {
    this.reopenReason.set('');
    this.reopenError.set(null);
    this.showReopenModal.set(true);
  }

  closeReopenModal(): void {
    this.showReopenModal.set(false);
  }

  async submitReopen(): Promise<void> {
    const reason = this.reopenReason().trim();
    if (reason.length < 10) {
      this.reopenError.set('Explica el motivo con algo más de detalle (mínimo 10 caracteres).');
      return;
    }
    this.reopening.set(true);
    this.reopenError.set(null);
    try {
      const updated = await this.fiscalYearsSvc.reopenFiscalYear(this.estate.id, this.year(), reason);
      this.setFiscalYear(updated);
      this.showReopenModal.set(false);
      this.showToast(`Ejercicio ${this.year()} reabierto`);
      await this.loadPreconditions();
    } catch (error: any) {
      this.reopenError.set(apiMessage(error, 'No se pudo reabrir el ejercicio.'));
    } finally {
      this.reopening.set(false);
    }
  }

  // ── Aplicar resultado ────────────────────────────────────────────────
  showApplyModal = signal(false);
  applyTarget = signal<ResultApplicationTarget>('retained');
  applying = signal(false);
  applyError = signal<string | null>(null);

  openApplyModal(): void {
    this.applyTarget.set('retained');
    this.applyError.set(null);
    this.showApplyModal.set(true);
  }

  closeApplyModal(): void {
    this.showApplyModal.set(false);
  }

  async submitApply(): Promise<void> {
    this.applying.set(true);
    this.applyError.set(null);
    try {
      const outcome = await this.fiscalYearsSvc.applyResult(this.estate.id, this.year(), this.applyTarget());
      this.showApplyModal.set(false);
      const targetLabel = this.applyTargets.find(t => t.value === outcome.target)?.label ?? outcome.target;
      this.showToast(`${this.fmtEur(outcome.appliedAmount)} aplicados a ${targetLabel}`);
    } catch (error: any) {
      this.applyError.set(apiMessage(error, 'No se pudo aplicar el resultado.'));
    } finally {
      this.applying.set(false);
    }
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
}
