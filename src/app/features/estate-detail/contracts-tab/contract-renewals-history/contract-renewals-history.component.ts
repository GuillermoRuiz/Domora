import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core';
import type { ContractRenewal } from '../../../../core/models';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { RENEWAL_LABEL, formatDate } from '../contracts-model';
import { ContractDialogDirective } from '../dialog-behavior.directive';

const money = (value: number, currency?: string): string =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: currency || 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/** Histórico completo de renovaciones de los contratos de la finca («Ver histórico»), la más reciente primero. */
@Component({
  selector: 'app-contract-renewals-history',
  standalone: true,
  imports: [ContractDialogDirective, IconComponent],
  templateUrl: './contract-renewals-history.component.html',
  styleUrl: './contract-renewals-history.component.scss',
})
export class ContractRenewalsHistoryComponent {
  private readonly source = signal<ContractRenewal[]>([]);
  @Input() set renewals(value: ContractRenewal[]) { this.source.set(value); }
  @Output() closed = new EventEmitter<void>();

  readonly rows = computed(() =>
    this.source().map((r) => ({
      id: r.id,
      service: r.serviceType,
      supplier: r.supplier.name,
      date: formatDate(r.renewedAt),
      previousEnd: r.previousEndDate ? formatDate(r.previousEndDate) : '—',
      newEnd: formatDate(r.newEndDate),
      amount: r.annualCost != null ? money(r.annualCost, r.currency) : r.costAmount != null ? money(r.costAmount, r.currency) : '—',
      kind: RENEWAL_LABEL[r.kind] ?? r.kind,
      notes: r.notes ?? '',
    })),
  );
}
