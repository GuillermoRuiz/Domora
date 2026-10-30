import type { ClientStatus, PaymentStatus } from '../../../core/models';
import type { StatusTone } from '../../../shared/components/status-pill/status-pill.component';

/** Client status and payment status are separate pills (S6): an Activo client can still owe an invoice. */
export const CLIENT_STATUS_TONE: Record<ClientStatus, StatusTone> = {
  'En prueba': 'info',
  'En onboarding': 'info',
  Activo: 'positive',
  Suspendido: 'danger',
  Cancelado: 'neutral',
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, StatusTone> = {
  'Al día': 'positive',
  Pendiente: 'neutral',
  Fallido: 'warning',
  Vencido: 'danger',
};

const PERCENT = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

/** 62.5 → «62,5 %». */
export function formatPercent(value: number): string {
  return `${PERCENT.format(value)} %`;
}
