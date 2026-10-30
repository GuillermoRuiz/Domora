import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { AgendaTaskDetail, PersonRef } from '../../../core/agenda-tasks.model';
import { DropdownComponent, DropdownItem } from '../../../shared/components/dropdown/dropdown.component';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { AgendaTasksService } from '../../../core/agenda-tasks.service';
import { IssuesService } from '../../../core/issues.service';
import { RESOLUTION_ROUTES, ROUTE_LABEL } from '../../../core/issue-workflow.models';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';
import { supplierCategoryFor } from '../../../core/supplier-categories';

type Choice = 'task' | 'wait' | 'visit' | 'route' | 'resolved' | 'exists';

/** Las opciones de «¿Cómo sigue?», con lo que hace cada una. */
const CHOICES: { key: Choice; label: string; hint: string }[] = [
  { key: 'task', label: 'Tengo que hacer algo', hint: 'Llamar, avisar o preparar algo: se crea una tarea con fecha.' },
  { key: 'wait', label: 'Estoy esperando una respuesta', hint: 'Del proveedor, el seguro, el propietario… Te avisamos si tarda.' },
  { key: 'visit', label: 'Hay una visita programada', hint: 'Alguien va a ver o arreglar la incidencia en una fecha.' },
  { key: 'resolved', label: 'La incidencia está solucionada', hint: 'Se cierra la incidencia como resuelta.' },
  { key: 'route', label: 'Hay que cambiar la vía de gestión', hint: 'Pasa a gestionarse por otro camino (seguro, proveedor…).' },
  { key: 'exists', label: 'Ya hay otra tarea, espera o visita pendiente', hint: 'Solo vale si ya existe un paso pendiente en la incidencia.' },
];

const PARTIES = [
  { key: 'provider', label: 'Proveedor' },
  { key: 'insurer', label: 'Seguro' },
  { key: 'owner', label: 'Propietario' },
  { key: 'other', label: 'Otro' },
];

const PRIORITIES = [
  { key: 'URGENTE', label: 'Urgente' },
  { key: 'ALTA', label: 'Alta' },
  { key: 'MEDIA', label: 'Media' },
  { key: 'BAJA', label: 'Baja' },
];

/** Lo único que el panel necesita de la tarea de revisión: cualquier sitio que la conozca (Tareas, la propia incidencia) puede alojarlo. */
export interface ReviewTaskRef {
  id: string;
  issueId: string | null;
  estate: { id: string } | null;
}

/**
 * Una revisión de incidencia no se cierra a «hecho»: se resuelve diciendo cómo sigue la incidencia (tarea, espera, visita, vía o
 * solucionada). Cada opción es una decisión de `POST /agenda/tasks/:id/resolution`; el servidor rechaza entera la que dejaría la
 * incidencia sin siguiente paso.
 */
@Component({
  selector: 'app-review-next-step-panel',
  standalone: true,
  imports: [DropdownComponent, SelectDropdownDirective],
  template: `
    <section class="rv" aria-label="Siguiente paso de la revisión" data-testid="review-next-step">
      <h3 class="rv__title">¿Cómo sigue esta incidencia?</h3>
      <p class="rv__hint">Elige el siguiente paso para que la incidencia no se quede sin nadie al cargo.</p>
      <app-dropdown
        class="rv__select"
        ariaLabel="Cómo sigue la incidencia"
        label="Elige cómo sigue…"
        [items]="choiceItems"
        [selectedId]="choice()"
        (selectionChange)="choice.set($any($event.id))"
      ></app-dropdown>
      @if (selectedHint()) { <p class="rv__hint" data-testid="review-choice-hint">{{ selectedHint() }}</p> }

      @switch (choice()) {
        @case ('task') {
          <label class="rv__field">¿Qué hay que hacer?
            <input type="text" maxlength="300" aria-label="Qué hay que hacer" [value]="note()" (input)="note.set($any($event.target).value)" />
          </label>
          <label class="rv__field">¿Cuándo?
            <input type="datetime-local" aria-label="Fecha de la tarea" [value]="dueAt()" (input)="dueAt.set($any($event.target).value)" />
          </label>
          <div class="rv__row">
            <label class="rv__field">Prioridad
              <select aria-label="Prioridad" (change)="priority.set($any($event.target).value)">
                <option value="" [selected]="!priority()">La habitual</option>
                @for (p of priorities; track p.key) { <option [value]="p.key" [selected]="priority() === p.key">{{ p.label }}</option> }
              </select>
            </label>
            <label class="rv__field">Responsable
              <select aria-label="Responsable" (change)="assigneeId.set($any($event.target).value)">
                <option value="" [selected]="!assigneeId()">Sin asignar</option>
                @for (a of assignees(); track a.id) { <option [value]="a.id" [selected]="assigneeId() === a.id">{{ a.name }}</option> }
              </select>
            </label>
          </div>
        }
        @case ('wait') {
          <div class="rv__row">
            <label class="rv__field">¿A quién esperas?
              <select aria-label="A quién esperas" (change)="party.set($any($event.target).value); waitSupplierId.set('')">
                @for (p of parties; track p.key) { <option [value]="p.key" [selected]="party() === p.key">{{ p.label }}</option> }
              </select>
            </label>
            @if (waitSuppliers().length) {
              <label class="rv__field">Del directorio
                <select aria-label="Entidad del directorio" (change)="waitSupplierId.set($any($event.target).value)">
                  <option value="" [selected]="!waitSupplierId()">Otro (escribir el nombre)</option>
                  @for (s of waitSuppliers(); track s.id) { <option [value]="s.id" [selected]="waitSupplierId() === s.id">{{ s.name }}</option> }
                </select>
              </label>
            }
            @if (!waitSupplierId()) {
              <label class="rv__field">Nombre
                <input type="text" maxlength="200" aria-label="Nombre de quien se espera" placeholder="Mapfre, la propietaria del 3ºB…" [value]="partyLabel()" (input)="partyLabel.set($any($event.target).value)" />
              </label>
            }
          </div>
          <label class="rv__field">Avisarme si no responde en (días)
            <input type="number" min="1" max="30" aria-label="Días para volver a avisar" [value]="waitDays()" (input)="waitDays.set(+$any($event.target).value)" />
          </label>
        }
        @case ('visit') {
          <label class="rv__field">¿Quién visita?
            <select aria-label="Quién visita" (change)="visitWho.set($any($event.target).value)">
              @if (assignedProfessional()) { <option value="assigned" [selected]="visitWho() === 'assigned'">Profesional asignado: {{ assignedProfessional() }}</option> }
              @for (s of visitSuppliers(); track s.id) { <option [value]="s.id" [selected]="visitWho() === s.id">{{ s.name }}</option> }
              <option value="" [selected]="!visitWho()">Otro (escribir el nombre)</option>
            </select>
          </label>
          @if (!visitWho()) {
            <label class="rv__field">Nombre de quien visita
              <input type="text" maxlength="200" aria-label="Nombre de quien visita" [value]="visitor()" (input)="visitor.set($any($event.target).value)" />
            </label>
          }
          <label class="rv__field">Fecha y hora
            <input type="datetime-local" aria-label="Fecha de la visita" [value]="visitAt()" (input)="visitAt.set($any($event.target).value)" />
          </label>
        }
        @case ('route') {
          <label class="rv__field">Nueva vía
            <select aria-label="Nueva vía" (change)="route.set($any($event.target).value)">
              <option value="" [selected]="!route()">Elige la vía…</option>
              @for (r of routes; track r) { <option [value]="r" [selected]="route() === r">{{ routeLabels[r] }}</option> }
            </select>
          </label>
        }
        @case ('resolved') { <p class="rv__hint">Al guardar, la incidencia pasa a Resuelta.</p> }
        @case ('exists') { <p class="rv__hint">Solo vale si la incidencia ya tiene otra tarea, espera o visita pendiente.</p> }
      }

      @if (problem()) { <p class="rv__error" role="alert">{{ problem() }}</p> }
      <div class="rv__actions">
        <button type="button" class="rv__btn" data-testid="review-submit" [disabled]="busy() || !choice()" (click)="submit()">{{ busy() ? 'Guardando…' : 'Guardar siguiente paso' }}</button>
      </div>
    </section>
  `,
  styles: `
    .rv { display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--color-accent); border-radius: var(--radius-md); padding: 14px 16px; background: var(--color-surface); }
    .rv__title { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-accent); font-weight: 700; }
    .rv__hint { margin: 0; font-size: 13px; color: var(--color-muted); }
    .rv__select { display: block; }
    /* La lista se despliega en el flujo (empuja el contenido) en vez de flotar: dentro de un modal con scroll una lista flotante se corta. */
    .rv__select ::ng-deep .dd__panel--open { position: static; width: 100%; max-width: 100%; max-height: none !important; margin-top: 4px; }
    .rv__row { display: flex; gap: 12px; flex-wrap: wrap; }
    .rv__row .rv__field { flex: 1; min-width: 140px; }
    .rv__field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; color: var(--color-muted); }
    .rv__field input, .rv__field select { padding: 6px 8px; font: inherit; color: var(--color-text); background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    .rv__error { margin: 0; font-size: 13px; color: var(--color-error); }
    .rv__actions { display: flex; justify-content: flex-end; }
    .rv__btn { font: inherit; font-size: 14px; font-weight: 600; padding: 8px 14px; border-radius: var(--radius-md); border: 1px solid var(--color-primary); background: var(--color-primary); color: #fff; cursor: pointer; }
    .rv__btn:disabled { opacity: 0.6; cursor: default; }
  `,
})
export class ReviewNextStepPanelComponent {
  private readonly agenda = inject(AgendaTasksService);
  private readonly suppliersSvc = inject(SuppliersStaffService);
  private readonly issuesSvc = inject(IssuesService);

  readonly task = input.required<ReviewTaskRef>();
  readonly resolved = output<AgendaTaskDetail>();
  /** Qué se ha creado o cambiado, dicho en una frase, para que quien aloja el panel lo confirme a la persona. */
  readonly decided = output<string>();

  readonly choiceItems: DropdownItem[] = CHOICES.map((c) => ({ id: c.key, label: c.label, description: c.hint }));
  readonly selectedHint = computed(() => CHOICES.find((c) => c.key === this.choice())?.hint ?? '');
  readonly parties = PARTIES;
  readonly priorities = PRIORITIES;
  readonly routes = RESOLUTION_ROUTES;
  readonly routeLabels = ROUTE_LABEL;

  readonly choice = signal<Choice | null>(null);
  readonly note = signal('');
  readonly dueAt = signal(defaultMoment());
  readonly priority = signal('');
  readonly assigneeId = signal('');
  readonly party = signal('provider');
  readonly partyLabel = signal('');
  readonly waitDays = signal(3);
  readonly visitor = signal('');
  readonly visitAt = signal(defaultMoment());
  readonly route = signal('');
  readonly busy = signal(false);
  readonly problem = signal('');
  readonly assignees = signal<{ id: string; name: string }[]>([]);
  /** Entidades reales: el directorio de la comunidad y el profesional asignado a la incidencia (si lo hay). */
  readonly directory = signal<{ id: string; name: string; insurer: boolean }[]>([]);
  readonly assignedProfessional = signal('');
  readonly waitSupplierId = signal('');
  /** Quién visita: `''` = escribir un nombre (fallback), `'assigned'` = el profesional asignado, o el id de un proveedor. */
  readonly visitWho = signal('');
  /** Solo proveedores o aseguradoras se eligen del directorio al esperar; para propietario u otro basta el nombre. */
  readonly waitSuppliers = computed(() => {
    const party = this.party();
    return party === 'provider' || party === 'insurer' ? this.directory().filter((s) => s.insurer === (party === 'insurer')) : [];
  });
  readonly visitSuppliers = computed(() => this.directory().filter((s) => !s.insurer));

  /** Lo que se envía al servidor para la opción elegida, o el motivo por el que aún no se puede. */
  readonly built = computed<{ body: Record<string, unknown> | null; problem: string }>(() => {
    const now = Date.now();
    const future = (v: string) => Number.isFinite(new Date(v).getTime()) && new Date(v).getTime() > now;
    switch (this.choice()) {
      case 'task':
        if (!this.note().trim()) return { body: null, problem: 'Escribe qué hay que hacer.' };
        if (!future(this.dueAt())) return { body: null, problem: 'La fecha de la tarea tiene que ser futura.' };
        return {
          problem: '',
          body: {
            decision: 'schedule_follow_up',
            note: this.note().trim(),
            dueAt: new Date(this.dueAt()).toISOString(),
            ...(this.priority() ? { priority: this.priority() } : {}),
            ...(this.assigneeId() ? { assigneeUserId: this.assigneeId() } : {}),
          },
        };
      case 'wait':
        if (!this.waitSupplierId() && !this.partyLabel().trim()) return { body: null, problem: 'Indica a quién esperas.' };
        return {
          problem: '',
          body: {
            decision: 'start_wait',
            party: this.party(),
            ...(this.waitSupplierId() ? { supplierId: this.waitSupplierId() } : { partyLabel: this.partyLabel().trim() }),
            dueInHours: Math.min(Math.max(Math.round(this.waitDays() || 1), 1), 30) * 24,
          },
        };
      case 'visit':
        if (!this.visitWho() && !this.visitor().trim()) return { body: null, problem: 'Indica quién visita.' };
        if (!future(this.visitAt())) return { body: null, problem: 'La visita tiene que ser en una fecha futura.' };
        return {
          problem: '',
          body: {
            decision: 'schedule_visit',
            scheduledAt: new Date(this.visitAt()).toISOString(),
            ...(this.visitWho() === 'assigned'
              ? { useAssignedProfessional: true }
              : this.visitWho()
                ? { supplierId: this.visitWho() }
                : { visitorLabel: this.visitor().trim() }),
          },
        };
      case 'route':
        return this.route() ? { problem: '', body: { decision: 'choose_route', route: this.route() } } : { body: null, problem: 'Elige la nueva vía.' };
      case 'resolved':
        return { problem: '', body: { decision: 'mark_resolved' } };
      case 'exists':
        return { problem: '', body: { decision: 'next_step_exists' } };
      default:
        return { body: null, problem: 'Elige cómo sigue la incidencia.' };
    }
  });

  constructor() {
    void this.agenda
      .listAssignees()
      .then((people: PersonRef[]) => this.assignees.set(people.map((p) => ({ id: p.id, name: p.fullName }))))
      .catch(() => undefined);
    // Las entidades reales son una ayuda: sin ellas se sigue pudiendo escribir un nombre.
    effect(() => {
      const task = this.task();
      const estateId = task.estate?.id;
      if (estateId)
        void this.suppliersSvc
          .listSuppliers(estateId)
          .then((list) => this.directory.set(list.map((x) => ({ id: x.id, name: x.name, insurer: supplierCategoryFor(x.category).key === 'seguros' }))))
          .catch(() => undefined);
      if (task.issueId)
        void this.issuesSvc
          .currentIssueProvider(task.issueId)
          .then((a) => this.assignedProfessional.set(a?.providerNameSnapshot ?? ''))
          .catch(() => undefined);
    });
  }

  /** Lo que se va a crear, en lenguaje de persona: es la confirmación tras guardar. */
  private summary(): string {
    const day = (v: string) => new Date(v).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    const hour = (v: string) => new Date(v).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    switch (this.choice()) {
      case 'task':
        return `Tarea creada: «${this.note().trim()}» para el ${day(this.dueAt())}.`;
      case 'wait': {
        const who = this.directory().find((s) => s.id === this.waitSupplierId())?.name ?? this.partyLabel().trim();
        const days = Math.min(Math.max(Math.round(this.waitDays() || 1), 1), 30);
        return `Espera registrada con ${who}. Te avisaremos en ${days} ${days === 1 ? 'día' : 'días'} si no responde.`;
      }
      case 'visit':
        return `Visita programada el ${day(this.visitAt())} a las ${hour(this.visitAt())}.`;
      case 'route':
        return `Vía de gestión cambiada a «${this.routeLabels[this.route() as keyof typeof ROUTE_LABEL] ?? this.route()}».`;
      case 'resolved':
        return 'Incidencia marcada como resuelta.';
      default:
        return 'Siguiente paso confirmado.';
    }
  }

  async submit(): Promise<void> {
    if (this.busy()) return;
    const { body, problem } = this.built();
    this.problem.set(problem);
    if (!body) return;
    this.busy.set(true);
    try {
      const summary = this.summary();
      const updated = await this.agenda.resolve(this.task().id, body);
      this.decided.emit(summary);
      this.resolved.emit(updated);
    } catch (error) {
      const message = (error as { error?: { message?: string | string[] } })?.error?.message;
      this.problem.set(Array.isArray(message) ? message.join(' ') : (message ?? 'No se pudo cerrar la revisión. Inténtalo de nuevo.'));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Mañana a las 10:00, en el formato de `datetime-local`. */
function defaultMoment(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
