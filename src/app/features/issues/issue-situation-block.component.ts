import { Component, computed, input, output } from '@angular/core';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import {
  AttentionTask,
  BALL_LABEL,
  IssueSituationView,
  SITUATION_LABEL,
  SITUATION_THEME,
  describeNextStep,
  holderText,
} from '../../core/issue-workflow.models';

/** El título de una tarea de incidencia termina en «— #INC-2026-001»: dentro del expediente sobra. */
export const taskTitleWithoutRef = (title: string): string => title.replace(/\s+—\s+#INC-[\w-]+$/i, '');

/**
 * «Situación actual»: el bloque más importante del expediente. Responde quién tiene la pelota, qué está ocurriendo,
 * qué viene después y cuándo toca actuar, a partir de la proyección del backend (nada se calcula ni se guarda aquí).
 * Si hay trabajo humano pendiente añade un aviso compacto con un enlace a la tarea: la tarea se gestiona en Tareas.
 */
@Component({
  selector: 'app-issue-situation-block',
  standalone: true,
  imports: [BtnComponent],
  template: `
    <section class="sit" [attr.data-situation]="view()?.situation ?? 'unknown'" aria-labelledby="sit-title">
      <header class="sit__head">
        <h3 id="sit-title" class="sit__title">Situación actual</h3>
        @if (view(); as v) {
          <span class="sit__pill" [class]="'sit__pill--' + theme()" data-testid="situation-label">{{ situationLabel() }}</span>
        }
      </header>

      @if (view(); as v) {
        <dl class="sit__grid">
          <div class="sit__row">
            <dt>Tiene la pelota</dt>
            <dd data-testid="ball">
              @if (v.ballInCourt.holders.length === 0) {
                <span class="sit__nobody">{{ nobodyLabel }}</span>
              } @else {
                <ul class="sit__holders">
                  @for (h of v.ballInCourt.holders; track h.refId) { <li class="sit__holder">{{ holderLabel(h) }}</li> }
                </ul>
              }
            </dd>
          </div>

          @if (v.situation !== 'requires_attention') {
            <div class="sit__row">
              <dt>Qué está ocurriendo</dt>
              <dd data-testid="happening">
                <strong>{{ text().headline }}</strong>
                <span class="sit__text">{{ text().text }}</span>
              </dd>
            </div>
            @if (v.nextStep.detail && v.situation === 'waiting_third_party') {
              <div class="sit__row">
                <dt>Qué pasará después</dt>
                <dd data-testid="after">{{ v.nextStep.detail }}</dd>
              </div>
            }
            @if (text().when) {
              <div class="sit__row">
                <dt>Cuándo toca actuar</dt>
                <dd data-testid="when">{{ text().when }}</dd>
              </div>
            }
          }
        </dl>

        @if (v.attention.count > 0 && v.attention.tasks[0]; as task) {
          <div class="sit__attention" data-testid="attention">
            <div class="sit__attention-text">
              <div class="sit__attention-kicker">Necesita tu intervención</div>
              <div class="sit__attention-title">{{ cleanTitle(task) }}</div>
              <div class="sit__attention-meta">
                @if (task.overdue) { <span class="sit__overdue">Plazo vencido</span> } @else { <span>Plazo: {{ dueLabel(task) }}</span> }
                @if (v.attention.count > 1) { <span>· y {{ v.attention.count - 1 }} más</span> }
              </div>
            </div>
            <app-btn variant="primary" size="sm" (clicked)="openTask.emit(task)">Abrir tarea</app-btn>
          </div>
        }
      } @else if (loading()) {
        <p class="sit__muted" aria-live="polite">Cargando la situación…</p>
      } @else {
        <p class="sit__muted">No se ha podido cargar la situación de la incidencia.</p>
      }
    </section>
  `,
  styles: `
    .sit { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; }
    .sit__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .sit__title { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-muted); font-weight: 700; }
    .sit__pill { font-size: 13px; font-weight: 700; padding: 4px 12px; border-radius: 999px; }
    .sit__pill--red { background: var(--color-error-bg); color: var(--color-error); }
    .sit__pill--orange { background: var(--color-orange-bg); color: var(--color-orange); }
    .sit__pill--blue { background: var(--color-blue-bg); color: var(--color-blue); }
    .sit__pill--gold { background: var(--color-warning-bg); color: var(--color-warning); }
    .sit__pill--purple { background: var(--color-purple-bg); color: var(--color-purple); }
    .sit__pill--green { background: var(--color-secondary-bg); color: var(--color-secondary); }
    .sit__pill--gray { background: var(--color-border-light); color: var(--color-muted); }
    .sit__grid { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 28px; }
    .sit__row { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .sit__row dt { font-size: 12px; color: var(--color-muted); font-weight: 600; }
    .sit__row dd { margin: 0; font-size: 15px; color: var(--color-text); display: flex; flex-direction: column; gap: 2px; overflow-wrap: anywhere; }
    .sit__text { font-size: 14px; color: var(--color-muted); }
    .sit__holders { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .sit__holder { font-size: 14px; font-weight: 600; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: 999px; padding: 3px 11px; }
    .sit__nobody, .sit__muted { color: var(--color-light); font-size: 14px; margin: 0; }
    .sit__attention { display: flex; align-items: center; justify-content: space-between; gap: 14px; border: 1px solid var(--color-accent); background: var(--color-bg); border-radius: var(--radius-md); padding: 12px 14px; }
    .sit__attention-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .sit__attention-kicker { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-accent); font-weight: 700; }
    .sit__attention-title { font-size: 15px; font-weight: 600; color: var(--color-text); overflow-wrap: anywhere; }
    .sit__attention-meta { font-size: 13px; color: var(--color-muted); display: flex; gap: 6px; flex-wrap: wrap; }
    .sit__overdue { color: var(--color-error); font-weight: 600; }
    @media (max-width: 720px) {
      .sit { padding: 14px 14px; }
      .sit__grid { grid-template-columns: 1fr; }
      .sit__attention { flex-direction: column; align-items: stretch; }
    }
  `,
})
export class IssueSituationBlockComponent {
  readonly view = input<IssueSituationView | null>(null);
  readonly loading = input(false);
  readonly openTask = output<AttentionTask>();

  readonly nobodyLabel = BALL_LABEL.nobody;
  readonly situationLabel = computed(() => (this.view() ? SITUATION_LABEL[this.view()!.situation] : ''));
  readonly theme = computed(() => (this.view() ? SITUATION_THEME[this.view()!.situation] : 'gray'));
  readonly text = computed(() => {
    const v = this.view();
    return v ? describeNextStep(v.nextStep, v.situation) : { headline: '', text: '', when: null };
  });

  holderLabel = holderText;
  cleanTitle(task: AttentionTask): string {
    return taskTitleWithoutRef(task.title);
  }
  dueLabel(task: AttentionTask): string {
    return new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' }).format(new Date(task.dueAt));
  }
}
