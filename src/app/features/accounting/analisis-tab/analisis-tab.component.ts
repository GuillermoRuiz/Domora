import { Component, Input, OnInit, computed, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccountingEstate, BudgetAnalysis, FiscalYear } from '../../../core/models';
import { BudgetService } from '../../../core/budget.service';
import { FiscalYearsService } from '../../../core/fiscal-years.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
/**
 * "Liquidación del ejercicio" — comparar gasto real vs. previsto del año
 * en curso Y del año anterior antes de redactar el presupuesto siguiente,
 * práctica habitual de administradores españoles. Único consumidor
 * frontend de `GET /budget/analysis` (año actual + comparación con el
 * anterior + mínimo legal de reserva, art. 9.1.f LPH).
 */
@Component({
  selector: 'app-analisis-tab',
  standalone: true,
  imports: [FormsModule, SelectDropdownDirective],
  templateUrl: './analisis-tab.component.html',
  styleUrl: './analisis-tab.component.scss',
})
export class AnalisisTabComponent implements OnInit {
  @Input() estate!: AccountingEstate;

  private budgetSvc = inject(BudgetService);
  private fiscalYearsSvc = inject(FiscalYearsService);

  fiscalYears = signal<FiscalYear[]>([]);
  fiscalYear = signal(new Date().getFullYear());
  analysis = signal<BudgetAnalysis | null>(null);
  loading = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.fiscalYears.set(await this.fiscalYearsSvc.listFiscalYears(this.estate.id));
      await this.reload();
    } catch (error) {
      console.error('Error cargando el análisis presupuestario', error);
    }
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      this.analysis.set(await this.budgetSvc.getAnalysis(this.estate.id, this.fiscalYear()));
    } finally {
      this.loading.set(false);
    }
  }

  async onFiscalYearChange(year: string | number): Promise<void> {
    this.fiscalYear.set(Number(year));
    try {
      await this.reload();
    } catch (error) {
      console.error('Error cargando el análisis presupuestario', error);
    }
  }

  /** `reserve` ya viene resuelto en el @Input estate (mismo dato que AccountingService.summary() calcula para el KPI de Resumen) — sin fetch adicional. */
  reserveOk = computed(() => {
    const min = this.analysis()?.reserveLegalMinimum;
    if (min === null || min === undefined) return null;
    return this.estate.reserve >= min;
  });

  /**
   * Positivo = gastaste más que el año pasado; negativo = menos. `null`
   * cuando el año anterior no tuvo ningún movimiento (no confundir "sin
   * dato" con "0% de variación"). Devuelve un objeto (nunca `0` desnudo)
   * para que `@if (...; as v)` no trate una variación exacta del 0% como
   * falsy en la plantilla.
   */
  varianceDisplay(current: number, prior: number): { pct: number } | null {
    if (prior === 0) return null;
    return { pct: Math.round(((current - prior) / prior) * 100) };
  }

  varianceColor(v: number | null): string {
    if (v === null) return 'var(--color-muted)';
    return v > 0 ? 'var(--color-error)' : v < 0 ? 'var(--color-secondary)' : 'var(--color-muted)';
  }

  fmtEur0(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
  }
}
