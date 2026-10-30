import { Component, computed, input, output } from '@angular/core';
import type { PerformanceRanking, PerformanceRow } from '../../../core/manager-overview.models';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { StatusPillComponent } from '../../../shared/components/status-pill/status-pill.component';
import { formatEuro } from '../overview-format';

interface RowView {
  row: PerformanceRow;
  billed: string;
  selected: boolean;
  /** La fila extra de la finca elegida cuando no está en el Top 10. */
  extra: boolean;
}

/**
 * «Rendimiento por comunidad»: las 10 comunidades que más facturan en su ejercicio, con las
 * propiedades en incidencia (recibo devuelto o impago vencido) y su estado. La finca elegida en el
 * selector aparece señalada; si no está entre las 10 se añade una fila con su posición real. Pulsar
 * una fila cambia la selección igual que el selector de la cabecera (sin salir de la pantalla).
 * «Ver todas» lleva a Fincas.
 */
@Component({
  selector: 'app-overview-performance',
  standalone: true,
  imports: [SectionCardComponent, StatusPillComponent],
  templateUrl: './overview-performance.component.html',
  styleUrl: './overview-performance.component.scss',
})
export class OverviewPerformanceComponent {
  readonly data = input<PerformanceRanking | null>(null);
  /** Finca elegida en el selector (`null` = todas). */
  readonly selectedId = input<string | null>(null);
  readonly loading = input(false);
  readonly error = input(false);
  readonly retry = input<() => void>(() => undefined);
  readonly pick = output<PerformanceRow>();
  readonly viewAll = output<void>();

  readonly rows = computed<RowView[]>(() => {
    const data = this.data();
    if (!data) return [];
    const selectedId = this.selectedId();
    const view = (row: PerformanceRow, extra: boolean): RowView => ({
      row, billed: formatEuro(row.billed), selected: row.estateId === selectedId, extra,
    });
    return [...data.items.map((r) => view(r, false)), ...(data.selected ? [view(data.selected, true)] : [])];
  });

  statusPill(row: PerformanceRow) {
    return row.status === 'al_dia'
      ? { text: 'Al día', tone: 'positive' as const }
      : { text: 'Con incidencias', tone: 'warning' as const };
  }
}
