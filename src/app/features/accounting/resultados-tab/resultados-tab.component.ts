import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ReportTableComponent, ReportSection } from '../../../shared/components/report-table/report-table.component';
import { BudgetVsActualReport, ReportsService } from '../../../core/reports.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

/** Resultados frente a presupuesto (fase 12): lo presupuestado contra lo ejecutado de verdad, cuenta por cuenta. */
@Component({
  selector: 'app-resultados-tab',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, ReportTableComponent, SelectDropdownDirective],
  templateUrl: './resultados-tab.component.html',
  styleUrls: ['../cobros/cobros-modal.scss', '../nominas-tab/nominas-tab.component.scss', '../impuestos-tab/impuestos-tab.component.scss'],
})
export class ResultadosTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private reports = inject(ReportsService);

  years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);
  year = signal(new Date().getFullYear());

  report = signal<BudgetVsActualReport | null>(null);
  loading = signal(false);
  loadError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async setYear(year: number): Promise<void> {
    this.year.set(Number(year));
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.report.set(await this.reports.budgetVsActual(this.estateId, this.year()));
    } catch (error) {
      this.loadError.set(apiMessage(error, 'No se pudo calcular el informe.'));
    } finally {
      this.loading.set(false);
    }
  }

  get sections(): ReportSection[] {
    const r = this.report();
    if (!r) return [];
    return [{
      columns: [
        { key: 'code', header: 'Cuenta' },
        { key: 'name', header: 'Partida' },
        { key: 'budgeted', header: 'Presupuestado', money: true },
        { key: 'executed', header: 'Ejecutado', money: true },
        { key: 'deviation', header: 'Desviación', money: true },
      ],
      rows: r.rows,
      totals: {
        name: 'Totales',
        budgeted: r.totalBudgeted,
        executed: r.totalExecuted,
        deviation: r.totalExecuted - r.totalBudgeted,
      },
      empty: 'Sin presupuesto para este ejercicio.',
    }];
  }

  async download(format: 'xlsx' | 'pdf'): Promise<void> {
    try {
      const blob = await this.reports.download(this.estateId, 'budget-vs-actual', format, { fiscalYear: this.year() });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `resultados-${this.year()}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando el informe', error);
    }
  }
}
