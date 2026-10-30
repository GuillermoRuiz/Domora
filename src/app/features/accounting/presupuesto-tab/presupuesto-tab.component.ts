import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, computed, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AccountingEstate, BudgetItem, ChartAccount, FiscalYear } from '../../../core/models';
import { AccountingService } from '../../../core/accounting.service';
import { BudgetService } from '../../../core/budget.service';
import { FiscalYearsService } from '../../../core/fiscal-years.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
interface EditableBudgetRow {
  accountCode: string;
  category: string;
  budgeted: number;
}

@Component({
  selector: 'app-presupuesto-tab',
  standalone: true,
  imports: [PageActionDirective, BtnComponent, IconComponent, FormsModule, SelectDropdownDirective],
  templateUrl: './presupuesto-tab.component.html',
  styleUrl: './presupuesto-tab.component.scss',
})
export class PresupuestoTabComponent implements OnInit {
  @Input() estate!: AccountingEstate;

  private accounting = inject(AccountingService);
  private budgetSvc = inject(BudgetService);
  private fiscalYearsSvc = inject(FiscalYearsService);

  budget = signal<BudgetItem[]>([]);
  toastMessage = signal<string | null>(null);

  // Selector de ejercicio real — antes `fiscalYear` era un campo hardcodeado
  // a new Date().getFullYear() sin forma de cambiarlo desde la UI, aunque
  // el backend ya aceptaba ?fiscalYear=.
  fiscalYears = signal<FiscalYear[]>([]);
  fiscalYear = signal(new Date().getFullYear());
  currentFiscalYear = computed(() => this.fiscalYears().find(f => f.year === this.fiscalYear()) ?? null);
  approvalLabel = computed(() => {
    const fy = this.currentFiscalYear();
    if (!fy?.approvedAt) return 'Pendiente de aprobación';
    return `Aprobado el ${this.fmtDate(fy.approvedAt)}`;
  });

  showEditModal = signal(false);
  editRows = signal<EditableBudgetRow[]>([]);
  chartAccounts = signal<ChartAccount[]>([]);
  newAccountCode = signal('');
  saving = signal(false);

  showApproveModal = signal(false);
  approveNote = signal('');
  approving = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.fiscalYears.set(await this.fiscalYearsSvc.listFiscalYears(this.estate.id));
      await this.reloadBudget();
    } catch (error) {
      console.error('Error cargando el presupuesto', error);
    }
  }

  private async reloadBudget(): Promise<void> {
    this.budget.set(await this.budgetSvc.listBudget(this.estate.id, this.fiscalYear()));
  }

  async onFiscalYearChange(year: string | number): Promise<void> {
    this.fiscalYear.set(Number(year));
    try {
      await this.reloadBudget();
    } catch (error) {
      console.error('Error cargando el presupuesto', error);
    }
  }

  fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString('es-ES');
  }

  async openEditModal(): Promise<void> {
    this.editRows.set(this.budget().map(b => ({ accountCode: b.code, category: b.category, budgeted: b.budgeted })));
    this.newAccountCode.set('');
    this.showEditModal.set(true);
    if (this.chartAccounts().length === 0) {
      try {
        this.chartAccounts.set(await this.accounting.listChartAccounts(this.estate.id));
      } catch (error) {
        console.error('Error cargando el plan contable', error);
      }
    }
  }

  closeEditModal(): void {
    this.showEditModal.set(false);
  }

  updateRowBudget(accountCode: string, value: string): void {
    const amount = Number(value);
    this.editRows.set(this.editRows().map(r => r.accountCode === accountCode ? { ...r, budgeted: isNaN(amount) ? 0 : amount } : r));
  }

  availableAccountsToAdd = computed(() => {
    const used = new Set(this.editRows().map(r => r.accountCode));
    return this.chartAccounts().filter(a => !used.has(a.code));
  });

  addRow(): void {
    const code = this.newAccountCode();
    const account = this.chartAccounts().find(a => a.code === code);
    if (!account) return;
    this.editRows.set([...this.editRows(), { accountCode: code, category: account.shortName ?? account.name, budgeted: 0 }]);
    this.newAccountCode.set('');
  }

  async saveEditModal(): Promise<void> {
    this.saving.set(true);
    try {
      for (const row of this.editRows()) {
        // `category` sigue siendo obligatorio en el payload por compatibilidad
        // del DTO, pero el backend ya no confía en él — lo recalcula
        // server-side desde la cuenta real en cada escritura (tarea 43).
        await this.budgetSvc.upsertBudgetItem(this.estate.id, {
          accountCode: row.accountCode,
          category: row.category,
          fiscalYear: this.fiscalYear(),
          budgeted: row.budgeted,
        });
      }
      await this.reloadBudget();
      this.showEditModal.set(false);
      this.showToast('Presupuesto actualizado correctamente');
    } catch (error) {
      console.error('Error guardando el presupuesto', error);
      this.showToast('No se pudo guardar el presupuesto');
    } finally {
      this.saving.set(false);
    }
  }

  openApproveModal(): void {
    this.approveNote.set('');
    this.showApproveModal.set(true);
  }

  closeApproveModal(): void {
    this.showApproveModal.set(false);
  }

  async submitApprove(): Promise<void> {
    this.approving.set(true);
    try {
      const updated = await this.fiscalYearsSvc.approveFiscalYear(this.estate.id, this.fiscalYear(), this.approveNote().trim() || undefined);
      this.fiscalYears.set([...this.fiscalYears().filter(f => f.year !== updated.year), updated]);
      this.showApproveModal.set(false);
      this.showToast('Presupuesto aprobado correctamente');
    } catch (error) {
      console.error('Error aprobando el presupuesto', error);
      this.showToast('No se pudo aprobar el presupuesto');
    } finally {
      this.approving.set(false);
    }
  }

  totalBudgeted = computed(() => this.budget().reduce((s, b) => s + b.budgeted, 0));
  totalExecuted = computed(() => this.budget().reduce((s, b) => s + b.executed, 0));
  totalPct = computed(() => {
    const budgeted = this.totalBudgeted();
    return budgeted > 0 ? Math.round((this.totalExecuted() / budgeted) * 100) : 0;
  });

  pct(item: { budgeted: number; executed: number }): number {
    if (!item.budgeted) return 0;
    return Math.round((item.executed / item.budgeted) * 100);
  }

  pctColor(p: number): string {
    return p >= 100 ? 'var(--color-error)' : p >= 75 ? 'var(--color-warning)' : 'var(--color-secondary)';
  }

  fmtEur0(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }
}
