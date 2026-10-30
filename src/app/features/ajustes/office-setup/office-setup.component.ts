import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { pendingOfficeSteps, type OfficeCompletenessDetail, type OfficeSetupStepKey, type SetupWeight } from '../../../core/office-setup.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';

interface StepCopy {
  label: string;
  hint: string;
  /** Screen where the gestor fixes it; `null` when only Domora can. */
  route: string | null;
  /** Section of the Ajustes page to scroll to when `route` is that page. */
  fragment?: string;
}

const STEP_COPY: Record<OfficeSetupStepKey, StepCopy> = {
  contact: { label: 'Datos de contacto', hint: 'Persona de contacto, email y teléfono del despacho, en Ajustes › Empresa administradora.', route: '/b/settings', fragment: 'ajustes-empresa' },
  billing: { label: 'Datos de facturación', hint: 'Razón social, NIF/CIF, domicilio y email con los que te facturamos, en Ajustes › Datos de facturación.', route: '/b/settings', fragment: 'ajustes-facturacion' },
  payment: { label: 'Método de pago', hint: 'Configura el pago de tu suscripción.', route: '/b/subscription' },
  estates: { label: 'Al menos una comunidad', hint: 'Da de alta tu primera comunidad.', route: '/b/estates' },
  team: { label: 'Equipo invitado', hint: 'Invita a tus compañeros desde Ajustes › Equipo.', route: '/b/settings', fragment: 'ajustes-equipo' },
  twoFactor: { label: 'Verificación en dos pasos', hint: 'Actívala en la cuenta del usuario principal, en Ajustes › Seguridad.', route: '/b/settings', fragment: 'ajustes-seguridad' },
};

const WEIGHT_LABEL: Record<SetupWeight, string> = { required: 'Obligatorio', recommended: 'Recomendado', info: 'Opcional' };

/**
 * «Puesta en marcha del despacho» (odd/tasks/role-a-panel.md S10): the
 * despacho-level setup steps with a link to where each one is fixed. It
 * disappears once every required and recommended step is done; the optional
 * one (equipo) never keeps it on screen.
 */
@Component({
  selector: 'app-office-setup',
  standalone: true,
  imports: [SectionCardComponent, IconComponent, RouterLink],
  templateUrl: './office-setup.component.html',
  styleUrl: './office-setup.component.scss',
})
export class OfficeSetupComponent {
  readonly data = input<OfficeCompletenessDetail | null>(null);

  readonly steps = computed(() =>
    (this.data()?.officeSteps ?? []).map((step) => ({ ...step, ...STEP_COPY[step.key], weightLabel: WEIGHT_LABEL[step.weight] })),
  );
  readonly counted = computed(() => this.steps().filter((s) => s.weight !== 'info').length);
  readonly pending = computed(() => pendingOfficeSteps(this.data()?.officeSteps ?? []));
  readonly visible = computed(() => this.steps().length > 0 && this.pending() > 0);
}
