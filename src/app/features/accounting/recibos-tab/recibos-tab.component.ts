import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import {
  Component, Input, OnInit, signal, computed, HostListener, inject
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { NuevaRemesaComponent } from '../nueva-remesa/nueva-remesa.component';
import { RegistrarCobroComponent } from '../cobros/registrar-cobro/registrar-cobro.component';
import { HistorialCobrosComponent } from '../cobros/historial-cobros/historial-cobros.component';
import { IngresosSinIdentificarComponent } from '../cobros/ingresos-sin-identificar/ingresos-sin-identificar.component';
import { AccountingEstate, AccountingReceipt, AccountingPeriod, RemesaHistoryItem, OwnerProperty, MANUAL_RECEIPT_KINDS, RECEIPT_KIND_LABELS, ReceiptKind } from '../../../core/models';
import { PropertiesService } from '../../../core/properties.service';
import { ReceiptsService } from '../../../core/receipts.service';
import { SepaService } from '../../../core/sepa.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
type StatusFilter = 'all' | 'Pagada' | 'Pendiente' | 'Parcial' | 'Devuelto' | 'Anulado';

interface ManualReceiptForm {
  propertyId: string;
  kind: ReceiptKind;
  periodKey: string;
  concept: string;
  amount: string;
  dueDate: string;
  method: string;
  includeInRemesa: boolean;
}

@Component({
  selector: 'app-recibos-tab',
  standalone: true,
  imports: [PageActionDirective,
    FormsModule, BadgeComponent, BtnComponent, IconComponent, AvatarComponent, NuevaRemesaComponent,
    RegistrarCobroComponent, HistorialCobrosComponent, IngresosSinIdentificarComponent, SelectDropdownDirective
  ],
  templateUrl: './recibos-tab.component.html',
  styleUrl: './recibos-tab.component.scss',
})
export class RecibosTabComponent implements OnInit {
  @Input() estate!: AccountingEstate;

  private propertiesSvc = inject(PropertiesService);
  private receiptsSvc = inject(ReceiptsService);
  private sepa = inject(SepaService);

  // ── Periods & filtering ─────────────────────────────────────────────────
  periods = signal<AccountingPeriod[]>([]);
  payMethods = ['Domiciliación', 'Transferencia', 'Efectivo', 'Pago en oficina', 'Bizum'];
  receiptKinds = MANUAL_RECEIPT_KINDS.map(k => ({ value: k, label: RECEIPT_KIND_LABELS[k] }));
  ALL_PERIODS_KEY = 'all';

  selectedPeriodKey = signal<string>('all');

  remesaHistory = signal<RemesaHistoryItem[]>([]);
  properties = signal<OwnerProperty[]>([]);

  async ngOnInit(): Promise<void> {
    try {
      const [periods, remesas, properties] = await Promise.all([
        this.receiptsSvc.listAccountingPeriods(this.estate.id),
        this.sepa.listRemesas(this.estate.id),
        this.propertiesSvc.listPropertiesByEstate(this.estate.id),
      ]);
      this.periods.set(periods.map(p => ({
        key: p.key,
        label: p.label,
        mon: p.monthAbbrev ?? '',
      })) as AccountingPeriod[]);
      this.remesaHistory.set(remesas);
      this.properties.set(properties);
      if (this.periods()[0]) this.selectedPeriodKey.set(this.periods()[0].key);
      await this.reloadReceipts();
    } catch (error) {
      console.error('Error cargando recibos', error);
    }
  }

  propertyLabel(p: OwnerProperty): string {
    return p.ref ?? ([p.staircase, p.floor, p.door].filter(Boolean).join('-') || p.type);
  }

  selectedPropertyLabel(): string {
    const p = this.properties().find(p => p.id === this.manualForm.propertyId);
    return p ? this.propertyLabel(p) : '—';
  }

  /** Remesa ya presentada para el periodo seleccionado, si existe. */
  remesaForCurrentPeriod = computed(() =>
    this.remesaHistory().find(r => r.periodKey === this.selectedPeriodKey())
  );

  private async reloadReceipts(): Promise<void> {
    this.receipts.set(await this.receiptsSvc.listReceiptsByEstate(this.estate.id));
  }
  searchQuery      = signal('');
  statusFilter     = signal<StatusFilter>('all');
  methodFilter     = signal('');

  // ── Context menu ────────────────────────────────────────────────────────
  openMenuId   = signal<string | null>(null);
  menuPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });

  // ── Modals ──────────────────────────────────────────────────────────────
  showSepaModal    = signal(false);
  showManualModal  = signal(false);
  showRemesaWizard = signal(false);

  manualForm: ManualReceiptForm = {
    propertyId: '', kind: 'cuota_ordinaria',
    periodKey: this.defaultPeriodKey(), concept: '', amount: '',
    dueDate: '', method: 'Domiciliación', includeInRemesa: true,
  };
  manualSaving = signal(false);
  manualError = signal<string | null>(null);

  // ── Editar recibo ───────────────────────────────────────────────────────
  // Solo método de cobro y, si el recibo está Devuelto, el código/motivo de
  // la devolución: son los únicos campos que admite UpdateReceiptDto. El
  // importe, concepto y vencimiento no se tocan aquí — no hay endpoint que
  // los edite, y no debería haberlo: romperían la integridad del ciclo de
  // facturación (el recibo nace de un periodo, no es un documento libre).
  editingReceipt = signal<AccountingReceipt | null>(null);
  editForm = { method: '', returnCode: '', returnReason: '' };
  editSaving = signal(false);
  editError = signal<string | null>(null);

  private defaultPeriodKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  openManualModal(): void {
    this.manualError.set(null);
    this.showManualModal.set(true);
  }

  closeManualModal(): void {
    this.manualError.set(null);
    this.showManualModal.set(false);
  }

  // Inline status-change toast
  toastMessage = signal<string | null>(null);

  // ── Derived receipts list ───────────────────────────────────────────────
  private receipts = signal<AccountingReceipt[]>([]);

  receiptsForPeriod = computed(() => {
    const pk = this.selectedPeriodKey();
    return pk === this.ALL_PERIODS_KEY
      ? this.receipts()
      : this.receipts().filter(r => r.periodKey === pk);
  });

  filteredReceipts = computed(() => {
    let list = this.receiptsForPeriod();
    const q = this.searchQuery().toLowerCase().trim();
    const sf = this.statusFilter();
    const mf = this.methodFilter();

    if (q) list = list.filter(r =>
      r.owner.toLowerCase().includes(q) ||
      r.unit.toLowerCase().includes(q) ||
      r.no.toLowerCase().includes(q)
    );
    if (sf === 'Pendiente') list = list.filter(r => r.status === 'Pendiente' || r.status === 'Parcial');
    else if (sf !== 'all') list = list.filter(r => r.status === sf);
    if (mf) list = list.filter(r => r.method === mf);
    return list;
  });

  // ── KPIs ────────────────────────────────────────────────────────────────
  // Los anulados no cuentan: su emisión está revertida. Lo pendiente sale de
  // `outstanding` (lo que falta por cobrar), no del importe: un recibo
  // cobrado en parte solo debe el resto.
  kpis = computed(() => {
    const list = this.receiptsForPeriod().filter(r => r.status !== 'Anulado');
    const pendingOf = (r: AccountingReceipt) => r.outstanding ?? (r.status === 'Pagada' ? 0 : r.amount);
    const total    = list.reduce((s, r) => s + r.amount, 0);
    const cobrado  = list.reduce((s, r) => s + (r.amount - pendingOf(r)), 0);
    const pendiente= list.filter(r => r.status === 'Pendiente' || r.status === 'Parcial').reduce((s, r) => s + pendingOf(r), 0);
    const devuelto = list.filter(r => r.status === 'Devuelto').reduce((s, r) => s + pendingOf(r), 0);
    return { total, cobrado, pendiente, devuelto };
  });

  // Status chip counts
  countAll       = computed(() => this.receiptsForPeriod().length);
  countPagada    = computed(() => this.receiptsForPeriod().filter(r => r.status === 'Pagada').length);
  countPendiente = computed(() => this.receiptsForPeriod().filter(r => r.status === 'Pendiente' || r.status === 'Parcial').length);
  countDevuelto  = computed(() => this.receiptsForPeriod().filter(r => r.status === 'Devuelto').length);
  countAnulado   = computed(() => this.receiptsForPeriod().filter(r => r.status === 'Anulado').length);

  // ── Current period info (for SEPA popover) ──────────────────────────────
  currentPeriod = computed<AccountingPeriod | undefined>(() => {
    const pk = this.selectedPeriodKey();
    return this.periods().find(p => p.key === pk);
  });

  sepaCount = computed(() =>
    this.receiptsForPeriod().filter(r => r.method === 'Domiciliación').length
  );
  sepaAmount = computed(() =>
    this.receiptsForPeriod().filter(r => r.method === 'Domiciliación').reduce((s, r) => s + r.amount, 0)
  );

  // ── Helpers ─────────────────────────────────────────────────────────────
  get isAllPeriods(): boolean { return this.selectedPeriodKey() === this.ALL_PERIODS_KEY; }

  statusBadgeVariant(status: string): string {
    if (status === 'Pagada') return 'green';
    if (status === 'Pendiente' || status === 'Parcial') return 'warning';
    if (status === 'Anulado') return 'default';
    return 'error';
  }

  /** Se puede anular si no tiene nada cobrado: pendiente, o devuelto sin volver a cobrar. */
  canCancel(r: AccountingReceipt): boolean {
    const nothingCollected = r.outstanding === undefined || r.outstanding === r.amount;
    return (r.status === 'Pendiente' || r.status === 'Devuelto') && nothingCollected;
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  contextActions(r: AccountingReceipt): { label: string; icon: string; danger?: boolean; action: () => void }[][] {
    const common = [
      { label: 'Ver detalle',           icon: 'eye',       action: () => this.openDetail(r) },
      { label: 'Descargar recibo PDF',  icon: 'download',  action: () => this.showToast('Descargando PDF…') },
      { label: 'Enviar al propietario', icon: 'send',      action: () => this.showToast(`Enviando a ${r.owner}…`) },
    ];
    const byStatus: { label: string; icon: string; danger?: boolean; action: () => void }[] = [];
    if (this.canCollect(r)) {
      byStatus.push({ label: 'Registrar cobro', icon: 'check', action: () => this.openCollect(r) });
    }
    if (r.status === 'Pendiente') {
      if (r.proofFileName) {
        byStatus.push({ label: 'Ver justificante de pago', icon: 'file-text', action: () => this.downloadProof(r) });
      }
      byStatus.push(
        { label: 'Reenviar aviso de pago',     icon: 'bell',     action: () => this.showToast('Aviso reenviado') },
        { label: 'Incluir en próxima remesa',  icon: 'file',     action: () => this.showToast('Añadido a remesa') },
      );
    }
    if (r.status === 'Devuelto') {
      byStatus.push(
        { label: 'Ver motivo de devolución',   icon: 'eye',      action: () => this.showToast(`Motivo: ${r.returnCode} – ${r.returnReason}`) },
        { label: 'Generar reclamación',        icon: 'file-text',action: () => this.showToast('Reclamación generada') },
      );
    }
    if (r.status === 'Pagada') {
      byStatus.push(
        // Antes solo mostraba un toast — mismo botón, mismo `downloadProof`
        // que ya usa el caso Pendiente unas líneas más arriba.
        { label: 'Ver justificante',           icon: 'file-text',action: () => this.downloadProof(r) },
        { label: 'Marcar como pendiente',      icon: 'refresh',  action: () => this.changeStatus(r, 'Pendiente') },
      );
    }
    // Un recibo anulado es terminal: solo se consulta.
    if (r.status === 'Anulado') return [common];
    const management: { label: string; icon: string; danger?: boolean; action: () => void }[] = [
      { label: 'Editar', icon: 'edit', action: () => this.openEditModal(r) },
    ];
    if (this.canCancel(r)) {
      management.push({ label: 'Anular recibo', icon: 'trash', danger: true, action: () => this.openCancel(r) });
    }
    return [common, byStatus, management].filter(g => g.length > 0);
  }

  // ── Vista de detalle ─────────────────────────────────────────────────────
  selectedReceipt = signal<AccountingReceipt | null>(null);

  openDetail(r: AccountingReceipt): void {
    this.selectedReceipt.set(r);
    this.openMenuId.set(null);
  }

  closeDetail(): void {
    this.selectedReceipt.set(null);
  }

  /** Acciones del footer del detalle — la lista completa vive en contextActions(); aquí solo las relevantes para una vista de solo-lectura. */
  detailActions(r: AccountingReceipt): { label: string; icon: string; danger?: boolean; action: () => void }[] {
    // Deshacer un cobro o registrar su devolución se hace desde el historial del detalle.
    if (this.canCollect(r)) {
      return [{ label: 'Registrar cobro', icon: 'check', action: () => this.openCollect(r) }];
    }
    return [];
  }

  // ── Cobros ─────────────────────────────────────────────────────────────
  /** Se cobra lo que el recibo todavía debe: pendiente, a medias o devuelto. */
  canCollect(r: AccountingReceipt): boolean {
    return r.status === 'Pendiente' || r.status === 'Parcial' || r.status === 'Devuelto';
  }

  collecting = signal<AccountingReceipt | null>(null);
  showSuspense = signal(false);

  openCollect(r: AccountingReceipt): void {
    this.collecting.set(r);
    this.openMenuId.set(null);
  }

  async onCollectClosed(result: { saved: boolean; message?: string }): Promise<void> {
    const r = this.collecting();
    this.collecting.set(null);
    if (!result.saved || !r) return;
    this.showToast(result.message ?? 'Cobro registrado');
    await this.refreshAfterChange(r.id);
  }

  /** Algo cambió desde el historial (deshacer, devolución): recarga lista y detalle. */
  async onHistoryChanged(message: string, receiptId: string): Promise<void> {
    this.showToast(message);
    await this.refreshAfterChange(receiptId);
  }

  async onSuspenseClosed(result: { changed: boolean }): Promise<void> {
    this.showSuspense.set(false);
    if (result.changed) await this.reloadReceipts();
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  openMenu(event: MouseEvent, id: string): void {
    event.stopPropagation();
    if (this.openMenuId() === id) { this.openMenuId.set(null); return; }
    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    // position: fixed en coordenadas de viewport — el menú se pinta fuera de
    // .receipts-table-wrap (overflow-x: auto para el scroll horizontal de la
    // tabla), que si no lo recorta en tablas de pocas filas o cerca del borde.
    const menuWidth = 220;
    this.menuPosition.set({ top: rect.bottom + 4, left: Math.max(8, rect.right - menuWidth) });
    this.openMenuId.set(id);
  }

  @HostListener('document:click')
  closeMenu(): void { this.openMenuId.set(null); }

  /**
   * Cambiar el estado contabiliza en el backend: cobrar (banco o caja según
   * el método), devolver o deshacer el cobro. Si la contabilidad lo
   * rechaza, se muestra el motivo.
   */
  async changeStatus(r: AccountingReceipt, newStatus: 'Pagada' | 'Pendiente' | 'Devuelto'): Promise<void> {
    try {
      await this.receiptsSvc.updateReceipt(r.id, { status: newStatus });
      this.showToast(`Recibo ${r.no} marcado como ${newStatus}`);
      await this.refreshAfterChange(r.id);
    } catch (error: any) {
      console.error('Error actualizando el recibo', error);
      const msg = error?.error?.message;
      this.showToast(typeof msg === 'string' ? msg : `No se pudo actualizar el recibo ${r.no}`);
    }
    this.openMenuId.set(null);
  }

  /** Recarga la lista y, si el detalle sigue abierto, su fila. */
  private async refreshAfterChange(receiptId: string): Promise<void> {
    await this.reloadReceipts();
    if (this.selectedReceipt()?.id === receiptId) {
      this.selectedReceipt.set(this.receipts().find(x => x.id === receiptId) ?? null);
    }
  }

  // ── Anular recibo ───────────────────────────────────────────────────────
  cancelling = signal<AccountingReceipt | null>(null);
  cancelReason = signal('');
  cancelSaving = signal(false);
  cancelError = signal<string | null>(null);

  openCancel(r: AccountingReceipt): void {
    this.cancelling.set(r);
    this.cancelReason.set('');
    this.cancelError.set(null);
    this.openMenuId.set(null);
  }

  closeCancel(): void {
    this.cancelling.set(null);
  }

  async confirmCancel(): Promise<void> {
    const r = this.cancelling();
    if (!r) return;
    const reason = this.cancelReason().trim();
    if (reason.length < 3) {
      this.cancelError.set('Indica el motivo de la anulación (queda en el recibo y en la contabilidad).');
      return;
    }
    this.cancelSaving.set(true);
    this.cancelError.set(null);
    try {
      await this.receiptsSvc.cancelReceipt(r.id, reason);
      this.cancelling.set(null);
      this.showToast(`Recibo ${r.no} anulado`);
      await this.refreshAfterChange(r.id);
    } catch (error: any) {
      const msg = error?.error?.message;
      this.cancelError.set(typeof msg === 'string' ? msg : 'No se pudo anular el recibo');
    } finally {
      this.cancelSaving.set(false);
    }
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    this.openMenuId.set(null);
    setTimeout(() => this.toastMessage.set(null), 3000);
  }

  async submitManualReceipt(): Promise<void> {
    const f = this.manualForm;
    if (!f.propertyId || !f.concept || !f.amount || !f.dueDate) return;
    this.manualSaving.set(true);
    this.manualError.set(null);
    try {
      const created = await this.receiptsSvc.createManualReceipt(this.estate.id, {
        propertyId: f.propertyId,
        periodKey: f.periodKey,
        concept: f.concept,
        kind: f.kind,
        amount: parseFloat(f.amount) || 0,
        dueDate: f.dueDate,
        method: f.method,
        includeInRemesa: f.includeInRemesa,
      });
      this.receipts.set([created, ...this.receipts()]);
      // El periodo puede ser nuevo (recién creado por el backend) — se
      // recarga para que aparezca en el filtro de periodos.
      const periods = await this.receiptsSvc.listAccountingPeriods(this.estate.id);
      this.periods.set(periods.map(p => ({ key: p.key, label: p.label, mon: p.monthAbbrev ?? '' })) as AccountingPeriod[]);
      this.showManualModal.set(false);
      this.showToast(`Recibo manual ${created.no} creado`);
      this.manualForm = { propertyId: '', kind: 'cuota_ordinaria', periodKey: this.defaultPeriodKey(), concept: '', amount: '', dueDate: '', method: 'Domiciliación', includeInRemesa: true };
    } catch (error: any) {
      console.error('Error creando el recibo manual', error);
      const msg = error?.error?.message;
      this.manualError.set(typeof msg === 'string' ? msg : 'No se pudo crear el recibo manual');
    } finally {
      this.manualSaving.set(false);
    }
  }

  async onWizardClosed(result: { generated: boolean }): Promise<void> {
    this.showRemesaWizard.set(false);
    if (result.generated) {
      this.remesaHistory.set(await this.sepa.listRemesas(this.estate.id));
      this.showToast('Remesa generada correctamente');
    }
  }

  // ── Descarga SEPA ─────────────────────────────────────────────────────
  /**
   * Descarga el pain.008 EXACTO ya presentado para el periodo seleccionado
   * — nunca genera uno nuevo aquí. Antes este botón llamaba a
   * `createRemesa()` en cada click, así que reabrir el modal y volver a
   * descargar creaba una remesa DUPLICADA cada vez (sin idempotencia, sin
   * validar `creditorId`/fecha de cargo). Generar una remesa nueva es
   * responsabilidad exclusiva del wizard "Nueva remesa"
   * (`NuevaRemesaComponent`, botón de al lado) que sí valida todo eso.
   */
  async downloadSepaFile(): Promise<void> {
    const match = this.remesaForCurrentPeriod();
    if (!match) {
      this.showToast('Todavía no se generó ninguna remesa para este periodo. Usa "Nueva remesa".');
      return;
    }
    try {
      const xml = await this.sepa.getRemesaFile(match.id);
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `remesa-${match.id}.xml`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.showSepaModal.set(false);
    } catch (error) {
      console.error('Error descargando el fichero SEPA', error);
      this.showToast('No se pudo descargar el fichero SEPA.');
    }
  }

  openEditModal(r: AccountingReceipt): void {
    this.editingReceipt.set(r);
    this.editForm = {
      method: r.method,
      returnCode: r.returnCode ?? '',
      returnReason: r.returnReason ?? '',
    };
    this.editError.set(null);
    this.openMenuId.set(null);
  }

  closeEditModal(): void {
    this.editingReceipt.set(null);
    this.editError.set(null);
  }

  async submitEditReceipt(): Promise<void> {
    const r = this.editingReceipt();
    if (!r) return;
    this.editSaving.set(true);
    this.editError.set(null);
    try {
      await this.receiptsSvc.updateReceipt(r.id, {
        method: this.editForm.method,
        ...(r.status === 'Devuelto'
          ? {
              returnCode: this.editForm.returnCode,
              returnReason: this.editForm.returnReason,
            }
          : {}),
      });
      await this.reloadReceipts();
      if (this.selectedReceipt()?.id === r.id) {
        this.selectedReceipt.set(this.receipts().find(x => x.id === r.id) ?? null);
      }
      this.showToast(`Recibo ${r.no} actualizado`);
      this.editingReceipt.set(null);
    } catch (error: any) {
      console.error('Error editando el recibo', error);
      const msg = error?.error?.message;
      this.editError.set(typeof msg === 'string' ? msg : 'No se pudo guardar el recibo');
    } finally {
      this.editSaving.set(false);
    }
  }

  async downloadProof(r: AccountingReceipt): Promise<void> {
    try {
      const blob = await this.receiptsSvc.downloadPaymentProof(r.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = r.proofFileName || 'justificante';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando el justificante', error);
      this.showToast('No se pudo descargar el justificante.');
    }
  }
}
