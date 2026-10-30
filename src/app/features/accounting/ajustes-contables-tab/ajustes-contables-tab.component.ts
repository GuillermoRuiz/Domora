import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AccountingEstate, AccountingSettings, BankAccount, FiscalYear, ReserveAllocationRule, ReserveMode } from '../../../core/models';
import { LedgerService } from '../../../core/ledger.service';
import { FiscalYearsService } from '../../../core/fiscal-years.service';
import { RESERVE_FUND_USE_REASON_LABELS, ReserveFundApplication, ReserveFundService, ReserveFundUseReason } from '../../../core/reserve-fund.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

/** IBAN normalizado (sin espacios, mayúsculas). La validación real es del backend. */
function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/**
 * Configuración contable de la finca: desde cuándo lleva Domora la
 * contabilidad y con qué cuentas bancarias.
 */
@Component({
  selector: 'app-ajustes-contables-tab',
  standalone: true,
  imports: [PageActionDirective, FormsModule, CurrencyPipe, DatePipe, BadgeComponent, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './ajustes-contables-tab.component.html',
  styleUrls: [
    '../cuentas-contables-tab/cuentas-contables-tab.component.scss',
    './ajustes-contables-tab.component.scss',
  ],
})
export class AjustesContablesTabComponent implements OnInit {
  @Input() estate!: AccountingEstate;

  private ledger = inject(LedgerService);
  private fiscalYears = inject(FiscalYearsService);
  private reserveFund = inject(ReserveFundService);

  settings = signal<AccountingSettings | null>(null);
  banks = signal<BankAccount[]>([]);
  loadError = signal<string | null>(null);
  toastMessage = signal<string | null>(null);

  openBanks = computed(() => this.banks().filter(b => !b.closedAt));
  closedBanks = computed(() => this.banks().filter(b => b.closedAt));

  async ngOnInit(): Promise<void> {
    try {
      const [settings, banks, years, applications] = await Promise.all([
        this.ledger.getAccountingSettings(this.estate.id),
        this.ledger.listBankAccounts(this.estate.id),
        this.fiscalYears.listFiscalYears(this.estate.id),
        this.reserveFund.list(this.estate.id),
      ]);
      this.settings.set(settings);
      this.cutoverDraft.set(settings.cutoverDate);
      this.banks.set(banks);
      const current = years.find(y => y.year === this.currentYear) ?? null;
      this.reserveYear.set(current);
      this.resetReserveDraft(current);
      this.reserveApplications.set(applications);
    } catch (error) {
      console.error('Error cargando la configuración contable', error);
      this.loadError.set('No se pudo cargar la configuración contable.');
    }
  }

  // ── Devoluciones bancarias ────────────────────────────────────────────
  returnFeeSaving = signal(false);
  returnFeeError = signal<string | null>(null);

  async setReturnFeeRecharge(value: boolean): Promise<void> {
    const previous = this.settings();
    if (!previous || previous.returnFeeRecharge === value) return;
    this.returnFeeSaving.set(true);
    this.returnFeeError.set(null);
    try {
      this.settings.set(await this.ledger.updateReturnFeeRecharge(this.estate.id, value));
      this.showToast(value ? 'Las comisiones de devolución se repercutirán' : 'Las comisiones de devolución las asume la comunidad');
    } catch (error) {
      this.settings.set({ ...previous });
      this.returnFeeError.set(apiMessage(error, 'No se pudo guardar la opción'));
    } finally {
      this.returnFeeSaving.set(false);
    }
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  // ── Fecha de inicio contable ────────────────────────────────────────────
  cutoverDraft = signal('');
  cutoverSaving = signal(false);
  cutoverError = signal<string | null>(null);

  cutoverChanged = computed(() => {
    const s = this.settings();
    return !!s && !!this.cutoverDraft() && this.cutoverDraft() !== s.cutoverDate;
  });

  async saveCutover(): Promise<void> {
    const s = this.settings();
    const next = this.cutoverDraft();
    if (!s || !next) return;
    if (s.firstEntryDate && next > s.firstEntryDate) {
      this.cutoverError.set(`Ya hay asientos desde el ${s.firstEntryDate}: la fecha no puede ser posterior.`);
      return;
    }
    this.cutoverSaving.set(true);
    this.cutoverError.set(null);
    try {
      const updated = await this.ledger.updateAccountingSettings(this.estate.id, next);
      this.settings.set(updated);
      this.cutoverDraft.set(updated.cutoverDate);
      this.showToast('Fecha de inicio contable actualizada');
    } catch (error: any) {
      this.cutoverError.set(apiMessage(error, 'No se pudo cambiar la fecha de inicio contable'));
    } finally {
      this.cutoverSaving.set(false);
    }
  }

  // ── Fondo de reserva del ejercicio ──────────────────────────────────────
  readonly currentYear = new Date().getFullYear();
  readonly reserveModes: { value: ReserveMode; label: string }[] = [
    { value: 'receipt_share', label: 'Una parte de cada cuota ordinaria' },
    { value: 'year_end_allocation', label: 'Dotación al cierre del ejercicio' },
    { value: 'both', label: 'Las dos: parte de cada cuota + dotación al cierre' },
    { value: 'none', label: 'Sin dotación automática' },
  ];
  readonly reserveAllocationRules: { value: ReserveAllocationRule; label: string }[] = [
    { value: 'top_up_to_legal_minimum', label: 'Justo hasta el mínimo legal (10 % del presupuesto)' },
    { value: 'fixed_amount', label: 'Un importe fijo' },
    { value: 'pct_of_result', label: 'Un porcentaje del resultado' },
  ];
  /** Porcentaje que cubre el mínimo legal (10 % del presupuesto = 10/110 de lo recaudado, redondeado arriba). */
  readonly legalMinimumPct = '9.10';

  reserveYear = signal<FiscalYear | null>(null);
  reserveModeDraft = signal<ReserveMode>('receipt_share');
  reservePctDraft = signal('');
  reserveAllocationRuleDraft = signal<ReserveAllocationRule | ''>('');
  reserveAllocationValueDraft = signal('');
  reserveAlsoDefault = signal(true);
  reserveSaving = signal(false);
  reserveError = signal<string | null>(null);

  reserveYearClosed = computed(() => this.reserveYear()?.status === 'Cerrado');
  reserveNeedsPct = computed(() => this.reserveModeDraft() === 'receipt_share' || this.reserveModeDraft() === 'both');
  reserveNeedsAllocation = computed(() => this.reserveModeDraft() === 'year_end_allocation' || this.reserveModeDraft() === 'both');
  reserveAllocationNeedsValue = computed(() => {
    const rule = this.reserveAllocationRuleDraft();
    return rule === 'fixed_amount' || rule === 'pct_of_result';
  });
  reserveAllocationValueLabel = computed(() => this.reserveAllocationRuleDraft() === 'fixed_amount' ? 'Importe fijo (€)' : 'Porcentaje del resultado');

  private resetReserveDraft(year: FiscalYear | null): void {
    const mode = year?.reserveMode ?? this.settings()?.defaultReserveMode ?? 'receipt_share';
    const pct = year?.reserveSharePct ?? this.settings()?.defaultReserveSharePct ?? null;
    const rule = year?.reserveAllocationRule ?? this.settings()?.defaultReserveAllocationRule ?? null;
    const value = year?.reserveAllocationValue ?? this.settings()?.defaultReserveAllocationValue ?? null;
    this.reserveModeDraft.set(mode);
    this.reservePctDraft.set(pct ? String(Number(pct)) : '');
    this.reserveAllocationRuleDraft.set(rule ?? '');
    this.reserveAllocationValueDraft.set(value ? String(Number(value)) : '');
  }

  useLegalMinimum(): void {
    this.reservePctDraft.set(this.legalMinimumPct);
  }

  /** Un número con como mucho 2 decimales, o null si el texto está vacío. `null` en el resultado de un campo obligatorio es el error. */
  private parseAmount(raw: string): number | null | undefined {
    const trimmed = raw.replace(',', '.').trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0 || Math.round(n * 100) !== n * 100) return undefined;
    return n;
  }

  async saveReserve(): Promise<void> {
    const mode = this.reserveModeDraft();
    let pct: number | null = null;
    if (this.reserveNeedsPct()) {
      const parsed = this.parseAmount(this.reservePctDraft());
      if (parsed === undefined || (parsed !== null && parsed > 100)) {
        this.reserveError.set('El porcentaje va de 0 a 100, con dos decimales como mucho.');
        return;
      }
      pct = parsed;
    }

    let rule: ReserveAllocationRule | null = null;
    let value: number | null = null;
    if (this.reserveNeedsAllocation()) {
      rule = this.reserveAllocationRuleDraft() || null;
      if (!rule) {
        this.reserveError.set('Elige cómo se dota el fondo de reserva al cierre.');
        return;
      }
      if (this.reserveAllocationNeedsValue()) {
        const parsed = this.parseAmount(this.reserveAllocationValueDraft());
        if (parsed === undefined || parsed === null) {
          this.reserveError.set('Esta regla necesita un importe o porcentaje.');
          return;
        }
        value = parsed;
      }
    }

    this.reserveSaving.set(true);
    this.reserveError.set(null);
    try {
      const updated = await this.fiscalYears.updateReserve(this.estate.id, this.currentYear, {
        reserveMode: mode,
        reserveSharePct: pct,
        reserveAllocationRule: rule,
        reserveAllocationValue: value,
      });
      this.reserveYear.set(updated);
      if (this.reserveAlsoDefault()) {
        this.settings.set(await this.ledger.updateDefaultReserve(this.estate.id, {
          defaultReserveMode: mode,
          defaultReserveSharePct: pct,
          defaultReserveAllocationRule: rule,
          defaultReserveAllocationValue: value,
        }));
      }
      this.showToast('Fondo de reserva actualizado');
    } catch (error: any) {
      this.reserveError.set(apiMessage(error, 'No se pudo guardar el fondo de reserva'));
    } finally {
      this.reserveSaving.set(false);
    }
  }

  // ── Uso del fondo de reserva (art. 9.1.f LPH) ───────────────────────────
  readonly reserveUseReasons: { value: ReserveFundUseReason; label: string }[] =
    (Object.entries(RESERVE_FUND_USE_REASON_LABELS) as [ReserveFundUseReason, string][])
      .map(([value, label]) => ({ value, label }));

  reserveApplications = signal<ReserveFundApplication[]>([]);
  reserveUseLabel = RESERVE_FUND_USE_REASON_LABELS;

  showReserveUseForm = signal(false);
  ruDate = signal(new Date().toISOString().slice(0, 10));
  ruAmount = signal('');
  ruReason = signal<ReserveFundUseReason>('conservacion');
  ruConcept = signal('');
  ruMeetingReference = signal('');
  ruSaving = signal(false);
  ruError = signal<string | null>(null);

  openReserveUseForm(): void {
    this.ruDate.set(new Date().toISOString().slice(0, 10));
    this.ruAmount.set('');
    this.ruReason.set('conservacion');
    this.ruConcept.set('');
    this.ruMeetingReference.set('');
    this.ruError.set(null);
    this.showReserveUseForm.set(true);
  }

  closeReserveUseForm(): void {
    this.showReserveUseForm.set(false);
  }

  async submitReserveUse(): Promise<void> {
    const amount = this.parseAmount(this.ruAmount());
    if (!amount || amount <= 0) {
      this.ruError.set('El importe debe ser mayor que cero, con dos decimales como mucho.');
      return;
    }
    const concept = this.ruConcept().trim();
    if (concept.length < 3) {
      this.ruError.set('Indica para qué se libera el fondo (mínimo 3 caracteres).');
      return;
    }
    const meetingReference = this.ruMeetingReference().trim();
    if (meetingReference.length < 3) {
      this.ruError.set('Indica el acta que autoriza esta obra o contrato.');
      return;
    }
    this.ruSaving.set(true);
    this.ruError.set(null);
    try {
      await this.reserveFund.create(this.estate.id, {
        date: this.ruDate(),
        amount,
        reason: this.ruReason(),
        concept,
        meetingReference,
      });
      this.reserveApplications.set(await this.reserveFund.list(this.estate.id));
      this.showReserveUseForm.set(false);
      this.showToast('Liberación del fondo de reserva registrada');
    } catch (error: any) {
      this.ruError.set(apiMessage(error, 'No se pudo registrar la liberación'));
    } finally {
      this.ruSaving.set(false);
    }
  }

  cancellingReserveUseId = signal<string | null>(null);
  ruCancelReason = signal('');
  ruCancelError = signal<string | null>(null);

  openCancelReserveUse(id: string): void {
    this.ruCancelReason.set('');
    this.ruCancelError.set(null);
    this.cancellingReserveUseId.set(id);
  }

  async confirmCancelReserveUse(): Promise<void> {
    const id = this.cancellingReserveUseId();
    if (!id) return;
    if (this.ruCancelReason().trim().length < 3) {
      this.ruCancelError.set('Indica el motivo (queda en la contabilidad).');
      return;
    }
    try {
      await this.reserveFund.cancel(id, this.ruCancelReason().trim());
      this.cancellingReserveUseId.set(null);
      this.reserveApplications.set(await this.reserveFund.list(this.estate.id));
      this.showToast('Liberación deshecha');
    } catch (error: any) {
      this.ruCancelError.set(apiMessage(error, 'No se pudo deshacer la liberación'));
    }
  }

  // ── Cuentas bancarias ───────────────────────────────────────────────────
  showBankForm = signal(false);
  editingBank = signal<BankAccount | null>(null);
  bAlias = signal('');
  bIban = signal('');
  bBic = signal('');
  bBankName = signal('');
  bReserve = signal(false);
  bErrors = signal<{ alias?: boolean; iban?: boolean }>({});
  bSaving = signal(false);
  bError = signal<string | null>(null);
  bankActionError = signal<string | null>(null);

  openNewBank(): void {
    this.editingBank.set(null);
    this.bAlias.set('');
    this.bIban.set('');
    this.bBic.set('');
    this.bBankName.set('');
    this.bReserve.set(false);
    this.bErrors.set({});
    this.bError.set(null);
    this.showBankForm.set(true);
  }

  openEditBank(bank: BankAccount): void {
    this.editingBank.set(bank);
    this.bAlias.set(bank.alias);
    this.bIban.set('');
    this.bBic.set(bank.bic ?? '');
    this.bBankName.set(bank.bankName ?? '');
    this.bReserve.set(bank.isReserveAccount);
    this.bErrors.set({});
    this.bError.set(null);
    this.showBankForm.set(true);
  }

  closeBankForm(): void {
    this.showBankForm.set(false);
  }

  async submitBank(): Promise<void> {
    const alias = this.bAlias().trim();
    const iban = normalizeIban(this.bIban());
    const errors: { alias?: boolean; iban?: boolean } = {};
    if (!alias) errors.alias = true;
    // Comprobación rápida de forma; el dígito de control lo valida el backend.
    if (iban && !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(iban)) errors.iban = true;
    this.bErrors.set(errors);
    if (errors.alias || errors.iban) return;

    const bic = this.bBic().trim().toUpperCase();
    const bankName = this.bBankName().trim();
    this.bSaving.set(true);
    this.bError.set(null);
    try {
      const editing = this.editingBank();
      const list = editing
        ? await this.ledger.updateBankAccount(this.estate.id, editing.id, {
            alias,
            ...(iban ? { iban } : {}),
            ...(bic ? { bic } : {}),
            bankName,
            isReserveAccount: this.bReserve(),
          })
        : await this.ledger.createBankAccount(this.estate.id, {
            alias,
            ...(iban ? { iban } : {}),
            ...(bic ? { bic } : {}),
            ...(bankName ? { bankName } : {}),
            isReserveAccount: this.bReserve(),
          });
      this.banks.set(list);
      this.showBankForm.set(false);
      this.showToast(editing ? 'Cuenta bancaria actualizada' : 'Cuenta bancaria creada');
    } catch (error: any) {
      this.bError.set(apiMessage(error, 'No se pudo guardar la cuenta bancaria'));
    } finally {
      this.bSaving.set(false);
    }
  }

  async makeDefault(bank: BankAccount): Promise<void> {
    await this.bankAction(bank, { isDefault: true }, `${bank.alias} es ahora la cuenta por defecto`);
  }

  async toggleClosed(bank: BankAccount): Promise<void> {
    await this.bankAction(
      bank,
      { closed: !bank.closedAt },
      bank.closedAt ? `${bank.alias} reabierta` : `${bank.alias} cerrada`,
    );
  }

  private async bankAction(bank: BankAccount, patch: { isDefault?: true; closed?: boolean }, ok: string): Promise<void> {
    this.bankActionError.set(null);
    try {
      this.banks.set(await this.ledger.updateBankAccount(this.estate.id, bank.id, patch));
      this.showToast(ok);
    } catch (error: any) {
      this.bankActionError.set(apiMessage(error, 'No se pudo actualizar la cuenta bancaria'));
    }
  }
}
