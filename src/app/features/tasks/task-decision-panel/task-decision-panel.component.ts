import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { AgendaTaskDetail } from '../../../core/agenda-tasks.model';
import { AgendaTasksService } from '../../../core/agenda-tasks.service';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';

export interface DecisionOption {
  decision: string;
  label: string;
  primary?: boolean;
}

/**
 * Decisiones que una persona puede tomar en cada tipo de tarea de incidencia (`POST /agenda/tasks/:id/resolution`).
 * Las decisiones válidas y su efecto los fija el backend por tipo de tarea (`task-kind.dtos.ts`); esto solo les pone
 * nombre. Un tipo que no esté aquí (p. ej. `approve_quote`, cuya resolución el backend aún no admite) no ofrece
 * botones: nada se simula.
 */
export const DECISIONS: Record<string, DecisionOption[]> = {
  confirm_visit_outcome: [
    { decision: 'completed', label: 'Se realizó', primary: true },
    { decision: 'cancelled', label: 'No se realizó / se canceló' },
  ],
  chase_provider: [
    { decision: 'wait_more', label: 'Seguir esperando', primary: true },
    { decision: 'contacted', label: 'Ya le he reclamado yo' },
    { decision: 'dismiss', label: 'Ya no espero respuesta' },
  ],
  inform_requester: [
    { decision: 'send', label: 'Informar al solicitante', primary: true },
    { decision: 'dismiss', label: 'No informar' },
  ],
};

/** Plazos para volver a avisar al seguir esperando (`extendHours` del backend, 1–720). */
export const EXTEND_CHOICES = [
  { hours: 0, label: 'Plazo habitual' },
  { hours: 24, label: 'En 1 día' },
  { hours: 72, label: 'En 3 días' },
  { hours: 168, label: 'En 1 semana' },
];

/**
 * Decisión pendiente de una tarea abierta por Domora (aprobar una consulta, confirmar una visita, reclamar…).
 * Es lo que vive en Tareas: la incidencia solo enlaza aquí. En «aprobar consulta» enseña el mensaje y las fotos de
 * la incidencia; la persona elige expresamente cuáles adjuntar (ninguna viene marcada) y el servidor es quien decide
 * si se envían (con autonomía 2/3 nunca se adjunta nada de forma automática).
 */
@Component({
  selector: 'app-task-decision-panel',
  standalone: true,
  imports: [NgTemplateOutlet, SelectDropdownDirective],
  template: `
    @if (options().length > 0) {
      <section class="decision" aria-label="Decisión pendiente">
        <div class="decision__head">
          <h3 class="decision__title">Decisión pendiente</h3>
          @if (!isChase()) {
            <ng-container *ngTemplateOutlet="buttons"></ng-container>
          }
        </div>

        @if (isChase()) {
          <label class="decision__extend">
            Volver a avisarme
            <select [value]="extendHours()" (change)="extendHours.set(+$any($event.target).value)" aria-label="Plazo para volver a avisar">
              @for (c of extendChoices; track c.hours) { <option [value]="c.hours">{{ c.label }}</option> }
            </select>
          </label>
        }

        @if (error()) { <p class="decision__error" role="alert">{{ error() }}</p> }

        @if (isChase()) {
          <ng-container *ngTemplateOutlet="buttons"></ng-container>
        }
      </section>
    }

    <ng-template #buttons>
      <div class="decision__actions">
        @for (o of options(); track o.decision) {
          <button type="button" class="decision__btn" [class.decision__btn--primary]="o.primary" [disabled]="busy()" (click)="decide(o)">{{ o.label }}</button>
        }
      </div>
    </ng-template>
  `,
  styles: `
    .decision { display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--color-accent); border-radius: var(--radius-md); padding: 14px 16px; background: var(--color-surface); }
    .decision__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .decision__title { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-accent); font-weight: 700; }
    .decision__label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted); font-weight: 600; margin-bottom: 4px; }
    .decision__subject { font-weight: 600; color: var(--color-text); }
    .decision__body { margin: 4px 0 0; white-space: pre-wrap; font-size: 14px; line-height: 1.55; background: var(--color-bg); border-radius: 9px; padding: 12px 14px; color: var(--color-text); }
    .decision__grid { display: flex; flex-wrap: wrap; gap: 8px; }
    .decision__photo { position: relative; display: block; width: 104px; height: 76px; border-radius: 9px; overflow: hidden; border: 2px solid var(--color-border); cursor: pointer; }
    .decision__photo--on { border-color: var(--color-accent); }
    .decision__photo img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .decision__photo input { position: absolute; top: 6px; left: 6px; z-index: 1; width: 18px; height: 18px; }
    .decision__hint { margin: 4px 0 0; font-size: 13px; color: var(--color-muted); }
    .decision__error { margin: 0; font-size: 13px; color: var(--color-error); }
    .decision__extend { display: flex; flex-direction: column; gap: 4px; font-size: 13px; font-weight: 600; color: var(--color-muted); max-width: 220px; }
    .decision__extend select { padding: 6px 8px; font: inherit; color: var(--color-text); background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    .decision__actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .decision__btn { font: inherit; font-size: 14px; font-weight: 600; padding: 8px 14px; border-radius: var(--radius-md); border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); cursor: pointer; }
    .decision__btn--primary { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
    .decision__btn:disabled { opacity: 0.6; cursor: default; }
    @media (max-width: 600px) { .decision__actions { flex-direction: column; } .decision__btn { width: 100%; } }
  `,
})
export class TaskDecisionPanelComponent {
  private readonly agenda = inject(AgendaTasksService);

  readonly task = input.required<AgendaTaskDetail>();
  readonly resolved = output<AgendaTaskDetail>();

  readonly extendChoices = EXTEND_CHOICES;
  readonly options = computed(() => {
    return DECISIONS[this.task().kind ?? ''] ?? [];
  });
  readonly isChase = computed(() => this.task().kind === 'chase_provider');
  readonly extendHours = signal(0);
  readonly busy = signal(false);
  readonly error = signal('');

  async decide(option: DecisionOption): Promise<void> {
    if (this.busy()) return;
    const result: Record<string, unknown> = { decision: option.decision };
    if (this.isChase() && option.decision !== 'dismiss' && this.extendHours() > 0) result['extendHours'] = this.extendHours();
    this.busy.set(true);
    this.error.set('');
    try {
      this.resolved.emit(await this.agenda.resolve(this.task().id, result));
    } catch (error) {
      const message = (error as { error?: { message?: string | string[] } })?.error?.message;
      this.error.set(Array.isArray(message) ? message.join(' ') : (message ?? 'No se pudo completar la decisión. Inténtalo de nuevo.'));
    } finally {
      this.busy.set(false);
    }
  }
}
