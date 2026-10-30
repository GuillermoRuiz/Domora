import { Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { EstateSetupStatus, EstateSetupStep, EstateSetupStepKey } from '../../../core/models';

/** Lo que la tarjeta pide hacer; quien la monta decide cómo (modal, pestaña, navegación). */
export type EstateSetupAction =
  | 'edit-estate'
  | 'add-property'
  | 'import-properties'
  | 'review-properties'
  | 'import-owners'
  | 'open-sepa'
  | 'open-opening-balances'
  | 'recalculate-coefficients';

interface StepAction {
  label: string;
  action: EstateSetupAction;
}

interface StepView {
  key: EstateSetupStepKey;
  title: string;
  detail: string;
  status: EstateSetupStep['status'];
  optional: boolean;
  actions: StepAction[];
}

function countLabel(step: EstateSetupStep, noun: string): string {
  return `${step.done ?? 0} de ${step.total ?? 0} ${noun}`;
}

/** Textos y acciones de cada paso. El backend solo manda claves y contadores. */
function describe(step: EstateSetupStep, invitableOwners: number): Omit<StepView, 'key' | 'status' | 'optional'> {
  const done = step.status === 'done';
  switch (step.key) {
    case 'fiscal':
      return {
        title: 'CIF de la comunidad',
        detail: done ? 'Informado.' : 'Sale en el certificado de deudas y en los documentos de la comunidad.',
        actions: done ? [] : [{ label: 'Añadir CIF', action: 'edit-estate' }],
      };
    case 'properties':
      return {
        title: 'Propiedades',
        detail: done
          ? `${step.done} dadas de alta.`
          : 'Viviendas, locales, garajes y trasteros: a mano o importándolos desde otro programa.',
        actions: done ? [] : [
          { label: 'Importar', action: 'import-properties' },
          { label: 'Añadir propiedad', action: 'add-property' },
        ],
      };
    case 'quotas':
      return {
        title: 'Cuotas mensuales',
        detail: done
          ? 'Todas las propiedades tienen cuota.'
          : `${countLabel(step, 'con cuota')}. Sin cuota, una propiedad no entra en la generación de recibos.`,
        actions: done ? [] : [{ label: 'Revisar propiedades', action: 'review-properties' }],
      };
    case 'coefficients':
      return {
        title: 'Coeficientes de participación',
        detail: done
          ? 'Informados y suman 100 %.'
          : `${countLabel(step, 'informados')}. Deben sumar 100 %: se usan en el quórum y las votaciones de junta.`,
        actions: done ? [] : [
          { label: 'Recalcular por m²', action: 'recalculate-coefficients' },
          { label: 'Revisar propiedades', action: 'review-properties' },
        ],
      };
    case 'owners':
      return {
        title: 'Titulares',
        detail: done
          ? 'Todas las propiedades tienen propietario.'
          : `${countLabel(step, 'con propietario')}. Se usan como titulares de los recibos.`,
        actions: done ? [] : [
          { label: 'Importar propietarios', action: 'import-owners' },
          { label: 'Revisar propiedades', action: 'review-properties' },
        ],
      };
    case 'sepa':
      return {
        title: 'Acreedor SEPA',
        detail: done
          ? 'Identificador, IBAN y BIC configurados.'
          : 'Identificador de acreedor, IBAN y BIC de la comunidad: necesarios para cobrar recibos por domiciliación.',
        actions: done ? [] : [{ label: 'Configurar SEPA', action: 'open-sepa' }],
      };
    case 'opening':
      return {
        title: 'Saldos iniciales',
        detail: done
          ? 'El asiento de apertura ya está contabilizado (o se confirmó que no hay saldos previos).'
          : 'Deudas, anticipos y saldos bancarios de antes de empezar con Domora, como un único asiento de apertura.',
        actions: done ? [] : [{ label: 'Configurar saldos iniciales', action: 'open-opening-balances' }],
      };
    case 'linked': {
      const invitable = invitableOwners > 0
        ? ` ${invitableOwners} propietario${invitableOwners === 1 ? '' : 's'} importado${invitableOwners === 1 ? '' : 's'} con email aún sin cuenta: invítalos desde el menú de cada propiedad.`
        : '';
      return {
        title: 'Propietarios en la app',
        detail: `${step.done ?? 0} con cuenta en Domora.${invitable}`,
        actions: invitableOwners > 0 ? [{ label: 'Ver propiedades', action: 'review-properties' }] : [],
      };
    }
  }
}

/**
 * "Puesta en marcha" de una finca: qué falta para poder operarla. Solo
 * presenta — el estado lo calcula el backend (`EstateSetupService`) y las
 * acciones las resuelve el componente que la monta, que sabe qué modal o
 * pestaña abrir. Un checklist y no un asistente lineal: los pasos se hacen
 * en cualquier orden y una importación completa varios a la vez.
 */
@Component({
  selector: 'app-estate-setup-card',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './estate-setup-card.component.html',
  styleUrl: './estate-setup-card.component.scss',
})
export class EstateSetupCardComponent {
  status = input.required<EstateSetupStatus>();
  action = output<EstateSetupAction>();

  progressPct = computed(() => {
    const s = this.status();
    return s.requiredTotal === 0 ? 0 : Math.round((s.requiredDone / s.requiredTotal) * 100);
  });

  steps = computed<StepView[]>(() => {
    const s = this.status();
    return s.steps.map((step) => ({
      key: step.key,
      status: step.status,
      optional: step.weight !== 'required',
      ...describe(step, s.invitableOwners),
    }));
  });

}
