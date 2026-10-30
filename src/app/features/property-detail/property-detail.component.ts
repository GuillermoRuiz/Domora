import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { BadgeComponent } from '../../shared/components/badge/badge.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { TransferInstructionsModalComponent } from '../../shared/components/transfer-instructions-modal/transfer-instructions-modal.component';
import { OwnerProperty, Amenity, Booking, LinkEstate, LinkageStatus, PropertyView, AccountingReceipt, Communication, CommunicationCategory, StaffDirectoryEntry} from '../../core/models';
import { ReceiptsService } from '../../core/receipts.service';
import { ComunicadosService } from '../../core/comunicados.service';
import { ResourceReadsService } from '../../core/resource-reads.service';
import { AmenitiesService } from '../../core/amenities.service';
import { SuppliersStaffService } from '../../core/suppliers-staff.service';
import { PropertiesService } from '../../core/properties.service';
import { MembershipsMessagingService } from '../../core/memberships-messaging.service';
import { ReportsService } from '../../core/reports.service';
import { DebtorsService } from '../../core/debtors.service';
import { MembersSectionComponent } from './members-section/members-section.component';
import { JuntasSectionComponent } from './juntas-section/juntas-section.component';

import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';

const COMMUNICATIONS_PAGE_SIZE = 20;

// 'Urgente' queda fuera a propósito: el backend la rechaza para rol C
// (assertPrivilegedFields), es exclusiva de la gestora.
const COMMUNICATION_CATEGORY_OPTIONS: CommunicationCategory[] = ['General', 'Mercadillo', 'ObjetosPerdidos', 'Evento'];
const COMMUNICATION_CATEGORY_LABELS: Record<CommunicationCategory, string> = {
  General: 'General',
  Urgente: 'Urgente',
  Mercadillo: 'Mercadillo vecinal',
  ObjetosPerdidos: 'Objetos perdidos',
  Evento: 'Evento',
};

type Tab = 'summary' | 'receipts' | 'communications' | 'reservas' | 'juntas';
type ReservaFilter = 'all' | 'upcoming' | 'past';
type VincMode = 'existing' | 'request';

interface CalendarDay {
  date: string;
  label: number;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  hasBooking: boolean;
}

const TYPE_ICON: Record<string, string> = {
  Piso: 'home', Casa: 'home', Parking: 'car', Trastero: 'package', Local: 'store',
};

const TYPE_THEME: Record<string, string> = {
  Piso: 'theme-blue', Casa: 'theme-blue', Parking: 'theme-purple', Trastero: 'theme-purple', Local: 'theme-green',
};

@Component({
  selector: 'app-property-detail',
  standalone: true,
  imports: [TopbarComponent, BadgeComponent, IconComponent, BtnComponent, CurrencyPipe, DecimalPipe, FormsModule, TransferInstructionsModalComponent, MembersSectionComponent, JuntasSectionComponent, SelectDropdownDirective],
  templateUrl: './property-detail.component.html',
  styleUrl: './property-detail.component.scss'
})
export class PropertyDetailComponent implements OnInit {
  router = inject(Router);
  route = inject(ActivatedRoute);
  state = inject(StateService);
  properties = inject(PropertiesService);
  membershipsMessaging = inject(MembershipsMessagingService);
  comunicados = inject(ComunicadosService);
  receiptsSvc = inject(ReceiptsService);
  resourceReads = inject(ResourceReadsService);
  amenitiesSvc = inject(AmenitiesService);
  suppliersStaff = inject(SuppliersStaffService);
  reports = inject(ReportsService);
  debtorsSvc = inject(DebtorsService);

  activeTab = signal<Tab>('summary');

  receipts = signal<AccountingReceipt[]>([]);
  communications = signal<(Communication & { read?: boolean })[]>([]);
  /** Total en servidor: puede ser mayor que `communications().length` (lista paginada). */
  communicationsTotal = signal(0);
  communicationsPage = signal(1);
  communicationsLoadingMore = signal(false);
  hasMoreCommunications = computed(() => this.communications().length < this.communicationsTotal());
  private resolvedEstateId: string | null = null;
  // TODO(backend): catálogo público de fincas para el wizard de vinculación
  // (alta de AdhesionRequest) — sin endpoint todavía.
  linkEstates: LinkEstate[] = [];

  tabs = computed<{ id: Tab; label: string }[]>(() => {
    const base: { id: Tab; label: string }[] = [
      { id: 'summary', label: 'Resumen' },
      { id: 'receipts', label: `Recibos (${this.receipts().length})` },
      { id: 'communications', label: `Comunicados (${this.communicationsTotal()})` },
      { id: 'juntas', label: 'Juntas' },
    ];
    if (this.amenities().length > 0) {
      base.push({ id: 'reservas', label: 'Reservas' });
    }
    return base;
  });

  typeIcon = computed(() => TYPE_ICON[this.property?.type ?? ''] || 'home');
  typeTheme = computed(() => TYPE_THEME[this.property?.type ?? ''] || 'theme-blue');

  paidThisYear = computed(() => (this.property?.quotaMonthly ?? 0) * 4);

  recentCommunications = computed(() => this.communications().slice(0, 2));

  // ── Estado de lectura de comunicados (por usuario) ───────
  // Sustituye a los antiguos flags globales `Communication.unread` y
  // `Document.isNew` — ahora resueltos contra ResourceRead vía ResourceReadsService.
  isCommUnread(commId: string): boolean {
    return !(this.communications().find(c => c.id === commId)?.read ?? false);
  }

  markCommRead(commId: string): void {
    this.communications.set(this.communications().map(c => c.id === commId ? { ...c, read: true } : c));
    void this.resourceReads.markCommunicationRead('', commId);
  }

  markAllCommunicationsRead(): void {
    for (const c of this.communications()) this.markCommRead(c.id);
  }

  /** Carga la siguiente página y la añade a la lista, sin recargar lo ya mostrado. */
  async loadMoreCommunications(): Promise<void> {
    const estateId = this.resolvedEstateId;
    if (!estateId || this.communicationsLoadingMore() || !this.hasMoreCommunications()) return;
    this.communicationsLoadingMore.set(true);
    try {
      const next = this.communicationsPage() + 1;
      const page = await this.comunicados.listCommunicationsByEstate(estateId, { page: next, pageSize: COMMUNICATIONS_PAGE_SIZE, filter: this.commFilter() });
      this.communications.set([...this.communications(), ...page.items]);
      this.communicationsTotal.set(page.total);
      this.communicationsPage.set(page.page);
    } catch (error) {
      console.error('Error cargando más comunicados', error);
    } finally {
      this.communicationsLoadingMore.set(false);
    }
  }

  // ── Comunicados: alta/edición propia + filtro Activos/Archivados ──────
  commFilter = signal<'active' | 'archived'>('active');
  showNuevoComunicado = signal(false);
  commEditingId = signal<string | null>(null);
  commTitle = signal('');
  commBody = signal('');
  /** `<input type="date">` (yyyy-mm-dd); '' = sin fecha de vigencia. */
  commActiveUntil = signal('');
  commCategory = signal<CommunicationCategory>('General');
  commErrors = signal<{ title?: boolean; body?: boolean }>({});
  communicationCategoryOptions = COMMUNICATION_CATEGORY_OPTIONS;

  communicationCategoryLabel(cat: CommunicationCategory): string {
    return COMMUNICATION_CATEGORY_LABELS[cat];
  }

  /** Recarga la página 1 con el filtro activo — se usa en la carga inicial y cada vez que cambia `commFilter`. */
  private async reloadCommunications(): Promise<void> {
    const estateId = this.resolvedEstateId;
    if (!estateId) return;
    try {
      const page = await this.comunicados.listCommunicationsByEstate(estateId, { page: 1, pageSize: COMMUNICATIONS_PAGE_SIZE, filter: this.commFilter() });
      this.communications.set(page.items);
      this.communicationsTotal.set(page.total);
      this.communicationsPage.set(page.page);
    } catch (error) {
      console.error('Error cargando los comunicados', error);
    }
  }

  setCommFilter(filter: 'active' | 'archived'): void {
    if (this.commFilter() === filter) return;
    this.commFilter.set(filter);
    void this.reloadCommunications();
  }

  isMyCommunication(comm: Communication): boolean {
    return comm.authorUserId === this.membershipsMessaging.currentUserId();
  }

  /** Traza de edición de la gestora (B) — solo si alguien distinto del autor editó. */
  showEditTrace(comm: Communication): boolean {
    return !!comm.lastEditedByUserId && comm.lastEditedByUserId !== comm.authorUserId;
  }

  /** Normaliza una fecha ISO a 'YYYY-MM-DD' para mostrarla — mismo criterio que `d()` en api-shared.ts. */
  formatDate(iso: string | null | undefined): string {
    return iso ? iso.slice(0, 10) : '';
  }

  openNuevoComunicado(): void {
    this.commEditingId.set(null);
    this.commTitle.set('');
    this.commBody.set('');
    this.commActiveUntil.set('');
    this.commCategory.set('General');
    this.commErrors.set({});
    this.showNuevoComunicado.set(true);
  }

  openEditarComunicado(comm: Communication): void {
    this.commEditingId.set(comm.id);
    this.commTitle.set(comm.title);
    this.commBody.set(comm.body);
    this.commActiveUntil.set(comm.activeUntil ? comm.activeUntil.slice(0, 10) : '');
    this.commCategory.set(comm.category === 'Urgente' ? 'General' : comm.category);
    this.commErrors.set({});
    this.showNuevoComunicado.set(true);
  }

  closeNuevoComunicado(): void {
    this.showNuevoComunicado.set(false);
  }

  async submitComunicado(): Promise<void> {
    const title = this.commTitle().trim();
    const body = this.commBody().trim();
    const errors: { title?: boolean; body?: boolean } = {};
    if (!title) errors.title = true;
    if (!body) errors.body = true;
    if (errors.title || errors.body) {
      this.commErrors.set(errors);
      return;
    }
    const activeUntil = this.commActiveUntil() || undefined;
    const category = this.commCategory();
    const editingId = this.commEditingId();
    try {
      if (editingId) {
        await this.comunicados.updateCommunication(editingId, { title, body, activeUntil: activeUntil ?? null, category });
      } else {
        const estateId = this.resolvedEstateId;
        if (!estateId) return;
        await this.comunicados.createCommunication(estateId, { title, body, activeUntil, category });
      }
      this.showNuevoComunicado.set(false);
      await this.reloadCommunications();
      this.showToast(editingId ? 'Comunicado actualizado correctamente' : 'Comunicado publicado correctamente');
    } catch (error) {
      console.error('Error guardando el comunicado', error);
      this.showToast('No se pudo guardar el comunicado');
    }
  }

  async deleteComunicado(comm: Communication): Promise<void> {
    if (!confirm(`¿Eliminar el comunicado "${comm.title}"?`)) return;
    try {
      await this.comunicados.deleteCommunication(comm.id);
      await this.reloadCommunications();
      this.showToast('Comunicado eliminado');
    } catch (error) {
      console.error('Error eliminando el comunicado', error);
      this.showToast('No se pudo eliminar el comunicado');
    }
  }

  // ── Respuestas a comunicados — cualquier vecino puede responder al propio
  // o al ajeno. ────────────
  commReplyTexts = signal<Record<string, string>>({});

  commReplyText(commId: string): string {
    return this.commReplyTexts()[commId] || '';
  }

  setCommReplyText(commId: string, text: string): void {
    this.commReplyTexts.set({ ...this.commReplyTexts(), [commId]: text });
  }

  async sendCommunicationReply(comm: Communication): Promise<void> {
    const text = this.commReplyText(comm.id).trim();
    if (!text) return;
    try {
      const reply = await this.comunicados.addCommunicationReply(comm.id, text);
      this.communications.set(this.communications().map(c => c.id === comm.id ? { ...c, replies: [...c.replies, reply] } : c));
      this.setCommReplyText(comm.id, '');
    } catch (error) {
      console.error('Error respondiendo al comunicado', error);
      this.showToast('No se pudo enviar la respuesta');
    }
  }

  /** La propia siempre se puede borrar; una ajena solo si es la gestora quien la escribió y el vecino tiene motivos para retirarla no aplica aquí — el backend ya rechaza si no es la propia. */
  async deleteCommunicationReply(comm: Communication, replyId: string): Promise<void> {
    if (!confirm('¿Eliminar esta respuesta?')) return;
    try {
      await this.comunicados.deleteCommunicationReply(comm.id, replyId);
      this.communications.set(this.communications().map(c => c.id === comm.id ? { ...c, replies: c.replies.filter(r => r.id !== replyId) } : c));
    } catch (error) {
      console.error('Error eliminando la respuesta', error);
      this.showToast('No se pudo eliminar la respuesta');
    }
  }


  // ── Informes contables (fase 12) ────────────────────────────────────
  downloadingReport = signal<'statement' | 'certificate' | null>(null);

  private triggerDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async downloadStatement(format: 'xlsx' | 'pdf'): Promise<void> {
    const propertyId = this.property?.id;
    if (!propertyId) return;
    this.downloadingReport.set('statement');
    try {
      const blob = await this.reports.downloadPropertyStatement(propertyId, format);
      this.triggerDownload(blob, `extracto.${format}`);
    } catch (error) {
      console.error('Error descargando el extracto', error);
      this.showToast('No se pudo descargar el extracto');
    } finally {
      this.downloadingReport.set(null);
    }
  }

  /** PDF en borrador (ADR D22): sin firmar, no tiene validez legal como certificado. */
  async downloadDebtCertificate(): Promise<void> {
    const propertyId = this.property?.id;
    if (!propertyId) return;
    this.downloadingReport.set('certificate');
    try {
      const blob = await this.debtorsSvc.downloadDebtCertificatePdf(propertyId);
      this.triggerDownload(blob, 'certificado-deuda.pdf');
    } catch (error) {
      console.error('Error descargando el certificado de deuda', error);
      this.showToast('No se pudo descargar el certificado');
    } finally {
      this.downloadingReport.set(null);
    }
  }

  // ── Vinculación ──────────────────────────────────────────────────────
  linkageStatus = signal<LinkageStatus>('none');
  showVinculacionModal = signal(false);
  vincStep = signal(0);
  vincMode = signal<VincMode>('existing');
  vincSearch = signal('');
  vincSelectedEstate = signal<LinkEstate | null>(null);
  vincName = signal('');
  vincAddress = signal('');
  vincAdminName = signal('');
  vincAdminEmail = signal('');

  filteredLinkEstates = computed(() => {
    const q = this.vincSearch().toLowerCase().trim();
    if (!q) return this.linkEstates;
    return this.linkEstates.filter(e => e.name.toLowerCase().includes(q) || e.address.toLowerCase().includes(q));
  });

  // ── Reservas ─────────────────────────────────────────────────────────
  bookings = signal<Booking[]>([]);
  amenities = signal<Amenity[]>([]);
  staffDirectory = signal<StaffDirectoryEntry[]>([]);
  reservaFilter = signal<ReservaFilter>('all');
  showNuevaReserva = signal(false);
  reservaStep = signal(0);
  selectedAmenity = signal<Amenity | null>(null);
  selectedDate = signal<string>('');
  selectedSlots = signal<string[]>([]);
  guestCount = signal(1);
  reservaNotes = signal('');
  selectedBooking = signal<Booking | null>(null);
  cancelConfirm = signal(false);
  toastMessage = signal<string | null>(null);

  filteredBookings = computed(() => {
    const f = this.reservaFilter();
    const today = this.today;
    const list = this.bookings();
    if (f === 'upcoming') return list.filter(b => b.date >= today && b.status !== 'cancelled');
    if (f === 'past') return list.filter(b => b.date < today || b.status !== 'confirmed');
    return list;
  });

  upcomingCount = computed(() => this.bookings().filter(b => b.date >= this.today && b.status === 'confirmed').length);
  completedCount = computed(() => this.bookings().filter(b => b.status === 'completed').length);
  totalCount = computed(() => this.bookings().length);

  occupiedSlots = signal<string[]>([]);

  private async refreshAvailability(): Promise<void> {
    const amenity = this.selectedAmenity();
    const date = this.selectedDate();
    if (!amenity || !date) {
      this.occupiedSlots.set([]);
      return;
    }
    try {
      const availability = await this.amenitiesSvc.amenityAvailability(amenity.id, date);
      this.occupiedSlots.set(availability.occupied);
    } catch (error) {
      console.error('Error consultando disponibilidad', error);
    }
  }

  // ── Mini calendar ────────────────────────────────────────────────────
  readonly today = new Date().toISOString().slice(0, 10);
  calendarMonth = signal(6);
  calendarYear = signal(2026);

  bookedDates = computed(() => {
    const set = new Set<string>();
    for (const b of this.bookings()) {
      if (b.status === 'confirmed') set.add(b.date);
    }
    return set;
  });

  calendarLabel = computed(() => {
    const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    return `${months[this.calendarMonth() - 1]} ${this.calendarYear()}`;
  });

  calendarDays = computed<CalendarDay[]>(() => {
    const year = this.calendarYear();
    const month = this.calendarMonth();
    const booked = this.bookedDates();
    const firstOfMonth = new Date(year, month - 1, 1);
    const startOffset = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const days: CalendarDay[] = [];
    for (let i = 0; i < startOffset; i++) {
      days.push({ date: '', label: 0, inMonth: false, isToday: false, isPast: false, hasBooking: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        date,
        label: d,
        inMonth: true,
        isToday: date === this.today,
        isPast: date < this.today,
        hasBooking: booked.has(date),
      });
    }
    return days;
  });

  calendarPrevMonth(): void {
    let month = this.calendarMonth() - 1;
    let year = this.calendarYear();
    if (month < 1) { month = 12; year -= 1; }
    this.calendarMonth.set(month);
    this.calendarYear.set(year);
  }

  calendarNextMonth(): void {
    let month = this.calendarMonth() + 1;
    let year = this.calendarYear();
    if (month > 12) { month = 1; year += 1; }
    this.calendarMonth.set(month);
    this.calendarYear.set(year);
  }

  selectCalendarDay(day: CalendarDay): void {
    if (!day.inMonth || day.isPast) return;
    this.selectedDate.set(day.date);
    this.selectedSlots.set([]);
    void this.refreshAvailability();
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? this.state.selectedProperty()?.id;
    if (!id) return;
    try {
      const [property, view] = await Promise.all([
        this.properties.findOwnerPropertyById(id),
        this.properties.resolvePropertyView(id),
      ]);
      this.propertyData.set(property);
      this.propertyViewData.set(view);
      const status = view?.linkageStatus ?? 'none';
      this.linkageStatus.set(status === 'linked' || status === 'pending' || status === 'revoked' ? status : 'none');

      const estateId = property?.estateId ?? view?.estate?.id ?? null;
      this.resolvedEstateId = estateId;
      const [myReceipts, myBookings] = await Promise.all([
        this.receiptsSvc.listReceiptsForUser(this.membershipsMessaging.currentUserId()),
        this.amenitiesSvc.listMyBookings(),
      ]);
      this.receipts.set(myReceipts.filter(r => !r.propertyId || r.propertyId === id));
      if (estateId) {
        const [amenities, , staffDirectory] = await Promise.all([
          this.amenitiesSvc.listAmenitiesByEstate(estateId),
          this.reloadCommunications(),
          this.suppliersStaff.listStaffDirectory(estateId),
        ]);
        this.amenities.set(amenities);
        const amenityIds = new Set(amenities.map(a => a.id));
        this.bookings.set(myBookings.filter(b => amenityIds.has(b.amenityId)));
        this.staffDirectory.set(staffDirectory);
      }
    } catch (error) {
      console.error('Error cargando la propiedad', error);
    }

    this.applyQueryParamDeepLink();
  }

  /**
   * `?tab=` (deep-link desde «Mi comunidad» y el feed de actividad). `?tab=issues` y `?tab=documents`
   * ya no llegan aquí: `legacyOwnerTabRedirect` los manda a /c/incidencias y /c/documentacion.
   */
  private applyQueryParamDeepLink(): void {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    const validTabs: Tab[] = ['summary', 'receipts', 'communications', 'reservas', 'juntas'];
    if (tab && (validTabs as string[]).includes(tab)) {
      this.activeTab.set(tab as Tab);
    }
  }

  private propertyData = signal<OwnerProperty | null>(null);

  get property(): OwnerProperty | null {
    return this.propertyData() ?? this.state.selectedProperty();
  }

  /**
   * Vista resuelta con datos "vivos" (nombre de finca, admin, contacto,
   * nickname del usuario, dirección postal formateada). Todos los accesos
   * a strings legacy (`property.estate`, `property.admin`, `property.label`,
   * `property.address`, `property.roleType`, `property.linked`) han sido
   * migrados a leer de aquí.
   */
  private propertyViewData = signal<PropertyView | null>(null);

  get propertyView(): PropertyView | null {
    return this.propertyViewData();
  }

  /** Importe/concepto en espera para el modal de instrucciones de transferencia — null = modal cerrado. */
  payTarget = signal<{ amount: number; concept: string } | null>(null);

  openPayBalance(): void {
    const balance = this.property?.balance ?? 0;
    if (balance >= 0) return;
    this.payTarget.set({ amount: -balance, concept: 'Saldo pendiente' });
  }

  openPayReceipt(receipt: AccountingReceipt): void {
    this.payTarget.set({ amount: receipt.amount, concept: `Recibo · ${receipt.period}` });
  }

  closePayModal(): void {
    this.payTarget.set(null);
  }

  // ── Justificante de pago ─────────────────────────────────────────────
  private pendingProofReceiptId = signal<string | null>(null);
  attachingProofId = signal<string | null>(null);

  triggerAttachProof(receiptId: string, input: HTMLInputElement): void {
    this.pendingProofReceiptId.set(receiptId);
    input.click();
  }

  async onProofFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const receiptId = this.pendingProofReceiptId();
    input.value = '';
    if (!file || !receiptId) return;

    this.attachingProofId.set(receiptId);
    try {
      const updated = await this.receiptsSvc.uploadPaymentProof(receiptId, file);
      this.receipts.set(this.receipts().map(r => r.id === receiptId ? { ...r, proofFileName: updated.proofFileName } : r));
      this.showToast('Justificante adjuntado correctamente');
    } catch (error) {
      console.error('Error adjuntando el justificante', error);
      this.showToast('No se pudo adjuntar el justificante');
    } finally {
      this.attachingProofId.set(null);
      this.pendingProofReceiptId.set(null);
    }
  }

  async downloadProof(receipt: AccountingReceipt): Promise<void> {
    try {
      const blob = await this.receiptsSvc.downloadPaymentProof(receipt.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = receipt.proofFileName || 'justificante';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando el justificante', error);
      this.showToast('No se pudo descargar el justificante');
    }
  }

  /** Mismo administrador que ya se muestra en la tarjeta de contacto — abre (o crea) la conversación con él. */
  contactAdmin(): void {
    const adminUserId = this.propertyView?.adminContact?.id;
    if (adminUserId) {
      this.router.navigate(['/c/messages'], { queryParams: { with: adminUserId } });
    } else {
      this.router.navigate(['/c/messages']);
    }
  }

  goBack(): void {
    this.router.navigate(['/c/community']);
  }

  setTab(tab: Tab): void {
    this.activeTab.set(tab);
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  receiptStatusVariant(status: string): 'green' | 'error' | 'warning' | 'default' {
    if (status === 'Pagada') return 'green';
    if (status === 'Devuelto') return 'error';
    if (status === 'Pendiente') return 'warning';
    return 'default';
  }

  /** Las incidencias son de la comunidad: el botón abre su módulo para crear una, y la propiedad solo dice en qué comunidad. */
  reportIssue(): void {
    const estateId = this.resolvedEstateId;
    void this.router.navigate(['/c/incidencias'], { queryParams: { new: '1', ...(estateId ? { estateId } : {}) } });
  }

  // ── Vinculación actions ──────────────────────────────────────────────
  openVinculacionModal(): void {
    this.vincStep.set(0);
    this.vincMode.set('existing');
    this.vincSearch.set('');
    this.vincSelectedEstate.set(null);
    this.vincName.set('');
    this.vincAddress.set('');
    this.vincAdminName.set('');
    this.vincAdminEmail.set('');
    this.showVinculacionModal.set(true);
  }

  closeVinculacionModal(): void {
    this.showVinculacionModal.set(false);
  }

  vincBack(): void {
    this.vincStep.set(Math.max(0, this.vincStep() - 1));
  }

  vincNext(): void {
    this.vincStep.set(Math.min(2, this.vincStep() + 1));
  }

  selectVincEstate(estate: LinkEstate): void {
    this.vincSelectedEstate.set(estate);
  }

  vincCanContinue(): boolean {
    if (this.vincStep() === 1) {
      if (this.vincMode() === 'existing') return !!this.vincSelectedEstate();
      return !!this.vincName().trim();
    }
    return true;
  }

  submitVinculacion(): void {
    this.linkageStatus.set('pending');
    this.showVinculacionModal.set(false);
    this.showToast('Solicitud de vinculación enviada');
  }

  // ── Reservas actions ─────────────────────────────────────────────────
  openNuevaReserva(amenity?: Amenity): void {
    this.reservaStep.set(amenity ? 1 : 0);
    this.selectedAmenity.set(amenity || null);
    this.selectedDate.set('');
    this.selectedSlots.set([]);
    this.guestCount.set(1);
    this.reservaNotes.set('');
    this.showNuevaReserva.set(true);
  }

  closeNuevaReserva(): void {
    this.showNuevaReserva.set(false);
  }

  pickAmenity(amenity: Amenity): void {
    this.selectedAmenity.set(amenity);
    this.selectedDate.set('');
    this.selectedSlots.set([]);
    this.guestCount.set(1);
  }

  reservaBack(): void {
    this.reservaStep.set(Math.max(0, this.reservaStep() - 1));
  }

  reservaNext(): void {
    this.reservaStep.set(Math.min(2, this.reservaStep() + 1));
  }

  reservaCanContinue(): boolean {
    if (this.reservaStep() === 0) return !!this.selectedAmenity();
    if (this.reservaStep() === 1) return !!this.selectedDate() && this.selectedSlots().length > 0;
    return true;
  }

  toggleSlot(slot: string): void {
    const amenity = this.selectedAmenity();
    if (!amenity) return;
    const occupied = this.occupiedSlots();
    if (occupied.includes(slot)) return;
    const current = this.selectedSlots();
    if (current.includes(slot)) {
      this.selectedSlots.set(current.filter(s => s !== slot));
      return;
    }
    if (current.length >= amenity.maxHours) return;
    this.selectedSlots.set([...current, slot].sort());
  }

  incGuests(): void {
    const amenity = this.selectedAmenity();
    const max = amenity?.capacity ?? 99;
    this.guestCount.set(Math.min(max, this.guestCount() + 1));
  }

  decGuests(): void {
    this.guestCount.set(Math.max(1, this.guestCount() - 1));
  }

  async confirmReserva(): Promise<void> {
    const amenity = this.selectedAmenity();
    const slots = this.selectedSlots();
    if (!amenity || slots.length === 0) return;
    const startSlot = slots[0];
    const endHour = parseInt(slots[slots.length - 1].split(':')[0], 10) + 1;
    const endSlot = `${endHour.toString().padStart(2, '0')}:00`;
    try {
      const booking = await this.amenitiesSvc.createBooking({
        amenityId: amenity.id,
        propertyId: this.property?.id,
        date: this.selectedDate(),
        startSlot,
        endSlot,
        guests: this.guestCount(),
        notes: this.reservaNotes() || undefined,
      });
      this.bookings.set([{ ...booking, amenityName: amenity.name }, ...this.bookings()]);
      this.showNuevaReserva.set(false);
      this.showToast('Reserva confirmada correctamente');
    } catch (error) {
      console.error('Error creando la reserva', error);
      this.showToast('No se pudo crear la reserva (¿horario ya ocupado?)');
    }
  }

  openBookingDetail(booking: Booking): void {
    this.selectedBooking.set(booking);
    this.cancelConfirm.set(false);
  }

  closeBookingDetail(): void {
    this.selectedBooking.set(null);
    this.cancelConfirm.set(false);
  }

  requestCancel(): void {
    this.cancelConfirm.set(true);
  }

  async cancelBooking(): Promise<void> {
    const booking = this.selectedBooking();
    if (!booking) return;
    try {
      await this.amenitiesSvc.cancelBooking(booking.id);
      this.bookings.set(this.bookings().map(b => b.id === booking.id ? { ...b, status: 'cancelled' as const } : b));
      this.selectedBooking.set(null);
      this.cancelConfirm.set(false);
      this.showToast('Reserva cancelada');
    } catch (error) {
      console.error('Error cancelando la reserva', error);
    }
  }

  bookingStatusVariant(status: string): 'green' | 'error' | 'warning' | 'default' {
    if (status === 'confirmed') return 'green';
    if (status === 'cancelled') return 'error';
    return 'default';
  }

  bookingStatusLabel(status: string): string {
    if (status === 'confirmed') return 'Confirmada';
    if (status === 'cancelled') return 'Cancelada';
    return 'Completada';
  }
}
