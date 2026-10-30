import { Component, computed, input, output } from '@angular/core';
import type { Supplier } from '../../../../core/models';
import { SectionCardComponent } from '../../../../shared/components/section-card/section-card.component';

/** Proveedores que se listan por nombre; el resto se pliega en "Otros". */
const VISIBLE_SUPPLIERS = 5;

const EURO = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);

interface SpendRow {
  /** null en la fila "Otros". */
  id: string | null;
  name: string;
  detail: string;
  amount: string;
  share: string;
  /** Ancho de la barra respecto a la fila mayor (0-100). */
  width: number;
}

/** "Gasto por proveedor": a quién se le ha pagado más en el ejercicio en curso. */
@Component({
  selector: 'app-supplier-spend-card',
  standalone: true,
  imports: [SectionCardComponent],
  templateUrl: './supplier-spend-card.component.html',
  styleUrl: './supplier-spend-card.component.scss',
})
export class SupplierSpendCardComponent {
  readonly suppliers = input<Supplier[]>([]);
  readonly selectSupplier = output<string>();

  readonly year = new Date().getFullYear();

  private readonly ranked = computed(() =>
    this.suppliers().filter(s => s.ytdSpend > 0).sort((a, b) => b.ytdSpend - a.ytdSpend),
  );
  readonly total = computed(() => this.ranked().reduce((sum, s) => sum + s.ytdSpend, 0));
  readonly totalLabel = computed(() => EURO.format(this.total()));

  readonly rows = computed<SpendRow[]>(() => {
    const ranked = this.ranked();
    const total = this.total();
    if (total <= 0) return [];
    const top = ranked.slice(0, VISIBLE_SUPPLIERS);
    const rest = ranked.slice(VISIBLE_SUPPLIERS);
    const entries = top.map(s => ({ id: s.id as string | null, name: s.name, detail: s.category, spend: s.ytdSpend }));
    if (rest.length > 0) {
      entries.push({ id: null, name: `Otros (${rest.length})`, detail: 'Resto de proveedores', spend: rest.reduce((sum, s) => sum + s.ytdSpend, 0) });
    }
    const max = Math.max(...entries.map(e => e.spend));
    return entries.map(e => ({
      id: e.id,
      name: e.name,
      detail: e.detail,
      amount: EURO.format(e.spend),
      share: `${Math.round((e.spend / total) * 100)} %`,
      width: Math.max(2, (e.spend / max) * 100),
    }));
  });
}
