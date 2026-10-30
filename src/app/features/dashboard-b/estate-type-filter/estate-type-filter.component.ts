import { Component, computed, input, output } from "@angular/core";
import type { EstateType } from "../../../core/models";
import { DropdownComponent, DropdownItem } from "../../../shared/components/dropdown/dropdown.component";

/** Filtro de tipos de finca: desplegable múltiple (se pueden combinar varios tipos). */
@Component({
  selector: "app-estate-type-filter",
  standalone: true,
  imports: [DropdownComponent],
  templateUrl: "./estate-type-filter.component.html",
  styleUrl: "./estate-type-filter.component.scss",
})
export class EstateTypeFilterComponent {
  readonly options = input.required<readonly { type: EstateType }[]>();
  readonly selected = input<readonly EstateType[]>([]);
  readonly selectionChange = output<EstateType[]>();

  readonly items = computed<DropdownItem[]>(() =>
    this.options().map((option) => ({ id: option.type, label: option.type })),
  );
  readonly summary = computed(() =>
    this.selected().length ? `Filtrar (${this.selected().length})` : "",
  );

  toggleType(type: EstateType): void {
    this.selectionChange.emit(
      this.selected().includes(type)
        ? this.selected().filter((value) => value !== type)
        : [...this.selected(), type],
    );
  }
}
