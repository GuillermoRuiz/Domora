import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  Asset,
  CorrectiveAction,
  CorrectiveActionStatus,
  Inspection,
  InspectionOutcome,
  InspectionStatus,
  InspectionType,
} from '../../../core/models';
import { InspectionsService } from '../../../core/inspections.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
const STATUS_OPTIONS: InspectionStatus[] = [
  'Planificada', 'Citada', 'Realizada', 'Desfavorable', 'Vencida', 'Exenta',
];
const CORRECTIVE_STATUS_OPTIONS: CorrectiveActionStatus[] = [
  'Abierta', 'En progreso', 'Cerrada', 'Vencida',
];
const OUTCOME_OPTIONS: InspectionOutcome[] = ['Favorable', 'Desfavorable'];
const NEW_ASSET_VALUE = '__new__';
const NEW_TYPE_VALUE = '__new__';

interface Semaforo {
  label: string;
  variant: 'green' | 'warning' | 'error' | 'default';
}

/**
 * Puerto de `InspeccionesTab.tsx` (domora-es) — mismo esqueleto que
 * `personal-tab.component.ts` (lista + drawer de detalle + modal de alta).
 * A diferencia del original, el activo se elige entre los ya existentes de
 * la finca (o se crea uno nuevo inline) en vez de crear uno nuevo en cada
 * alta — ver plan de la feature.
 */
@Component({
  selector: 'app-inspecciones-tab',
  standalone: true,
  imports: [PageActionDirective, BadgeComponent, BtnComponent, IconComponent, FormsModule, SelectDropdownDirective],
  templateUrl: './inspecciones-tab.component.html',
  styleUrl: './inspecciones-tab.component.scss',
})
export class InspeccionesTabComponent implements OnInit {
  @Input() estateId!: string;

  private dataSvc = inject(InspectionsService);

  inspections = signal<Inspection[]>([]);
  assets = signal<Asset[]>([]);
  inspectionTypes = signal<InspectionType[]>([]);
  toastMessage = signal<string | null>(null);

  statusOptions = STATUS_OPTIONS;
  correctiveStatusOptions = CORRECTIVE_STATUS_OPTIONS;
  outcomeOptions = OUTCOME_OPTIONS;
  newAssetValue = NEW_ASSET_VALUE;
  newTypeValue = NEW_TYPE_VALUE;

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    try {
      const [inspections, assets, types] = await Promise.all([
        this.dataSvc.listInspectionsByEstate(this.estateId),
        this.dataSvc.listAssetsByEstate(this.estateId),
        this.dataSvc.listInspectionTypes(this.estateId),
      ]);
      this.inspections.set(inspections);
      this.assets.set(assets);
      this.inspectionTypes.set(types);
    } catch (error) {
      console.error('Error cargando las inspecciones', error);
    }
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  // ── Días restantes / semáforo (mismo criterio que getDiasRestantes/getSemaforo del origen) ──
  daysRemaining(i: Inspection): number | null {
    if (!i.nextDueDate) return null;
    // En UTC: `i.nextDueDate` ('YYYY-MM-DD', sin hora) lo parsea JS como
    // medianoche UTC, pero `new Date().toDateString()` da la fecha en hora
    // LOCAL del navegador — mezclar ambas desplaza el cálculo un día entero
    // fuera de UTC (mismo bug que en InspectionsCronService.startOfDay).
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const due = new Date(i.nextDueDate).getTime();
    return Math.round((due - today) / 86_400_000);
  }

  semaforo(i: Inspection): Semaforo {
    if (i.status === 'Exenta') return { label: 'Exenta', variant: 'default' };
    if (i.status === 'Desfavorable') return { label: 'Desfavorable', variant: 'error' };
    if (i.status === 'Vencida') return { label: 'Vencida', variant: 'error' };
    // `nextDueDate` de un ciclo ya cerrado sigue apuntando a la fecha límite
    // HISTÓRICA de ese ciclo (el backend no la toca al registrar un
    // resultado, a propósito — es el registro de cuándo tocaba, no un
    // recordatorio pendiente) — sin este caso explícito, una inspección
    // completada a tiempo se mostraría igualmente como "vencida" si su
    // fecha límite ya pasó, aunque el resultado sea favorable.
    if (i.status === 'Realizada') return { label: 'Realizada', variant: 'green' };
    const days = this.daysRemaining(i);
    if (days == null) return { label: 'Sin fecha', variant: 'default' };
    if (days < 0) return { label: `Vencida hace ${Math.abs(days)} días`, variant: 'error' };
    if (days <= 30) return { label: `${days} días`, variant: 'warning' };
    return { label: 'En plazo', variant: 'green' };
  }

  statusBadgeVariant(status: InspectionStatus): string {
    switch (status) {
      case 'Realizada': return 'green';
      case 'Desfavorable':
      case 'Vencida': return 'error';
      case 'Citada': return 'warning';
      default: return 'default';
    }
  }

  correctiveStatusBadgeVariant(status: CorrectiveActionStatus): string {
    switch (status) {
      case 'Cerrada': return 'green';
      case 'Vencida': return 'error';
      case 'En progreso': return 'warning';
      default: return 'default';
    }
  }

  // ── KPIs (mismos cortes que los 5 tiles de InspeccionesTab.tsx) ──────────
  totalCount = computed(() => this.inspections().length);
  onTrackCount = computed(() => this.inspections().filter((i) => this.semaforo(i).variant === 'green').length);
  dueSoonCount = computed(() => this.inspections().filter((i) => this.semaforo(i).variant === 'warning').length);
  // Derivado de semaforo() (no de la fecha en bruto): así una inspección ya
  // "Realizada" con fecha límite histórica pasada no cuenta como vencida —
  // se excluye "Desfavorable" porque tiene su propio tile más abajo.
  overdueCount = computed(() => this.inspections().filter(
    (i) => this.semaforo(i).variant === 'error' && i.status !== 'Desfavorable',
  ).length);
  unfavorableCount = computed(() => this.inspections().filter((i) => i.status === 'Desfavorable').length);

  // ── Filtros de la lista ───────────────────────────────────────────────
  statusFilter = signal<InspectionStatus | 'all'>('all');
  searchQuery = signal('');

  filteredInspections = computed(() => {
    const status = this.statusFilter();
    const q = this.searchQuery().trim().toLowerCase();
    return this.inspections().filter((i) => {
      if (status !== 'all' && i.status !== status) return false;
      if (q && !i.asset.name.toLowerCase().includes(q) && !i.inspectionType.name.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  // ── Detalle (drawer) ──────────────────────────────────────────────────
  selectedInspectionId = signal<string | null>(null);
  selectedDetail = signal<Inspection | null>(null);
  detailLoading = signal(false);
  savingEdit = signal(false);

  editStatus = signal<InspectionStatus>('Planificada');
  editNextDueDate = signal('');
  editAppointmentDate = signal('');
  editNotes = signal('');

  async openDetail(i: Inspection): Promise<void> {
    this.selectedInspectionId.set(i.id);
    this.detailLoading.set(true);
    try {
      const detail = await this.dataSvc.findInspectionById(i.id);
      this.selectedDetail.set(detail);
      if (detail) {
        this.editStatus.set(detail.status);
        this.editNextDueDate.set(detail.nextDueDate ?? '');
        this.editAppointmentDate.set(detail.appointmentDate ?? '');
        this.editNotes.set(detail.notes ?? '');
      }
    } catch (error) {
      console.error('Error cargando el detalle de la inspección', error);
    } finally {
      this.detailLoading.set(false);
    }
  }

  closeDetail(): void {
    this.selectedInspectionId.set(null);
    this.selectedDetail.set(null);
    this.resetResultForm();
    this.resetCorrectiveActionForm();
  }

  async saveEdit(): Promise<void> {
    const id = this.selectedInspectionId();
    if (!id) return;
    this.savingEdit.set(true);
    try {
      const updated = await this.dataSvc.updateInspection(id, {
        status: this.editStatus(),
        nextDueDate: this.editNextDueDate() || undefined,
        appointmentDate: this.editAppointmentDate() || undefined,
        // Sin `|| undefined`, a diferencia de las fechas: una cadena vacía
        // SÍ es un valor válido para el DTO (@IsString(), sin @MinLength) y
        // el backend la aplica tal cual — es lo que permite vaciar el
        // campo. Con `|| undefined` aquí, borrar el textarea nunca llegaba
        // a enviarse (el merge del backend interpreta `undefined` como "no
        // tocar este campo"), así que la nota vieja reaparecía siempre.
        notes: this.editNotes(),
      });
      this.selectedDetail.set(updated);
      this.inspections.set(this.inspections().map((x) => (x.id === id ? { ...x, ...updated } : x)));
      this.showToast('Inspección actualizada');
    } catch (error: any) {
      console.error('Error actualizando la inspección', error);
      const msg = error?.error?.message;
      this.showToast(typeof msg === 'string' ? msg : 'No se pudo actualizar la inspección.');
    } finally {
      this.savingEdit.set(false);
    }
  }

  async deleteInspection(i: Inspection, event: Event): Promise<void> {
    event.stopPropagation();
    if (!confirm(`¿Eliminar la inspección de "${i.asset.name}" (${i.inspectionType.name})?`)) return;
    try {
      await this.dataSvc.deleteInspection(i.id);
      this.inspections.set(this.inspections().filter((x) => x.id !== i.id));
      if (this.selectedInspectionId() === i.id) this.closeDetail();
      this.showToast('Inspección eliminada');
    } catch (error) {
      console.error('Error eliminando la inspección', error);
      this.showToast('No se pudo eliminar la inspección');
    }
  }

  // ── Registrar resultado ────────────────────────────────────────────────
  resultDate = signal(this.todayIso());
  resultOutcome = signal<InspectionOutcome>('Favorable');
  resultDefects = signal('');
  resultCost = signal<number | null>(null);
  resultNotes = signal('');
  private resultFile = signal<File | null>(null);
  savingResult = signal(false);

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private resetResultForm(): void {
    this.resultDate.set(this.todayIso());
    this.resultOutcome.set('Favorable');
    this.resultDefects.set('');
    this.resultCost.set(null);
    this.resultNotes.set('');
    this.resultFile.set(null);
  }

  onResultFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.resultFile.set(input.files?.[0] ?? null);
  }

  async submitResult(): Promise<void> {
    const id = this.selectedInspectionId();
    if (!id) return;
    this.savingResult.set(true);
    try {
      await this.dataSvc.recordInspectionResult(
        id,
        {
          date: this.resultDate(),
          outcome: this.resultOutcome(),
          defects: this.resultDefects().trim() || undefined,
          cost: this.resultCost() ?? undefined,
          notes: this.resultNotes().trim() || undefined,
        },
        this.resultFile() ?? undefined,
      );
      const detail = await this.dataSvc.findInspectionById(id);
      this.selectedDetail.set(detail);
      if (detail) {
        this.inspections.set(this.inspections().map((x) => (x.id === id ? { ...x, ...detail } : x)));
        this.editStatus.set(detail.status);
      }
      this.resetResultForm();
      this.showToast('Resultado registrado');
    } catch (error) {
      console.error('Error registrando el resultado', error);
      this.showToast('No se pudo registrar el resultado');
    } finally {
      this.savingResult.set(false);
    }
  }

  async downloadCertificate(result: { id: string }): Promise<void> {
    const id = this.selectedInspectionId();
    if (!id) return;
    try {
      const blob = await this.dataSvc.downloadInspectionCertificate(id, result.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'certificado';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando el certificado', error);
      this.showToast('No se pudo descargar el certificado');
    }
  }

  // ── Acciones correctivas ──────────────────────────────────────────────
  caTitle = signal('');
  caDescription = signal('');
  caPriority = signal(2);
  caDueDate = signal('');
  savingCorrectiveAction = signal(false);

  private resetCorrectiveActionForm(): void {
    this.caTitle.set('');
    this.caDescription.set('');
    this.caPriority.set(2);
    this.caDueDate.set('');
  }

  async submitCorrectiveAction(): Promise<void> {
    const id = this.selectedInspectionId();
    const title = this.caTitle().trim();
    if (!id || !title) return;
    this.savingCorrectiveAction.set(true);
    try {
      const action = await this.dataSvc.createCorrectiveAction(id, {
        title,
        description: this.caDescription().trim() || undefined,
        priority: this.caPriority(),
        dueDate: this.caDueDate() || undefined,
      });
      const detail = this.selectedDetail();
      if (detail) {
        this.selectedDetail.set({ ...detail, correctiveActions: [action, ...detail.correctiveActions] });
      }
      this.resetCorrectiveActionForm();
      this.showToast('Acción correctiva añadida');
    } catch (error) {
      console.error('Error añadiendo la acción correctiva', error);
      this.showToast('No se pudo añadir la acción correctiva');
    } finally {
      this.savingCorrectiveAction.set(false);
    }
  }

  async updateCorrectiveActionStatus(action: CorrectiveAction, status: CorrectiveActionStatus): Promise<void> {
    try {
      const updated = await this.dataSvc.updateCorrectiveAction(action.id, { status });
      const detail = this.selectedDetail();
      if (detail) {
        this.selectedDetail.set({
          ...detail,
          correctiveActions: detail.correctiveActions.map((a) => (a.id === action.id ? updated : a)),
        });
      }
    } catch (error) {
      console.error('Error actualizando la acción correctiva', error);
      this.showToast('No se pudo actualizar la acción correctiva');
    }
  }

  // ── Nueva inspección (modal) ──────────────────────────────────────────
  showNewInspection = signal(false);
  niAssetId = signal<string>('');
  niNewAssetName = signal('');
  niNewAssetCategory = signal('');
  niNewAssetLocation = signal('');
  niTypeId = signal<string>('');
  niNewTypeCode = signal('');
  niNewTypeName = signal('');
  niNewTypeLegalBasis = signal('');
  niNewTypeRequiresOca = signal(false);
  niNextDueDate = signal('');
  niReminderDays = signal(30);
  niNotes = signal('');
  niErrors = signal<{ asset?: boolean; type?: boolean }>({});
  niSaving = signal(false);
  niError = signal<string | null>(null);

  openNewInspection(): void {
    this.niAssetId.set('');
    this.niNewAssetName.set('');
    this.niNewAssetCategory.set('');
    this.niNewAssetLocation.set('');
    this.niTypeId.set('');
    this.niNewTypeCode.set('');
    this.niNewTypeName.set('');
    this.niNewTypeLegalBasis.set('');
    this.niNewTypeRequiresOca.set(false);
    this.niNextDueDate.set('');
    this.niReminderDays.set(30);
    this.niNotes.set('');
    this.niErrors.set({});
    this.niError.set(null);
    this.showNewInspection.set(true);
  }

  closeNewInspection(): void {
    this.showNewInspection.set(false);
  }

  async submitNewInspection(): Promise<void> {
    const errors: { asset?: boolean; type?: boolean } = {};
    const isNewAsset = this.niAssetId() === NEW_ASSET_VALUE;
    if (!this.niAssetId() || (isNewAsset && !this.niNewAssetName().trim())) errors.asset = true;
    const isNewType = this.niTypeId() === NEW_TYPE_VALUE;
    if (!this.niTypeId() || (isNewType && (!this.niNewTypeCode().trim() || !this.niNewTypeName().trim()))) {
      errors.type = true;
    }
    this.niErrors.set(errors);
    if (errors.asset || errors.type) return;

    this.niSaving.set(true);
    this.niError.set(null);
    try {
      let assetId = this.niAssetId();
      if (isNewAsset) {
        const asset = await this.dataSvc.createAsset(this.estateId, {
          name: this.niNewAssetName().trim(),
          category: this.niNewAssetCategory().trim() || 'Otro',
          location: this.niNewAssetLocation().trim() || undefined,
        });
        this.assets.set([...this.assets(), asset]);
        assetId = asset.id;
      }

      let typeId = this.niTypeId();
      if (isNewType) {
        const type = await this.dataSvc.createInspectionType(this.estateId, {
          code: this.niNewTypeCode().trim(),
          name: this.niNewTypeName().trim(),
          legalBasis: this.niNewTypeLegalBasis().trim() || undefined,
          requiresOca: this.niNewTypeRequiresOca(),
        });
        this.inspectionTypes.set([...this.inspectionTypes(), type]);
        typeId = type.id;
      }

      const inspection = await this.dataSvc.createInspection(this.estateId, {
        assetId,
        inspectionTypeId: typeId,
        nextDueDate: this.niNextDueDate() || undefined,
        reminderDaysBefore: this.niReminderDays(),
        notes: this.niNotes().trim() || undefined,
      });
      this.inspections.set([inspection, ...this.inspections()]);
      this.showNewInspection.set(false);
      this.showToast('Inspección programada');
    } catch (error: any) {
      console.error('Error creando la inspección', error);
      const msg = error?.error?.message;
      this.niError.set(typeof msg === 'string' ? msg : 'No se pudo programar la inspección.');
    } finally {
      this.niSaving.set(false);
    }
  }
}
