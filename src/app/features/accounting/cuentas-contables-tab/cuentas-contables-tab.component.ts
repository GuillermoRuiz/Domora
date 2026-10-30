import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AccountingEstate, AccountNature, ChartAccount } from '../../../core/models';
import { AccountingService } from '../../../core/accounting.service';

const NATURE_LABELS: Record<AccountNature, string> = {
  asset: 'Activo',
  liability: 'Pasivo',
  equity: 'Patrimonio',
  income: 'Ingreso',
  expense: 'Gasto',
};

/** Grupos del plan contable que usa una comunidad. */
const GROUP_LABELS: Record<string, string> = {
  '1': 'Grupo 1 · Patrimonio y fondos',
  '2': 'Grupo 2 · Inmovilizado',
  '3': 'Grupo 3 · Existencias',
  '4': 'Grupo 4 · Propietarios, proveedores y administraciones',
  '5': 'Grupo 5 · Tesorería',
  '6': 'Grupo 6 · Gastos',
  '7': 'Grupo 7 · Ingresos',
};

export interface AccountGroup {
  key: string;
  label: string;
  accounts: ChartAccount[];
}

function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  return typeof msg === 'string' ? msg : fallback;
}

@Component({
  selector: 'app-cuentas-contables-tab',
  standalone: true,
  imports: [PageActionDirective, FormsModule, BadgeComponent, BtnComponent, IconComponent],
  templateUrl: './cuentas-contables-tab.component.html',
  styleUrl: './cuentas-contables-tab.component.scss',
})
export class CuentasContablesTabComponent implements OnInit {
  @Input() estate!: AccountingEstate;

  private data = inject(AccountingService);

  accounts = signal<ChartAccount[]>([]);
  loaded = signal(false);
  showArchived = signal(false);
  toastMessage = signal<string | null>(null);

  /** Cuentas por grupo (primer dígito), en orden de código. */
  groups = computed<AccountGroup[]>(() => {
    const visible = this.accounts()
      .filter(a => this.showArchived() || !a.archivedAt)
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code));
    const byGroup = new Map<string, ChartAccount[]>();
    for (const a of visible) {
      const key = a.code.charAt(0);
      byGroup.set(key, [...(byGroup.get(key) ?? []), a]);
    }
    return [...byGroup.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, accounts]) => ({ key, label: GROUP_LABELS[key] ?? `Grupo ${key}`, accounts }));
  });

  archivedCount = computed(() => this.accounts().filter(a => a.archivedAt).length);

  async ngOnInit(): Promise<void> {
    try {
      this.accounts.set(await this.data.listChartAccounts(this.estate.id));
    } catch (error) {
      console.error('Error cargando las cuentas contables', error);
    } finally {
      this.loaded.set(true);
    }
  }

  natureLabel(a: ChartAccount): string {
    return a.nature ? NATURE_LABELS[a.nature] : '—';
  }

  indent(a: ChartAccount): number {
    return Math.max(0, (a.level ?? 1) - 1) * 20;
  }

  /** Las cuentas de los bancos se gestionan en Configuración, no aquí. */
  canAddChild(a: ChartAccount): boolean {
    return !a.archivedAt && a.code !== '572' && a.systemRole !== 'bank';
  }

  canArchive(a: ChartAccount): boolean {
    return !a.systemRole;
  }

  canDelete(a: ChartAccount): boolean {
    return !a.system && a.systemRole !== 'bank';
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  // ── Nueva cuenta / subcuenta ────────────────────────────────────────────
  showNuevaCuenta = signal(false);
  ncParent = signal<ChartAccount | null>(null);
  ncCode = signal('');
  ncName = signal('');
  ncShortName = signal('');
  ncErrors = signal<{ code?: boolean; name?: boolean; prefix?: boolean }>({});
  ncSaving = signal(false);
  ncError = signal<string | null>(null);

  openNuevaCuenta(parent: ChartAccount | null = null): void {
    this.ncParent.set(parent);
    this.ncCode.set(parent?.code ?? '');
    this.ncName.set('');
    this.ncShortName.set('');
    this.ncErrors.set({});
    this.ncError.set(null);
    this.showNuevaCuenta.set(true);
  }

  closeNuevaCuenta(): void {
    this.showNuevaCuenta.set(false);
  }

  async submitNuevaCuenta(): Promise<void> {
    const code = this.ncCode().trim();
    const name = this.ncName().trim();
    const parent = this.ncParent();
    const errors: { code?: boolean; name?: boolean; prefix?: boolean } = {};
    if (!/^[0-9]{3,10}$/.test(code)) errors.code = true;
    if (!name) errors.name = true;
    if (parent && !errors.code && (!code.startsWith(parent.code) || code.length <= parent.code.length)) {
      errors.prefix = true;
    }
    this.ncErrors.set(errors);
    if (errors.code || errors.name || errors.prefix) return;

    this.ncSaving.set(true);
    this.ncError.set(null);
    try {
      const created = await this.data.createChartAccount(this.estate.id, {
        code,
        name,
        shortName: this.ncShortName().trim() || undefined,
        parentId: parent?.id,
      });
      this.accounts.set([...this.accounts(), created]);
      this.showNuevaCuenta.set(false);
      this.showToast('Cuenta contable creada correctamente');
    } catch (error: any) {
      console.error('Error creando la cuenta contable', error);
      this.ncError.set(apiMessage(error, 'No se pudo crear la cuenta contable'));
    } finally {
      this.ncSaving.set(false);
    }
  }

  // ── Renombrar ───────────────────────────────────────────────────────────
  editing = signal<ChartAccount | null>(null);
  edName = signal('');
  edShortName = signal('');
  edError = signal<string | null>(null);
  edSaving = signal(false);

  openEditar(a: ChartAccount): void {
    this.editing.set(a);
    this.edName.set(a.name);
    this.edShortName.set(a.shortName ?? '');
    this.edError.set(null);
  }

  closeEditar(): void {
    this.editing.set(null);
  }

  async submitEditar(): Promise<void> {
    const account = this.editing();
    if (!account) return;
    const name = this.edName().trim();
    if (!name) {
      this.edError.set('El nombre es obligatorio');
      return;
    }
    this.edSaving.set(true);
    try {
      const updated = await this.data.updateChartAccount(this.estate.id, account.id, {
        name,
        shortName: this.edShortName().trim() || null,
      });
      this.replace(updated);
      this.editing.set(null);
      this.showToast('Cuenta actualizada');
    } catch (error: any) {
      this.edError.set(apiMessage(error, 'No se pudo guardar la cuenta'));
    } finally {
      this.edSaving.set(false);
    }
  }

  // ── Archivar / reactivar / borrar ───────────────────────────────────────
  actionError = signal<string | null>(null);

  async toggleArchived(a: ChartAccount): Promise<void> {
    this.actionError.set(null);
    try {
      const updated = await this.data.updateChartAccount(this.estate.id, a.id, { archived: !a.archivedAt });
      this.replace(updated);
      this.showToast(updated.archivedAt ? `Cuenta ${a.code} archivada` : `Cuenta ${a.code} reactivada`);
    } catch (error: any) {
      this.actionError.set(apiMessage(error, 'No se pudo cambiar el estado de la cuenta'));
    }
  }

  deleting = signal<ChartAccount | null>(null);

  askDelete(a: ChartAccount): void {
    this.actionError.set(null);
    this.deleting.set(a);
  }

  cancelDelete(): void {
    this.deleting.set(null);
  }

  async confirmDelete(): Promise<void> {
    const a = this.deleting();
    if (!a) return;
    try {
      await this.data.deleteChartAccount(this.estate.id, a.id);
      this.accounts.set(this.accounts().filter(x => x.id !== a.id));
      this.showToast(`Cuenta ${a.code} borrada`);
    } catch (error: any) {
      this.actionError.set(apiMessage(error, 'No se pudo borrar la cuenta'));
    } finally {
      this.deleting.set(null);
    }
  }

  private replace(updated: ChartAccount): void {
    this.accounts.set(this.accounts().map(x => (x.id === updated.id ? updated : x)));
  }
}
