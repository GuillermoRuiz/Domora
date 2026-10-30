import { Component, OnInit, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { CUSTOM_NOTICE, CUSTOM_NOTICE_MAX, REQUESTER_TEMPLATES, RegisterInteractionBody, RequesterTemplate, buildRequesterNotice } from '../../../core/issue-interaction.builder';
import { PreviewState, RequesterNoticePreviewComponent } from '../requester-notice-preview.component';

/**
 * «Informar al solicitante»: un aviso con plantilla a la persona que reportó la incidencia (y solo a ella: nunca a todos
 * los residentes de la vivienda). Es una gestión sin contraparte externa: `POST /issues/:id/interactions` con el efecto
 * `inform_requester`.
 */
@Component({
  selector: 'app-inform-requester-dialog',
  standalone: true,
  imports: [FormsModule, SelectDropdownDirective, BtnComponent, IconComponent, RequesterNoticePreviewComponent],
  template: `
    <div class="modal-backdrop" (click)="closed.emit()">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="ir-title" (click)="$event.stopPropagation()">
        <div class="modal__header">
          <h4 id="ir-title">Informar al solicitante</h4>
          <button type="button" class="close-btn" aria-label="Cerrar" (click)="closed.emit()"><app-icon name="x" [size]="16"></app-icon></button>
        </div>
        <div class="modal__body">
          <p class="ir-intro">Se avisa solo a la persona que reportó la incidencia. Revisa el texto exacto antes de enviarlo.</p>
          <label class="ir-field">
            Mensaje
            <select name="template" aria-label="Mensaje" [ngModel]="template()" (ngModelChange)="template.set($event)">
              @for (t of templates(); track t.key) {
                <option [value]="t.key">{{ t.label }}</option>
              }
            </select>
          </label>
          @if (needsLabel()) {
            <label class="ir-field">
              ¿Con quién?
              <input type="text" maxlength="200" aria-label="Tercero" placeholder="Ascensores Levante, el seguro…" [value]="label()" (input)="label.set($any($event.target).value)" />
            </label>
          }
          @if (isCustom()) {
            <label class="ir-field">
              Escribe el mensaje
              <textarea rows="4" [attr.maxlength]="customMax" aria-label="Texto del mensaje" data-field="custom-text" placeholder="Lo que quieres contarle a quien reportó la incidencia" [value]="text()" (input)="text.set($any($event.target).value)"></textarea>
              <span class="ir-count" [class.ir-count--full]="text().length >= customMax">{{ text().length }}/{{ customMax }}</span>
            </label>
          }
          <app-requester-notice-preview
            [issueId]="issueId()"
            [template]="template()"
            [when]="visitAt()"
            [label]="needsLabel() ? label() : null"
            [text]="isCustom() ? text() : null"
            (stateChange)="previewState.set($event)"
          ></app-requester-notice-preview>
          @if (problems().length > 0) {
            <ul class="ir-problems" role="alert">@for (p of problems(); track p) { <li>{{ p }}</li> }</ul>
          }
          @if (error()) { <p class="ir-error" role="alert">{{ error() }}</p> }
        </div>
        <div class="modal__footer">
          <app-btn variant="outline" size="sm" (clicked)="closed.emit()">Cancelar</app-btn>
          <app-btn variant="primary" size="sm" [disabled]="busy() || previewState() !== 'ready'" (clicked)="submit()">{{ busy() ? 'Enviando…' : 'Enviar este aviso' }}</app-btn>
        </div>
      </div>
    </div>
  `,
  styleUrl: './inform-requester-dialog.component.scss',
})
export class InformRequesterDialogComponent implements OnInit {
  /** Incidencia sobre la que se avisa (para pedir el texto exacto al servidor). */
  readonly issueId = input.required<string>();
  /** Fecha (ISO) de la visita planificada, si la hay: sin ella no se ofrece avisar de una visita. */
  readonly visitAt = input<string | null>(null);
  /** Nombre del tercero con el que se está tratando (la espera abierta), para proponerlo. */
  readonly partyLabel = input('');
  readonly busy = input(false);
  readonly error = input('');

  readonly submitted = output<RegisterInteractionBody>();
  readonly closed = output<void>();

  /** Estado del texto exacto: solo se puede enviar con el texto a la vista. */
  readonly previewState = signal<PreviewState>('idle');
  readonly template = signal<RequesterTemplate>('third_party_contacted');
  readonly label = signal('');
  readonly text = signal('');
  readonly customMax = CUSTOM_NOTICE_MAX;
  readonly problems = signal<string[]>([]);

  readonly templates = computed(() => {
    const at = this.visitAt() ? new Date(this.visitAt()!) : null;
    const hasVisit = !!at && Number.isFinite(at.getTime()) && at.getTime() > Date.now();
    return [...REQUESTER_TEMPLATES.filter((t) => t.key !== 'visit_scheduled' || hasVisit), CUSTOM_NOTICE];
  });
  readonly isCustom = computed(() => this.template() === 'custom');
  readonly needsLabel = computed(() => this.template() === 'third_party_contacted' || this.template() === 'waiting_third_party');

  ngOnInit(): void {
    this.label.set(this.partyLabel());
    // Si hay una visita planificada, lo más probable es avisar de ella.
    const options = this.templates();
    this.template.set(options.find((t) => t.key === 'visit_scheduled')?.key ?? options[0]?.key ?? 'issue_resolved');
  }

  submit(): void {
    const built = buildRequesterNotice(this.template(), { when: this.visitAt(), label: this.label(), text: this.text() });
    if (!built.ok || !built.body) {
      this.problems.set(built.errors);
      return;
    }
    this.problems.set([]);
    this.submitted.emit(built.body);
  }
}
