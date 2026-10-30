import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { IssueWorkflowService, RequesterNoticePreview } from '../../core/issue-workflow.service';

export type PreviewState = 'idle' | 'loading' | 'ready' | 'error';

const DEBOUNCE_MS = 250;

/**
 * El texto EXACTO que recibirá quien reportó la incidencia, pedido al servidor (`POST /issues/:id/requester-notices/
 * preview`): el mismo renderizado que el envío real, sin duplicar ninguna plantilla en el frontend y sin enviar nada. Se
 * vuelve a pedir cuando cambia lo que lo determina (plantilla, fecha, nombre del tercero). Mientras no se pueda
 * redactar (falta la fecha o el nombre) no pide nada.
 */
@Component({
  selector: 'app-requester-notice-preview',
  standalone: true,
  template: `
    @if (preview(); as p) {
      <div class="rnp" data-testid="notice-preview" [class.rnp--stale]="state() === 'loading'">
        <div class="rnp__kicker">Se enviará exactamente este texto</div>
        <div class="rnp__title">{{ p.title }}</div>
        <p class="rnp__body">{{ p.body }}</p>
      </div>
    } @else if (state() === 'loading') {
      <p class="rnp__hint" aria-live="polite">Preparando el texto…</p>
    } @else if (error()) {
      <p class="rnp__error" role="alert" data-testid="notice-preview-error">{{ error() }}</p>
    }
  `,
  styles: `
    .rnp { border: 1px dashed var(--color-border); border-radius: var(--radius-md); padding: 10px 12px; background: var(--color-bg); }
    .rnp--stale { opacity: 0.6; }
    .rnp__kicker { font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted); font-weight: 700; }
    .rnp__title { margin-top: 4px; font-size: 14px; font-weight: 700; color: var(--color-text); }
    .rnp__body { margin: 2px 0 0; font-size: 14px; line-height: 1.5; color: var(--color-text); white-space: pre-wrap; overflow-wrap: anywhere; }
    .rnp__hint { margin: 0; font-size: 13px; color: var(--color-muted); }
    .rnp__error { margin: 0; font-size: 13px; color: var(--color-error); }
  `,
})
export class RequesterNoticePreviewComponent {
  private readonly workflow = inject(IssueWorkflowService);

  readonly issueId = input.required<string>();
  readonly template = input<string | null>(null);
  /** Fecha (ISO) de la visita, para la plantilla de visita. */
  readonly when = input<string | null>(null);
  /** Nombre del tercero, para las plantillas que lo nombran. */
  readonly label = input<string | null>(null);
  /** El mensaje escrito por la gestión, para la plantilla libre. */
  readonly text = input<string | null>(null);

  /** Estado y texto vigentes, para que quien lo aloja decida si se puede confirmar. */
  readonly stateChange = output<PreviewState>();
  readonly previewChange = output<RequesterNoticePreview | null>();

  readonly preview = signal<RequesterNoticePreview | null>(null);
  readonly state = signal<PreviewState>('idle');
  readonly error = signal('');
  private sequence = 0;

  constructor() {
    effect((onCleanup) => {
      const issueId = this.issueId();
      const template = this.template();
      const when = this.when();
      const label = (this.label() ?? '').trim();
      const text = (this.text() ?? '').trim();
      const needsWhen = template === 'visit_scheduled';
      const needsLabel = template === 'third_party_contacted' || template === 'waiting_third_party';
      const needsText = template === 'custom';
      if (!template || (needsWhen && !when) || (needsLabel && !label) || (needsText && !text)) {
        untracked(() => this.set('idle', null, ''));
        return;
      }
      const mine = ++this.sequence;
      // Lo que se ve ya no es lo que se enviaría: no se puede confirmar hasta tener el texto nuevo.
      untracked(() => this.set('loading', this.preview(), ''));
      const timer = setTimeout(async () => {
        try {
          const result = await this.workflow.previewRequesterNotice(issueId, {
            template,
            ...(needsWhen && when ? { when } : {}),
            ...(needsLabel ? { label } : {}),
            ...(needsText ? { text } : {}),
          });
          if (mine === this.sequence) this.set('ready', result, '');
        } catch (error) {
          if (mine !== this.sequence) return;
          const message = (error as { error?: { message?: string | string[] } })?.error?.message;
          this.set('error', null, Array.isArray(message) ? message.join(' ') : (message ?? 'No se ha podido preparar el texto.'));
        }
      }, DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  private set(state: PreviewState, preview: RequesterNoticePreview | null, error: string): void {
    this.state.set(state);
    this.preview.set(preview);
    this.error.set(error);
    this.stateChange.emit(state);
    this.previewChange.emit(state === 'ready' ? preview : null);
  }
}
