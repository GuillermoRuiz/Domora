import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReportDefinition, ReportFilters, ReportInput } from '../../core/reporting.models';

import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';
@Component({
  selector: 'app-report-filters', standalone: true, imports: [FormsModule, SelectDropdownDirective],
  templateUrl: './report-filters.component.html', styleUrl: './report-filters.component.scss',
})
export class ReportFiltersComponent {
  @Input({ required: true }) definition!: ReportDefinition;
  @Input({ required: true }) value!: ReportInput;
  @Input() properties: { id: string; name: string }[] = [];
  @Input() suppliers: { id: string; name: string }[] = [];
  @Input() optionsLoading = false;
  @Input() singleEstate = false;
  @Output() valueChange = new EventEmitter<Partial<ReportInput>>();
  readonly receiptKinds = [
    ['cuota_ordinaria', 'Cuota ordinaria'], ['derrama', 'Derrama'], ['fondo_reserva', 'Fondo de reserva'],
    ['saldo_anterior', 'Saldo anterior'], ['intereses_demora', 'Intereses de demora'],
    ['gastos_devolucion', 'Gastos de devolución'], ['otros', 'Otros'],
  ];
  has(key: ReportDefinition['filters'][number]): boolean { return this.definition.filters.includes(key); }
  // Emit only edited fields; a stale child input must not replace the viewer's scope.
  period(patch: Partial<ReportInput>): void { this.valueChange.emit(patch); }
  filter(patch: Partial<ReportFilters>): void { this.valueChange.emit({ filters: patch }); }
  today(): void {
    const now = new Date();
    this.period({ asOf: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` });
  }
}
