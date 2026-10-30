import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AccountingEstate, CostCentre } from '../../../core/models';
import { CostCentresService } from '../../../core/cost-centres.service';

@Component({
  selector: 'app-centros-coste-tab',
  standalone: true,
  imports: [PageActionDirective, FormsModule, BadgeComponent, BtnComponent, IconComponent],
  templateUrl: './centros-coste-tab.component.html',
  styleUrl: './centros-coste-tab.component.scss',
})
export class CentrosCosteTabComponent implements OnInit {
  @Input() estate!: AccountingEstate;

  private costCentres = inject(CostCentresService);

  centres = signal<CostCentre[]>([]);
  toastMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.centres.set(await this.costCentres.listCostCentres(this.estate.id));
    } catch (error) {
      console.error('Error cargando los centros de coste', error);
    }
  }

  private async reload(): Promise<void> {
    this.centres.set(await this.costCentres.listCostCentres(this.estate.id));
  }

  pct(centre: CostCentre): number {
    if (!centre.budgeted) return 0;
    return Math.round(((centre.executed ?? 0) / centre.budgeted) * 100);
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

  // ── Nuevo / editar centro de coste ──────────────────────────────────────
  showModal = signal(false);
  editingId = signal<string | null>(null);
  ccName = signal('');
  ccDescription = signal('');
  ccErrors = signal<{ name?: boolean }>({});
  ccSaving = signal(false);
  ccError = signal<string | null>(null);

  openNuevo(): void {
    this.editingId.set(null);
    this.ccName.set('');
    this.ccDescription.set('');
    this.ccErrors.set({});
    this.ccError.set(null);
    this.showModal.set(true);
  }

  openEditar(centre: CostCentre): void {
    this.editingId.set(centre.id);
    this.ccName.set(centre.name);
    this.ccDescription.set(centre.description ?? '');
    this.ccErrors.set({});
    this.ccError.set(null);
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  async submit(): Promise<void> {
    const name = this.ccName().trim();
    if (!name) {
      this.ccErrors.set({ name: true });
      return;
    }
    this.ccSaving.set(true);
    this.ccError.set(null);
    try {
      const editingId = this.editingId();
      if (editingId) {
        await this.costCentres.updateCostCentre(this.estate.id, editingId, {
          name, description: this.ccDescription().trim() || undefined,
        });
        this.showToast('Centro de coste actualizado correctamente');
      } else {
        await this.costCentres.createCostCentre(this.estate.id, {
          name, description: this.ccDescription().trim() || undefined,
        });
        this.showToast('Centro de coste creado correctamente');
      }
      await this.reload();
      this.showModal.set(false);
    } catch (error: any) {
      console.error('Error guardando el centro de coste', error);
      const msg = error?.error?.message;
      this.ccError.set(typeof msg === 'string' ? msg : 'No se pudo guardar el centro de coste');
    } finally {
      this.ccSaving.set(false);
    }
  }

  /** Baja lógica — nunca hard-delete, puede haber movimientos ya etiquetados con este centro. */
  async archivar(centre: CostCentre): Promise<void> {
    if (!confirm(`¿Archivar "${centre.name}"? Los movimientos ya etiquetados con este centro no se ven afectados.`)) return;
    try {
      await this.costCentres.updateCostCentre(this.estate.id, centre.id, { status: 'Archivado' });
      await this.reload();
      this.showToast(`${centre.name} archivado`);
    } catch (error) {
      console.error('Error archivando el centro de coste', error);
      this.showToast('No se pudo archivar el centro de coste');
    }
  }
}
