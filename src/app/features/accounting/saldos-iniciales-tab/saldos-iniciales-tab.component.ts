import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  AccountingEstate, AccountingSettings, BankAccount, OwnerProperty, Supplier,
  OpeningBalancesView, OpeningValidateResult, OpeningDifferenceRole, OpeningOtherBalanceRole,
  OpeningBankBalanceInput, OpeningPropertyDebtInput, OpeningPropertyAdvanceInput,
  OpeningSupplierInvoiceInput, OpeningOtherBalanceInput,
} from '../../../core/models';
import { LedgerService } from '../../../core/ledger.service';
import { PropertiesService } from '../../../core/properties.service';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

function propertyLabel(p: OwnerProperty): string {
  return p.ref || [p.staircase, p.floor, p.door].filter(Boolean).join('-') || p.id;
}

const OTHER_ROLE_OPTIONS: { value: OpeningOtherBalanceRole; label: string }[] = [
  { value: 'reserve_fund', label: 'Fondo de reserva (117)' },
  { value: 'retained', label: 'Remanente (120)' },
  { value: 'prior_losses', label: 'Pérdidas de ejercicios anteriores (121)' },
  { value: 'withholding_payable', label: 'Retenciones pendientes de ingresar (4751)' },
  { value: 'social_security_payable', label: 'Seguridad Social (476)' },
  { value: 'salaries_payable', label: 'Salarios pendientes (465)' },
  { value: 'suspense', label: 'Pendiente de aplicar (555)' },
];

const DIFFERENCE_ROLE_OPTIONS: { value: OpeningDifferenceRole; label: string }[] = [
  { value: 'reserve_fund', label: 'Fondo de reserva (117)' },
  { value: 'retained', label: 'Remanente (120)' },
];

/**
 * Asistente de saldos iniciales (fase 9 de doc/contabilidad/roadmap-partida-doble.md):
 * bancos, deudas por propiedad y año, anticipos, facturas de proveedor pendientes y
 * otros saldos, contabilizados como un único asiento de apertura en la fecha de
 * corte. Un borrador se edita libre con PUT; contabilizar (post/repost) es la
 * única vía que lo hace irreversible salvo con una corrección nueva.
 */
@Component({
  selector: 'app-saldos-iniciales-tab',
  standalone: true,
  imports: [FormsModule, CurrencyPipe, DatePipe, BadgeComponent, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './saldos-iniciales-tab.component.html',
  styleUrls: [
    '../cuentas-contables-tab/cuentas-contables-tab.component.scss',
    '../ajustes-contables-tab/ajustes-contables-tab.component.scss',
    '../nueva-remesa/nueva-remesa.component.scss',
  ],
})
export class SaldosInicialesTabComponent implements OnInit {
  @Input() estate!: AccountingEstate;

  private ledger = inject(LedgerService);
  private propertiesSvc = inject(PropertiesService);
  private suppliersSvc = inject(SuppliersStaffService);

  readonly otherRoleOptions = OTHER_ROLE_OPTIONS;
  readonly differenceRoleOptions = DIFFERENCE_ROLE_OPTIONS;

  loading = signal(true);
  loadError = signal<string | null>(null);

  settings = signal<AccountingSettings | null>(null);
  view = signal<OpeningBalancesView | null>(null);
  banks = signal<BankAccount[]>([]);
  properties = signal<OwnerProperty[]>([]);
  suppliers = signal<Supplier[]>([]);

  /** Se entra en edición si el set activo ya es un borrador, o el usuario pulsa "Corregir". */
  editing = signal(false);

  otherRoleLabelByValue = new Map(OTHER_ROLE_OPTIONS.map((o) => [o.value, o.label]));

  bankLabel = computed(() => new Map(this.banks().map((b) => [b.id, b.alias])));
  propertyLabelById = computed(() => new Map(this.properties().map((p) => [p.id, propertyLabel(p)])));
  supplierLabel = computed(() => new Map(this.suppliers().filter((s) => s.status === 'Activo').map((s) => [s.id, s.name])));

  // ── Filas del borrador, en edición local ─────────────────────────────────
  bankRows = signal<OpeningBankBalanceInput[]>([]);
  debtRows = signal<OpeningPropertyDebtInput[]>([]);
  advanceRows = signal<OpeningPropertyAdvanceInput[]>([]);
  invoiceRows = signal<OpeningSupplierInvoiceInput[]>([]);
  otherRows = signal<OpeningOtherBalanceInput[]>([]);

  hasAnyRow = computed(() =>
    this.bankRows().length + this.debtRows().length + this.advanceRows().length
    + this.invoiceRows().length + this.otherRows().length > 0,
  );

  // ── Altas por sección ─────────────────────────────────────────────────────
  bankAccountIdDraft = signal('');
  bankBalanceDraft = signal('');

  debtPropertyIdDraft = signal('');
  debtOriginYearDraft = signal(String(new Date().getFullYear() - 1));
  debtConceptDraft = signal('');
  debtAmountDraft = signal('');
  debtDueDateDraft = signal('');

  advPropertyIdDraft = signal('');
  advConceptDraft = signal('');
  advAmountDraft = signal('');

  invSupplierIdDraft = signal('');
  invNumberDraft = signal('');
  invConceptDraft = signal('');
  invIssueDateDraft = signal('');
  invDueDateDraft = signal('');
  invAmountDraft = signal('');

  otherRoleDraft = signal<OpeningOtherBalanceRole>('reserve_fund');
  otherConceptDraft = signal('');
  otherSideDraft = signal<'debit' | 'credit'>('debit');
  otherAmountDraft = signal('');

  rowError = signal<string | null>(null);

  // ── Guardado / diferencia / contabilizar ─────────────────────────────────
  saving = signal(false);
  saveError = signal<string | null>(null);
  validateResult = signal<OpeningValidateResult | null>(null);
  differenceRoleDraft = signal<OpeningDifferenceRole>('reserve_fund');
  posting = signal(false);
  postError = signal<string | null>(null);
  toastMessage = signal<string | null>(null);

  // ── "Sin saldos previos" ──────────────────────────────────────────────────
  noPriorNote = signal('');
  noPriorSaving = signal(false);
  noPriorError = signal<string | null>(null);

  isPosted = computed(() => this.view()?.status === 'Contabilizado');
  isCorrection = computed(() => !!this.view()?.supersedesId);
  /** Misma regla que el backend (opening-balances.service.ts): sin ella, "post" la exige igual, pero así se ve antes de intentarlo. */
  needsDifferenceRole = computed(() => {
    const v = this.validateResult();
    return !!v && (v.difference !== 0 || this.debtRows().length > 0 || this.invoiceRows().length > 0);
  });

  async ngOnInit(): Promise<void> {
    try {
      const [settings, view, banks, properties, suppliers] = await Promise.all([
        this.ledger.getAccountingSettings(this.estate.id),
        this.ledger.getOpeningBalances(this.estate.id),
        this.ledger.listBankAccounts(this.estate.id),
        this.propertiesSvc.listPropertiesByEstate(this.estate.id),
        this.suppliersSvc.listSuppliers(this.estate.id),
      ]);
      this.settings.set(settings);
      this.view.set(view);
      this.banks.set(banks);
      this.properties.set(properties);
      this.suppliers.set(suppliers);
      this.editing.set(view.status !== 'Contabilizado');
      this.seedRowsFromView(view);
    } catch (error) {
      console.error('Error cargando los saldos iniciales', error);
      this.loadError.set('No se pudieron cargar los saldos iniciales.');
    } finally {
      this.loading.set(false);
    }
  }

  private seedRowsFromView(v: OpeningBalancesView): void {
    this.bankRows.set(v.bankBalances.map((b) => ({ bankAccountId: b.bankAccountId, balance: b.balance })));
    this.debtRows.set(v.propertyDebts.map((d) => ({
      propertyId: d.propertyId, originYear: d.originYear, concept: d.concept, amount: d.amount,
      dueDate: d.dueDate ?? undefined,
    })));
    this.advanceRows.set(v.propertyAdvances.map((a) => ({ propertyId: a.propertyId, concept: a.concept, amount: a.amount })));
    this.invoiceRows.set(v.supplierInvoices.map((i) => ({
      supplierId: i.supplierId, number: i.number, concept: i.concept, issueDate: i.issueDate,
      dueDate: i.dueDate ?? undefined, amount: i.amount, payableRole: i.payableRole,
    })));
    this.otherRows.set(v.otherBalances.map((o) => ({ role: o.role, concept: o.concept, side: o.side, amount: o.amount })));
    this.validateResult.set(null);
  }

  startCorrection(): void {
    this.editing.set(true);
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  /** Formato español: coma decimal, punto de millar opcional (ej. "12.500,50"). */
  private parseAmount(raw: string): number | null {
    const trimmed = raw.trim();
    const normalized = trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed;
    const n = Number(normalized);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }

  // ── Altas ──────────────────────────────────────────────────────────────
  addBank(): void {
    this.rowError.set(null);
    const bankAccountId = this.bankAccountIdDraft();
    const balance = this.parseAmount(this.bankBalanceDraft());
    if (!bankAccountId || balance === null) {
      this.rowError.set('Elige la cuenta y un importe mayor que cero.');
      return;
    }
    if (this.bankRows().some((b) => b.bankAccountId === bankAccountId)) {
      this.rowError.set('Esa cuenta ya tiene un saldo en el borrador — quítala primero para cambiarlo.');
      return;
    }
    this.bankRows.update((rows) => [...rows, { bankAccountId, balance }]);
    this.bankAccountIdDraft.set('');
    this.bankBalanceDraft.set('');
  }
  removeBank(i: number): void {
    this.bankRows.update((rows) => rows.filter((_, idx) => idx !== i));
  }

  addDebt(): void {
    this.rowError.set(null);
    const propertyId = this.debtPropertyIdDraft();
    const originYear = Number(this.debtOriginYearDraft());
    const concept = this.debtConceptDraft().trim();
    const amount = this.parseAmount(this.debtAmountDraft());
    if (!propertyId || !concept || amount === null || !Number.isInteger(originYear) || originYear < 2000 || originYear > 2100) {
      this.rowError.set('Elige la propiedad, un año válido, el concepto y un importe mayor que cero.');
      return;
    }
    this.debtRows.update((rows) => [...rows, {
      propertyId, originYear, concept, amount,
      dueDate: this.debtDueDateDraft() || undefined,
    }]);
    this.debtPropertyIdDraft.set('');
    this.debtConceptDraft.set('');
    this.debtAmountDraft.set('');
    this.debtDueDateDraft.set('');
  }
  removeDebt(i: number): void {
    this.debtRows.update((rows) => rows.filter((_, idx) => idx !== i));
  }

  addAdvance(): void {
    this.rowError.set(null);
    const propertyId = this.advPropertyIdDraft();
    const concept = this.advConceptDraft().trim();
    const amount = this.parseAmount(this.advAmountDraft());
    if (!propertyId || !concept || amount === null) {
      this.rowError.set('Elige la propiedad, el concepto y un importe mayor que cero.');
      return;
    }
    this.advanceRows.update((rows) => [...rows, { propertyId, concept, amount }]);
    this.advPropertyIdDraft.set('');
    this.advConceptDraft.set('');
    this.advAmountDraft.set('');
  }
  removeAdvance(i: number): void {
    this.advanceRows.update((rows) => rows.filter((_, idx) => idx !== i));
  }

  addInvoice(): void {
    this.rowError.set(null);
    const supplierId = this.invSupplierIdDraft();
    const number = this.invNumberDraft().trim();
    const concept = this.invConceptDraft().trim();
    const issueDate = this.invIssueDateDraft();
    const amount = this.parseAmount(this.invAmountDraft());
    if (!supplierId || !number || !concept || !issueDate || amount === null) {
      this.rowError.set('Completa proveedor, número, concepto, fecha e importe.');
      return;
    }
    this.invoiceRows.update((rows) => [...rows, {
      supplierId, number, concept, issueDate, amount,
      dueDate: this.invDueDateDraft() || undefined,
    }]);
    this.invSupplierIdDraft.set('');
    this.invNumberDraft.set('');
    this.invConceptDraft.set('');
    this.invIssueDateDraft.set('');
    this.invDueDateDraft.set('');
    this.invAmountDraft.set('');
  }
  removeInvoice(i: number): void {
    this.invoiceRows.update((rows) => rows.filter((_, idx) => idx !== i));
  }

  addOther(): void {
    this.rowError.set(null);
    const concept = this.otherConceptDraft().trim();
    const amount = this.parseAmount(this.otherAmountDraft());
    if (!concept || amount === null) {
      this.rowError.set('Indica el concepto y un importe mayor que cero.');
      return;
    }
    this.otherRows.update((rows) => [...rows, {
      role: this.otherRoleDraft(), concept, side: this.otherSideDraft(), amount,
    }]);
    this.otherConceptDraft.set('');
    this.otherAmountDraft.set('');
  }
  removeOther(i: number): void {
    this.otherRows.update((rows) => rows.filter((_, idx) => idx !== i));
  }

  // ── Guardar borrador / validar diferencia / contabilizar ─────────────────

  private draftPayload() {
    return {
      bankBalances: this.bankRows(),
      propertyDebts: this.debtRows(),
      propertyAdvances: this.advanceRows(),
      supplierInvoices: this.invoiceRows(),
      otherBalances: this.otherRows(),
    };
  }

  async saveDraft(): Promise<boolean> {
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const updated = await this.ledger.saveOpeningDraft(this.estate.id, this.draftPayload());
      this.view.set(updated);
      this.showToast('Borrador guardado');
      return true;
    } catch (error) {
      this.saveError.set(apiMessage(error, 'No se pudo guardar el borrador'));
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  async refreshDifference(): Promise<boolean> {
    this.saveError.set(null);
    if (!(await this.saveDraft())) return false;
    try {
      this.validateResult.set(await this.ledger.validateOpeningBalances(this.estate.id));
      return true;
    } catch (error) {
      this.saveError.set(apiMessage(error, 'No se pudo calcular la diferencia'));
      return false;
    }
  }

  async confirmPost(): Promise<void> {
    this.postError.set(null);
    if (!(await this.refreshDifference())) return;
    this.posting.set(true);
    try {
      const differenceRole = this.needsDifferenceRole() ? this.differenceRoleDraft() : undefined;
      const updated = this.isCorrection()
        ? await this.ledger.repostOpeningBalances(this.estate.id, differenceRole)
        : await this.ledger.postOpeningBalances(this.estate.id, differenceRole);
      this.view.set(updated);
      this.editing.set(false);
      this.showToast('Saldos iniciales contabilizados');
    } catch (error) {
      this.postError.set(apiMessage(error, 'No se pudo contabilizar el asiento de apertura'));
    } finally {
      this.posting.set(false);
    }
  }

  async confirmNoPriorBalances(): Promise<void> {
    this.noPriorError.set(null);
    this.noPriorSaving.set(true);
    try {
      await this.ledger.confirmNoPriorBalances(this.estate.id, this.noPriorNote() || undefined);
      this.settings.set(await this.ledger.getAccountingSettings(this.estate.id));
      this.showToast('Confirmado: esta finca no tiene saldos previos');
    } catch (error) {
      this.noPriorError.set(apiMessage(error, 'No se pudo confirmar'));
    } finally {
      this.noPriorSaving.set(false);
    }
  }
}
