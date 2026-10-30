import { Component, DestroyRef, HostListener, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AgendaTasksService } from '../../core/agenda-tasks.service';
import { messageFrom } from '../incidencias-c/issue-helpers';
import { CommunityScopeService } from '../../core/community-scope.service';
import {
  AgendaQuery,
  AgendaTask,
  AgendaTaskDetail,
  TASK_PRIORITIES,
  AgendaTaskStatus,
  TASK_STATUSES,
  TASK_STATUS_KEYS,
  TASK_TYPES,
} from '../../core/agenda-tasks.model';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { DropdownComponent, DropdownItem } from '../../shared/components/dropdown/dropdown.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';
import { FocusTrapDirective } from './focus-trap.directive';
import { TaskAgendaListComponent } from './task-agenda-list/task-agenda-list.component';
import { TaskCatalogService } from './task-catalog.service';
import { TaskDrawerComponent } from './task-drawer/task-drawer.component';
import { EMPTY_FILTERS, TaskFilterState, TaskFiltersComponent, activeFilterCount } from './task-filters/task-filters.component';
import { TaskCreated, TaskFormDialogComponent, TaskPrefill } from './task-form-dialog/task-form-dialog.component';
import { TaskKanbanComponent, TaskStatusChange } from './task-kanban/task-kanban.component';
import { TaskMonthGridComponent } from './task-month-grid/task-month-grid.component';
import { TaskTableComponent } from './task-table/task-table.component';
import { SlotClick, TaskHover, TaskMove, TaskTimeGridComponent } from './task-time-grid/task-time-grid.component';
import {
  CalendarView,
  allDayDateInput,
  allDayIso,
  dateKey,
  periodLabel,
  sameDay,
  shiftAnchor,
  startOfDay,
  timeRangeLabel,
  viewRange,
  dueLabel,
  isUpcoming,
  TaskAction,
  taskActionItems,
} from './tasks.util';

/** Móvil: el menú lateral se colapsa y el detalle pasa a pantalla completa. */
const NARROW_QUERY = '(max-width: 720px)';
/**
 * Con el menú lateral de 240 px, la semana en siete columnas necesita ~700 px de
 * contenido: por debajo de esta anchura de ventana se muestra como agenda en lista.
 */
const COMPACT_QUERY = '(max-width: 1000px)';
const SEARCH_DEBOUNCE_MS = 300;
const MODE_STORAGE_KEY = 'domora-tasks-mode';

/** Cómo se muestran las tareas del periodo: calendario, tabla o tablero por estado. */
export type TaskMode = 'calendar' | 'table' | 'kanban';

/**
 * "Tareas": la agenda operativa de la gestora. Esta pantalla solo orquesta —
 * qué rango y qué filtros se piden al servidor, qué se selecciona, qué
 * diálogos están abiertos—; el pintado vive en los componentes hijos y toda
 * la autorización en el backend.
 */
@Component({
  selector: 'app-tasks',
  standalone: true,
  imports: [
    FormsModule, DropdownComponent, SelectDropdownDirective, TopbarComponent, BtnComponent, FocusTrapDirective, IconComponent, TaskAgendaListComponent, TaskDrawerComponent,
    TaskFiltersComponent, TaskFormDialogComponent, TaskKanbanComponent, TaskMonthGridComponent, TaskTableComponent, TaskTimeGridComponent,
  ],
  templateUrl: './tasks.component.html',
  styleUrl: './tasks.component.scss',
})
export class TasksComponent {
  private readonly agenda = inject(AgendaTasksService);
  readonly catalog = inject(TaskCatalogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Navegación
  readonly narrow = signal(false);
  /** Ventana demasiado estrecha para siete columnas legibles. */
  readonly compact = signal(false);
  readonly view = signal<CalendarView>('week');
  readonly anchor = signal(startOfDay(new Date()));
  private readonly communityScope = inject(CommunityScopeService);
  /** Hasta que llega la lista real se usan las comunidades recordadas, para que la elegida se vea desde el primer fotograma. */
  readonly estateOptions = computed(() => this.catalog.estates().length ? this.catalog.estates() : this.communityScope.cachedEstates());
  readonly filters = signal<TaskFilterState>({ ...EMPTY_FILTERS, estateId: this.communityScope.estateId() ?? '', labelIds: [] });
  readonly search = signal('');
  readonly query = signal('');
  readonly mode = signal<TaskMode>(this.savedMode());

  // Datos
  readonly items = signal<AgendaTask[]>([]);
  /** Tareas de incidencias abiertas que vencen después del periodo: arriba del calendario, no en su cuadrícula. */
  readonly upcoming = computed(() => this.items().filter((t) => isUpcoming(t, this.range().to)));
  readonly calendarItems = computed(() => this.items().filter((t) => !isUpcoming(t, this.range().to)));
  readonly dueLabel = dueLabel;
  /** El servidor alcanzó un tope de seguridad: faltan tareas en lo que se ve. */
  readonly truncated = signal(false);
  readonly loading = signal(true);
  readonly loaded = signal(false);
  readonly error = signal(false);
  private readonly refreshTick = signal(0);
  /** Consulta a la que pertenecen los datos que se muestran (para no pintar los de otra lista). */
  private readonly itemsKey = signal('');
  private requestId = 0;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  // UI
  /** Detalle completo (doble clic). */
  readonly selected = signal<AgendaTask | null>(null);
  /** Ventana rápida (un clic), junto al punto donde se pulsó. */
  readonly quick = signal<{ task: AgendaTask; style: Record<string, string> } | null>(null);
  readonly quickInfo = computed(() => {
    const quick = this.quick();
    if (!quick) return null;
    const { task } = quick;
    const start = new Date(task.occurrenceStart);
    // Las de todo el día guardan medianoches UTC: su día se lee en UTC.
    const day = task.allDay ? this.utcDay(task.occurrenceStart) : start;
    const date = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(day);
    return { ...quick, when: `${date} · ${timeRangeLabel(task)}`, actions: taskActionItems(task) };
  });
  private lastPointer: { x: number; y: number } | null = null;
  readonly creating = signal<TaskPrefill | 'blank' | null>(null);
  readonly confirmDelete = signal<AgendaTask | null>(null);
  readonly deleting = signal(false);
  /** Filas marcadas en la tabla para completarlas o eliminarlas en bloque. */
  readonly checkedKeys = signal<string[]>([]);
  readonly confirmBulkDelete = signal(false);
  readonly bulkBusy = signal(false);
  /** Las marcadas que siguen en la lista cargada (al filtrar o cambiar de periodo, las que desaparecen dejan de contar). */
  readonly checkedTasks = computed(() => {
    const keys = new Set(this.checkedKeys());
    return this.items().filter((t) => keys.has(t.occurrenceKey));
  });
  readonly hasRecurringChecked = computed(() => this.checkedTasks().some((t) => t.recurring));
  readonly hover = signal<TaskHover | null>(null);
  readonly notice = signal<{ tone: 'ok' | 'error'; text: string } | null>(null);

  /** Esqueleto solo en la primera carga; al navegar o refrescar se conserva lo anterior (atenuado). */
  readonly showSkeleton = computed(() => this.loading() && !this.loaded());

  readonly range = computed(() => viewRange(this.view(), this.anchor()));
  readonly period = computed(() => periodLabel(this.view(), this.anchor()));
  readonly filterCount = computed(() => activeFilterCount(this.filters()) + (this.query() ? 1 : 0));
  readonly selectedKey = computed(() => this.quick()?.task.occurrenceKey ?? this.selected()?.occurrenceKey ?? null);
  /** Si la ventana es estrecha la semana no cabe en columnas: se muestra como agenda en lista. */
  readonly weekAsList = computed(() => this.compact() && this.view() === 'week');
  readonly isToday = computed(() => sameDay(this.anchor(), new Date()));

  readonly tooltip = computed(() => {
    const hover = this.hover();
    if (!hover || this.narrow()) return null;
    const { task, rect } = hover;
    const width = 260;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
    const below = rect.bottom + 8 + 130 < window.innerHeight;
    return {
      task,
      time: timeRangeLabel(task),
      priority: TASK_PRIORITIES[task.priority].label,
      status: TASK_STATUSES[task.status].label,
      type: TASK_TYPES[task.type].label,
      style: { left: `${left}px`, width: `${width}px`, ...(below ? { top: `${rect.bottom + 8}px` } : { bottom: `${window.innerHeight - rect.top + 8}px` }) },
    };
  });

  /** Consulta al servidor: las tareas que solapan el periodo visible, con los filtros activos. */
  private readonly serverQuery = computed<AgendaQuery>(() => {
    const f = this.filters();
    const { from, to } = this.range();
    return {
      estateId: f.estateId,
      assignee: f.assignee,
      status: f.status ? [f.status] : undefined,
      priority: f.priority ? [f.priority] : undefined,
      type: f.type ? [f.type] : undefined,
      labelIds: f.labelIds,
      q: this.query(),
      from: from.toISOString(),
      to: to.toISOString(),
    };
  });

  constructor() {
    // `matchMedia` no existe en todos los entornos (p. ej. jsdom): sin él, escritorio.
    if (typeof window.matchMedia === 'function') {
      const narrow = window.matchMedia(NARROW_QUERY);
      const compact = window.matchMedia(COMPACT_QUERY);
      this.narrow.set(narrow.matches);
      this.compact.set(compact.matches);
      if (narrow.matches) this.view.set('day');
      const onNarrow = (event: MediaQueryListEvent) => this.narrow.set(event.matches);
      const onCompact = (event: MediaQueryListEvent) => this.compact.set(event.matches);
      narrow.addEventListener('change', onNarrow);
      compact.addEventListener('change', onCompact);
      this.destroyRef.onDestroy(() => {
        narrow.removeEventListener('change', onNarrow);
        compact.removeEventListener('change', onCompact);
      });
    }
    this.destroyRef.onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });

    void this.catalog.load();

    effect(() => {
      const query = this.serverQuery();
      this.refreshTick();
      untracked(() => void this.load(query));
    });

    void this.openFromQueryParam();
  }

  // ── Carga ────────────────────────────────────────────────────────────────

  private async load(query: AgendaQuery): Promise<void> {
    const request = ++this.requestId;
    this.loading.set(true);
    this.error.set(false);
    try {
      const { items, truncated } = await this.agenda.list(query);
      if (request !== this.requestId) return;
      this.items.set(items);
      this.truncated.set(truncated);
      this.itemsKey.set(JSON.stringify(query));
      this.syncSelection(items);
      this.loaded.set(true);
    } catch (error) {
      if (request !== this.requestId) return;
      console.error('No se pudieron cargar las tareas', error);
      // Si cambió de lista, lo que había era de otra consulta: no se deja como si fuera de esta.
      if (this.itemsKey() !== JSON.stringify(query)) this.items.set([]);
      this.error.set(true);
    } finally {
      if (request === this.requestId) this.loading.set(false);
    }
  }

  refresh(): void {
    this.refreshTick.update((n) => n + 1);
  }

  /** Mantiene la tarea seleccionada apuntando a su versión recién cargada. */
  private syncSelection(items: AgendaTask[]): void {
    const quick = this.quick();
    if (quick) {
      const freshQuick = items.find((t) => t.occurrenceKey === quick.task.occurrenceKey) ?? items.find((t) => t.id === quick.task.id && !quick.task.recurring);
      this.quick.set(freshQuick ? { ...quick, task: freshQuick } : null);
    }
    const current = this.selected();
    if (!current) return;
    const fresh = items.find((t) => t.occurrenceKey === current.occurrenceKey) ?? items.find((t) => t.id === current.id && !t.recurring);
    if (fresh) this.selected.set(fresh);
  }

  private async openFromQueryParam(): Promise<void> {
    const id = this.route.snapshot.queryParamMap.get('task');
    if (!id) return;
    try {
      const task = await this.agenda.get(id);
      this.anchor.set(task.allDay ? this.utcDay(task.startAt) : startOfDay(new Date(task.startAt)));
      this.selected.set(task);
    } catch {
      this.notice.set({ tone: 'error', text: 'No se encontró la tarea indicada.' });
    }
  }

  private utcDay(iso: string): Date {
    const [y, m, d] = allDayDateInput(iso).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  // ── Navegación del calendario ────────────────────────────────────────────

  setView(view: CalendarView): void {
    this.view.set(view);
  }

  setMode(mode: TaskMode): void {
    this.mode.set(mode);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      /* La vista funciona aunque el almacenamiento no esté disponible. */
    }
  }

  private savedMode(): TaskMode {
    try {
      const saved = localStorage.getItem(MODE_STORAGE_KEY);
      return saved === 'table' || saved === 'kanban' ? saved : 'calendar';
    } catch {
      return 'calendar';
    }
  }

  goToday(): void {
    this.anchor.set(startOfDay(new Date()));
  }

  move(direction: -1 | 1): void {
    this.anchor.set(shiftAnchor(this.view(), this.anchor(), direction));
  }

  openDay(date: Date): void {
    this.anchor.set(startOfDay(date));
    this.view.set('day');
  }

  // ── Filtros y búsqueda ───────────────────────────────────────────────────

  onFilters(next: TaskFilterState): void {
    this.filters.set({ ...next, estateId: this.filters().estateId });
  }

  changeEstate(estateId: string): void {
    this.communityScope.select(estateId || null);
    this.filters.update(current => ({ ...current, estateId }));
    this.closeDrawer();
    this.quick.set(null);
    this.hover.set(null);
  }

  clearFilters(): void {
    this.filters.set({ ...EMPTY_FILTERS, estateId: this.filters().estateId, labelIds: [] });
    this.onSearch('');
  }

  onSearch(value: string): void {
    this.search.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.query.set(value.trim()), SEARCH_DEBOUNCE_MS);
  }

  // ── Selección y creación ─────────────────────────────────────────────────

  /** Un clic: ventana rápida con lo esencial y las acciones. */
  select(task: AgendaTask): void {
    this.hover.set(null);
    this.quick.set({ task, style: this.quickStyle() });
  }

  /** Doble clic: el detalle completo. */
  open(task: AgendaTask): void {
    this.hover.set(null);
    this.quick.set(null);
    this.selected.set(task);
  }

  trackPointer(event: PointerEvent): void {
    this.lastPointer = { x: event.clientX, y: event.clientY };
  }

  /** La ventana se coloca junto al puntero —sin taparlo, para que el segundo clic llegue a la tarea— y dentro de la pantalla. */
  private quickStyle(): Record<string, string> {
    const width = 340;
    const height = 200;
    const point = this.lastPointer;
    this.lastPointer = null;
    if (!point || this.narrow()) return {};
    const left = Math.min(Math.max(8, point.x + 12), window.innerWidth - width - 8);
    const below = point.y + 16 + height < window.innerHeight;
    const top = below ? point.y + 16 : Math.max(8, point.y - 16 - height);
    return { left: `${left}px`, top: `${top}px` };
  }

  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointerDown(event: Event): void {
    if (this.quick() && !(event.target as HTMLElement | null)?.closest?.('.quick')) this.quick.set(null);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.quick.set(null);
  }

  async onQuickAction(task: AgendaTask, action: TaskAction): Promise<void> {
    this.quick.set(null);
    if (action === 'complete') await this.complete(task);
    else if (action === 'reopen') await this.reopen(task);
    else if (action === 'cancel') await this.cancel(task);
    else this.askDelete(task);
  }

  closeDrawer(): void {
    this.selected.set(null);
    if (this.route.snapshot.queryParamMap.has('task')) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { task: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  openCreate(prefill?: TaskPrefill): void {
    this.hover.set(null);
    this.creating.set(prefill ?? 'blank');
  }

  onSlot(slot: SlotClick): void {
    this.openCreate({ date: slot.date, minutes: slot.minutes });
  }

  createOnDay(date: Date): void {
    this.openCreate({ date, minutes: 9 * 60 });
  }

  prefillOf(): TaskPrefill | null {
    const creating = this.creating();
    return creating === 'blank' ? { date: this.anchor() } : creating;
  }

  async onCreated(result: TaskCreated): Promise<void> {
    this.creating.set(null);
    const task = result.task;
    // Lleva el calendario al día de la nueva tarea para que se vea dónde ha quedado.
    this.anchor.set(task.allDay ? this.utcDay(task.startAt) : startOfDay(new Date(task.startAt)));
    this.refresh();
    this.say('ok', result.failedUploads > 0
      ? `Tarea creada, pero ${result.failedUploads} adjunto(s) no se pudieron subir. Añádelos desde el detalle.`
      : 'Tarea creada.');
  }

  async onChanged(detail: AgendaTaskDetail): Promise<void> {
    this.refresh();
    const current = this.selected();
    // Una tarea simple que ya no aparece en la vista actual se sigue mostrando en el panel.
    if (current && !current.recurring && current.id === detail.id) {
      this.selected.set({ ...current, ...detail } as AgendaTask);
    }
  }

  onDuplicated(detail: AgendaTaskDetail): void {
    this.refresh();
    this.selected.set(detail);
    this.say('ok', 'Tarea duplicada. Ajusta la fecha desde el detalle.');
  }

  // ── Acciones sobre tareas ────────────────────────────────────────────────

  /** Una tarea de incidencia lleva a la ficha de su incidencia. */
  goToIssue(task: AgendaTask): void {
    if (!task.issueId) return;
    this.quick.set(null);
    void this.router.navigate(['/b/incidencias', task.issueId]);
  }

  async complete(task: AgendaTask): Promise<void> {
    try {
      await this.agenda.setStatus(task.id, 'COMPLETADA', task.recurring ? task.occurrenceStart : undefined);
      this.refresh();
    } catch (error) {
      console.error('No se pudo completar la tarea', error);
      this.say('error', messageFrom(error, 'No se pudo completar la tarea.'));
    }
  }

  /** Desmarcar una tarea completada: vuelve al estado que tenía antes (en una serie, la ocurrencia queda como el resto). */
  async reopen(task: AgendaTask): Promise<void> {
    try {
      await this.agenda.setStatus(task.id, 'PENDIENTE', task.recurring ? task.occurrenceStart : undefined, true);
      this.refresh();
    } catch (error) {
      console.error('No se pudo reabrir la tarea', error);
      this.say('error', 'No se pudo reabrir la tarea.');
    }
  }

  async cancel(task: AgendaTask): Promise<void> {
    try {
      await this.agenda.setStatus(task.id, 'CANCELADA', task.recurring ? task.occurrenceStart : undefined);
      this.refresh();
    } catch (error) {
      console.error('No se pudo cancelar la tarea', error);
      this.say('error', messageFrom(error, 'No se pudo cancelar la tarea.'));
    }
  }

  /** Arrastrar una tarjeta a otra columna del tablero cambia su estado (en una serie, solo el de la ocurrencia). */
  async onStatusChange(change: TaskStatusChange): Promise<void> {
    const { task, status } = change;
    try {
      await this.agenda.setStatus(task.id, status, task.recurring ? task.occurrenceStart : undefined);
      this.refresh();
    } catch (error) {
      console.error('No se pudo cambiar el estado de la tarea', error);
      this.say('error', messageFrom(error, 'No se pudo cambiar el estado de la tarea.'));
    }
  }

  askDelete(task: AgendaTask): void {
    this.confirmDelete.set(task);
  }

  async confirmRemoval(): Promise<void> {
    const task = this.confirmDelete();
    if (!task) return;
    this.deleting.set(true);
    try {
      await this.agenda.remove(task.id);
      this.confirmDelete.set(null);
      if (this.selected()?.id === task.id) this.closeDrawer();
      this.refresh();
      this.say('ok', 'Tarea eliminada.');
    } catch (error) {
      console.error('No se pudo eliminar la tarea', error);
      this.confirmDelete.set(null);
      this.say('error', 'No se pudo eliminar la tarea.');
    } finally {
      this.deleting.set(false);
    }
  }

  readonly statusItems: DropdownItem[] = TASK_STATUS_KEYS.map((id) => ({ id, label: TASK_STATUSES[id].label, icon: TASK_STATUSES[id].icon }));

  /** Pasa las marcadas al estado elegido. Las decisiones no se cierran ni se reabren a secas: se resuelven con su acción. */
  async changeCheckedStatus(status: AgendaTaskStatus): Promise<void> {
    const terminal = (s: AgendaTaskStatus) => s === 'COMPLETADA' || s === 'CANCELADA';
    const pending = this.checkedTasks().filter((t) => t.status !== status);
    const targets = pending.filter((t) => !t.kind || !(terminal(status) || terminal(t.status)));
    const skipped = pending.length - targets.length;
    if (targets.length === 0) {
      // Una decisión ya resuelta no se toca; una pendiente se resuelve con su acción, desde su detalle.
      const resolvedOnly = pending.filter((t) => t.kind && terminal(t.status)).length === skipped;
      this.say('error', skipped > 0 ? (resolvedOnly ? 'Esta decisión ya está resuelta y no puede modificarse.' : 'Las tareas de decisión se resuelven desde su detalle.') : `Las tareas seleccionadas ya están en «${TASK_STATUSES[status].label}».`);
      return;
    }
    this.bulkBusy.set(true);
    try {
      const results = await Promise.allSettled(
        targets.map((t) => this.agenda.setStatus(t.id, status, t.recurring ? t.occurrenceStart : undefined)),
      );
      const failed = targets.filter((_, i) => results[i].status === 'rejected');
      this.finishBulk(failed, 'cambiar', `${targets.length - failed.length} pasada(s) a «${TASK_STATUSES[status].label}»`, skipped);
    } finally {
      this.bulkBusy.set(false);
    }
  }

  async removeChecked(): Promise<void> {
    // Una serie se borra entera: varias ocurrencias de la misma serie son una sola petición.
    const ids = [...new Set(this.checkedTasks().map((t) => t.id))];
    this.bulkBusy.set(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => this.agenda.remove(id)));
      const failedIds = new Set(ids.filter((_, i) => results[i].status === 'rejected'));
      const failed = this.checkedTasks().filter((t) => failedIds.has(t.id));
      const shown = this.selected();
      if (shown && ids.includes(shown.id) && !failedIds.has(shown.id)) this.closeDrawer();
      this.confirmBulkDelete.set(false);
      this.finishBulk(failed, 'eliminar', `${ids.length - failedIds.size} eliminada(s)`, 0);
    } finally {
      this.bulkBusy.set(false);
    }
  }

  /** Deja marcadas solo las que fallaron, refresca y cuenta lo ocurrido. */
  private finishBulk(failed: AgendaTask[], verb: string, done: string, skipped: number): void {
    this.checkedKeys.set(failed.map((t) => t.occurrenceKey));
    this.refresh();
    if (failed.length > 0) this.say('error', `${done}; no se pudo ${verb} ${failed.length}. Siguen seleccionadas.`);
    else this.say('ok', skipped > 0 ? `${done}. ${skipped} de decisión se resuelven desde su detalle.` : `${done}.`);
  }

  /**
   * Arrastrar una tarea a otro día/hora. Es una actualización optimista
   * porque es segura: el servidor valida igual, y si falla se restaura el
   * estado anterior y se avisa.
   */
  async onMoved(move: TaskMove): Promise<void> {
    const { task, start } = move;
    const durationMs = new Date(task.occurrenceEnd).getTime() - new Date(task.occurrenceStart).getTime();
    let startAt: string;
    let endAt: string;
    if (task.allDay) {
      const days = Math.max(1, Math.round(durationMs / 86_400_000));
      startAt = allDayIso(dateKey(start));
      endAt = allDayIso(dateKey(start), days);
    } else {
      startAt = start.toISOString();
      endAt = new Date(start.getTime() + durationMs).toISOString();
    }
    if (startAt === task.occurrenceStart) return;

    const snapshot = this.items();
    this.items.update((items) =>
      items.map((t) => (t.occurrenceKey === task.occurrenceKey ? { ...t, occurrenceStart: startAt, occurrenceEnd: endAt, startAt, endAt } : t)),
    );
    try {
      await this.agenda.update(task.id, { startAt, endAt, allDay: task.allDay, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      this.refresh();
    } catch (error) {
      console.error('No se pudo mover la tarea', error);
      this.items.set(snapshot);
      this.say('error', 'No se pudo mover la tarea. Se ha restaurado su posición.');
    }
  }

  private say(tone: 'ok' | 'error', text: string): void {
    this.notice.set({ tone, text });
    setTimeout(() => {
      if (this.notice()?.text === text) this.notice.set(null);
    }, 6000);
  }

  // Solo se avisa del vacío cuando hay filtros activos (para poder limpiarlos); sin filtros no hay banner.
  readonly showEmptyBanner = computed(() => this.filterCount() > 0 && this.loaded() && !this.loading() && !this.error() && this.items().length === 0);
}
