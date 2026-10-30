import { Component, Input } from '@angular/core';

export interface ReportColumn {
  key: string;
  header: string;
  align?: 'left' | 'right';
  money?: boolean;
}

export interface ReportSection {
  title?: string;
  columns: ReportColumn[];
  // Cada informe (mayor, sumas y saldos, balance…) tiene su propia interfaz
  // tipada en `reports.service.ts` — esta tabla es deliberadamente genérica,
  // así que las filas viajan sueltas en vez de forzar un índice de string.
  rows: readonly Record<string, any>[];
  totals?: Record<string, any>;
  empty?: string;
}

/**
 * Tabla genérica para los informes de fase 12 (sumas y saldos, mayor,
 * balance de situación, resultados y liquidación de caja) — mismo modelo de
 * secciones que `common/reports/table-report.ts` en el backend, pero solo
 * para pantalla: el Excel y el PDF los genera el backend, este componente
 * no exporta nada por sí mismo.
 */
@Component({
  selector: 'app-report-table',
  standalone: true,
  templateUrl: './report-table.component.html',
  styleUrl: './report-table.component.scss',
})
export class ReportTableComponent {
  @Input({ required: true }) sections: ReportSection[] = [];

  fmt(value: string | number | null | undefined, column: ReportColumn): string {
    if (value === null || value === undefined || value === '') return column.money ? '' : '—';
    if (!column.money) return String(value);
    const n = Number(value);
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  align(column: ReportColumn): 'left' | 'right' {
    return column.align ?? (column.money ? 'right' : 'left');
  }
}
