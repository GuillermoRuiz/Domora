import { Component, DestroyRef, ElementRef, EventEmitter, HostListener, Input, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
import { MeetingCardComponent } from '../meeting-card.component';
import { StatusPillComponent } from '../status-pill.component';
import {
  formatPercent,
  type AttendanceStatus,
  type ParticipationRow,
  type ParticipationStats,
  type Tone,
} from '../meeting-workspace.model';

/** Alto aproximado del menú de fila, para decidir si se abre hacia arriba. */
const MENU_HEIGHT = 190;

type StatusFilter = 'all' | AttendanceStatus;

const STATUS_TONE: Record<AttendanceStatus, Tone> = {
  presente: 'green',
  representado: 'blue',
  ausente: 'red',
};

/** Pestaña «Participación»: ¿quién asiste, quién representa a quién y qué coeficiente hay presente? */
@Component({
  selector: 'app-meeting-participation-tab',
  standalone: true,
  imports: [IconComponent, SelectDropdownDirective, MeetingCardComponent, StatusPillComponent],
  templateUrl: './participation-tab.component.html',
  styleUrl: './participation-tab.component.scss',
})
export class MeetingParticipationTabComponent {
  constructor() {
    // El menú usa coordenadas de ventana: cualquier scroll (también el de un panel interno,
    // que no burbujea) lo dejaría desalineado del botón.
    const close = () => this.closeMenu();
    document.addEventListener('scroll', close, true);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('scroll', close, true));
  }

  @Input({ required: true }) set rows(value: ParticipationRow[]) {
    this.allRows.set(value);
  }
  @Input({ required: true }) stats!: ParticipationStats;
  /** La asistencia solo se puede registrar mientras la junta está convocada. */
  @Input() canRegister = false;
  /** El menú «⋯» de cada fila: cambiar la asistencia o la representación de ese propietario. */
  @Output() markPresent = new EventEmitter<ParticipationRow>();
  @Output() markAbsent = new EventEmitter<ParticipationRow>();
  /** Registrar la representación (o cambiar el representante si ya la tiene). */
  @Output() represent = new EventEmitter<ParticipationRow>();
  @Output() removeRepresentation = new EventEmitter<ParticipationRow>();
  /** Propiedad con varios titulares: se elige cuál de ellos asiste. */
  @Output() holderChosen = new EventEmitter<{ row: ParticipationRow; userId: string }>();

  readonly percent = formatPercent;
  readonly query = signal('');
  readonly filter = signal<StatusFilter>('all');
  private readonly allRows = signal<ParticipationRow[]>([]);
  readonly visibleRows = computed(() => {
    const query = this.query().trim().toLowerCase();
    const filter = this.filter();
    return this.allRows().filter(
      (row) =>
        (filter === 'all' || row.status === filter) &&
        (!query ||
          row.owner.toLowerCase().includes(query) ||
          row.unit.toLowerCase().includes(query)),
    );
  });
  readonly filters: { id: StatusFilter; label: string }[] = [
    { id: 'all', label: 'Todos' },
    { id: 'presente', label: 'Presentes' },
    { id: 'representado', label: 'Representados' },
    { id: 'ausente', label: 'Ausentes' },
  ];

  /** Fila con el menú abierto y su posición (el menú es un popover, para no recortarse con el scroll de la tabla). */
  readonly menu = signal<{
    row: ParticipationRow;
    top: number | null;
    bottom: number | null;
    right: number;
  } | null>(null);

  /** Hay varios titulares entre los que elegir quién asiste (no con la propiedad representada ni con la junta cerrada). */
  canPickHolder(row: ParticipationRow): boolean {
    return this.canRegister && row.status !== 'representado' && (row.holders?.length ?? 0) > 1;
  }

  statusTone(status: AttendanceStatus): Tone {
    return STATUS_TONE[status];
  }

  toggleMenu(row: ParticipationRow, trigger: HTMLElement): void {
    if (this.menu()?.row.propertyId === row.propertyId) return this.closeMenu();
    const rect = trigger.getBoundingClientRect();
    // Con poco hueco debajo, el menú se abre hacia arriba.
    const opensUp = window.innerHeight - rect.bottom < MENU_HEIGHT;
    // Coordenadas de ventana: el menú vive en la capa superior (popover), ajena a
    // los contenedores de ancestros, y se alinea al borde derecho del botón.
    this.menu.set({
      row,
      right: window.innerWidth - rect.right,
      top: opensUp ? null : rect.bottom + 4,
      bottom: opensUp ? window.innerHeight - rect.top + 4 : null,
    });
  }

  /** Muestra el menú en la capa superior en cuanto se pinta (no existe en navegadores sin Popover API). */
  @ViewChild('menuPanel') set menuPanel(panel: ElementRef<HTMLElement> | undefined) {
    panel?.nativeElement.showPopover?.();
  }

  closeMenu(): void {
    this.menu.set(null);
  }

  act(action: 'markPresent' | 'markAbsent' | 'represent' | 'removeRepresentation', row: ParticipationRow): void {
    this.closeMenu();
    this[action].emit(row);
  }

  @HostListener('document:click', ['$event'])
  closeOnOutsideClick(event: Event): void {
    if (this.menu() && !(event.target as HTMLElement).closest('.row-menu, .row-menu__trigger')) this.closeMenu();
  }

  @HostListener('document:keydown.escape')
  @HostListener('window:resize')
  closeOnEscapeOrScroll(): void {
    this.closeMenu();
  }
}
