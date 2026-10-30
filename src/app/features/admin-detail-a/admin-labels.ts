import type { ClientStatus, EstateSetupStepKey, HealthSignalKey, PaymentStatus } from '../../core/models';
import type { OfficeSetupStepKey, SetupWeight } from '../../core/office-setup.service';

/** Labels and badge variants shared by the despachos list and the ficha 360° (odd/tasks/role-a-panel.md S4, S6, S10, S14). */

export type BadgeVariant = 'green' | 'warning' | 'error' | 'default' | 'primary';

export const CLIENT_STATUSES: ClientStatus[] = ['En prueba', 'En onboarding', 'Activo', 'Suspendido', 'Cancelado'];
export const PAYMENT_STATUSES: PaymentStatus[] = ['Al día', 'Pendiente', 'Vencido', 'Fallido'];

export function clientStatusVariant(status: ClientStatus | undefined | null): BadgeVariant {
  if (status === 'Activo') return 'green';
  if (status === 'En onboarding') return 'warning';
  if (status === 'Suspendido') return 'error';
  return 'default';
}

export function paymentStatusVariant(status: PaymentStatus | undefined | null): BadgeVariant {
  if (status === 'Al día') return 'green';
  if (status === 'Pendiente') return 'warning';
  if (status === 'Vencido' || status === 'Fallido') return 'error';
  return 'default';
}

export function fmtEur(n: number): string {
  return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

/** Whole percentage for tables and headers: 62.5 → «63 %». */
export function fmtPct(n: number): string {
  return `${Math.round(n)} %`;
}

export const OFFICE_STEP_LABEL: Record<OfficeSetupStepKey, string> = {
  contact: 'Datos de contacto',
  billing: 'Datos de facturación',
  payment: 'Método de pago',
  estates: 'Al menos una comunidad',
  team: 'Equipo invitado',
  twoFactor: 'Verificación en dos pasos del usuario principal',
};

export const ESTATE_STEP_LABEL: Record<EstateSetupStepKey, string> = {
  fiscal: 'CIF de la comunidad',
  properties: 'Propiedades',
  quotas: 'Cuotas mensuales',
  coefficients: 'Coeficientes de participación',
  owners: 'Titulares',
  sepa: 'Acreedor SEPA',
  opening: 'Saldos iniciales',
  linked: 'Propietarios en la app',
};

export const WEIGHT_LABEL: Record<SetupWeight, string> = { required: 'Obligatorio', recommended: 'Recomendado', info: 'Opcional' };

export const SIGNAL_LABEL: Record<HealthSignalKey, string> = {
  payment: 'Pagos',
  usage: 'Uso de la plataforma',
  completeness: 'Completitud',
  support: 'Incidencias de soporte',
};

/** Salud index without decimals: 55.6 → «56». */
export function fmtScore(n: number): string {
  return String(Math.round(n));
}
