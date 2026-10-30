import { Component, computed, input, output, signal } from '@angular/core';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { IssueVisitView } from '../../core/issue-visits.service';

const dayTime = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/Madrid',
});

/**
 * «Visitas»: las visitas del expediente, también las de un profesional que no es proveedor de la comunidad, con lo mínimo para
 * que ninguna se quede sin salida — dar su resultado, cancelarla (aunque sea futura) o cambiarle la hora. Es la misma operación
 * del servidor que usa la tarea «confirmar el resultado»; aquí no se interpreta nada: el servidor decide si procede.
 */
@Component({
  selector: 'app-issue-visits-block',
  standalone: true,
  imports: [BtnComponent],
  template: `
    <section class="visits" aria-labelledby="visits-title" data-testid="visits-block">
      <header class="visits__head">
        <h3 id="visits-title" class="visits__title">Visitas</h3>
      </header>

      @for (v of visits(); track v.id) {
        <article class="visit" [class.visit--done]="v.status !== 'planificada'" [attr.data-visit]="v.id" [attr.data-status]="v.status">
          <div class="visit__main">
            <div class="visit__who">{{ v.professionalName ?? 'Profesional' }}@if (v.sentByInsurer) { <span class="visit__tag">enviado por el seguro</span> }</div>
            <div class="visit__when" data-testid="visit-when">{{ when(v) }}</div>
            <div class="visit__state" data-testid="visit-state" [class.visit__state--warn]="v.overdue">{{ stateLabel(v) }}</div>
          </div>

          @if (v.status === 'planificada' && canManage()) {
            @if (editingId() === v.id) {
              <div class="visit__edit">
                <label class="visit__field">
                  Nueva fecha y hora
                  <input type="datetime-local" aria-label="Nueva fecha y hora de la visita" [value]="editValue()" (input)="editValue.set($any($event.target).value)" />
                </label>
                @if (localError()) { <p class="visit__error" role="alert" data-testid="visit-local-error">{{ localError() }}</p> }
                <div class="visit__actions">
                  <app-btn variant="primary" size="sm" [disabled]="busy()" (clicked)="saveReschedule(v)">Guardar</app-btn>
                  <app-btn variant="outline" size="sm" (clicked)="stopEditing()">Volver</app-btn>
                </div>
              </div>
            } @else {
              <div class="visit__actions">
                <app-btn variant="primary" size="sm" [disabled]="busy()" (clicked)="outcome.emit({ visitId: v.id, outcome: 'completed' })">Se realizó</app-btn>
                <app-btn variant="outline" size="sm" [disabled]="busy()" (clicked)="startEditing(v)">Reprogramar</app-btn>
                <app-btn variant="outline" size="sm" [disabled]="busy()" (clicked)="outcome.emit({ visitId: v.id, outcome: 'cancelled' })">{{ v.overdue ? 'No se realizó' : 'Cancelar visita' }}</app-btn>
              </div>
            }
          }
        </article>
      }

      @if (error()) { <p class="visit__error" role="alert" data-testid="visits-error">{{ error() }}</p> }
    </section>
  `,
  styles: `
    .visits { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 14px 20px; display: flex; flex-direction: column; gap: 10px; }
    .visits__title { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-muted); font-weight: 700; }
    .visit { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px 24px; flex-wrap: wrap; padding-top: 10px; border-top: 1px dashed var(--color-border); }
    .visit:first-of-type { border-top: 0; padding-top: 0; }
    .visit--done { opacity: 0.8; }
    .visit__main { flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .visit__who { font-size: 16px; font-weight: 600; color: var(--color-text); }
    .visit__tag { margin-left: 8px; font-size: 12px; font-weight: 600; color: var(--color-muted); }
    .visit__when { font-size: 14px; color: var(--color-muted); }
    .visit__state { font-size: 14px; font-weight: 600; color: var(--color-text); }
    .visit__state--warn { color: var(--color-error); }
    .visit__edit { display: flex; flex-direction: column; gap: 8px; }
    .visit__field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--color-muted); }
    .visit__field input { padding: 7px 10px; font: inherit; font-size: 14px; color: var(--color-text); background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); color-scheme: inherit; }
    .visit__actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .visit__error { margin: 0; font-size: 13px; color: var(--color-error); }
    @media (max-width: 720px) { .visits { padding: 14px; } }
  `,
})
export class IssueVisitsBlockComponent {
  readonly visits = input<IssueVisitView[]>([]);
  /** La incidencia admite cambios en sus visitas (una terminada ya las canceló). */
  readonly canManage = input(true);
  readonly busy = input(false);
  /** Lo que rechazó el servidor, en claro. */
  readonly error = input('');
  readonly outcome = output<{ visitId: string; outcome: 'completed' | 'cancelled' }>();
  readonly reschedule = output<{ visitId: string; scheduledAt: string }>();

  readonly editingId = signal<string | null>(null);
  readonly editValue = signal('');
  readonly localError = signal('');
  readonly hasVisits = computed(() => this.visits().length > 0);

  when(v: IssueVisitView): string {
    const text = dayTime.format(new Date(v.scheduledAt));
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  stateLabel(v: IssueVisitView): string {
    if (v.status === 'realizada') return 'Realizada';
    if (v.status === 'cancelada') return 'Cancelada';
    return v.overdue ? 'Pasó su hora: indica qué ocurrió' : 'Planificada';
  }

  startEditing(v: IssueVisitView): void {
    this.localError.set('');
    this.editValue.set(toLocalInput(new Date(v.scheduledAt)));
    this.editingId.set(v.id);
  }

  stopEditing(): void {
    this.editingId.set(null);
    this.localError.set('');
  }

  saveReschedule(v: IssueVisitView): void {
    const at = new Date(this.editValue());
    if (!this.editValue() || !Number.isFinite(at.getTime())) {
      this.localError.set('Indica la nueva fecha y hora.');
      return;
    }
    if (at.getTime() <= Date.now()) {
      this.localError.set('La visita tiene que ser en una fecha futura.');
      return;
    }
    this.localError.set('');
    this.editingId.set(null);
    this.reschedule.emit({ visitId: v.id, scheduledAt: at.toISOString() });
  }
}

/** `Date` → valor de un `datetime-local` (hora local, sin zona). */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
