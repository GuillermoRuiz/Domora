import { Component, computed, input, output } from '@angular/core';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
import {
  DEFAULT_FILTERS, SORTS, VIGENCIAS, type ContractFilters, type ContractSort, type RenewalFilter, type Vigencia,
} from '../contracts-model';

/**
 * Buscador y filtros del panel de contratos (D8): texto, Vigencia, Proveedor, Renovación, Categoría,
 * rango de vencimiento y Ordenar por. No guarda estado: recibe los filtros y emite el nuevo conjunto.
 */
@Component({
  selector: 'app-contracts-toolbar',
  standalone: true,
  imports: [BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './contracts-toolbar.component.html',
  styleUrl: './contracts-toolbar.component.scss',
})
export class ContractsToolbarComponent {
  readonly filters = input.required<ContractFilters>();
  readonly suppliers = input<{ id: string; name: string }[]>([]);
  readonly categories = input<string[]>([]);
  readonly filtersChange = output<ContractFilters>();
  /** «Nuevo contrato» (D2). */
  readonly create = output<void>();

  readonly vigencias = VIGENCIAS;
  readonly sorts = SORTS;
  /** Hay algún filtro aplicado (el orden no cuenta): habilita «Quitar filtros». */
  readonly dirty = computed(() => {
    const f = this.filters();
    return !!(f.search || f.vigencia !== 'todos' || f.supplierId || f.renewal || f.category || f.from || f.to);
  });

  private emit(patch: Partial<ContractFilters>): void {
    this.filtersChange.emit({ ...this.filters(), ...patch });
  }

  setSearch(value: string): void { this.emit({ search: value }); }
  setVigencia(value: string): void { this.emit({ vigencia: value as Vigencia }); }
  setSupplier(value: string): void { this.emit({ supplierId: value }); }
  setRenewal(value: string): void { this.emit({ renewal: value as RenewalFilter }); }
  setCategory(value: string): void { this.emit({ category: value }); }
  setFrom(value: string): void { this.emit({ from: value }); }
  setTo(value: string): void { this.emit({ to: value }); }
  setSort(value: string): void { this.emit({ sort: value as ContractSort }); }

  /** Quita los filtros pero conserva el orden elegido. */
  clear(): void {
    this.filtersChange.emit({ ...DEFAULT_FILTERS, sort: this.filters().sort });
  }
}
