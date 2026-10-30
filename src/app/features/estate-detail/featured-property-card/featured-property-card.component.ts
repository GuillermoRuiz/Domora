import { Component, computed, input, output } from '@angular/core';
import { EstateFacadeThumbnailComponent } from '../../dashboard-b/estate-facade-thumbnail/estate-facade-thumbnail.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { StatusPillComponent, type StatusTone } from '../../../shared/components/status-pill/status-pill.component';

const EURO = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);
const DATE = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Lo que la tarjeta necesita saber de la propiedad, ya resuelto por la pestaña. */
export interface FeaturedProperty {
  id: string;
  ref: string;
  /** "Vivienda · 3ª planta" */
  subtitle: string;
  titular: string | null;
  quotaMonthly: number | null;
  /** null = aún no se sabe (los estados no han cargado o fallaron). */
  balance: number | null;
  status: { text: string; tone: StatusTone } | null;
  lastPaymentDate: string | null;
  ownerSince: string | null;
}

const day = (iso: string | null) => (iso ? DATE.format(new Date(`${iso}T00:00:00Z`)) : '—');

/** "Propiedad destacada": la ficha rápida de la propiedad seleccionada (por defecto, la de mayor deuda). */
@Component({
  selector: 'app-featured-property-card',
  standalone: true,
  imports: [SectionCardComponent, StatusPillComponent, EstateFacadeThumbnailComponent],
  templateUrl: './featured-property-card.component.html',
  styleUrl: './featured-property-card.component.scss',
})
export class FeaturedPropertyCardComponent {
  readonly property = input<FeaturedProperty | null>(null);
  /** Las propiedades no tienen foto propia: se usa la fachada de la finca (o su marcador de posición). */
  readonly facadeUrl = input<string | null>(null);
  readonly estateName = input('');
  /** La finca y la versión de su foto subida (si la hay): manda sobre la fachada del Catastro. */
  readonly estateId = input<string | null>(null);
  readonly photoVersion = input<string | null>(null);
  readonly view = output<string>();

  readonly details = computed(() => {
    const p = this.property();
    if (!p) return [];
    return [
      { id: 'titular', label: 'Titular', value: p.titular ?? '—', owes: false },
      { id: 'quota', label: 'Cuota mensual', value: p.quotaMonthly != null ? EURO.format(p.quotaMonthly) : '—', owes: false },
      { id: 'balance', label: 'Saldo pendiente', value: p.balance != null ? EURO.format(p.balance) : '—', owes: (p.balance ?? 0) > 0 },
      { id: 'lastPayment', label: 'Último pago', value: day(p.lastPaymentDate), owes: false },
      { id: 'ownerSince', label: 'Propietario desde', value: day(p.ownerSince), owes: false },
    ];
  });
}
