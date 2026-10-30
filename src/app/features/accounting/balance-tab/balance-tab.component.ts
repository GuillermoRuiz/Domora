import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ReportTableComponent, ReportSection } from '../../../shared/components/report-table/report-table.component';
import { BalanceSheetReport, EstateReportKind, ReportsService, TrialBalanceReport } from '../../../core/reports.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
type View = 'trial-balance' | 'balance-sheet';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

/**
 * Sumas y saldos y balance de situación (fase 12) — las dos vistas "de un
 * vistazo" del estado de la contabilidad, así que comparten pestaña con un
 * selector, igual que los modelos fiscales en `impuestos-tab`.
 */
@Component({
  selector: 'app-balance-tab',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, ReportTableComponent, SelectDropdownDirective],
  templateUrl: './balance-tab.component.html',
  styleUrls: ['../cobros/cobros-modal.scss', '../nominas-tab/nominas-tab.component.scss', '../impuestos-tab/impuestos-tab.component.scss'],
})
export class BalanceTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private reports = inject(ReportsService);

  view = signal<View>('trial-balance');
  years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);
  year = signal(new Date().getFullYear());
  asOf = signal(today());

  trialBalance = signal<TrialBalanceReport | null>(null);
  balanceSheet = signal<BalanceSheetReport | null>(null);
  loading = signal(false);
  loadError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async select(view: View): Promise<void> {
    this.view.set(view);
    await this.load();
  }

  async setYear(year: number): Promise<void> {
    this.year.set(Number(year));
    await this.load();
  }

  async setAsOf(asOf: string): Promise<void> {
    this.asOf.set(asOf);
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      if (this.view() === 'trial-balance') {
        this.trialBalance.set(await this.reports.trialBalance(this.estateId, this.year()));
      } else {
        this.balanceSheet.set(await this.reports.balanceSheet(this.estateId, this.asOf()));
      }
    } catch (error) {
      this.loadError.set(apiMessage(error, 'No se pudo calcular el informe.'));
    } finally {
      this.loading.set(false);
    }
  }

  get trialBalanceSections(): ReportSection[] {
    const r = this.trialBalance();
    if (!r) return [];
    return [{
      columns: [
        { key: 'code', header: 'Cuenta' },
        { key: 'name', header: 'Nombre' },
        { key: 'debit', header: 'Debe', money: true },
        { key: 'credit', header: 'Haber', money: true },
        { key: 'balance', header: 'Saldo', money: true },
      ],
      rows: r.rows,
      totals: { name: 'Totales', debit: r.totalDebit, credit: r.totalCredit },
      empty: 'Sin movimientos en este ejercicio.',
    }];
  }

  get balanceSheetSections(): ReportSection[] {
    const r = this.balanceSheet();
    if (!r) return [];
    const columns = [
      { key: 'code', header: 'Cuenta' },
      { key: 'name', header: 'Nombre' },
      { key: 'amount', header: 'Importe', money: true },
    ];
    return [
      { title: 'Activo', columns, rows: r.asset.rows, totals: { name: 'Total activo', amount: r.asset.total } },
      { title: 'Pasivo', columns, rows: r.liability.rows, totals: { name: 'Total pasivo', amount: r.liability.total } },
      { title: 'Patrimonio neto', columns, rows: r.equity.rows, totals: { name: 'Total patrimonio neto', amount: r.equity.total } },
    ];
  }

  async download(format: 'xlsx' | 'pdf'): Promise<void> {
    const report: EstateReportKind = this.view();
    const query = this.view() === 'trial-balance' ? { fiscalYear: this.year() } : { asOf: this.asOf() };
    try {
      const blob = await this.reports.download(this.estateId, report, format, query);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${report}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando el informe', error);
    }
  }
}
