import { Component, computed, input, output } from '@angular/core';
import type { AccountingReceipt } from '../../../core/models';
import { SectionCardComponent } from '../../../shared/components/section-card/section-card.component';
import { StatusPillComponent, type StatusTone } from '../../../shared/components/status-pill/status-pill.component';

/** Cuántos recibos enseña la tarjeta. */
const VISIBLE = 4;
/** Recibos que el propietario todavía tiene que pagar (o volver a pagar). */
const PAYABLE = new Set(['Pendiente', 'Parcial', 'Devuelto']);

const STATUS: Record<string, { text: string; tone: StatusTone }> = {
  Pagada: { text: 'Pagado', tone: 'positive' },
  Pendiente: { text: 'Pendiente', tone: 'warning' },
  Parcial: { text: 'Parcial', tone: 'warning' },
  Devuelto: { text: 'Devuelto', tone: 'danger' },
};

const EURO = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

/** Lo que se quiere pagar: importe y concepto para las instrucciones de transferencia. */
export interface PaymentRequest {
  amount: number;
  concept: string;
  /** Property the receipt belongs to (its estate's IBAN is the one to pay); absent for a total. */
  propertyId?: string;
}

interface Row {
  id: string;
  concept: string;
  /** Property name, only when the card mixes several properties. */
  property: string | null;
  period: string;
  amount: string;
  status: { text: string; tone: StatusTone };
  payable: boolean;
  payment: PaymentRequest;
}

/**
 * «Mis recibos y pagos»: los últimos recibos de la propiedad, con su estado, y
 * un atajo para pagar lo pendiente (instrucciones de transferencia).
 */
@Component({
  selector: 'app-community-receipts',
  standalone: true,
  imports: [SectionCardComponent, StatusPillComponent],
  templateUrl: './community-receipts.component.html',
  styleUrl: './community-receipts.component.scss',
})
export class CommunityReceiptsComponent {
  /** Del más reciente al más antiguo; null mientras cargan. */
  readonly receipts = input<AccountingReceipt[] | null>(null);
  readonly failed = input(false);
  /** Names by property id when the card shows every property of the owner («Todas»); null for one property. */
  readonly propertyNames = input<Record<string, string> | null>(null);
  /** «Ver» y «Ver todos»: la lista completa de recibos de la propiedad. */
  readonly viewAll = output<void>();
  readonly pay = output<PaymentRequest>();

  private readonly owed = (r: AccountingReceipt) => r.outstanding ?? r.amount;

  readonly rows = computed<Row[]>(() =>
    (this.receipts() ?? []).slice(0, VISIBLE).map(r => ({
      id: r.id,
      // El tipo de recibo («Cuota ordinaria»): el periodo ya tiene su columna y el concepto completo lo repite.
      concept: r.kind || r.concept,
      property: (r.propertyId && this.propertyNames()?.[r.propertyId]) || null,
      period: r.period,
      amount: EURO.format(r.amount),
      status: STATUS[r.status] ?? { text: r.status, tone: 'neutral' as const },
      payable: PAYABLE.has(r.status),
      payment: { amount: this.owed(r), concept: r.concept, propertyId: r.propertyId },
    })),
  );

  /** Todo lo pendiente de pagar de la propiedad (no solo de lo que se ve). */
  readonly pendingTotal = computed(() =>
    (this.receipts() ?? []).filter(r => PAYABLE.has(r.status)).reduce((sum, r) => sum + this.owed(r), 0),
  );
  readonly pendingLabel = computed(() => EURO.format(this.pendingTotal()));
}
