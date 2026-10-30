import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { saveBlob } from '../../../../core/file-download';
import type { ContractRenewal, EstateContract, SupplierDocument } from '../../../../core/models';
import { SuppliersStaffService } from '../../../../core/suppliers-staff.service';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { StatusPillComponent } from '../../../../shared/components/status-pill/status-pill.component';
import {
  FREQUENCY_LABEL, RENEWAL_LABEL, STATUS_PILL, amountText, canCancel, canEdit, canRenew, contractAlert, formatDate,
} from '../contracts-model';
import { ContractDialogDirective } from '../dialog-behavior.directive';

/**
 * Detalle de un contrato (acción «Ver»): datos, importe anual y mensual, documentos descargables y las
 * renovaciones registradas, con las acciones que admite (editar, renovar, cancelar, ver proveedor).
 */
@Component({
  selector: 'app-contract-detail',
  standalone: true,
  imports: [ContractDialogDirective, BtnComponent, IconComponent, StatusPillComponent],
  templateUrl: './contract-detail.component.html',
  styleUrl: './contract-detail.component.scss',
})
export class ContractDetailComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Input({ required: true }) contract!: EstateContract;
  /** Renovaciones de la finca; aquí se muestran las de este contrato. */
  @Input() renewals: ContractRenewal[] = [];
  @Output() closed = new EventEmitter<void>();
  @Output() edit = new EventEmitter<EstateContract>();
  @Output() renew = new EventEmitter<EstateContract>();
  @Output() cancel = new EventEmitter<EstateContract>();
  @Output() openSupplier = new EventEmitter<EstateContract>();

  private api = inject(SuppliersStaffService);

  readonly documents = signal<SupplierDocument[] | null>(null);
  readonly documentsFailed = signal(false);
  readonly downloadError = signal<string | null>(null);

  readonly pill = computed(() => STATUS_PILL[this.contract.status]);
  readonly alert = computed(() => contractAlert(this.contract));
  readonly amount = computed(() => amountText(this.contract));
  readonly start = computed(() => formatDate(this.contract.startDate));
  readonly end = computed(() => (this.contract.endDate ? formatDate(this.contract.endDate) : 'Indefinido'));
  readonly renewalLabel = computed(() => RENEWAL_LABEL[this.contract.renewalType] ?? this.contract.renewalType);
  readonly costAsRecorded = computed(() => {
    const c = this.contract;
    if (c.costAmount == null) return 'Sin importe';
    const money = new Intl.NumberFormat('es-ES', { style: 'currency', currency: c.currency || 'EUR' }).format(c.costAmount);
    return `${money} · ${c.costFrequency ? FREQUENCY_LABEL[c.costFrequency] : 'periodicidad sin informar'}`;
  });
  readonly cancelledOn = computed(() => formatDate(this.contract.cancelledAt));
  readonly mine = computed(() =>
    this.renewals.filter((r) => r.contractId === this.contract.id).map((r) => ({
      id: r.id,
      date: formatDate(r.renewedAt),
      newEnd: formatDate(r.newEndDate),
      kind: RENEWAL_LABEL[r.kind] ?? r.kind,
      amount: r.annualCost != null ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: r.currency || 'EUR' }).format(r.annualCost) : null,
      notes: r.notes ?? null,
    })),
  );

  readonly canEdit = computed(() => canEdit(this.contract));
  readonly canRenew = computed(() => canRenew(this.contract));
  readonly canCancel = computed(() => canCancel(this.contract));

  async ngOnInit(): Promise<void> {
    try {
      const all = await this.api.listSupplierDocuments(this.estateId, this.contract.supplierId);
      this.documents.set(all.filter((d) => d.contractId === this.contract.id));
    } catch (error) {
      console.error('Error cargando los documentos del contrato', error);
      this.documentsFailed.set(true);
      this.documents.set([]);
    }
  }

  /** Guarda el fichero en el equipo del usuario (aparte para poder sustituirlo en los tests). */
  saveFile(blob: Blob, name: string): Promise<void> {
    return saveBlob(blob, name);
  }

  async download(doc: SupplierDocument): Promise<void> {
    this.downloadError.set(null);
    try {
      const blob = await this.api.downloadSupplierDocument(this.estateId, this.contract.supplierId, doc.id);
      await this.saveFile(blob, doc.fileName);
    } catch (error) {
      console.error('Error descargando el documento', error);
      this.downloadError.set('No se pudo descargar el documento. Inténtalo de nuevo.');
    }
  }
}
