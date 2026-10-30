import { Component, ElementRef, Injector, OnDestroy, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { IssueJourneyStep, IssueJourneyView, JourneyActionType } from '../../../core/issue-workflow.models';
import { IssueWorkflowService } from '../../../core/issue-workflow.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';

/** Cuántos pasos ya hechos se ven de entrada; el resto, tras «Ver anteriores». */
const VISIBLE_HISTORY = 4;

/**
 * Recorrido de la incidencia en «Situación actual»: lo que ocurrió (con fecha), UNA situación actual destacada y accionable y,
 * como mucho, el siguiente paso previsible. Es una lectura de lo que hay en la incidencia: lo que se hace desde aquí se hace
 * con los diálogos y pantallas de siempre (el componente solo avisa qué acción se pidió). «Personalizar recorrido» permite
 * añadir hitos propios y renombrar u ocultar los que ya ocurrieron; los hechos del sistema no se pueden declarar a mano.
 */
@Component({
  selector: 'app-issue-journey',
  standalone: true,
  imports: [IconComponent, SelectDropdownDirective],
  template: `
    @if (journey(); as j) {
      <section class="journey" [class.journey--has-now]="!!now()" [class.journey--dragging]="!!dragged()" aria-label="Recorrido de la incidencia" data-testid="journey">
        @if (canEdit()) {
          <footer class="journey__head">
            <button type="button" class="journey__edit" [attr.aria-pressed]="editing()" (click)="editing.set(!editing())">
              {{ editing() ? 'Terminar' : 'Personalizar recorrido' }}
            </button>
          </footer>
        }

        @if (hiddenCount() > 0 && !showAll()) {
          <button type="button" class="journey__more" data-testid="journey-more" (click)="showAll.set(true)">Ver {{ hiddenCount() }} anteriores</button>
        }
        <ol class="steps">
          @for (s of history(); track s.key; let last = $last) {
            <li class="step step--done" [class.step--last]="last" data-testid="journey-step" [attr.data-custom]="s.custom">
              <span class="step__dot" aria-hidden="true"><app-icon name="check" [size]="12"></app-icon></span>
              <div class="step__content">
                <div class="step__title-row">
                  <div class="step__body">
                    @if (editing() && renaming() === ref(s)) {
                      <input class="step__input" [value]="s.label" #name (keydown.enter)="rename(s, name.value)" (keydown.escape)="renaming.set(null)" (blur)="rename(s, name.value)" aria-label="Nombre del hito" />
                    } @else {
                      <span class="step__label">{{ s.label }}</span>
                    }
                    @if (s.completedAt) { <span class="step__meta">{{ dateTimeLabel(s.completedAt) }}</span> }
                  </div>
                </div>
                @if (editing()) {
                  <span class="step__actions">
                    <button type="button" class="icon-btn" aria-label="Renombrar" (click)="renaming.set(ref(s))"><app-icon name="edit" [size]="12"></app-icon></button>
                    <select class="step__status" aria-label="Estado asociado" [value]="linkedValue(s)" [disabled]="s.key === 'resolved'" (change)="associate(s, $any($event.target).value)">
                      <option value="">Sin estado</option>
                      @for (status of issueStatuses; track status.key) { <option [value]="status.key">{{ status.label }}</option> }
                    </select>
                    @if (s.key !== 'created' && s.key !== 'resolved') {
                      <button type="button" class="icon-btn" aria-label="Quitar" (click)="remove(s)"><app-icon name="trash" [size]="12"></app-icon></button>
                    }
                  </span>
                }
              </div>
            </li>
          }
        </ol>

        @if (upcoming().length) {
          <ul class="next" aria-label="Después">
            @for (s of upcoming(); track s.key; let first = $first; let last = $last) {
              <li class="next__item" [class.next__item--active]="first" [class.next__item--last]="last" [class.next__item--dragging]="dragged()?.key === s.key" data-testid="journey-next" [attr.data-active]="first ? 'true' : null" [attr.data-custom]="s.custom" [attr.data-custom-milestone-id]="s.custom ? ref(s) : null">
                <span class="next__dot" aria-hidden="true"></span>
                <div class="next__content">
                  <div class="next__title-row">
                    @if (editing() && s.custom) {
                      <button type="button" class="drag-handle" data-testid="drag-handle" [disabled]="movableCount() < 2" [attr.data-handle-for]="ref(s)" title="Arrastrar para reordenar" [attr.aria-label]="'Reordenar hito ' + s.label + '. Usa las flechas arriba y abajo.'" (pointerdown)="startDrag($event, s)" (keydown)="onHandleKeydown($event, ref(s))">
                        <svg width="12" height="18" viewBox="0 0 12 18" fill="currentColor" aria-hidden="true">
                          <circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/>
                          <circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/>
                          <circle cx="3" cy="15" r="1.5"/><circle cx="9" cy="15" r="1.5"/>
                        </svg>
                      </button>
                    }
                    @if (editing() && renaming() === ref(s)) {
                      <input class="step__input" [value]="s.label" #futureName (keydown.enter)="rename(s, futureName.value)" (keydown.escape)="renaming.set(null)" (blur)="rename(s, futureName.value)" aria-label="Nombre del hito" />
                    } @else {
                      <span class="next__label">{{ s.label }}</span>
                    }
                  </div>
                  @if (editing()) {
                    <span class="step__actions">
                      <button type="button" class="icon-btn" aria-label="Renombrar" (click)="renaming.set(ref(s))"><app-icon name="edit" [size]="12"></app-icon></button>
                      <select class="step__status" aria-label="Estado asociado" [value]="linkedValue(s)" [disabled]="s.key === 'resolved'" (change)="associate(s, $any($event.target).value)">
                        <option value="">Sin estado</option>
                        @for (status of issueStatuses; track status.key) { <option [value]="status.key">{{ status.label }}</option> }
                      </select>
                      @if (s.custom) {
                        <button type="button" class="icon-btn" aria-label="Marcar como hecho" (click)="toggle(s)"><app-icon name="check" [size]="12"></app-icon></button>
                        <button type="button" class="icon-btn" aria-label="Quitar" (click)="remove(s)"><app-icon name="trash" [size]="12"></app-icon></button>
                      }
                    </span>
                  }
                </div>
              </li>
              @if (first && now(); as c) {
                <li class="now-row" [class.now-row--tail]="last">
                  <div class="now" [class.now--alert]="j.status === 'needs_attention' || c.overdue" data-testid="journey-now" aria-current="step">
                    <span class="now__kicker">Ahora</span>
                    <strong class="now__label" data-testid="journey-current">Decide cómo sigue la incidencia</strong>
                    <div class="now__actions">
                      <button type="button" class="now__btn now__btn--ghost" data-testid="journey-schedule-task" (click)="addTask(c, s)"><app-icon name="calendar" [size]="13"></app-icon> {{ hasTask(c) ? 'Ver tarea' : 'Añadir tarea' }}</button>
                      <button type="button" class="now__btn" data-testid="journey-complete" (click)="finish(s)"><app-icon name="check" [size]="13"></app-icon> Completar</button>
                    </div>
                  </div>
                </li>
              }
            }
          </ul>
        }

        @if (editing()) {
          <form class="add" (submit)="$event.preventDefault(); add(label.value); label.value = ''">
            <input class="add__input" #label placeholder="Nuevo hito" aria-label="Nuevo hito" maxlength="120" />
            <button type="submit" class="add__btn"><app-icon name="plus" [size]="12"></app-icon> Añadir hito</button>
          </form>
        }
        @if (error()) { <p class="journey__error" role="alert">{{ error() }}</p> }
        <p class="sr-only" aria-live="polite">{{ dragMessage() }}</p>
      </section>
    } @else if (loadFailed()) {
      <div class="journey__failed" role="alert" data-testid="journey-error">
        <p class="journey__error">No se pudo cargar la situación de la incidencia.</p>
        <button type="button" class="journey__edit" data-testid="journey-retry" (click)="load(issueId())">Reintentar</button>
      </div>
    }
  `,
  styles: `
    .journey { margin: 0; }
    .journey--dragging { cursor: grabbing; user-select: none; }
    /* En la línea del título de la tarjeta (que es su ancestro posicionado), a la derecha. */
    .journey__head { position: absolute; top: 16px; right: 18px; }
    .journey__edit, .journey__more { font-size: 12px; color: var(--color-accent); background: none; border: none; cursor: pointer; padding: 2px 4px; }
    .journey__more { margin: 0 0 8px 24px; }
    .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .step { position: relative; display: flex; align-items: flex-start; gap: 10px; padding: 0 0 14px; }
    .step::before { content: ''; position: absolute; left: 8px; top: 18px; bottom: 0; width: 2px; background: var(--color-accent); }
    .step--last::before { display: none; }
    .journey--has-now .step--last::before { display: block; bottom: -18px; background: var(--color-accent); }
    .step__dot { flex: 0 0 18px; height: 18px; border-radius: 50%; border: 2px solid var(--color-accent); background: var(--color-accent); display: grid; place-items: center; color: #fff; z-index: 1; }
    .step__content, .next__content { display: grid; flex: 1; gap: 4px; min-width: 0; border-radius: var(--radius-sm); transition: opacity 120ms ease, transform 120ms ease, box-shadow 120ms ease; }
    .step__title-row, .next__title-row { display: flex; align-items: flex-start; gap: 4px; min-width: 0; }
    .step__body { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    .step__label { overflow: hidden; font-size: 14px; color: var(--color-text); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
    .step__meta { font-size: 12px; color: var(--color-muted); }
    .step__input, .add__input { font: inherit; font-size: 14px; padding: 3px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); min-width: 0; }
    .step__actions { display: flex; align-items: center; gap: 4px; }
    .step[data-custom="true"] .step__actions, .next__item[data-custom="true"] .step__actions { margin-left: 28px; }
    .icon-btn { width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: none; color: var(--color-muted); cursor: pointer; }
    .icon-btn:hover { color: var(--color-text); border-color: var(--color-accent); }
    .drag-handle { display: grid; place-items: center; flex: 0 0 24px; width: 24px; height: 24px; padding: 0; color: var(--color-muted); background: none; border: 0; border-radius: var(--radius-sm); cursor: grab; touch-action: none; }
    .drag-handle:hover:not(:disabled) { color: var(--color-text); background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
    .drag-handle:active:not(:disabled) { cursor: grabbing; }
    .drag-handle:disabled { opacity: 0.3; cursor: default; }
    .drag-handle:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
    /* La situación actual cuelga del hito que se está atendiendo. */
    .now-row { position: relative; list-style: none; margin: 0; padding: 0 0 8px 28px; }
    .now-row::before { content: ''; position: absolute; left: 8px; top: -10px; bottom: -2px; width: 2px; background: var(--color-border); }
    .now { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 2px; padding: 9px 12px; border: 1px solid var(--color-accent); border-radius: var(--radius-md); background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface)); }
    .now--alert { border-color: var(--color-warning, #b45309); background: color-mix(in srgb, var(--color-warning, #b45309) 9%, var(--color-surface)); }
    .now__kicker { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 700; color: var(--color-accent); }
    .now--alert .now__kicker { color: var(--color-warning, #b45309); }
    .now__label { font-size: 14px; color: var(--color-text); }
    .now__actions { display: flex; align-items: stretch; justify-content: center; align-self: stretch; gap: 10px; margin-top: 6px; }
    .now__btn { flex: 1 1 0; min-width: 140px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-family: var(--font-family); font-size: 15px; font-weight: 500; padding: 8px 16px; border-radius: var(--radius-md); border: 1px solid var(--color-accent); background: var(--color-primary); color: #fff; cursor: pointer; white-space: nowrap; transition: background 0.15s, color 0.15s, border-color 0.15s; }
    .now__btn:hover { background: var(--color-primary-hover); }
    .now__btn--ghost { background: none; color: var(--color-accent); }
    .now__btn--ghost:hover { background: color-mix(in srgb, var(--color-accent) 12%, transparent); }
    .now__btn:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
    .next { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .next__item { position: relative; display: flex; align-items: center; gap: 10px; min-height: 32px; padding-bottom: 8px; font-size: 13px; color: var(--color-muted); }
    .next__item::before { content: ''; position: absolute; left: 8px; top: 18px; bottom: -2px; width: 2px; background: var(--color-border); }
    .next__item::after { content: ''; position: absolute; left: 8px; top: -2px; height: 20px; width: 2px; background: var(--color-border); }
    .next__item--active::after { background: var(--color-accent); }
    .next__item--last::before { display: none; }
    .now-row--tail::before { display: none; }
    .next__item--dragging .next__content { opacity: 0.72; transform: translateY(-2px); box-shadow: 0 0 0 2px var(--color-accent), 0 8px 18px rgb(0 0 0 / 0.22); }
    .next__dot { position: relative; z-index: 1; flex: 0 0 18px; height: 18px; border-radius: 50%; border: 2px solid var(--color-muted); background: var(--color-surface); box-sizing: border-box; }
    .next__label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .step__status { max-width: 145px; text-align: center; text-align-last: center; padding-left: 30px !important; min-height: 26px; font: inherit; font-size: 12px; color: var(--color-text); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); }
    .journey--dragging .drag-handle { cursor: grabbing; }
    .add { display: flex; gap: 8px; margin-top: 12px; }
    .add__input { flex: 1; }
    .add__btn { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; padding: 3px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: none; color: var(--color-text); cursor: pointer; }
    .journey__error { margin: 8px 0 0; font-size: 13px; color: var(--color-error); }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    @media (max-width: 420px) {
      .now__actions { flex-wrap: wrap; }
    }
  `,
})
export class IssueJourneyComponent implements OnDestroy {
  private readonly workflow = inject(IssueWorkflowService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private stopDrag: (() => void) | null = null;

  readonly issueId = input.required<string>();
  /** Cualquier cosa que cambie cuando la incidencia cambia (p. ej. su situación): vuelve a leer el recorrido. */
  readonly refreshOn = input<unknown>(null);
  readonly canEdit = input(true);
  /** La tarea de revisión pendiente: su paso se presenta como una decisión («Decidir ahora»), no como trabajo por hacer. */
  readonly reviewTaskId = input<string | null>(null);
  /** Se pidió una acción sobre el paso actual: quien aloja el recorrido decide a dónde lleva. */
  readonly act = output<{ type: JourneyActionType; entityId?: string }>();
  /** Sin siguiente paso, la persona elige cómo sigue: quien aloja el recorrido abre «Registrar actividad» con esa opción. */
  readonly decide = output<'task' | 'wait' | 'visit' | 'resolved'>();
  readonly issueStatuses = [
    { key: 'Abierta', label: 'Abierta' },
    { key: 'EnReparacion', label: 'En reparación' },
    { key: 'PendienteProveedor', label: 'Pendiente proveedor' },
    { key: 'PendienteInformacion', label: 'Pendiente de información' },
    { key: 'Resuelta', label: 'Resuelta' },
    { key: 'Cerrada', label: 'Cerrada' },
  ] as const;

  readonly journey = signal<IssueJourneyView | null>(null);
  readonly editing = signal(false);
  readonly renaming = signal<string | null>(null);
  readonly showAll = signal(false);
  readonly error = signal('');
  readonly loadFailed = signal(false);
  readonly dragged = signal<IssueJourneyStep | null>(null);
  readonly dragMessage = signal('');
  private readonly dragPreview = signal<IssueJourneyStep[] | null>(null);

  private readonly editableSteps = computed(() => {
    const view = this.journey();
    const steps = view?.steps ?? [];
    if (view?.route === 'community_insurance') {
      const createdSource = steps.find((step) => step.key === 'created');
      const contactSource = steps.find((step) => step.key === 'community_insurance:contact')
        ?? steps.find((step) => step.status === 'completed' && /seguro de la comunidad contactado/i.test(step.label));
      const closedSource = steps.find((step) => step.key === 'resolved');
      const custom = steps
        .filter((step) => step.custom)
        .map((step, index) => ({ ...step, milestone: true, position: step.position ?? (index + 1) * 10 }));
      const created: IssueJourneyStep = {
        ...(createdSource ?? { id: null, completedAt: undefined }),
        key: 'created', label: createdSource?.label ?? 'Incidencia creada', status: 'completed', custom: false,
        milestone: true, position: -1_000_000,
      };
      const contact: IssueJourneyStep = {
        ...(contactSource ?? { id: null }),
        key: 'community_insurance:contact', label: contactSource?.milestone ? contactSource.label : 'Contactar con el seguro de la comunidad',
        status: contactSource?.status === 'completed' ? 'completed' : 'upcoming', custom: false,
        milestone: true, position: 0,
      };
      const closed: IssueJourneyStep = {
        ...(closedSource ?? { id: null }),
        key: 'resolved', label: closedSource?.milestone ? closedSource.label : 'Incidencia cerrada',
        status: closedSource?.status === 'completed' ? 'completed' : 'upcoming', custom: false,
        milestone: true, position: 1_000_000,
      };
      return [created, contact, ...custom, closed]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    }
    const milestones = steps.filter((step) => step.milestone);
    return milestones.length
      ? [...milestones].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      : steps;
  });
  private readonly doneSteps = computed(() => this.editableSteps().filter((s) => s.status === 'completed'));
  readonly hiddenCount = computed(() => Math.max(0, this.doneSteps().length - VISIBLE_HISTORY));
  readonly history = computed(() => (this.showAll() ? this.doneSteps() : this.doneSteps().slice(-VISIBLE_HISTORY)));
  readonly now = computed(() => this.journey()?.steps.find((s) => s.status === 'current') ?? null);
  private readonly upcomingSteps = computed(() => this.editableSteps().filter((s) => s.status === 'upcoming'));
  readonly upcoming = computed(() => this.dragPreview() ?? this.upcomingSteps());
  readonly movableCount = computed(() => this.upcomingSteps().filter((step) => step.custom).length);

  constructor() {
    effect(() => {
      const id = this.issueId();
      this.refreshOn();
      untracked(() => void this.load(id));
    });
  }

  ngOnDestroy(): void {
    this.stopDrag?.();
  }

  /** «Incidencia cerrada» siempre va con el estado Cerrada; el resto, el que la gestión eligió. */
  linkedValue(s: IssueJourneyStep): string {
    return s.key === 'resolved' ? 'Cerrada' : (s.linkedStatus ?? '');
  }

  ref(s: IssueJourneyStep): string {
    return s.id ?? s.key;
  }

  dateTimeLabel(iso: string): string {
    return new Date(iso).toLocaleString('es-ES', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid',
    });
  }

  canComplete(current: IssueJourneyStep, milestone: IssueJourneyStep): boolean {
    return milestone.key === 'resolved' || (current.source?.type === 'task' && !!current.action);
  }

  complete(current: IssueJourneyStep, milestone: IssueJourneyStep): void {
    if (milestone.key === 'resolved') {
      this.act.emit({ type: 'resolve_issue' });
      return;
    }
    if (current.source?.type === 'task' && current.action) this.act.emit(current.action);
  }

  /** El paso actual ya es una tarea (p. ej. la creó la propia incidencia): en vez de añadir otra, se ve esa. */
  hasTask(current: IssueJourneyStep): boolean {
    return current.source?.type === 'task' && !!current.action;
  }

  /** «Añadir tarea» abre el mismo modal que «Completar»; sin esa acción (no hay nada que completar) pide la tarea como siguiente paso. */
  addTask(current: IssueJourneyStep, milestone: IssueJourneyStep): void {
    if (this.canComplete(current, milestone)) this.complete(current, milestone);
    else this.decide.emit('task');
  }

  async load(id: string): Promise<void> {
    this.loadFailed.set(false);
    try {
      const view = await this.workflow.journey(id);
      // Una respuesta sin `steps` (servidor desactualizado) no es un recorrido: se trata como fallo, no como un panel vacío.
      if (!Array.isArray(view?.steps)) throw new Error('Respuesta del recorrido inesperada');
      this.journey.set(view);
    } catch (error) {
      console.error('No se pudo cargar el recorrido', error);
      this.journey.set(null);
      this.loadFailed.set(true);
    }
  }

  private async run(action: () => Promise<IssueJourneyView>): Promise<void> {
    this.error.set('');
    try {
      this.journey.set(await action());
    } catch (error) {
      console.error('No se pudo actualizar el recorrido', error);
      this.error.set('No se pudo actualizar el recorrido.');
    }
  }

  /** «Completar»: da el hito por hecho al momento. En el último hito, además, cierra la incidencia. */
  finish(s: IssueJourneyStep): Promise<void> | void {
    if (s.key === 'resolved') return this.act.emit({ type: 'close_issue' });
    return this.toggle(s);
  }

  toggle(s: IssueJourneyStep): Promise<void> {
    return this.run(() => this.workflow.updateMilestone(this.issueId(), this.ref(s), { done: s.status !== 'completed' }));
  }

  async rename(s: IssueJourneyStep, value: string): Promise<void> {
    if (this.renaming() !== this.ref(s)) return;
    this.renaming.set(null);
    const label = value.trim();
    if (!label || label === s.label) return;
    await this.run(() => this.workflow.updateMilestone(this.issueId(), this.ref(s), { label }));
  }

  remove(s: IssueJourneyStep): Promise<void> {
    return this.run(() => this.workflow.removeMilestone(this.issueId(), this.ref(s)));
  }

  associate(s: IssueJourneyStep, linkedStatus: string): Promise<void> {
    return this.run(() => this.workflow.updateMilestone(this.issueId(), this.ref(s), { linkedStatus: linkedStatus || null }));
  }

  /** Mismo gesto que la agenda de Juntas: pointer events desde el asa, compatible con ratón y táctil. */
  startDrag(event: PointerEvent, step: IssueJourneyStep): void {
    if (!step.custom || this.movableCount() < 2) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    this.stopDrag?.();
    this.dragPreview.set([...this.upcomingSteps()]);
    this.dragged.set(step);
    this.dragMessage.set(`Moviendo ${step.label}. Arrastra arriba o abajo y suelta para reordenar.`);

    const onMove = (moveEvent: PointerEvent) => this.dragTo(moveEvent.clientY, this.ref(step));
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      this.stopDrag = null;
    };
    const onUp = () => {
      cleanup();
      this.finishPointerDrag();
    };
    const onCancel = () => {
      cleanup();
      this.cancelDrag();
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    this.stopDrag = () => {
      cleanup();
      this.cancelDrag();
    };
  }

  private dragTo(clientY: number, id: string): void {
    const cards = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-custom-milestone-id]'));
    const custom = this.upcoming().filter((step) => step.custom);
    const from = custom.findIndex((step) => this.ref(step) === id);
    if (from < 0) return;
    const to = cards
      .filter((card) => card.dataset['customMilestoneId'] !== id)
      .filter((card) => {
        const rect = card.getBoundingClientRect();
        return clientY > rect.top + rect.height / 2;
      }).length;
    this.previewMove(from, to);
  }

  private previewMove(from: number, to: number): IssueJourneyStep[] | null {
    const all = [...this.upcoming()];
    const custom = all.filter((step) => step.custom);
    if (from === to || from < 0 || to < 0 || from >= custom.length || to >= custom.length) return null;
    const [moved] = custom.splice(from, 1);
    custom.splice(to, 0, moved);
    let customIndex = 0;
    const preview = all.map((step) => step.custom ? custom[customIndex++] : step);
    this.dragPreview.set(preview);
    this.dragMessage.set(`Hito movido a la posición ${to + 1} de ${custom.length}.`);
    return preview;
  }

  private finishPointerDrag(): void {
    const moved = this.dragged();
    const preview = this.dragPreview();
    this.dragged.set(null);
    if (!moved || !preview || this.sameCustomOrder(preview, this.upcomingSteps())) {
      this.dragPreview.set(null);
      return;
    }
    void this.persistOrder(moved, preview);
  }

  /** Se mantiene público para cancelar el gesto en pruebas y al desmontar el componente. */
  dragEnd(): void {
    if (this.stopDrag) this.stopDrag();
    else this.cancelDrag();
  }

  private cancelDrag(): void {
    if (this.dragged()) this.dragMessage.set('Arrastre cancelado.');
    this.dragged.set(null);
    this.dragPreview.set(null);
  }

  onHandleKeydown(event: KeyboardEvent, id: string): void {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const custom = this.upcoming().filter((step) => step.custom);
    const from = custom.findIndex((step) => this.ref(step) === id);
    const to = from + (event.key === 'ArrowUp' ? -1 : 1);
    const preview = this.previewMove(from, to);
    if (!preview) return;
    const moved = preview.find((step) => this.ref(step) === id)!;
    void this.persistOrder(moved, preview);
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-handle-for="${id}"]`)?.focus(), { injector: this.injector });
  }

  private sameCustomOrder(a: IssueJourneyStep[], b: IssueJourneyStep[]): boolean {
    return a.filter((step) => step.custom).map((step) => step.key).join('|')
      === b.filter((step) => step.custom).map((step) => step.key).join('|');
  }

  private async persistOrder(moved: IssueJourneyStep, ordered: IssueJourneyStep[]): Promise<void> {
    const custom = ordered.filter((step) => step.custom);
    const index = custom.findIndex((step) => step.key === moved.key);
    if (index < 0) {
      this.dragPreview.set(null);
      return;
    }
    const before = custom[index - 1]?.position ?? 0;
    const after = custom[index + 1]?.position ?? 1_000_000;
    const position = Math.max(1, Math.min(999_999, (before + after) / 2));
    await this.run(() => this.workflow.updateMilestone(this.issueId(), this.ref(moved), { position }));
    this.dragPreview.set(null);
  }

  async add(value: string): Promise<void> {
    const label = value.trim();
    if (!label) return;
    const afterKey = this.journey()?.route === 'community_insurance' ? 'community_insurance:contact' : undefined;
    await this.run(() => this.workflow.addMilestone(this.issueId(), { label, ...(afterKey ? { afterKey } : {}) }));
  }
}
