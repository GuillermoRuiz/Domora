import { Component, computed, input, output } from '@angular/core';
import { COMMON_AREAS, type CommunitySummary } from '../../../core/owner-community.models';
import { EstateFacadeThumbnailComponent } from '../../dashboard-b/estate-facade-thumbnail/estate-facade-thumbnail.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';

/**
 * «Resumen de la comunidad»: la finca de la propiedad que se está viendo (foto,
 * dirección, descripción) y tres indicadores agregados. PRIVACIDAD: solo
 * contadores y una etiqueta de estado; nunca nombres ni datos de otros vecinos.
 */
@Component({
  selector: 'app-community-summary',
  standalone: true,
  imports: [SectionCardComponent, EstateFacadeThumbnailComponent, IconComponent],
  templateUrl: './community-summary.component.html',
  styleUrl: './community-summary.component.scss',
})
export class CommunitySummaryComponent {
  readonly summary = input<CommunitySummary | null>(null);
  readonly failed = input(false);
  /** La propiedad elegida aún no tiene finca: se ofrece solicitar la vinculación. */
  readonly unlinked = input(false);
  /** «Ver detalles»: la ficha de la propiedad. */
  readonly details = output<void>();
  readonly requestLink = output<void>();

  /** Calle y número, población (como en la cabecera de gestión). */
  readonly addressLine = computed(() => {
    const s = this.summary();
    return s ? [s.address, s.location].filter(Boolean).join(', ') : '';
  });
  readonly areas = computed(() => COMMON_AREAS[this.summary()?.indicators.commonAreas ?? 'sin_datos']);
  readonly areasIcon = computed(() => (this.areas().tone === 'positive' ? 'check' : this.areas().tone === 'neutral' ? 'building' : 'exclamation'));
}
