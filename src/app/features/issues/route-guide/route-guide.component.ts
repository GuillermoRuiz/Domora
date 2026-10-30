import { Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { RESOLUTION_ROUTES, ROUTE_LABEL, ResolutionRoute } from '../../../core/issue-workflow.models';

export type RouteCovered = 'yes' | 'no' | 'unsure';
export type RouteDoer = 'provider' | 'admin' | 'owner';

export interface RouteAnswers {
  covered?: RouteCovered;
  doer?: RouteDoer;
}

export interface RouteRecommendation {
  route: ResolutionRoute;
  reason: string;
}

/**
 * La vía que recomiendan las respuestas, o `null` si todavía faltan respuestas. Es solo una guía: la vía la elige una
 * persona y puede cambiarla en el desplegable.
 */
export function recommendRoute(a: RouteAnswers): RouteRecommendation | null {
  if (a.covered === 'yes') {
    return { route: 'community_insurance', reason: 'Daño sobrevenido en un elemento común: puede cubrirlo la póliza de la comunidad.' };
  }
  if (a.covered !== 'no' && a.covered !== 'unsure') return null;
  if (a.doer === 'provider') return { route: 'community_provider', reason: 'Lo resuelve un proveedor de la comunidad, sin pasar por el seguro.' };
  if (a.doer === 'admin') return { route: 'direct_management', reason: 'La administración lo gestiona directamente.' };
  if (a.doer === 'owner') return { route: 'owner_insurance', reason: 'Lo causó un propietario o una vivienda: corresponde a él y a su seguro.' };
  return null;
}

/**
 * Preguntas (desplegables) para elegir la vía de gestión («Resolver vía») y desplegable con la vía elegida. Las respuestas proponen una vía
 * y la dejan elegida; el desplegable permite cambiarla a mano en cualquier momento.
 */
@Component({
  selector: 'app-route-guide',
  standalone: true,
  imports: [FormsModule, SelectDropdownDirective],
  template: `
    @if (showQuestions()) {
      <div class="row">
        <label class="pick" data-q="covered">
          <span class="pick__label">¿Es un daño por agua, incendio, robo, vandalismo o fenómeno atmosférico?</span>
          <select aria-label="Tipo de daño" (change)="answer({ covered: $any($event.target).value || undefined })">
            <option value="" [selected]="!answers().covered">Selecciona una respuesta</option>
            <option value="yes" [selected]="answers().covered === 'yes'">Sí</option>
            <option value="no" [selected]="answers().covered === 'no'">No, es una avería o desgaste</option>
            <option value="unsure" [selected]="answers().covered === 'unsure'">No lo sé</option>
          </select>
        </label>
        @if (answers().covered === 'no' || answers().covered === 'unsure') {
          <label class="pick" data-q="doer">
            <span class="pick__label">¿Quién lo va a resolver?</span>
            <select aria-label="Quién lo resuelve" (change)="answer({ doer: $any($event.target).value || undefined })">
              <option value="" [selected]="!answers().doer">Selecciona una respuesta</option>
              <option value="provider" [selected]="answers().doer === 'provider'">Un proveedor de la comunidad</option>
              <option value="admin" [selected]="answers().doer === 'admin'">La propia administración</option>
              <option value="owner" [selected]="answers().doer === 'owner'">El propietario responsable (con su seguro)</option>
            </select>
          </label>
        }
      </div>
      @if (recommendation(); as rec) {
        <p class="rec" data-testid="route-recommendation"><strong>{{ labels[rec.route] }}.</strong> {{ rec.reason }}</p>
      }
    }
    <label class="pick">
      <span class="pick__label">Vía de gestión</span>
      <select name="route" aria-label="Vía de gestión" data-field="route" [class.invalid]="invalid()" [ngModel]="route() ?? ''" (ngModelChange)="pick($event)">
        <option value="">Selecciona una vía</option>
        @for (r of routes; track r) { <option [value]="r">{{ labels[r] }}</option> }
      </select>
    </label>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 12px; }
    /* Una pregunta por línea. */
    .row { display: flex; flex-direction: column; gap: 12px; }
    .rec { margin: 0; padding: 10px 12px; font-size: 13px; line-height: 1.45; color: var(--color-text); background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); }
    .pick { display: flex; flex-direction: column; gap: 5px; }
    .pick__label { font-size: 13px; font-weight: 600; color: var(--color-muted); }
    .pick select { padding: 9px 12px; font: inherit; font-size: 14px; color: var(--color-text); background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); color-scheme: inherit; }
    .pick select.invalid { border-color: var(--color-error); }
  `,
})
export class RouteGuideComponent {
  /** La vía elegida (`null` = todavía ninguna). */
  readonly route = model<ResolutionRoute | null>(null);
  /** El motivo de la vía cuando viene de las respuestas; vacío si se eligió a mano. */
  readonly reason = model('');
  /** Enseñar las preguntas (si no, solo el desplegable). */
  readonly showQuestions = input(true);
  readonly invalid = input(false);

  readonly routes = RESOLUTION_ROUTES;
  readonly labels = ROUTE_LABEL;
  readonly answers = signal<RouteAnswers>({});
  readonly recommendation = computed(() => recommendRoute(this.answers()));

  answer(patch: RouteAnswers): void {
    // Cambiar la primera respuesta invalida la segunda, que dependía de ella.
    const next: RouteAnswers = 'covered' in patch ? { covered: patch.covered } : { ...this.answers(), ...patch };
    this.answers.set(next);
    const rec = recommendRoute(next);
    if (rec) {
      this.route.set(rec.route);
      this.reason.set(rec.reason);
    }
  }

  pick(value: string): void {
    this.route.set((RESOLUTION_ROUTES as readonly string[]).includes(value) ? (value as ResolutionRoute) : null);
    this.reason.set('');
  }
}
