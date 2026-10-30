import { Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { ALERT_DAYS, type ContractKpis, type KpiShortcut } from '../contracts-model';

const EURO = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Las cuatro fichas del panel de contratos (D5, D7, D9). Cada una es un botón que aplica un atajo de
 * filtro a la tabla; la que corresponde al filtro actual queda marcada.
 */
@Component({
  selector: 'app-contracts-kpis',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './contracts-kpis.component.html',
  styleUrl: './contracts-kpis.component.scss',
})
export class ContractsKpisComponent {
  readonly kpis = input.required<ContractKpis>();
  /** Ficha cuyo atajo coincide con el filtro actual. */
  readonly selected = input<KpiShortcut | null>(null);
  readonly pick = output<KpiShortcut>();

  readonly alertDays = ALERT_DAYS;
  readonly amount = computed(() => EURO.format(this.kpis().annualAmount));
  /** Avisos bajo el importe anual: lo que no se ha podido sumar. */
  readonly amountNotes = computed(() => {
    const k = this.kpis();
    const notes: string[] = [];
    if (k.withoutAnnual > 0) notes.push(`+${k.withoutAnnual} sin importe anual`);
    if (k.otherCurrency > 0) notes.push(`+${k.otherCurrency} en otra moneda`);
    return notes;
  });
}
