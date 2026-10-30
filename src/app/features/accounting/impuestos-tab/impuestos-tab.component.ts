import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BankAccount } from '../../../core/models';
import { LedgerService } from '../../../core/ledger.service';
import { Model111, Model190, Model347, TaxModel, TaxService } from '../../../core/tax.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
const KEY_LABELS: Record<string, string> = { A: 'A · Trabajo', G: 'G · Profesionales', other: 'Otra' };
const EXCLUSION_LABELS: Record<string, string> = {
  art_33_5: 'Suministros o seguros (art. 33.5 RGAT)',
  retencion: 'Con retención: va en el 190',
  umbral: 'No supera 3.005,06 €',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentQuarter(): number {
  return Math.floor(new Date().getMonth() / 3) + 1;
}

function parseEuros(value: string): number {
  const raw = String(value ?? '').trim();
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return NaN;
  return Math.abs(Math.round(n * 100) - n * 100) > 1e-6 ? NaN : Math.round(n * 100) / 100;
}

function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

/**
 * Modelos fiscales de la finca (fase 7b): 111 trimestral, 190 y 347 anuales.
 * Domora prepara los datos desde la contabilidad; la presentación la hace la
 * gestora en la sede de la AEAT. Cada modelo se descarga en Excel o PDF.
 */
@Component({
  selector: 'app-impuestos-tab',
  standalone: true,
  imports: [PageActionDirective, FormsModule, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './impuestos-tab.component.html',
  styleUrls: ['../cobros/cobros-modal.scss', '../nominas-tab/nominas-tab.component.scss', './impuestos-tab.component.scss'],
})
export class ImpuestosTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private tax = inject(TaxService);
  private ledger = inject(LedgerService);

  keyLabels = KEY_LABELS;
  exclusionLabels = EXCLUSION_LABELS;
  years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);
  year = signal(new Date().getFullYear());
  quarter = signal(currentQuarter());
  model = signal<TaxModel>('111');

  m111 = signal<Model111 | null>(null);
  m190 = signal<Model190 | null>(null);
  m347 = signal<Model347 | null>(null);
  banks = signal<BankAccount[]>([]);
  loading = signal(false);
  loadError = signal<string | null>(null);
  toastMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.banks.set((await this.ledger.listBankAccounts(this.estateId)).filter((b) => !b.closedAt));
    } catch (error) {
      console.error('Error cargando cuentas bancarias', error);
    }
    await this.load();
  }

  async select(model: TaxModel): Promise<void> {
    this.model.set(model);
    await this.load();
  }

  async setYear(year: number): Promise<void> {
    this.year.set(Number(year));
    await this.load();
  }

  async setQuarter(quarter: number): Promise<void> {
    this.quarter.set(Number(quarter));
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      if (this.model() === '111') this.m111.set(await this.tax.model111(this.estateId, this.year(), this.quarter()));
      if (this.model() === '190') this.m190.set(await this.tax.model190(this.estateId, this.year()));
      if (this.model() === '347') this.m347.set(await this.tax.model347(this.estateId, this.year()));
    } catch (error) {
      this.loadError.set(apiMessage(error, 'No se pudo calcular el modelo.'));
    } finally {
      this.loading.set(false);
    }
  }

  async download(format: 'xlsx' | 'pdf'): Promise<void> {
    const model = this.model();
    try {
      const blob = await this.tax.download(this.estateId, model, format, this.year(), model === '111' ? this.quarter() : undefined);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `modelo-${model}-${this.year()}${model === '111' ? `-T${this.quarter()}` : ''}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando el modelo', error);
      this.showToast('No se pudo descargar el documento.');
    }
  }

  // ── Ingreso del 111 ─────────────────────────────────────────────────────
  showSettle = signal(false);
  settleForm = { date: today(), amount: '', reference: '', bankAccountId: '' };
  settleSaving = signal(false);
  settleError = signal<string | null>(null);

  openSettle(): void {
    const pending = this.m111()?.pending ?? 0;
    this.settleForm = {
      date: today(),
      amount: pending > 0 ? pending.toFixed(2).replace('.', ',') : '',
      reference: '',
      bankAccountId: (this.banks().find((b) => b.isDefault) ?? this.banks()[0])?.id ?? '',
    };
    this.settleError.set(null);
    this.showSettle.set(true);
  }

  async confirmSettle(): Promise<void> {
    const amount = parseEuros(this.settleForm.amount);
    if (Number.isNaN(amount)) return this.settleError.set('Indica un importe mayor que cero, con dos decimales como mucho.');
    this.settleSaving.set(true);
    this.settleError.set(null);
    try {
      await this.tax.createSettlement(this.estateId, {
        kind: 'modelo111',
        period: `${this.year()}-T${this.quarter()}`,
        date: this.settleForm.date,
        amount,
        ...(this.settleForm.bankAccountId ? { bankAccountId: this.settleForm.bankAccountId } : {}),
        ...(this.settleForm.reference.trim() ? { reference: this.settleForm.reference.trim() } : {}),
      });
      this.showSettle.set(false);
      this.showToast('Ingreso del modelo 111 registrado');
      await this.load();
    } catch (error) {
      this.settleError.set(apiMessage(error, 'No se pudo registrar el ingreso.'));
    } finally {
      this.settleSaving.set(false);
    }
  }

  undoingId = signal<string | null>(null);
  undoReason = signal('');
  undoError = signal<string | null>(null);

  async confirmUndo(): Promise<void> {
    const id = this.undoingId();
    if (!id) return;
    if (this.undoReason().trim().length < 3) return this.undoError.set('Indica el motivo (queda en la contabilidad).');
    try {
      await this.tax.undoSettlement(id, this.undoReason().trim());
      this.undoingId.set(null);
      this.showToast('Ingreso deshecho');
      await this.load();
    } catch (error) {
      this.undoError.set(apiMessage(error, 'No se pudo deshacer el ingreso.'));
    }
  }

  openUndo(id: string): void {
    this.undoReason.set('');
    this.undoError.set(null);
    this.undoingId.set(id);
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  fmtDate(iso: string): string {
    return iso.split('-').reverse().join('/');
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 3000);
  }
}
