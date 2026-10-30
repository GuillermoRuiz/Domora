import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ChartAccount, CostCentre } from '../../../core/models';
import { JournalEntryView, JournalService } from '../../../core/journal.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
/** Cuentas que solo se mueven con sus documentos (recibos, facturas, cobros), igual que en el backend. */
const DOCUMENT_ROLES = new Set(['owners_receivable', 'suppliers_payable', 'creditors_payable', 'suspense']);

export interface ManualLineForm {
  accountId: string;
  debit: string;
  credit: string;
  costCentreId: string;
  concept: string;
}

function emptyLine(): ManualLineForm {
  return { accountId: '', debit: '', credit: '', costCentreId: '', concept: '' };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** '1.234,56' o '1234.56' → céntimos; 0 si está vacío; NaN si no es un importe válido. */
function toCents(value: string): number {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  if (!Number.isFinite(n) || n < 0) return NaN;
  const c = Math.round(n * 100);
  return Math.abs(c - n * 100) > 1e-6 ? NaN : c;
}

function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

/**
 * Asiento manual (fase 8): regularizaciones, amortizaciones, incobrables…
 * Todo lo que no nace de un documento. Debe cuadrar y cada línea va solo al
 * debe o solo al haber; el backend lo vuelve a comprobar.
 */
@Component({
  selector: 'app-asiento-manual-dialog',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './asiento-manual-dialog.component.html',
  styleUrls: ['../cobros/cobros-modal.scss', './asiento-manual-dialog.component.scss'],
})
export class AsientoManualDialogComponent {
  @Input({ required: true }) estateId!: string;
  @Input() set accounts(list: ChartAccount[]) {
    this.usableAccounts.set(
      list
        .filter((a) => a.postable !== false && !a.archivedAt && !a.requiresProperty && !a.requiresSupplier && !DOCUMENT_ROLES.has(a.systemRole ?? ''))
        .sort((a, b) => a.code.localeCompare(b.code)),
    );
  }
  @Input() costCentres: CostCentre[] = [];
  @Output() saved = new EventEmitter<JournalEntryView>();
  @Output() closed = new EventEmitter<void>();

  private journal = inject(JournalService);

  usableAccounts = signal<ChartAccount[]>([]);
  form = { date: today(), concept: '', reference: '' };
  lines: ManualLineForm[] = [emptyLine(), emptyLine()];
  saving = signal(false);
  error = signal<string | null>(null);
  private revision = signal(0);

  totals = computed(() => {
    this.revision();
    const debit = this.lines.reduce((s, l) => s + toCents(l.debit), 0);
    const credit = this.lines.reduce((s, l) => s + toCents(l.credit), 0);
    return {
      valid: Number.isFinite(debit) && Number.isFinite(credit),
      debit: debit / 100,
      credit: credit / 100,
      diff: (debit - credit) / 100,
    };
  });

  touch(): void {
    this.revision.update((v) => v + 1);
  }

  allowsCostCentre(line: ManualLineForm): boolean {
    return !!this.usableAccounts().find((a) => a.id === line.accountId)?.allowsCostCentre;
  }

  addLine(): void {
    this.lines = [...this.lines, emptyLine()];
    this.touch();
  }

  removeLine(index: number): void {
    if (this.lines.length <= 2) return;
    this.lines = this.lines.filter((_, i) => i !== index);
    this.touch();
  }

  /** Completa la última línea con lo que falta para cuadrar. */
  balanceLastLine(): void {
    const t = this.totals();
    if (!t.valid || t.diff === 0) return;
    const last = this.lines[this.lines.length - 1];
    const rest = this.lines.slice(0, -1);
    const debit = rest.reduce((s, l) => s + toCents(l.debit), 0);
    const credit = rest.reduce((s, l) => s + toCents(l.credit), 0);
    const missing = debit - credit;
    const fmt = (c: number) => (Math.abs(c) / 100).toFixed(2).replace('.', ',');
    last.debit = missing < 0 ? fmt(missing) : '';
    last.credit = missing > 0 ? fmt(missing) : '';
    this.touch();
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  async save(): Promise<void> {
    if (!this.form.date) return this.error.set('Indica la fecha del asiento.');
    if (this.form.concept.trim().length < 3) return this.error.set('Indica el concepto del asiento.');
    const parsed = [];
    for (const [i, l] of this.lines.entries()) {
      const n = i + 1;
      const debit = toCents(l.debit);
      const credit = toCents(l.credit);
      if (!l.accountId) return this.error.set(`Línea ${n}: elige la cuenta.`);
      if (Number.isNaN(debit) || Number.isNaN(credit)) return this.error.set(`Línea ${n}: importe no válido (dos decimales como mucho).`);
      if ((debit > 0) === (credit > 0)) return this.error.set(`Línea ${n}: pon el importe en el debe o en el haber, no en los dos.`);
      parsed.push({
        accountId: l.accountId,
        debit: debit / 100,
        credit: credit / 100,
        ...(l.costCentreId && this.allowsCostCentre(l) ? { costCentreId: l.costCentreId } : {}),
        ...(l.concept.trim() ? { concept: l.concept.trim() } : {}),
      });
    }
    if (this.totals().diff !== 0) return this.error.set(`El asiento no cuadra: la diferencia es de ${this.fmtEur(this.totals().diff)}.`);

    this.saving.set(true);
    this.error.set(null);
    try {
      const entry = await this.journal.createManual(this.estateId, {
        date: this.form.date,
        concept: this.form.concept.trim(),
        ...(this.form.reference.trim() ? { reference: this.form.reference.trim() } : {}),
        lines: parsed,
      });
      this.saved.emit(entry);
    } catch (error) {
      this.error.set(apiMessage(error, 'No se pudo registrar el asiento.'));
    } finally {
      this.saving.set(false);
    }
  }
}
