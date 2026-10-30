import { Injectable, computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type { AccountingEstate } from './models';

export type AccountingTab = 'summary' | 'receipts' | 'treasury' | 'journal' | 'remesas' | 'suppliers' | 'accounts' | 'budget' | 'cost-centres' | 'analysis' | 'delinquency' | 'payroll' | 'taxes' | 'opening' | 'closing' | 'settings' | 'ledger' | 'balance' | 'results' | 'cash-settlement';

interface AccountingNavGroup {
  id: string;
  label: string;
  items: { id: AccountingTab; label: string; link?: boolean }[];
}

export const ACCOUNTING_NAV_GROUPS: AccountingNavGroup[] = [
  { id: 'collections', label: 'Cobros y tesorería', items: [
    { id: 'receipts', label: 'Recibos' },
    { id: 'remesas', label: 'Remesas' },
    { id: 'delinquency', label: 'Morosidad' },
    { id: 'treasury', label: 'Tesorería' },
    { id: 'suppliers', label: 'Proveedores', link: true },
  ] },
  { id: 'books', label: 'Libros y cuentas', items: [
    { id: 'journal', label: 'Diario' },
    { id: 'ledger', label: 'Mayor' },
    { id: 'balance', label: 'Balance' },
    { id: 'accounts', label: 'Cuentas contables' },
  ] },
  { id: 'budget', label: 'Presupuesto y análisis', items: [
    { id: 'budget', label: 'Presupuesto' },
    { id: 'results', label: 'Resultados' },
    { id: 'analysis', label: 'Análisis' },
    { id: 'cash-settlement', label: 'Liquidación de caja' },
  ] },
  { id: 'payroll', label: 'Nóminas e impuestos', items: [
    { id: 'payroll', label: 'Nóminas' },
    { id: 'taxes', label: 'Impuestos' },
  ] },
  { id: 'fiscal-year', label: 'Ejercicio y configuración', items: [
    { id: 'opening', label: 'Saldos iniciales' },
    { id: 'closing', label: 'Cierre' },
    { id: 'cost-centres', label: 'Centros de coste' },
    { id: 'settings', label: 'Configuración' },
  ] },
];

export interface AccountingNavigationContext {
  estate: Signal<AccountingEstate | null>;
  activeTab: WritableSignal<AccountingTab>;
}

/** Shares only the current detail's navigation with the persistent sidebar. */
@Injectable({ providedIn: 'root' })
export class AccountingNavigationService {
  readonly context = signal<AccountingNavigationContext | null>(null);
  readonly groups = ACCOUNTING_NAV_GROUPS;
  readonly activeGroup = computed(() => {
    const activeTab = this.context()?.activeTab();
    return this.groups.find(group => group.items.some(item => item.id === activeTab)) ?? null;
  });

  selectGroup(groupId: string): void {
    const group = this.groups.find(group => group.id === groupId);
    if (group && this.activeGroup()?.id !== group.id) {
      this.context()?.activeTab.set(group.items[0].id);
    }
  }
}
