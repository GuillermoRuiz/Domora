import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BankAccount, StaffMember } from '../../../core/models';
import { LedgerService } from '../../../core/ledger.service';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';
import { PayrollKind, PayrollRecord, PayrollService, TaxService, TaxSettlement } from '../../../core/tax.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
const KIND_LABELS: Record<PayrollKind, string> = {
  mensual: 'Mensual',
  extra: 'Paga extra',
  finiquito: 'Finiquito',
  otros: 'Otros',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** '1.234,56' o '1234.56' → euros; NaN si no es un importe con dos decimales como mucho. */
function parseEuros(value: string | number): number {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.abs(Math.round(n * 100) - n * 100) > 1e-6 ? NaN : Math.round(n * 100) / 100;
}

function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

type ReasonAction =
  | { kind: 'undo'; payroll: PayrollRecord }
  | { kind: 'cancel'; payroll: PayrollRecord }
  | { kind: 'undo-ss'; settlement: TaxSettlement };

/**
 * Nóminas de la finca (fase 7c). Domora no calcula nóminas: la gestoría
 * laboral da los importes y aquí se registran y contabilizan. El IRPF
 * retenido entra en el 111 y el 190 cuando la nómina se paga.
 */
@Component({
  selector: 'app-nominas-tab',
  standalone: true,
  imports: [PageActionDirective, FormsModule, BadgeComponent, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './nominas-tab.component.html',
  styleUrls: ['../cobros/cobros-modal.scss', './nominas-tab.component.scss'],
})
export class NominasTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private payrollSvc = inject(PayrollService);
  private taxSvc = inject(TaxService);
  private staffSvc = inject(SuppliersStaffService);
  private ledger = inject(LedgerService);

  kindLabels = KIND_LABELS;
  kinds = Object.keys(KIND_LABELS) as PayrollKind[];
  year = signal(new Date().getFullYear());
  years = Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - i);

  payrolls = signal<PayrollRecord[]>([]);
  staff = signal<StaffMember[]>([]);
  banks = signal<BankAccount[]>([]);
  ssPayments = signal<TaxSettlement[]>([]);
  loading = signal(true);
  toastMessage = signal<string | null>(null);

  active = computed(() => this.payrolls().filter((p) => p.status !== 'Anulada'));
  totals = computed(() => {
    const list = this.active();
    const sum = (f: (p: PayrollRecord) => number) => Math.round(list.reduce((s, p) => s + f(p) * 100, 0)) / 100;
    return {
      cost: sum((p) => p.totalCost),
      irpf: sum((p) => p.irpfWithholding),
      ss: sum((p) => p.employeeSs + p.employerSs),
      unpaid: sum((p) => (p.status === 'Registrada' ? p.netPay : 0)),
    };
  });
  activeStaff = computed(() => this.staff().filter((s) => s.status !== 'Baja'));

  async ngOnInit(): Promise<void> {
    try {
      const [staff, banks] = await Promise.all([
        this.staffSvc.listStaffByEstate(this.estateId),
        this.ledger.listBankAccounts(this.estateId),
      ]);
      this.staff.set(staff);
      this.banks.set(banks.filter((b) => !b.closedAt));
      await this.reload();
    } catch (error) {
      console.error('Error cargando nóminas', error);
    } finally {
      this.loading.set(false);
    }
  }

  async setYear(year: number): Promise<void> {
    this.year.set(Number(year));
    await this.reload();
  }

  private async reload(): Promise<void> {
    const [payrolls, settlements] = await Promise.all([
      this.payrollSvc.list(this.estateId, this.year()),
      this.taxSvc.listSettlements(this.estateId, this.year()),
    ]);
    this.payrolls.set(payrolls);
    this.ssPayments.set(settlements.filter((s) => s.kind === 'seguridad_social'));
  }

  statusVariant(status: PayrollRecord['status']): string {
    if (status === 'Pagada') return 'green';
    if (status === 'Anulada') return 'default';
    return 'warning';
  }

  defaultBankId(): string {
    return (this.banks().find((b) => b.isDefault) ?? this.banks()[0])?.id ?? '';
  }

  // ── Registrar nómina ────────────────────────────────────────────────────
  showNew = signal(false);
  newForm = { staffMemberId: '', period: thisMonth(), kind: 'mensual' as PayrollKind, gross: '', employeeSs: '', employerSs: '', irpf: '', notes: '' };
  newSaving = signal(false);
  newError = signal<string | null>(null);
  private newRevision = signal(0);

  newNet = computed(() => {
    this.newRevision();
    const f = this.newForm;
    const [gross, ss, irpf] = [parseEuros(f.gross), parseEuros(f.employeeSs), parseEuros(f.irpf)];
    if ([gross, ss, irpf].some((n) => Number.isNaN(n))) return null;
    return Math.round((gross - ss - irpf) * 100) / 100;
  });

  openNew(): void {
    this.newForm = { staffMemberId: '', period: thisMonth(), kind: 'mensual', gross: '', employeeSs: '', employerSs: '', irpf: '', notes: '' };
    this.newError.set(null);
    this.touchNew();
    this.showNew.set(true);
  }

  /** Al elegir empleado se precarga su coste mensual como bruto (se puede cambiar). */
  onStaffChange(id: string): void {
    this.newForm.staffMemberId = id;
    const s = this.staff().find((x) => x.id === id);
    if (s?.monthlyCost && !this.newForm.gross) this.newForm.gross = String(s.monthlyCost).replace('.', ',');
    this.touchNew();
  }

  touchNew(): void {
    this.newRevision.update((v) => v + 1);
  }

  async saveNew(): Promise<void> {
    const f = this.newForm;
    const gross = parseEuros(f.gross);
    const [employeeSs, employerSs, irpf] = [parseEuros(f.employeeSs), parseEuros(f.employerSs), parseEuros(f.irpf)];
    if (!f.staffMemberId) return this.newError.set('Elige el empleado.');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(f.period)) return this.newError.set('Indica el mes de la nómina.');
    if (!(gross > 0)) return this.newError.set('El bruto debe ser mayor que cero.');
    if ([employeeSs, employerSs, irpf].some((n) => Number.isNaN(n))) return this.newError.set('Revisa los importes: dos decimales como mucho.');
    const net = this.newNet();
    if (net === null || net < 0) return this.newError.set('La cuota obrera y la retención no pueden superar el bruto.');
    this.newSaving.set(true);
    this.newError.set(null);
    try {
      await this.payrollSvc.create(this.estateId, {
        staffMemberId: f.staffMemberId, period: f.period, kind: f.kind,
        grossSalary: gross, employeeSs, employerSs, irpfWithholding: irpf,
        ...(f.notes.trim() ? { notes: f.notes.trim() } : {}),
      });
      this.showNew.set(false);
      this.showToast('Nómina registrada y contabilizada');
      await this.reload();
    } catch (error) {
      this.newError.set(apiMessage(error, 'No se pudo registrar la nómina.'));
    } finally {
      this.newSaving.set(false);
    }
  }

  // ── Pagar nómina ─────────────────────────────────────────────────────────
  paying = signal<PayrollRecord | null>(null);
  payForm = { date: today(), method: 'Transferencia', bankAccountId: '' };
  paySaving = signal(false);
  payError = signal<string | null>(null);

  openPay(p: PayrollRecord): void {
    this.payForm = { date: today(), method: 'Transferencia', bankAccountId: this.defaultBankId() };
    this.payError.set(null);
    this.paying.set(p);
  }

  async confirmPay(): Promise<void> {
    const p = this.paying();
    if (!p) return;
    this.paySaving.set(true);
    this.payError.set(null);
    try {
      await this.payrollSvc.pay(p.id, {
        date: this.payForm.date,
        method: this.payForm.method,
        ...(this.payForm.method === 'Efectivo' || !this.payForm.bankAccountId ? {} : { bankAccountId: this.payForm.bankAccountId }),
      });
      this.paying.set(null);
      this.showToast(`Nómina de ${p.staffName} pagada`);
      await this.reload();
    } catch (error) {
      this.payError.set(apiMessage(error, 'No se pudo registrar el pago.'));
    } finally {
      this.paySaving.set(false);
    }
  }

  // ── Motivo: deshacer pago, anular nómina, deshacer pago de SS ────────────
  reasonAction = signal<ReasonAction | null>(null);
  reason = signal('');
  reasonSaving = signal(false);
  reasonError = signal<string | null>(null);

  openReason(action: ReasonAction): void {
    this.reason.set('');
    this.reasonError.set(null);
    this.reasonAction.set(action);
  }

  reasonTitle(action: ReasonAction): string {
    if (action.kind === 'undo') return `Deshacer el pago de la nómina de ${action.payroll.staffName}`;
    if (action.kind === 'cancel') return `Anular la nómina de ${action.payroll.staffName} (${action.payroll.period})`;
    return `Deshacer el pago de la Seguridad Social de ${action.settlement.period}`;
  }

  async confirmReason(): Promise<void> {
    const action = this.reasonAction();
    const reason = this.reason().trim();
    if (!action) return;
    if (reason.length < 3) return this.reasonError.set('Indica el motivo (queda en la contabilidad).');
    this.reasonSaving.set(true);
    this.reasonError.set(null);
    try {
      if (action.kind === 'undo') await this.payrollSvc.undoPayment(action.payroll.id, reason);
      else if (action.kind === 'cancel') await this.payrollSvc.cancel(action.payroll.id, reason);
      else await this.taxSvc.undoSettlement(action.settlement.id, reason);
      this.reasonAction.set(null);
      this.showToast(action.kind === 'cancel' ? 'Nómina anulada' : 'Pago deshecho');
      await this.reload();
    } catch (error) {
      this.reasonError.set(apiMessage(error, 'No se pudo completar la operación.'));
    } finally {
      this.reasonSaving.set(false);
    }
  }

  // ── Seguridad Social ────────────────────────────────────────────────────
  showSs = signal(false);
  ssForm = { period: thisMonth(), date: today(), amount: '', reference: '', bankAccountId: '' };
  ssSaving = signal(false);
  ssError = signal<string | null>(null);

  /** Cuotas obrera y patronal de las nóminas de un mes. */
  ssDueFor(period: string): number {
    return Math.round(this.active().filter((p) => p.period === period).reduce((s, p) => s + (p.employeeSs + p.employerSs) * 100, 0)) / 100;
  }

  openSs(): void {
    const period = this.ssForm.period || thisMonth();
    this.ssForm = { period, date: today(), amount: String(this.ssDueFor(period)).replace('.', ','), reference: '', bankAccountId: this.defaultBankId() };
    this.ssError.set(null);
    this.showSs.set(true);
  }

  onSsPeriodChange(period: string): void {
    this.ssForm.period = period;
    this.ssForm.amount = String(this.ssDueFor(period)).replace('.', ',');
  }

  async confirmSs(): Promise<void> {
    const amount = parseEuros(this.ssForm.amount);
    if (!(amount > 0)) return this.ssError.set('Indica un importe mayor que cero.');
    this.ssSaving.set(true);
    this.ssError.set(null);
    try {
      await this.taxSvc.createSettlement(this.estateId, {
        kind: 'seguridad_social',
        period: this.ssForm.period,
        date: this.ssForm.date,
        amount,
        ...(this.ssForm.bankAccountId ? { bankAccountId: this.ssForm.bankAccountId } : {}),
        ...(this.ssForm.reference.trim() ? { reference: this.ssForm.reference.trim() } : {}),
      });
      this.showSs.set(false);
      this.showToast('Pago de la Seguridad Social registrado');
      await this.reload();
    } catch (error) {
      this.ssError.set(apiMessage(error, 'No se pudo registrar el pago.'));
    } finally {
      this.ssSaving.set(false);
    }
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 3000);
  }
}
