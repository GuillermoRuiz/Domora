import { Component, computed, input, output, signal } from '@angular/core';
import type { ScopeGroup, ScopeProperty } from '../../../core/owner-scope.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/**
 * Selector de la propiedad que se visualiza en «Mi comunidad». Las
 * propiedades se agrupan por finca y, al final, ofrece añadir otra. Es la
 * puerta de entrada a «cambiar de propiedad» (y de finca, que se deduce de ella).
 */
@Component({
  selector: 'app-community-scope-selector',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './community-scope-selector.component.html',
  styleUrl: './community-scope-selector.component.scss',
})
export class CommunityScopeSelectorComponent {
  readonly groups = input<ScopeGroup[]>([]);
  readonly selectedId = input<string | null>(null);
  /** Offers «Todas mis propiedades» (owners with more than one property); null selectedId means it is active. */
  readonly showAll = input(false);
  /** Id de la propiedad elegida, o null para «Todas». */
  readonly choose = output<string | null>();
  readonly addProperty = output<void>();

  readonly open = signal(false);

  readonly selected = computed<ScopeProperty | null>(() => {
    for (const group of this.groups()) {
      const found = group.properties.find(p => p.id === this.selectedId());
      if (found) return found;
    }
    return null;
  });

  /** Opens the list (the page asks for a property when an action needs one). */
  openPanel(): void {
    this.open.set(true);
  }
  toggle(): void {
    this.open.update(v => !v);
  }
  close(): void {
    this.open.set(false);
  }
  readonly propertyCount = computed(() => this.groups().reduce((n, g) => n + g.properties.length, 0));

  pick(id: string | null): void {
    this.close();
    if (id !== this.selectedId()) this.choose.emit(id);
  }
  add(): void {
    this.close();
    this.addProperty.emit();
  }
}
