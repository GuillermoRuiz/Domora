import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ReportTableComponent, ReportSection } from '../../../shared/components/report-table/report-table.component';
import { CashSettlementReport, ReportsService } from '../../../core/reports.service';

function firstDayOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

/**
 * Liquidación por criterio de caja (fase 12): lo que de verdad entró y
 * salió del banco en el periodo, para presentar en la junta — distinto de
 * "Resultados", que es por devengo (cuándo se emitió el recibo, no cuándo
 * se cobró). Ver el comentario de `LedgerReportsService.cashSettlement`.
 */
@Component({
  selector: 'app-liquidacion-tab',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, ReportTableComponent],
  templateUrl: './liquidacion-tab.component.html',
  styleUrls: ['../cobros/cobros-modal.scss', '../nominas-tab/nominas-tab.component.scss', '../impuestos-tab/impuestos-tab.component.scss'],
})
export class LiquidacionTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private reports = inject(ReportsService);

  from = signal(firstDayOfYear());
  to = signal(today());

  report = signal<CashSettlementReport | null>(null);
  loading = signal(false);
  loadError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async setFrom(from: string): Promise<void> {
    this.from.set(from);
    await this.load();
  }

  async setTo(to: string): Promise<void> {
    this.to.set(to);
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.report.set(await this.reports.cashSettlement(this.estateId, this.from(), this.to()));
    } catch (error) {
      this.loadError.set(apiMessage(error, 'No se pudo calcular la liquidación.'));
    } finally {
      this.loading.set(false);
    }
  }

  get sections(): ReportSection[] {
    const r = this.report();
    if (!r) return [];
    const columns = [
      { key: 'code', header: 'Cuenta' },
      { key: 'name', header: 'Partida' },
      { key: 'amount', header: 'Importe', money: true },
    ];
    return [
      { title: 'Cobrado', columns, rows: r.income.rows, totals: { name: 'Total cobrado', amount: r.income.total }, empty: 'Sin cobros en el periodo.' },
      { title: 'Pagado', columns, rows: r.expense.rows, totals: { name: 'Total pagado', amount: r.expense.total }, empty: 'Sin pagos en el periodo.' },
    ];
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  async download(format: 'xlsx' | 'pdf'): Promise<void> {
    try {
      const blob = await this.reports.download(this.estateId, 'cash-settlement', format, { from: this.from(), to: this.to() });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `liquidacion-caja-${this.from()}-${this.to()}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando la liquidación', error);
    }
  }
}
