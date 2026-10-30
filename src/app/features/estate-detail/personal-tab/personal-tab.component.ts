import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { StaffDocument, StaffMember } from '../../../core/models';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
const POSITION_SUGGESTIONS = ['Portero', 'Seguridad', 'Socorrista', 'Conserje', 'Jardinero', 'Limpieza'];
const CONTRACT_TYPES: StaffMember['contractType'][] = ['Indefinido', 'Temporal', 'Obra y servicio', 'Autónomo'];

@Component({
  selector: 'app-personal-tab',
  standalone: true,
  imports: [PageActionDirective, BadgeComponent, BtnComponent, IconComponent, AvatarComponent, FormsModule, SelectDropdownDirective],
  templateUrl: './personal-tab.component.html',
  styleUrl: './personal-tab.component.scss',
})
export class PersonalTabComponent implements OnInit {
  @Input() estateId!: string;

  private dataSvc = inject(SuppliersStaffService);
  staff = signal<StaffMember[]>([]);
  toastMessage = signal<string | null>(null);

  positionSuggestions = POSITION_SUGGESTIONS;
  contractTypeOptions = CONTRACT_TYPES;

  async ngOnInit(): Promise<void> {
    await this.reloadStaff();
  }

  private async reloadStaff(): Promise<void> {
    try {
      this.staff.set(await this.dataSvc.listStaffByEstate(this.estateId));
    } catch (error) {
      console.error('Error cargando el personal', error);
    }
  }

  activeStaff = computed(() => this.staff().filter(s => s.status === 'Activo'));
  positionsCount = computed(() => new Set(this.staff().map(s => s.position)).size);

  // ── Detalle de miembro del personal (drawer) ─────────────────────────────
  selectedStaffId = signal<string | null>(null);
  staffDocuments = signal<StaffDocument[]>([]);
  documentsLoading = signal(false);

  get selectedStaffMember(): StaffMember | null {
    const id = this.selectedStaffId();
    return id ? this.staff().find(s => s.id === id) ?? null : null;
  }

  async openStaffDetail(s: StaffMember): Promise<void> {
    this.selectedStaffId.set(s.id);
    this.documentsLoading.set(true);
    try {
      this.staffDocuments.set(await this.dataSvc.listStaffDocuments(this.estateId, s.id));
    } catch (error) {
      console.error('Error cargando los documentos del personal', error);
    } finally {
      this.documentsLoading.set(false);
    }
  }

  closeStaffDetail(): void {
    this.selectedStaffId.set(null);
    this.staffDocuments.set([]);
  }

  async darDeBaja(s: StaffMember): Promise<void> {
    if (!confirm(`¿Dar de baja a ${s.fullName}? Se conservará su histórico.`)) return;
    try {
      const updated = await this.dataSvc.updateStaffMember(this.estateId, s.id, {
        status: 'Baja',
        endDate: this.todayIso(),
      });
      this.staff.set(this.staff().map(x => x.id === s.id ? updated : x));
      this.showToast(`${s.fullName} dado de baja`);
    } catch (error) {
      console.error('Error dando de baja al miembro del personal', error);
      this.showToast('No se pudo completar la baja');
    }
  }

  // ── Documentos (adjuntos, siempre privados a gestión) ────────────────────
  docTitleInput = signal('');
  private pendingDocFile = signal<File | null>(null);
  uploadingDoc = signal(false);

  onDocFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pendingDocFile.set(input.files?.[0] ?? null);
  }

  async submitDocument(): Promise<void> {
    const file = this.pendingDocFile();
    const staffId = this.selectedStaffId();
    if (!file || !staffId) return;
    this.uploadingDoc.set(true);
    try {
      const doc = await this.dataSvc.uploadStaffDocument(this.estateId, staffId, this.docTitleInput().trim(), file);
      this.staffDocuments.set([doc, ...this.staffDocuments()]);
      this.docTitleInput.set('');
      this.pendingDocFile.set(null);
      this.showToast('Documento adjuntado correctamente');
    } catch (error) {
      console.error('Error adjuntando el documento', error);
      this.showToast('No se pudo adjuntar el documento');
    } finally {
      this.uploadingDoc.set(false);
    }
  }

  async downloadDocument(doc: StaffDocument): Promise<void> {
    const staffId = this.selectedStaffId();
    if (!staffId) return;
    try {
      const blob = await this.dataSvc.downloadStaffDocument(this.estateId, staffId, doc.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando el documento', error);
      this.showToast('No se pudo descargar el documento');
    }
  }

  async deleteDocument(doc: StaffDocument): Promise<void> {
    const staffId = this.selectedStaffId();
    if (!staffId) return;
    if (!confirm(`¿Eliminar el documento "${doc.title}"?`)) return;
    try {
      await this.dataSvc.deleteStaffDocument(this.estateId, staffId, doc.id);
      this.staffDocuments.set(this.staffDocuments().filter(d => d.id !== doc.id));
      this.showToast('Documento eliminado');
    } catch (error) {
      console.error('Error eliminando el documento', error);
      this.showToast('No se pudo eliminar el documento');
    }
  }

  // ── Nuevo miembro del personal ────────────────────────────────────────────
  showNuevoPersonal = signal(false);
  npFullName = signal('');
  npPosition = signal('');
  npNationalId = signal('');
  npEmail = signal('');
  npPhone = signal('');
  npContractType = signal<StaffMember['contractType']>('Indefinido');
  npStartDate = signal(this.todayIso());
  npSchedule = signal('');
  npMonthlyCost = signal<number | null>(null);
  npErrors = signal<{ fullName?: boolean; position?: boolean }>({});
  npSaving = signal(false);
  npError = signal<string | null>(null);

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  openNuevoPersonal(): void {
    this.npFullName.set('');
    this.npPosition.set('');
    this.npNationalId.set('');
    this.npEmail.set('');
    this.npPhone.set('');
    this.npContractType.set('Indefinido');
    this.npStartDate.set(this.todayIso());
    this.npSchedule.set('');
    this.npMonthlyCost.set(null);
    this.npErrors.set({});
    this.npError.set(null);
    this.showNuevoPersonal.set(true);
  }

  closeNuevoPersonal(): void {
    this.showNuevoPersonal.set(false);
  }

  async submitNuevoPersonal(): Promise<void> {
    const errors: { fullName?: boolean; position?: boolean } = {};
    if (!this.npFullName().trim()) errors.fullName = true;
    if (!this.npPosition().trim()) errors.position = true;
    this.npErrors.set(errors);
    if (errors.fullName || errors.position) return;

    this.npSaving.set(true);
    this.npError.set(null);
    try {
      const staff = await this.dataSvc.createStaffMember(this.estateId, {
        fullName: this.npFullName().trim(),
        position: this.npPosition().trim(),
        nationalId: this.npNationalId().trim() || undefined,
        email: this.npEmail().trim() || undefined,
        phone: this.npPhone().trim() || undefined,
        contractType: this.npContractType(),
        startDate: this.npStartDate(),
        schedule: this.npSchedule().trim() || undefined,
        monthlyCost: this.npMonthlyCost() ?? undefined,
      });
      this.staff.set([staff, ...this.staff()]);
      this.showNuevoPersonal.set(false);
      this.showToast('Miembro del personal añadido correctamente');
    } catch (error: any) {
      console.error('Error creando el miembro del personal', error);
      const msg = error?.error?.message;
      this.npError.set(typeof msg === 'string' ? msg : 'No se pudo añadir el miembro del personal');
    } finally {
      this.npSaving.set(false);
    }
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
}
