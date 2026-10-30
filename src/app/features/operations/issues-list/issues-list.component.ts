import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { OperationPage, OperationRow } from '../../../core/operations.service';
import {
  BALL_LABEL,
  ISSUE_LIST_FILTERS,
  ISSUE_SITUATIONS,
  SITUATION_LABEL,
  holderText,
  type BallParty,
  type IssueListFilter,
} from '../../../core/issue-workflow.models';
import type { IssueStatus } from '../../../core/models';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';

/** Los filtros y la ordenación vigentes del listado (los guarda la página en la URL). */
export interface IssuesListQuery {
  search: string;
  filter: string;
  sort: string;
  estateId: string;
  status: string;
  situation: string;
  ball: string;
  created: string;
  assetId: string;
}

const CARDS: { filter: IssueListFilter; icon: string; tone: string; caption: string }[] = [
  { filter: 'all', icon: 'file-text', tone: 'blue', caption: 'Total de incidencias' },
  { filter: 'attention', icon: 'exclamation', tone: 'red', caption: 'Necesitan intervención' },
  { filter: 'waiting', icon: 'user', tone: 'orange', caption: 'Pendientes de un tercero' },
  { filter: 'resolved', icon: 'check', tone: 'green', caption: 'Resueltas y cerradas' },
];

const BALL_ICON: Record<BallParty, string> = {
  administration: 'user',
  provider: 'wrench',
  insurer: 'shield',
  owner: 'home',
  other: 'users',
  nobody: 'clock',
};

/** Estado del expediente tal y como lo entiende `PATCH /issues/:id/status` (`OperationRow.status` trae la clave). */
const STATUS_OPTIONS: { value: string; label: IssueStatus }[] = [
  { value: 'Abierta', label: 'Abierta' },
  { value: 'EnReparacion', label: 'En reparación' },
  { value: 'PendienteProveedor', label: 'Pendiente proveedor' },
  { value: 'Resuelta', label: 'Resuelta' },
  { value: 'Cerrada', label: 'Cerrada' },
];
/**
 * Los estados por los que se puede FILTRAR: los de arriba más «Pendiente de información», que no se pone a mano (lo pone
 * «Pedir información») y por eso no sale en el cambio rápido de estado.
 */
const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  ...STATUS_OPTIONS.slice(0, 3),
  { value: 'PendienteInformacion', label: 'Pendiente de información' },
  ...STATUS_OPTIONS.slice(3),
];

export type SortField = 'ref' | 'title' | 'estate' | 'status' | 'date' | 'situation' | 'ball';

const dayMonthYear = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * Listado de Incidencias del administrador: una fila por incidencia con lo que importa para trabajarla (situación,
 * quién tiene la pelota y siguiente paso). No calcula ni guarda nada: pinta la proyección que sirve el backend y
 * devuelve a la página lo que el usuario pide (filtros, orden, abrir, cambiar estado).
 */
@Component({
  selector: 'app-issues-list',
  standalone: true,
  imports: [FormsModule, IconComponent, SelectDropdownDirective],
  templateUrl: './issues-list.component.html',
  styleUrl: './issues-list.component.scss',
})
export class IssuesListComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly data = input.required<OperationPage>();
  readonly query = input.required<IssuesListQuery>();
  /** Primera carga: aún no hay nada que enseñar. */
  readonly loading = input(false);
  /** Nueva consulta (filtros, búsqueda, orden): lo que hay en pantalla se conserva hasta que llegue lo nuevo. */
  readonly refreshing = input(false);
  readonly failed = input(false);
  readonly saving = input(false);
  /** Instalación por la que se filtra (viene del panel de Instalaciones), con su nombre. */
  readonly asset = input<{ id: string; name: string } | null>(null);
  readonly page = input(1);
  readonly pageCount = input(1);

  readonly queryChange = output<Record<string, string | number | null>>();
  readonly searchChange = output<string>();
  readonly cleared = output<void>();
  readonly opened = output<OperationRow>();
  readonly statusChanged = output<{ row: OperationRow; status: IssueStatus }>();
  readonly deleteRequested = output<OperationRow>();

  readonly statusOptions = STATUS_OPTIONS;
  readonly statusFilterOptions = STATUS_FILTER_OPTIONS;
  readonly situationOptions = ISSUE_SITUATIONS.map((key) => ({ key, label: SITUATION_LABEL[key] }));
  readonly ballOptions = (Object.keys(BALL_LABEL) as BallParty[]).map((key) => ({ key, label: BALL_LABEL[key] }));
  readonly createdOptions = [
    { key: '7d', label: 'Últimos 7 días' },
    { key: '30d', label: 'Últimos 30 días' },
    { key: '90d', label: 'Últimos 3 meses' },
    { key: 'year', label: 'Este año' },
  ];

  readonly cards = computed(() =>
    CARDS.map((card) => ({
      ...card,
      label: ISSUE_LIST_FILTERS.find((f) => f.key === card.filter)?.label ?? '',
      value: this.data().summary[card.filter] ?? 0,
    })),
  );
  readonly hasFilters = computed(() => {
    const q = this.query();
    return !!(q.search || q.estateId || q.status || q.situation || q.ball || q.created || q.assetId || q.filter !== 'all');
  });

  /** Fila con el menú «⋮» abierto y dónde pintarlo (el panel es `fixed`: la tabla con scroll no lo recorta). */
  readonly menuFor = signal<string | null>(null);
  readonly menuPosition = signal<{ top: number | null; bottom: number | null; maxHeight: number; left: number }>({ top: 0, bottom: null, maxHeight: 0, left: 0 });
  readonly menuRow = computed(() => this.data().items.find((row) => row.id === this.menuFor()) ?? null);

  setFilter(value: string): void {
    this.queryChange.emit({ filter: value === 'all' ? null : value });
  }
  setField(name: string, value: string | null): void {
    this.queryChange.emit({ [name]: value || null });
  }

  toggleMenu(event: Event, row: OperationRow): void {
    // El clic no debe abrir también el expediente de la fila.
    event.stopPropagation();
    if (this.menuFor() === row.id) return this.closeMenu();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 232;
    const margin = 8;
    // Alto del menú: relleno + «Ver expediente» + título + una fila por estado (≈38px cada una).
    const height = 12 + 38 + 30 + this.statusOptions.length * 38;
    const below = window.innerHeight - rect.bottom - 4 - margin;
    const above = rect.top - 4 - margin;
    // Si abajo no cabe y arriba hay más sitio, se abre hacia arriba; el alto máximo evita que se salga por el otro lado.
    const up = below < height && above > below;
    this.menuPosition.set({
      top: up ? null : rect.bottom + 4,
      bottom: up ? window.innerHeight - rect.top + 4 : null,
      maxHeight: Math.max(120, up ? above : below),
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    });
    this.menuFor.set(row.id);
    // La página (o la tabla) se desplaza por debajo: el panel `fixed` se cerraría mal alineado.
    document.addEventListener('scroll', () => this.closeMenu(), { capture: true, once: true });
  }
  closeMenu(): void {
    this.menuFor.set(null);
  }
  open(row: OperationRow): void {
    this.closeMenu();
    this.opened.emit(row);
  }
  requestDelete(row: OperationRow): void {
    this.closeMenu();
    this.deleteRequested.emit(row);
  }
  changeStatus(row: OperationRow, status: IssueStatus): void {
    this.closeMenu();
    this.statusChanged.emit({ row, status });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.menuFor() && !this.host.nativeElement.querySelector('.row-menu')?.contains(event.target as Node))
      this.closeMenu();
  }
  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMenu();
  }
  @HostListener('window:resize')
  onViewportChange(): void {
    this.closeMenu();
  }

  // ── Textos de las filas ─────────────────────────────────────────────

  /** En manos de: la parte principal y, si es un tercero con nombre, quién es. */
  ball(row: OperationRow): { icon: string; who: string; detail: string; more: number; title: string } {
    const holders = row.situation?.ballInCourt.holders ?? [];
    const [first, ...rest] = holders;
    if (!first) return { icon: BALL_ICON.nobody, who: BALL_LABEL.nobody, detail: '', more: 0, title: '' };
    const named = first.party !== 'administration';
    return {
      icon: BALL_ICON[first.party],
      who: BALL_LABEL[first.party],
      detail: named ? (first.label ?? '') : '',
      more: rest.length,
      title: holders.map(holderText).join(' · '),
    };
  }
  /** Solo la primera línea de la descripción: la lista enseña título y una línea, el resto está en el expediente. */
  firstLine(text: string | null | undefined): string {
    return (text ?? '').split(/\r?\n/).find((line) => line.trim())?.trim() ?? '';
  }
  /** Cuándo se creó, siempre como fecha («12 mar 2024»), nunca «hoy» ni «hace 3 días». */
  day(date: string): string {
    const value = new Date(date);
    return Number.isFinite(value.getTime()) ? dayMonthYear.format(value).replace(/\./g, '') : '—';
  }
  /** Color del estado del expediente (los mismos temas que las etiquetas de situación). */
  statusTheme(row: OperationRow): string {
    return (
      {
        Abierta: 'blue',
        EnReparacion: 'gold',
        PendienteProveedor: 'orange',
        PendienteInformacion: 'purple',
        Resuelta: 'green',
      } as Record<string, string>
    )[row.status] ?? 'gray';
  }

  // ── Orden por columnas ───────────────────────────────────────────────
  /** `date` es cuándo se creó: «Más recientes» (`newest`) es de menor a mayor antigüedad. */
  readonly columns: { field: SortField; label: string }[] = [
    { field: 'ref', label: 'Código' },
    { field: 'title', label: 'Título' },
    { field: 'estate', label: 'Comunidad / Inmueble' },
    { field: 'status', label: 'Estado' },
    { field: 'ball', label: 'En manos de' },
    { field: 'date', label: 'Creado' },
  ];
  sortState(field: SortField): 'asc' | 'desc' | null {
    const sort = this.query().sort;
    if (field === 'date') return sort === 'newest' ? 'asc' : sort === 'oldest' ? 'desc' : null;
    const [active, dir] = sort.split('_');
    return active === field ? (dir === 'desc' ? 'desc' : 'asc') : null;
  }
  ariaSort(field: SortField): 'ascending' | 'descending' | 'none' {
    const state = this.sortState(field);
    return state === 'asc' ? 'ascending' : state === 'desc' ? 'descending' : 'none';
  }
  /** Primer clic: orden natural de la columna; segundo: el inverso. */
  sortBy(field: SortField): void {
    const state = this.sortState(field);
    const next =
      field === 'date'
        ? state === 'asc' ? 'oldest' : 'newest'
        : `${field}_${state === 'asc' ? 'desc' : 'asc'}`;
    this.queryChange.emit({ sort: next === 'newest' ? null : next });
  }
  /** Texto de la opción del selector cuando el orden es por una columna (no por fecha). */
  columnSortLabel(): string {
    const sort = this.query().sort;
    if (sort === 'newest' || sort === 'oldest') return '';
    const column = this.columns.find((c) => this.sortState(c.field));
    return column ? `${column.label} ${this.sortState(column.field) === 'asc' ? '↑' : '↓'}` : '';
  }
}
