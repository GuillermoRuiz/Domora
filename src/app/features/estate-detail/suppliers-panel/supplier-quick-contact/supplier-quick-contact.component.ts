import { Component, computed, input } from '@angular/core';
import { supplierCategoryFor } from '../../../../core/supplier-categories';
import { visitDate, visitTime, type SupplierPanelRow } from '../../../../core/supplier-panel.models';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../../shared/components/section-card/section-card.component';

/** Las dos primeras iniciales del nombre ("Marta Ruiz Gil" → "MR"). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

/**
 * «Contacto rápido»: la ficha del proveedor seleccionado en la tabla, con lo
 * necesario para ponerse en contacto (persona, teléfono y correo) y atajos
 * para llamar o escribir. Sin teléfono o sin correo, ese atajo no se ofrece.
 */
@Component({
  selector: 'app-supplier-quick-contact',
  standalone: true,
  imports: [SectionCardComponent, IconComponent],
  templateUrl: './supplier-quick-contact.component.html',
  styleUrl: './supplier-quick-contact.component.scss',
})
export class SupplierQuickContactComponent {
  readonly supplier = input<SupplierPanelRow | null>(null);

  readonly person = computed(() => {
    const s = this.supplier();
    return s ? (s.contactName?.trim() || s.name) : '';
  });
  readonly initials = computed(() => initials(this.person()));
  readonly categoryIcon = computed(() => supplierCategoryFor(this.supplier()?.category).icon);
  /** `tel:` sin espacios ni guiones (los móviles marcan mejor así). */
  readonly telHref = computed(() => {
    const phone = this.supplier()?.phone;
    return phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : null;
  });
  readonly mailHref = computed(() => {
    const email = this.supplier()?.email;
    return email ? `mailto:${email}` : null;
  });
  readonly nextVisit = computed(() => {
    const visit = this.supplier()?.nextVisit;
    return visit ? { date: visitDate(visit.scheduledAt), time: visitTime(visit.scheduledAt), purpose: visit.purpose } : null;
  });
}
