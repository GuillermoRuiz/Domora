import { Component, computed, input, output } from '@angular/core';
import { supplierCategoryFor } from '../../../../core/supplier-categories';
import type { SupplierIntervention } from '../../../../core/supplier-panel.models';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../../shared/components/section-card/section-card.component';

const MONTH = new Intl.DateTimeFormat('es-ES', { month: 'short' });

/**
 * «Últimas intervenciones»: las visitas ya realizadas de la finca, la más
 * reciente primero. Pulsar una abre el proveedor en la tabla.
 */
@Component({
  selector: 'app-supplier-interventions',
  standalone: true,
  imports: [SectionCardComponent, IconComponent],
  templateUrl: './supplier-interventions.component.html',
  styleUrl: './supplier-interventions.component.scss',
})
export class SupplierInterventionsComponent {
  readonly interventions = input<SupplierIntervention[]>([]);
  /** Id del proveedor de la intervención pulsada. */
  readonly openSupplier = output<string>();

  readonly rows = computed(() =>
    this.interventions().map(i => {
      // La fecha en que se hizo; si falta (no debería), la prevista.
      const when = new Date(i.completedAt ?? i.scheduledAt);
      const links = [i.asset ? `Instalación: ${i.asset.name}` : null, i.issue ? `Incidencia ${i.issue.ref}` : null].filter((l): l is string => !!l);
      return {
        id: i.id,
        supplierId: i.supplierId,
        purpose: i.purpose,
        supplierName: i.supplierName,
        icon: supplierCategoryFor(i.supplierCategory).icon,
        day: String(when.getDate()).padStart(2, '0'),
        month: MONTH.format(when).replace('.', ''),
        links: links.join(' · '),
      };
    }),
  );
}
