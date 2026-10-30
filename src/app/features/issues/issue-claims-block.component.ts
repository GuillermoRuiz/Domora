import { Component, computed, input, output } from '@angular/core';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';
import {
  CLAIM_STAGE_LABEL,
  CLAIM_STATUSES,
  CLAIM_STATUS_LABEL,
  ClaimStatus,
  InsuranceClaimView,
  isClaimStatus,
  isInsuranceRoute,
  isTerminalClaim,
} from '../../core/insurance-claims.models';
import { ROUTE_LABEL, isResolutionRoute } from '../../core/issue-workflow.models';

/**
 * «Seguro»: el siniestro de seguro dentro del expediente, no un módulo aparte. Enseña, por siniestro, la aseguradora, la
 * póliza, el nº de siniestro, en qué punto está y el profesional que envió la aseguradora. Las acciones son las
 * estrictamente necesarias: registrar una gestión con el seguro (que abre, actualiza o cierra el siniestro) y cambiar su
 * estado. Lo que toca hacer a continuación sigue siendo la tarea, la espera o la visita del expediente.
 */
@Component({
  selector: 'app-issue-claims-block',
  standalone: true,
  imports: [BtnComponent, SelectDropdownDirective],
  template: `
    <section class="claims" aria-labelledby="claims-title" data-testid="claims-block">
      <header class="claims__head">
        <h3 id="claims-title" class="claims__title">Seguro</h3>
        @if (routeText(); as r) { <span class="claims__route">{{ r }}</span> }
      </header>

      @if (claims().length === 0) {
        <p class="claims__empty" data-testid="claims-empty">Aún no hay un siniestro abierto con la aseguradora.</p>
      }

      @for (c of claims(); track c.id) {
        <article class="claim" [class.claim--done]="done(c)" [attr.data-claim]="c.id" [attr.data-stage]="c.stage">
          <div class="claim__main">
            <div class="claim__insurer">{{ c.insurerName }}</div>
            <div class="claim__ids">
              <span data-testid="claim-policy">{{ c.policyNumber ? 'Póliza ' + c.policyNumber : 'Sin póliza indicada' }}</span>
              <span aria-hidden="true">·</span>
              <span data-testid="claim-reference">{{ c.reference ? 'Siniestro ' + c.reference : 'Sin nº de siniestro todavía' }}</span>
            </div>
            <div class="claim__stage" data-testid="claim-stage">{{ stageLabel(c) }}</div>
            @if (c.professional; as p) {
              <div class="claim__pro" data-testid="claim-professional">Profesional: {{ p.name }}@if (p.phone) { · {{ p.phone }} }</div>
            }
          </div>
          <label class="claim__status">
            <span class="claim__status-label">Estado del siniestro</span>
            @if (done(c) || !canManage()) {
              <span class="claim__status-fixed" data-testid="claim-status">{{ statusLabels[c.status] }}</span>
            } @else {
              <select [disabled]="busy()" (change)="choose(c, $any($event.target).value)" aria-label="Estado del siniestro">
                @for (s of statuses; track s) { <option [value]="s" [selected]="c.status === s">{{ statusLabels[s] }}</option> }
              </select>
            }
          </label>
        </article>
      }

      @if (canRegister()) {
        <div class="claims__actions">
          @if (claims().length === 0) {
            <app-btn variant="primary" size="sm" (clicked)="register.emit(true)">Abrir siniestro</app-btn>
          } @else {
            <app-btn variant="outline" size="sm" (clicked)="register.emit(false)">Registrar gestión con el seguro</app-btn>
          }
        </div>
      }
    </section>
  `,
  styles: `
    .claims { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 14px 20px; display: flex; flex-direction: column; gap: 10px; }
    .claims__head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
    .claims__title { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-muted); font-weight: 700; }
    .claims__route { font-size: 13px; color: var(--color-muted); }
    .claims__empty { margin: 0; font-size: 14px; color: var(--color-muted); }
    .claim { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px 24px; flex-wrap: wrap; padding-top: 10px; border-top: 1px dashed var(--color-border); }
    .claim:first-of-type { border-top: 0; padding-top: 0; }
    .claim--done { opacity: 0.8; }
    .claim__main { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .claim__insurer { font-size: 16px; font-weight: 600; color: var(--color-text); }
    .claim__ids { display: flex; gap: 6px; flex-wrap: wrap; font-size: 14px; color: var(--color-muted); }
    .claim__stage { font-size: 14px; font-weight: 600; color: var(--color-text); }
    .claim__pro { font-size: 14px; color: var(--color-muted); }
    .claim__status { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; color: var(--color-muted); }
    .claim__status select { padding: 7px 10px; font: inherit; font-size: 14px; color: var(--color-text); background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); color-scheme: inherit; min-width: 200px; }
    .claim__status-fixed { font-size: 14px; color: var(--color-text); }
    .claims__actions { display: flex; gap: 8px; flex-wrap: wrap; }
    @media (max-width: 720px) { .claims { padding: 14px; } .claim__status, .claim__status select { width: 100%; min-width: 0; } }
  `,
})
export class IssueClaimsBlockComponent {
  /** Vía de gestión vigente (solo para recordar de cuál viene el seguro). */
  readonly route = input<string | null>(null);
  readonly claims = input<InsuranceClaimView[]>([]);
  /** La gestión puede cambiar el estado del siniestro (también con la incidencia resuelta: se cierra igualmente). */
  readonly canManage = input(true);
  /** La incidencia admite nuevas gestiones (una resuelta ya no). */
  readonly canRegister = input(true);
  readonly busy = input(false);
  /** Abre «Registrar gestión con el seguro»; `true` = para abrir el primer siniestro. */
  readonly register = output<boolean>();
  readonly statusChange = output<{ claimId: string; status: ClaimStatus }>();

  readonly statuses = CLAIM_STATUSES;
  readonly statusLabels = CLAIM_STATUS_LABEL;
  readonly routeText = computed(() => {
    const route = this.route();
    return isResolutionRoute(route) && isInsuranceRoute(route) ? ROUTE_LABEL[route] : null;
  });

  done(claim: InsuranceClaimView): boolean {
    return isTerminalClaim(claim.status);
  }
  stageLabel(claim: InsuranceClaimView): string {
    return CLAIM_STAGE_LABEL[claim.stage] ?? claim.status;
  }
  choose(claim: InsuranceClaimView, value: string): void {
    if (!isClaimStatus(value) || value === claim.status) return;
    this.statusChange.emit({ claimId: claim.id, status: value });
  }
}
