import { Component, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild, inject, signal } from '@angular/core';
import { ReportEstate, ReportScopeSelection } from '../../core/reporting.models';
import { formatEstateAddress } from '../../core/estate-display';
import { normalizeReportSearch } from './reporting.utils';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Component({
  selector: 'app-report-estate-scope-selector', standalone: true,
  imports: [IconComponent],
  templateUrl: './report-estate-scope-selector.component.html', styleUrl: './report-estate-scope-selector.component.scss',
})
export class ReportEstateScopeSelectorComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  @Input() estates: ReportEstate[] = [];
  @Input() value: ReportScopeSelection = { scopeMode: 'all', estateIds: [] };
  @Input() single = false;
  @Input() disabled = false;
  @Input() header = false;
  @Output() valueChange = new EventEmitter<ReportScopeSelection>();
  @ViewChild('trigger') trigger?: ElementRef<HTMLButtonElement>;
  @ViewChild('searchInput') set searchInput(input: ElementRef<HTMLInputElement> | undefined) { input?.nativeElement.focus(); }
  readonly open = signal(false);
  readonly search = signal('');
  get selectedIds(): string[] { return this.value.scopeMode === 'all' && !this.single ? this.estates.map(e => e.id) : this.value.estateIds; }
  /** Con «Todas» activa solo se resalta esa fila, como en Fincas: las comunidades no se marcan una a una. */
  isSelected(id: string): boolean { return !(this.value.scopeMode === 'all' && !this.single) && this.value.estateIds.includes(id); }
  get allSelected(): boolean { return this.estates.length > 0 && this.estates.every(e => this.selectedIds.includes(e.id)); }
  visibleEstates(): ReportEstate[] {
    const term = normalizeReportSearch(this.search());
    return this.estates.filter(e => normalizeReportSearch(`${e.name} ${this.address(e)}`).includes(term));
  }
  get selectionLabel(): string {
    if (!this.single && this.allSelected) return 'Todas mis comunidades';
    if (this.selectedIds.length === 0) return this.single ? 'Seleccionar comunidad' : 'Seleccionar comunidades';
    if (this.selectedIds.length === 1) return this.estates.find(e => e.id === this.selectedIds[0])?.name ?? 'Una comunidad seleccionada';
    return `${this.selectedIds.length} comunidades seleccionadas`;
  }
  address(estate: ReportEstate): string {
    return estate.address ? formatEstateAddress({ address: estate.address, streetNumber: estate.streetNumber, location: estate.location ?? '' }) : estate.location ?? '';
  }
  toggle(): void { this.search.set(''); this.open.update(v => !v); }
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.scope-panel button:not(:disabled)'));
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    buttons[current < 0 ? (step > 0 ? 0 : buttons.length - 1) : (current + step + buttons.length) % buttons.length].focus();
  }
  /**
   * Escape se escucha en el documento y no en el fieldset: en Safari un clic en un checkbox no le da el foco,
   * así que tras marcar una comunidad el foco queda en <body> y el evento nunca llegaría al panel.
   */
  @HostListener('document:keydown.escape', ['$event'])
  closeOnEscape(event: Event): void {
    if (!this.open()) return;
    event.preventDefault(); event.stopPropagation(); this.open.set(false); this.trigger?.nativeElement.focus();
  }
  @HostListener('document:pointerdown', ['$event'])
  closeOutside(event: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
  closeOnBlur(event: FocusEvent): void {
    if (event.relatedTarget && !this.host.nativeElement.contains(event.relatedTarget as Node)) this.open.set(false);
  }
  toggleAll(checked: boolean): void {
    if (this.single) return;
    this.valueChange.emit(checked && this.estates.length ? { scopeMode: 'all', estateIds: [] } : { scopeMode: 'selected', estateIds: [] });
  }
  toggleEstate(id: string, checked: boolean): void {
    const base = this.value.scopeMode === 'all' && !this.single ? [] : this.selectedIds;
    const ids = this.single ? (checked ? [id] : []) : checked
      ? [...new Set([...base, id])] : base.filter(value => value !== id);
    const all = !this.single && this.estates.length > 0 && this.estates.every(estate => ids.includes(estate.id));
    this.valueChange.emit(all ? { scopeMode: 'all', estateIds: [] } : { scopeMode: 'selected', estateIds: ids });
    if (this.single) { this.open.set(false); this.trigger?.nativeElement.focus(); }
  }
}
