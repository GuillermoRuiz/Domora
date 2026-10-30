import { Component, computed, input, output } from '@angular/core';
import type { ContractRenewal, EstateContract } from '../../../../core/models';
import { SectionCardComponent } from '../../../../shared/components/section-card/section-card.component';
import { RENEWAL_LABEL, amountText, contractAlert, formatDate, upcomingExpirations, type AlertTone } from '../contracts-model';

/** Filas que se ven en cada panel; el resto está en la tabla y en el histórico. */
export const PANEL_ROWS = 5;

interface UpcomingRow {
  contract: EstateContract;
  end: string;
  days: string;
  tone: AlertTone;
  amount: string;
}

interface RenewalRow {
  id: string;
  service: string;
  supplier: string;
  date: string;
  newEnd: string;
  amount: string;
  kind: string;
}

const money = (value: number, currency?: string): string =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: currency || 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/**
 * Los dos paneles inferiores del mockup: «Próximos vencimientos» (los vigentes que vencen antes, con sus
 * días restantes coloreados según D4) y «Últimas renovaciones» (las registradas con «Renovar»).
 */
@Component({
  selector: 'app-contracts-panels',
  standalone: true,
  imports: [SectionCardComponent],
  templateUrl: './contracts-panels.component.html',
  styleUrl: './contracts-panels.component.scss',
})
export class ContractsPanelsComponent {
  readonly contracts = input.required<EstateContract[]>();
  readonly renewals = input<ContractRenewal[]>([]);
  /** «Ver» un contrato de «Próximos vencimientos». */
  readonly view = output<EstateContract>();
  /** «Ver todos»: la tabla, ordenada por vencimiento. */
  readonly viewAll = output<void>();
  /** «Ver histórico»: el listado completo de renovaciones. */
  readonly viewHistory = output<void>();

  readonly upcoming = computed<UpcomingRow[]>(() =>
    upcomingExpirations(this.contracts(), PANEL_ROWS).map((contract) => ({
      contract,
      end: formatDate(contract.endDate),
      days: contract.daysLeft === 0 ? 'Hoy' : `${contract.daysLeft} ${contract.daysLeft === 1 ? 'día' : 'días'}`,
      tone: contractAlert(contract).tone,
      amount: amountText(contract).main,
    })),
  );

  readonly latest = computed<RenewalRow[]>(() =>
    this.renewals().slice(0, PANEL_ROWS).map((r) => ({
      id: r.id,
      service: r.serviceType,
      supplier: r.supplier.name,
      date: formatDate(r.renewedAt),
      newEnd: formatDate(r.newEndDate),
      amount: r.annualCost != null ? money(r.annualCost, r.currency) : r.costAmount != null ? money(r.costAmount, r.currency) : '—',
      kind: RENEWAL_LABEL[r.kind] ?? r.kind,
    })),
  );
}
