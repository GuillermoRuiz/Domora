import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BankAccount, ChartAccount, CostCentre } from '../../../core/models';
import { AccountingService } from '../../../core/accounting.service';
import { CostCentresService } from '../../../core/cost-centres.service';
import { LedgerService } from '../../../core/ledger.service';
import {
  AutoMatchResult, BankLedger, BankLedgerLine, BankStatementView, JournalService, ReconciliationService, StatementEntry,
} from '../../../core/journal.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
/** Valor del selector de cuenta que representa la caja (570). */
export const CASH = 'cash';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** '1.234,56' o '1234.56' → euros; NaN si no es un importe positivo con dos decimales como mucho. */
function parseEuros(value: string | number): number {
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.abs(Math.round(n * 100) - n * 100) > 1e-6 ? NaN : Math.round(n * 100) / 100;
}

function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

function cents(n: number): number {
  return Math.round(n * 100);
}

/** Una conciliación ya hecha: sus partidas del extracto y sus apuntes. */
export interface ReconciledGroup {
  id: string;
  entries: StatementEntry[];
  lines: BankLedgerLine[];
}

/**
 * Tesorería de la finca (fase 8): el mayor de cada cuenta bancaria con su
 * saldo, cobros y pagos sueltos, traspasos, y la conciliación con el
 * extracto del banco. Todo lo que se registra aquí es un asiento del diario.
 */
@Component({
  selector: 'app-tesoreria-tab',
  standalone: true,
  imports: [PageActionDirective, FormsModule, BadgeComponent, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './tesoreria-tab.component.html',
  styleUrls: ['../cobros/cobros-modal.scss', './tesoreria-tab.component.scss'],
})
export class TesoreriaTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private ledgerSvc = inject(LedgerService);
  private accounting = inject(AccountingService);
  private costCentresSvc = inject(CostCentresService);
  private journal = inject(JournalService);
  private recon = inject(ReconciliationService);

  readonly CASH = CASH;

  banks = signal<BankAccount[]>([]);
  accounts = signal<ChartAccount[]>([]);
  costCentres = signal<CostCentre[]>([]);
  bankId = signal<string>('');
  ledger = signal<BankLedger | null>(null);
  statement = signal<BankStatementView | null>(null);
  loading = signal(true);
  mode = signal<'ledger' | 'reconcile'>('ledger');
  toastMessage = signal<string | null>(null);

  bank = computed(() => this.banks().find((b) => b.id === this.bankId()) ?? null);

  /** Más recientes primero; el saldo corrido ya viene calculado en orden cronológico. */
  ledgerLines = computed(() => [...(this.ledger()?.lines ?? [])].reverse());
  pendingLines = computed(() => this.ledgerLines().filter((l) => !l.reconciliationGroupId));
  pendingEntries = computed(() => (this.statement()?.entries ?? []).filter((e) => !e.reconciliationGroupId));

  /** Diferencia entre el saldo contable y el del último extracto importado. */
  statementGap = computed(() => {
    const last = this.statement()?.lastStatement;
    const ledger = this.ledger();
    if (!last || !ledger) return null;
    return (cents(ledger.closingBalance) - cents(last.closingBalance)) / 100;
  });

  reconciledGroups = computed<ReconciledGroup[]>(() => {
    const groups = new Map<string, ReconciledGroup>();
    const group = (id: string) => {
      if (!groups.has(id)) groups.set(id, { id, entries: [], lines: [] });
      return groups.get(id)!;
    };
    for (const e of this.statement()?.entries ?? []) if (e.reconciliationGroupId) group(e.reconciliationGroupId).entries.push(e);
    for (const l of this.ledgerLines()) if (l.reconciliationGroupId) group(l.reconciliationGroupId).lines.push(l);
    return [...groups.values()];
  });

  async ngOnInit(): Promise<void> {
    try {
      const [banks, accounts, costCentres] = await Promise.all([
        this.ledgerSvc.listBankAccounts(this.estateId),
        this.accounting.listChartAccounts(this.estateId),
        this.costCentresSvc.listCostCentres(this.estateId),
      ]);
      const open = banks.filter((b) => !b.closedAt);
      this.banks.set(open);
      this.accounts.set(accounts);
      this.costCentres.set(costCentres.filter((c) => c.status === 'Activo'));
      const initial = open.find((b) => b.isDefault) ?? open[0];
      if (initial) {
        this.bankId.set(initial.id);
        await this.reload();
      }
    } catch (error) {
      console.error('Error cargando la tesorería', error);
    } finally {
      this.loading.set(false);
    }
  }

  async selectBank(id: string): Promise<void> {
    this.bankId.set(id);
    this.clearSelection();
    await this.reload();
  }

  private async reload(): Promise<void> {
    const id = this.bankId();
    if (!id) return;
    const [ledger, statement, banks] = await Promise.all([
      this.recon.ledger(this.estateId, id),
      this.recon.statement(this.estateId, id),
      this.ledgerSvc.listBankAccounts(this.estateId),
    ]);
    this.ledger.set(ledger);
    this.statement.set(statement);
    this.banks.set(banks.filter((b) => !b.closedAt));
  }

  // ── Importar extracto ───────────────────────────────────────────────────
  importing = signal(false);
  importWarnings = signal<string[]>([]);

  async onStatementFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.bankId()) return;
    this.importing.set(true);
    this.importWarnings.set([]);
    try {
      const result = await this.recon.importStatement(this.estateId, this.bankId(), file);
      this.importWarnings.set(result.warnings ?? []);
      const dupes = result.skippedDuplicates ? ` (${result.skippedDuplicates} ya estaban importadas)` : '';
      this.showToast(`${result.imported} partidas importadas${dupes}`);
      await this.reload();
    } catch (error) {
      this.showToast(apiMessage(error, 'No se pudo importar el extracto.'));
    } finally {
      this.importing.set(false);
    }
  }

  // ── Conciliación ────────────────────────────────────────────────────────
  selectedEntries = signal<ReadonlySet<string>>(new Set());
  selectedLines = signal<ReadonlySet<string>>(new Set());
  matching = signal(false);
  matchError = signal<string | null>(null);
  lastAuto = signal<AutoMatchResult | null>(null);

  selectedEntriesTotal = computed(() =>
    this.pendingEntries().filter((e) => this.selectedEntries().has(e.id)).reduce((s, e) => s + cents(e.amount), 0) / 100,
  );
  selectedLinesTotal = computed(() =>
    this.pendingLines().filter((l) => this.selectedLines().has(l.id)).reduce((s, l) => s + cents(l.amount), 0) / 100,
  );
  selectionDiff = computed(() => (cents(this.selectedEntriesTotal()) - cents(this.selectedLinesTotal())) / 100);
  canMatch = computed(() => this.selectedEntries().size > 0 && this.selectedLines().size > 0 && this.selectionDiff() === 0);

  enterReconcile(): void {
    this.clearSelection();
    this.lastAuto.set(null);
    this.mode.set('reconcile');
  }

  exitReconcile(): void {
    this.clearSelection();
    this.mode.set('ledger');
  }

  toggleEntry(id: string): void {
    this.selectedEntries.update((s) => toggled(s, id));
    this.matchError.set(null);
  }

  toggleLine(id: string): void {
    this.selectedLines.update((s) => toggled(s, id));
    this.matchError.set(null);
  }

  clearSelection(): void {
    this.selectedEntries.set(new Set());
    this.selectedLines.set(new Set());
    this.matchError.set(null);
  }

  async matchSelection(): Promise<void> {
    if (!this.canMatch()) return;
    this.matching.set(true);
    this.matchError.set(null);
    try {
      await this.recon.match(this.estateId, this.bankId(), [...this.selectedEntries()], [...this.selectedLines()]);
      this.clearSelection();
      this.showToast('Conciliado');
      await this.reload();
    } catch (error) {
      this.matchError.set(apiMessage(error, 'No se pudo conciliar.'));
    } finally {
      this.matching.set(false);
    }
  }

  async autoMatch(): Promise<void> {
    this.matching.set(true);
    this.matchError.set(null);
    try {
      const result = await this.recon.autoMatch(this.estateId, this.bankId());
      this.lastAuto.set(result);
      this.clearSelection();
      this.showToast(result.matched ? `${result.matched} partidas conciliadas` : 'No se encontraron parejas con el mismo importe');
      await this.reload();
    } catch (error) {
      this.matchError.set(apiMessage(error, 'No se pudo conciliar automáticamente.'));
    } finally {
      this.matching.set(false);
    }
  }

  groupTotal(g: ReconciledGroup): number {
    return g.lines.reduce((s, l) => s + cents(l.amount), 0) / 100;
  }

  async unmatch(groupId: string): Promise<void> {
    try {
      await this.recon.unmatch(groupId);
      this.showToast('Conciliación deshecha');
      await this.reload();
    } catch (error) {
      this.showToast(apiMessage(error, 'No se pudo deshacer la conciliación.'));
    }
  }

  // ── Cobro o pago suelto ─────────────────────────────────────────────────
  showQuick = signal(false);
  quickForm = { direction: 'out' as 'in' | 'out', date: today(), place: '', accountId: '', costCentreId: '', amount: '', concept: '', reference: '' };
  quickSaving = signal(false);
  quickError = signal<string | null>(null);
  private quickRevision = signal(0);

  /** Contrapartidas posibles: cuentas de gasto (grupo 6) e ingreso (grupo 7) que admiten apuntes. */
  quickAccounts = computed(() => {
    this.quickRevision();
    const group = this.quickForm.direction === 'in' ? '7' : '6';
    const other = group === '7' ? '6' : '7';
    const usable = this.accounts().filter((a) => a.postable !== false && !a.archivedAt && /^[67]/.test(a.code));
    // Primero las del grupo que corresponde a la dirección (ingresos al cobrar, gastos al pagar).
    return [...usable.filter((a) => a.code.startsWith(group)), ...usable.filter((a) => a.code.startsWith(other))];
  });

  quickAllowsCostCentre = computed(() => {
    this.quickRevision();
    return !!this.accounts().find((a) => a.id === this.quickForm.accountId)?.allowsCostCentre;
  });

  openQuick(direction: 'in' | 'out'): void {
    this.quickForm = { direction, date: today(), place: this.bankId() || CASH, accountId: '', costCentreId: '', amount: '', concept: '', reference: '' };
    this.quickError.set(null);
    this.touchQuick();
    this.showQuick.set(true);
  }

  touchQuick(): void {
    this.quickRevision.update((v) => v + 1);
  }

  async saveQuick(): Promise<void> {
    const f = this.quickForm;
    const amount = parseEuros(f.amount);
    if (!f.accountId) return this.quickError.set('Elige la cuenta de ingreso o gasto.');
    if (Number.isNaN(amount)) return this.quickError.set('Indica un importe mayor que cero, con dos decimales como mucho.');
    if (f.concept.trim().length < 3) return this.quickError.set('Indica el concepto.');
    this.quickSaving.set(true);
    this.quickError.set(null);
    try {
      await this.journal.quickEntry(this.estateId, {
        date: f.date,
        direction: f.direction,
        amount,
        ...(f.place && f.place !== CASH ? { bankAccountId: f.place } : {}),
        counterpartAccountId: f.accountId,
        ...(f.costCentreId && this.quickAllowsCostCentre() ? { costCentreId: f.costCentreId } : {}),
        concept: f.concept.trim(),
        ...(f.reference.trim() ? { reference: f.reference.trim() } : {}),
      });
      this.showQuick.set(false);
      this.showToast(f.direction === 'in' ? 'Cobro registrado' : 'Pago registrado');
      await this.reload();
    } catch (error) {
      this.quickError.set(apiMessage(error, 'No se pudo registrar el movimiento.'));
    } finally {
      this.quickSaving.set(false);
    }
  }

  // ── Traspaso ────────────────────────────────────────────────────────────
  showTransfer = signal(false);
  transferForm = { from: '', to: '', date: today(), amount: '', concept: '' };
  transferSaving = signal(false);
  transferError = signal<string | null>(null);

  openTransfer(): void {
    const other = this.banks().find((b) => b.id !== this.bankId());
    this.transferForm = { from: this.bankId() || CASH, to: other?.id ?? CASH, date: today(), amount: '', concept: '' };
    this.transferError.set(null);
    this.showTransfer.set(true);
  }

  async saveTransfer(): Promise<void> {
    const f = this.transferForm;
    const amount = parseEuros(f.amount);
    if (f.from === f.to) return this.transferError.set('El origen y el destino deben ser distintos.');
    if (Number.isNaN(amount)) return this.transferError.set('Indica un importe mayor que cero, con dos decimales como mucho.');
    this.transferSaving.set(true);
    this.transferError.set(null);
    try {
      await this.journal.transfer(this.estateId, {
        date: f.date,
        amount,
        ...(f.from !== CASH ? { fromBankAccountId: f.from } : {}),
        ...(f.to !== CASH ? { toBankAccountId: f.to } : {}),
        ...(f.concept.trim() ? { concept: f.concept.trim() } : {}),
      });
      this.showTransfer.set(false);
      this.showToast('Traspaso registrado');
      await this.reload();
    } catch (error) {
      this.transferError.set(apiMessage(error, 'No se pudo registrar el traspaso.'));
    } finally {
      this.transferSaving.set(false);
    }
  }

  placeLabel(id: string): string {
    if (id === CASH) return 'Caja';
    return this.banks().find((b) => b.id === id)?.alias ?? '—';
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 3000);
  }
}

function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
