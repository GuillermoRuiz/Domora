import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth.service';
import { InspectionsService } from '../../../core/inspections.service';
import { IssuesService } from '../../../core/issues.service';
import { Issue, IssueProviderAssignment } from '../../../core/models';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { IconComponent } from '../../../shared/components/icon/icon.component';

export type IssueEditKind = 'provider' | 'budget' | 'installation';

const TITLE: Record<IssueEditKind, string> = {
  provider: 'Editar proveedor',
  budget: 'Presupuesto',
  installation: 'Instalación afectada',
};
const DONE: Record<IssueEditKind, string> = {
  provider: 'Proveedor actualizado',
  budget: 'Presupuesto actualizado',
  installation: 'Instalación actualizada',
};

/**
 * Edita un dato del expediente: el proveedor asignado, el presupuesto o la instalación afectada. Guarda por los
 * servicios de siempre y avisa con `saved`; la pantalla vuelve a leer el expediente, no se escribe nada desde aquí.
 */
@Component({
  selector: 'app-issue-edit-dialog',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './issue-edit-dialog.component.html',
  styleUrl: './issue-edit-dialog.component.scss',
})
export class IssueEditDialogComponent implements OnInit {
  private readonly issuesApi = inject(IssuesService);
  private readonly suppliersApi = inject(SuppliersStaffService);
  private readonly inspectionsApi = inject(InspectionsService);
  private readonly auth = inject(AuthService);

  readonly kind = input.required<IssueEditKind>();
  readonly issue = input.required<Issue>();
  /** Asignación vigente del proveedor, para rellenar el formulario. */
  readonly provider = input<IssueProviderAssignment | null>(null);
  readonly saved = output<string>();
  readonly closed = output<void>();

  readonly title = computed(() => TITLE[this.kind()]);
  readonly error = signal('');
  readonly saving = signal(false);

  // Proveedor
  readonly directory = signal<{ id: string; name: string; category: string }[]>([]);
  readonly supplierId = signal('');
  readonly providerName = signal('');
  readonly providerCategory = signal('');
  readonly providerPhone = signal('');
  readonly providerResolution = signal('');
  // Presupuesto
  readonly amount = signal<number | null>(null);
  readonly budgetDescription = signal('');
  readonly approved = signal(false);
  // Instalación
  readonly installations = signal<{ id: string; name: string }[]>([]);
  readonly assetId = signal('');

  ngOnInit(): void {
    const issue = this.issue();
    const estateId = issue.estateId;
    if (this.kind() === 'provider') {
      const current = this.provider();
      this.providerName.set(current?.providerNameSnapshot ?? '');
      this.providerCategory.set(current?.categorySnapshot ?? '');
      this.providerPhone.set(current?.phoneSnapshot ?? '');
      // El control de fecha trabaja con `AAAA-MM-DD`; lo guardado llega como ISO completo.
      this.providerResolution.set((current?.estimatedResolutionDate ?? '').slice(0, 10));
      this.supplierId.set(current?.supplierId ?? '');
      if (estateId)
        void this.suppliersApi
          .listSuppliers(estateId)
          .then((all) =>
            this.directory.set(all.filter((s) => s.status === 'Activo').map((s) => ({ id: s.id, name: s.name, category: s.category }))),
          )
          // Sin directorio se puede asignar igualmente escribiendo el nombre.
          .catch(() => undefined);
    } else if (this.kind() === 'budget') {
      this.amount.set(issue.budgetAmount ?? null);
      this.budgetDescription.set(issue.budgetDescription ?? '');
      this.approved.set(issue.budgetApproved ?? false);
    } else {
      this.assetId.set(issue.assetId ?? '');
      if (estateId)
        void this.inspectionsApi
          .listAssetsByEstate(estateId)
          .then((assets) =>
            this.installations.set(assets.map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name, 'es'))),
          )
          .catch(() => undefined);
    }
  }

  /** Elegir un proveedor del directorio fija su ficha (nombre y categoría salen de ella); «solo con nombre» la deja libre. */
  chooseSupplier(id: string): void {
    this.supplierId.set(id);
    const supplier = this.directory().find((s) => s.id === id);
    if (supplier) {
      this.providerName.set(supplier.name);
      this.providerCategory.set(supplier.category);
    }
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const issue = this.issue();
      if (this.kind() === 'provider') {
        const name = this.providerName().trim();
        if (!name) return this.closed.emit();
        await this.issuesApi.assignIssueProvider({
          issueId: issue.id,
          // Un proveedor del directorio conserva su ficha; solo un profesional solo con nombre va sin ella.
          supplierId: this.supplierId() || null,
          providerNameSnapshot: name,
          categorySnapshot: this.providerCategory().trim(),
          phoneSnapshot: this.providerPhone().trim(),
          estimatedResolutionDate: this.providerResolution().trim(),
          assignedAt: new Date().toISOString(),
          assignedByUserId: this.auth.currentUser()?.id ?? '',
        });
      } else if (this.kind() === 'budget') {
        await this.issuesApi.updateIssueBudget(issue.id, {
          budgetAmount: this.amount() ?? undefined,
          budgetDescription: this.budgetDescription().trim(),
          budgetApproved: this.approved(),
        });
      } else {
        const next = this.assetId() || null;
        if ((issue.assetId ?? null) !== next) await this.issuesApi.setIssueAsset(issue.id, next);
      }
      this.saved.emit(DONE[this.kind()]);
    } catch (error) {
      const message = (error as { error?: { message?: string | string[] } })?.error?.message;
      const text = Array.isArray(message) ? message.join(' ') : message;
      // Sin tragarse el rechazo: el diálogo sigue abierto con lo que hay que corregir.
      this.error.set(text?.trim() || 'No se pudo guardar. Revisa los datos e inténtalo de nuevo.');
    } finally {
      this.saving.set(false);
    }
  }
}
