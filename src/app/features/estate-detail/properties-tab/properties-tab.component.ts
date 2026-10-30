import { Component, EventEmitter, Input, OnInit, Output, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
import { FormsModule } from '@angular/forms';
import { PropertyChangesCardComponent } from '../property-changes-card/property-changes-card.component';
import { FeaturedPropertyCardComponent, type FeaturedProperty } from '../featured-property-card/featured-property-card.component';
import { KpiTileComponent } from '../../../shared/components/kpi-tile/kpi-tile.component';
import { StatusPillComponent, type StatusTone } from '../../../shared/components/status-pill/status-pill.component';
import { EstateDashboardService } from '../../../core/estate-dashboard.service';
import { EstatePropertyStatuses, RecentPropertyStatus } from '../../../core/estate-dashboard.models';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ExternalOwner, OwnerProperty as Property, OwnerPropertyType, RoleType, ViaType } from '../../../core/models';
import { formatQuota } from '../../../core/format';
import { MembershipsMessagingService } from '../../../core/memberships-messaging.service';
import { PropertiesService } from '../../../core/properties.service';
import { MembersSectionComponent } from '../../property-detail/members-section/members-section.component';
import { EstateGovernanceService, currentOffices, localDay, type CurrentOffice, type EstateOfficeTerm } from '../../../core/estate-governance.service';
import { OfficeTermDialogComponent, type OfficeTermDialogMode } from '../office-term-dialog/office-term-dialog.component';
import { KeyContactsDialogComponent } from '../key-contacts-dialog/key-contacts-dialog.component';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PAYMENT: Record<RecentPropertyStatus, { text: string; tone: StatusTone }> = {
  ok: { text: 'Al día', tone: 'positive' },
  overdue: { text: 'En mora', tone: 'warning' },
};
// `useGrouping: 'always'`: como el pipe `currency` de la app, agrupa miles también en 4 cifras.
const EURO = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', useGrouping: 'always' } as unknown as Intl.NumberFormatOptions);

export type PaymentFilter = 'all' | RecentPropertyStatus;
export type TypeFilter = 'all' | 'Vivienda' | 'Local' | 'Parking' | 'Trastero';
export type DebtFilter = 'all' | 'owes' | 'clear';
export type SortKey = 'ref-asc' | 'ref-desc' | 'balance-desc' | 'payment-desc';

/** Piso y Casa se agrupan como "Vivienda"; el resto de tipos se filtra tal cual. */
function typeGroup(type: OwnerPropertyType): Exclude<TypeFilter, 'all'> {
  return type === 'Piso' || type === 'Casa' ? 'Vivienda' : type;
}

const PAGE_SIZES = [10, 25, 50];
const HOUSING_TYPES: OwnerPropertyType[] = ['Piso', 'Casa'];
const PERCENT = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const PAYMENT_DATE = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Pestaña "Propiedades" de la finca, extraída de `estate-detail`: tabla de
 * unidades con su menú de fila (editar, titular, miembros, invitar,
 * eliminar). La lista es de dos vías con el padre (`properties`); los
 * titulares los resuelve el padre y llegan como entrada.
 */
@Component({
  selector: 'app-properties-tab',
  standalone: true,
  imports: [SelectDropdownDirective, PropertyChangesCardComponent, FeaturedPropertyCardComponent, KpiTileComponent, StatusPillComponent, BtnComponent, IconComponent, FormsModule, MembersSectionComponent, OfficeTermDialogComponent, KeyContactsDialogComponent],
  templateUrl: './properties-tab.component.html',
  styleUrl: './properties-tab.component.scss',
})
export class PropertiesTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  /** La carga inicial terminó: sin esto, "0 propiedades" es solo que aún no han llegado. */
  @Input() propertiesLoaded = false;
  /** Fachada de la finca (Catastro): es la foto de la ficha de "Propiedad destacada". */
  @Input() facadeUrl: string | null = null;
  @Input() estateName = '';
  /** Versión (`photoUpdatedAt`) de la foto subida de la finca, si la hay. */
  @Input() photoVersion: string | null = null;
  // Respaldado por una señal: los titulares llegan DESPUÉS que las propiedades, y la búsqueda y el
  // filtro "Propietario" (computed) tienen que recalcularse cuando llegan.
  private readonly titularMap = signal<Record<string, { name: string; roleType: RoleType }>>({});
  @Input() set titularByProperty(value: Record<string, { name: string; roleType: RoleType }>) { this.titularMap.set(value ?? {}); }
  get titularByProperty(): Record<string, { name: string; roleType: RoleType }> { return this.titularMap(); }
  /** Titular importado (sin cuenta) de cada propiedad — el que se puede invitar a la app. */
  @Input() externalOwnerByProperty: Record<string, ExternalOwner> = {};
  properties = model<Property[]>([]);
  /** Propiedad cuya edición se abre al llegar (enlace desde el Resumen). */
  readonly focusPropertyId = input<string | null>(null);
  @Output() focusHandled = new EventEmitter<void>();

  /** Se añadió un titular: el padre recarga titulares y puesta en marcha. */
  @Output() titularAdded = new EventEmitter<void>();
  /** Algo cambió que afecta a la puesta en marcha (editar/eliminar propiedad). */
  @Output() setupChanged = new EventEmitter<void>();
  @Output() importCatastro = new EventEmitter<void>();

  private propertiesSvc = inject(PropertiesService);
  private membershipsMessaging = inject(MembershipsMessagingService);
  private dashboard = inject(EstateDashboardService);
  private governance = inject(EstateGovernanceService);

  // ── Cargos de la comunidad (presidente y vicepresidentes) ───────────
  readonly officeTerms = signal<EstateOfficeTerm[]>([]);
  /** Cargos vigentes hoy por propiedad, con su etiqueta («Presidente», «Vicepresidente 2º»). */
  readonly officesByProperty = computed(() => {
    const { president, vicePresidents } = currentOffices(this.officeTerms(), localDay());
    const map = new Map<string, CurrentOffice[]>();
    for (const office of [president, ...vicePresidents]) {
      if (!office?.term.propertyId) continue;
      map.set(office.term.propertyId, [...(map.get(office.term.propertyId) ?? []), office]);
    }
    return map;
  });
  readonly officeDialog = signal<{ property: Property; mode: OfficeTermDialogMode } | null>(null);
  /** Propiedad cuyos contactos clave se están marcando. */
  readonly keyContactsFor = signal<Property | null>(null);

  // ── Saldo, estado de pago y filtros ─────────────────────────────────
  /** Saldo por propiedad; null mientras carga (o si falla: la tabla sigue sin esas columnas). */
  private statuses = signal<Map<string, EstatePropertyStatuses['items'][number]> | null>(null);
  readonly search = signal('');
  readonly typeFilter = signal<TypeFilter>('all');
  readonly paymentFilter = signal<PaymentFilter>('all');
  /** 'owes' = solo las que tienen saldo pendiente; 'clear' = solo las que no deben nada. */
  readonly debtFilter = signal<DebtFilter>('all');
  readonly ownerFilter = signal<string>('all');
  readonly sortKey = signal<SortKey>('ref-asc');
  readonly typeOptions: { value: TypeFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'Vivienda', label: 'Vivienda' },
    { value: 'Local', label: 'Local' },
    { value: 'Parking', label: 'Parking' },
    { value: 'Trastero', label: 'Trastero' },
  ];
  readonly debtOptions: { value: DebtFilter; label: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'owes', label: 'Con deuda' },
    { value: 'clear', label: 'Sin deuda' },
  ];
  readonly sortOptions: { value: SortKey; label: string }[] = [
    { value: 'ref-asc', label: 'Referencia (A-Z)' },
    { value: 'ref-desc', label: 'Referencia (Z-A)' },
    { value: 'balance-desc', label: 'Saldo pendiente (mayor)' },
    { value: 'payment-desc', label: 'Último pago (reciente)' },
  ];
  readonly paymentOptions: { value: PaymentFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'ok', label: PAYMENT.ok.text },
    { value: 'overdue', label: PAYMENT.overdue.text },
  ];
  readonly hasFilters = computed(() => this.search().trim() !== '' || this.typeFilter() !== 'all' || this.paymentFilter() !== 'all' || this.debtFilter() !== 'all' || this.ownerFilter() !== 'all');

  /** Titulares distintos de la finca, para el desplegable "Propietario". */
  readonly ownerOptions = computed(() => {
    const names = new Set<string>();
    for (const p of this.properties()) {
      const name = this.propertyTitular(p);
      if (name && name !== '—') names.add(name);
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'es'));
  });

  readonly visibleProperties = computed(() => {
    const term = this.search().trim().toLowerCase();
    const type = this.typeFilter();
    const payment = this.paymentFilter();
    const debt = this.debtFilter();
    const owner = this.ownerFilter();
    const filtered = this.properties().filter(p => {
      if (type !== 'all' && typeGroup(p.type) !== type) return false;
      if (payment !== 'all' && this.statusOf(p)?.status !== payment) return false;
      const balance = this.statusOf(p)?.balance ?? 0;
      if (debt === 'owes' && !(balance > 0)) return false;
      if (debt === 'clear' && balance > 0) return false;
      if (owner !== 'all' && this.propertyTitular(p) !== owner) return false;
      if (!term) return true;
      return [p.ref, this.propertyTitular(p), this.locationLabel(p)].some(v => (v ?? '').toLowerCase().includes(term));
    });
    return this.sorted(filtered);
  });

  private sorted(list: Property[]): Property[] {
    const byRef = (a: Property, b: Property) => (a.ref ?? '').localeCompare(b.ref ?? '', 'es', { numeric: true });
    const balance = (p: Property) => this.statusOf(p)?.balance ?? 0;
    // Sin pagos nunca ("") queda al final del orden "reciente".
    const paid = (p: Property) => this.statusOf(p)?.lastPaymentDate ?? '';
    switch (this.sortKey()) {
      case 'ref-desc': return [...list].sort((a, b) => byRef(b, a));
      case 'balance-desc': return [...list].sort((a, b) => balance(b) - balance(a) || byRef(a, b));
      case 'payment-desc': return [...list].sort((a, b) => paid(b).localeCompare(paid(a)) || byRef(a, b));
      default: return [...list].sort(byRef);
    }
  }

  // ── Paginación ──────────────────────────────────────────────────────
  readonly pageSizes = PAGE_SIZES;
  readonly pageSize = signal(PAGE_SIZES[0]);
  private readonly page = signal(1);
  readonly pageCount = computed(() => Math.max(1, Math.ceil(this.visibleProperties().length / this.pageSize())));
  /** Página mostrada: nunca pasa de la última aunque los filtros dejen menos filas. */
  readonly currentPage = computed(() => Math.min(this.page(), this.pageCount()));
  readonly pagedProperties = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.visibleProperties().slice(start, start + this.pageSize());
  });
  /** "Mostrando 1-10 de 24 propiedades". */
  readonly rangeLabel = computed(() => {
    const total = this.visibleProperties().length;
    if (total === 0) return '';
    const start = (this.currentPage() - 1) * this.pageSize() + 1;
    const end = Math.min(total, start + this.pageSize() - 1);
    return `Mostrando ${start}-${end} de ${total} ${total === 1 ? 'propiedad' : 'propiedades'}`;
  });
  /** Números de página con elipsis: 1 … 4 5 6 … 12. */
  readonly pageButtons = computed<{ page: number | null; label: string }[]>(() => {
    const last = this.pageCount();
    const current = this.currentPage();
    const pages = new Set([1, last, current - 1, current, current + 1].filter(n => n >= 1 && n <= last));
    const out: { page: number | null; label: string }[] = [];
    let previous = 0;
    for (const n of [...pages].sort((a, b) => a - b)) {
      // Una elipsis nunca esconde una sola página: en ese caso se muestra el número.
      if (n - previous === 2) out.push({ page: previous + 1, label: String(previous + 1) });
      else if (n - previous > 2) out.push({ page: null, label: '…' });
      out.push({ page: n, label: String(n) });
      previous = n;
    }
    return out;
  });
  goToPage(n: number): void {
    this.page.set(Math.min(Math.max(1, n), this.pageCount()));
  }
  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
  }

  /** Las cuatro cifras de cabecera: salen de la lista y de los estados ya cargados, igual que los filtros. */
  readonly kpis = computed(() => {
    const all = this.properties();
    const total = all.length;
    const share = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
    const housing = all.filter(p => HOUSING_TYPES.includes(p.type)).length;
    const commercial = all.filter(p => p.type === 'Local').length;
    const statuses = this.statuses();
    const debtors = statuses ? all.filter(p => (statuses.get(p.id)?.balance ?? 0) > 0) : [];
    const debt = debtors.reduce((sum, p) => sum + (statuses!.get(p.id)?.balance ?? 0), 0);
    return {
      total,
      housing: { count: housing, percent: share(housing) },
      commercial: { count: commercial, percent: share(commercial) },
      delinquency: {
        loaded: statuses !== null,
        amount: debt,
        properties: debtors.length,
        percent: total === 0 ? '0' : PERCENT.format((debtors.length / total) * 100),
      },
    };
  });

  /** Clic en "Total propiedades": quita todos los filtros. */
  showAll(): void {
    this.clearFilters();
  }
  /** Clic en "Morosidad": deja solo las propiedades con saldo pendiente (otro clic lo quita). */
  toggleDelinquency(): void {
    this.debtFilter.set(this.debtFilter() === 'owes' ? 'all' : 'owes');
  }

  // ── Propiedad destacada ─────────────────────────────────────────────
  /** Propiedad que el usuario ha elegido pulsando su fila; null = la de mayor deuda. */
  readonly selectedId = signal<string | null>(null);

  readonly featuredProperty = computed<FeaturedProperty | null>(() => {
    const all = this.properties();
    if (all.length === 0) return null;
    const chosen = all.find(p => p.id === this.selectedId());
    const byRef = [...all].sort((a, b) => (a.ref ?? '').localeCompare(b.ref ?? '', 'es', { numeric: true }));
    // Por defecto la de mayor deuda; si aún no hay estados (o fallaron), la primera por referencia.
    const property = chosen ?? (this.statuses() ? byRef.reduce((top, p) => ((this.statusOf(p)?.balance ?? 0) > (this.statusOf(top)?.balance ?? 0) ? p : top), byRef[0]) : byRef[0]);
    const status = this.statusOf(property);
    const owner = this.propertyTitular(property);
    return {
      id: property.id,
      ref: property.ref ?? '—',
      subtitle: [this.typeInfo(property).label, this.locationLabel(property)].filter(Boolean).join(' · '),
      titular: owner !== '—' ? owner : null,
      quotaMonthly: property.quotaMonthly ?? null,
      balance: status ? status.balance : null,
      status: this.paymentPill(property),
      lastPaymentDate: status?.lastPaymentDate ?? null,
      ownerSince: status?.ownerSince ?? null,
    };
  });

  /** "Ver propiedad" de la ficha destacada: abre su edición. */
  openFeatured(id: string): void {
    const property = this.properties().find(p => p.id === id);
    if (property) this.openEditProperty(property);
  }

  /** Clic (o Enter) en una fila: la deja seleccionada y la muestra en "Propiedad destacada". */
  selectProperty(p: Property): void {
    this.selectedId.set(p.id);
  }

  statusOf(p: Property) {
    return this.statuses()?.get(p.id) ?? null;
  }
  /** Etiqueta e icono del tipo: piso y casa se muestran como "Vivienda". */
  typeInfo(p: Property): { label: string; icon: string } {
    switch (typeGroup(p.type)) {
      case 'Vivienda': return { label: 'Vivienda', icon: 'home' };
      case 'Local': return { label: 'Local', icon: 'store' };
      case 'Parking': return { label: 'Parking', icon: 'car' };
      default: return { label: 'Trastero', icon: 'package' };
    }
  }
  lastPaymentLabel(p: Property): string {
    const date = this.statusOf(p)?.lastPaymentDate;
    return date ? PAYMENT_DATE.format(new Date(`${date}T00:00:00Z`)) : '—';
  }
  /** Estado de la cabecera "Ref.": a qué orden de referencia está ahora (para aria-sort). */
  readonly refSort = computed(() => (this.sortKey() === 'ref-asc' ? 'ascending' : this.sortKey() === 'ref-desc' ? 'descending' : 'none'));
  /** Clic en la cabecera "Ref.": alterna A-Z / Z-A (desde otro orden, empieza por A-Z). */
  toggleRefSort(): void {
    this.sortKey.set(this.sortKey() === 'ref-asc' ? 'ref-desc' : 'ref-asc');
  }
  paymentPill(p: Property) {
    const status = this.statusOf(p)?.status;
    return status ? PAYMENT[status] : null;
  }
  euro(amount: number): string {
    return EURO.format(amount);
  }
  clearFilters(): void {
    this.search.set('');
    this.typeFilter.set('all');
    this.paymentFilter.set('all');
    this.debtFilter.set('all');
    this.ownerFilter.set('all');
  }

  async ngOnInit(): Promise<void> {
    void this.loadOfficeTerms();
    try {
      const { items } = await this.dashboard.getPropertyStatuses(this.estateId);
      this.statuses.set(new Map(items.map(i => [i.propertyId, i])));
    } catch (error) {
      console.error('Error cargando el saldo de las propiedades de la finca', error);
    }
  }

  async loadOfficeTerms(): Promise<void> {
    try {
      this.officeTerms.set(await this.governance.list(this.estateId));
    } catch (error) {
      console.error('Error cargando los cargos de la comunidad', error);
    }
  }

  officesOf(p: Property): CurrentOffice[] {
    return this.officesByProperty().get(p.id) ?? [];
  }

  /** El presidente vigente es de esta propiedad: la fila ofrece cesarle en vez de nombrar otro. */
  presidentOf(p: Property): CurrentOffice | null {
    return this.officesOf(p).find(o => o.term.role === 'PRESIDENT') ?? null;
  }

  vicePresidentsOf(p: Property): CurrentOffice[] {
    return this.officesOf(p).filter(o => o.term.role === 'VICE_PRESIDENT');
  }

  openOfficeDialog(property: Property, mode: OfficeTermDialogMode): void {
    this.closePropertyMenu();
    this.officeDialog.set({ property, mode });
  }

  openKeyContacts(property: Property): void {
    this.closePropertyMenu();
    this.keyContactsFor.set(property);
  }

  closeOfficeDialog(): void {
    this.officeDialog.set(null);
  }

  async onOfficeSaved(): Promise<void> {
    const mode = this.officeDialog()?.mode;
    this.closeOfficeDialog();
    await this.loadOfficeTerms();
    this.showToast(mode?.kind === 'end' ? 'Cese registrado' : 'Nombramiento registrado');
  }

  toastMessage = signal<string | null>(null);

  constructor() {
    // Cualquier cambio de filtro u orden vuelve a la primera página.
    effect(() => {
      this.search(); this.typeFilter(); this.paymentFilter(); this.debtFilter(); this.ownerFilter(); this.sortKey();
      untracked(() => this.page.set(1));
    });
    effect(() => {
      const id = this.focusPropertyId();
      const property = id ? this.properties().find(p => p.id === id) : undefined;
      if (!property) return;
      untracked(() => {
        this.openEditProperty(property);
        this.focusHandled.emit();
      });
    });
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  // ── Menú de propiedad (fila de la tabla) ────────────────────────────
  // position: fixed con coordenadas de viewport — el menú vive dentro de
  // .card, que tiene overflow: hidden para redondear las esquinas de la
  // tabla; con position: absolute (relativo a un ancestro dentro de esa
  // caja) se recorta apenas hay pocas filas y el menú cae fuera del alto
  // real de la tarjeta.
  openPropertyMenuId = signal<string | null>(null);
  propertyMenuPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });

  // ── Editar propiedad modal ──────────────────────────────────────────
  showEditProperty = signal(false);
  editPropertyId = signal<string | null>(null);
  epType = signal<OwnerPropertyType>('Piso');
  epViaType = signal<ViaType>('Calle');
  epViaName = signal('');
  epStreetNumber = signal('');
  epStaircase = signal('');
  epFloor = signal('');
  epDoor = signal('');
  epMunicipality = signal('');
  epProvince = signal('');
  /** Coeficiente de participación (%) — null = sin informar (vaciar el campo lo borra). */
  epParticipationQuota = signal<number | null>(null);
  epQuotaMonthly = signal<number | null>(null);
  /** Superficie construida (m²) — null = sin informar (vaciar el campo lo borra). */
  epBuiltAreaM2 = signal<number | null>(null);
  epSaving = signal(false);

  // ── Añadir titular (propietario sin cuenta) ─────────────────────────
  addTitularPropertyId = signal<string | null>(null);
  atFullName = signal('');
  atTaxId = signal('');
  atEmail = signal('');
  atPhone = signal('');
  atSaving = signal(false);
  atEmailInvalid = computed(() => {
    const email = this.atEmail().trim();
    return email.length > 0 && !EMAIL_PATTERN.test(email);
  });
  epTypeOptions: OwnerPropertyType[] = ['Piso', 'Casa', 'Parking', 'Trastero', 'Local'];
  epViaTypeOptions: ViaType[] = ['Calle', 'Avenida', 'Plaza', 'Paseo', 'Camino', 'Carretera'];

  invitableOwnerOf(p: Property): ExternalOwner | null {
    const owner = this.externalOwnerByProperty[p.id];
    return owner?.email ? owner : null;
  }

  async inviteExternalOwner(p: Property): Promise<void> {
    this.closePropertyMenu();
    const owner = this.invitableOwnerOf(p);
    if (!owner) return;
    try {
      await this.membershipsMessaging.createOwnerInvite(p.id, owner.id);
      this.showToast(`Invitación enviada a ${owner.email}`);
    } catch (error: any) {
      console.error('Error invitando al titular', error);
      const msg = error?.error?.message;
      this.showToast(typeof msg === 'string' ? msg : 'No se pudo enviar la invitación');
    }
  }

  propertyTitular(p: Property): string {
    return this.titularByProperty[p.id]?.name ?? '—';
  }

  /** Dirección postal formateada vía PropertiesService (usado en selects). */
  propertyAddressLine(p: Property): string {
    return this.propertiesSvc.formatPostalAddress(p);
  }

  locationLabel(p: Property): string {
    const parts = [];
    if (p.floor) parts.push(`${p.floor}ª planta`);
    if (p.door) parts.push(`Puerta ${p.door}`);
    if (p.staircase) parts.push(`Esc. ${p.staircase}`);
    return parts.join(', ') || (p.ref ?? '—');
  }

  /** "2,50 %" o "—" si la propiedad no tiene coeficiente informado. */
  readonly quotaLabel = formatQuota;

  /**
   * Suma de coeficientes informados y cuántas propiedades siguen sin él.
   * Los coeficientes de una finca deberían sumar 100 %; mientras falten,
   * cualquier quórum por cuota estaría calculado sobre datos incompletos —
   * esto le enseña a la gestora cuánto le falta por cargar.
   */
  quotaSummary = computed(() => {
    const props = this.properties();
    const informed = props.filter((p) => p.participationQuota != null);
    const total = informed.reduce((sum, p) => sum + (p.participationQuota as number), 0);
    return { total: Math.round(total * 100) / 100, missing: props.length - informed.length };
  });


  // ── Menú de propiedad ────────────────────────────────────────────────
  togglePropertyMenu(event: MouseEvent, propertyId: string): void {
    if (this.openPropertyMenuId() === propertyId) {
      this.openPropertyMenuId.set(null);
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const menuWidth = 230;
    this.propertyMenuPosition.set({
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - menuWidth),
    });
    this.openPropertyMenuId.set(propertyId);
  }

  closePropertyMenu(): void {
    this.openPropertyMenuId.set(null);
  }

  // ── Gestionar miembros (respaldo administrativo — el alta es cosa del propietario) ──
  manageMembersPropertyId = signal<string | null>(null);

  openManageMembers(p: Property): void {
    this.closePropertyMenu();
    this.manageMembersPropertyId.set(p.id);
  }

  closeManageMembers(): void {
    this.manageMembersPropertyId.set(null);
  }

  // ── Añadir titular ───────────────────────────────────────────────────
  openAddTitular(p: Property): void {
    this.closePropertyMenu();
    this.atFullName.set('');
    this.atTaxId.set('');
    this.atEmail.set('');
    this.atPhone.set('');
    this.addTitularPropertyId.set(p.id);
  }

  closeAddTitular(): void {
    this.addTitularPropertyId.set(null);
  }

  async saveAddTitular(): Promise<void> {
    const propertyId = this.addTitularPropertyId();
    const fullName = this.atFullName().trim();
    if (!propertyId || !fullName || this.atEmailInvalid()) return;
    this.atSaving.set(true);
    try {
      await this.propertiesSvc.createExternalOwner(propertyId, {
        fullName,
        taxId: this.atTaxId().trim() || undefined,
        email: this.atEmail().trim() || undefined,
        phone: this.atPhone().trim() || undefined,
      });
      this.addTitularPropertyId.set(null);
      this.showToast('Titular añadido');
      this.titularAdded.emit();
      this.setupChanged.emit();
    } catch (error) {
      console.error('Error añadiendo el titular', error);
      this.showToast('No se pudo añadir el titular');
    } finally {
      this.atSaving.set(false);
    }
  }


  // ── Editar propiedad ─────────────────────────────────────────────────
  openEditProperty(p: Property): void {
    this.closePropertyMenu();
    this.editPropertyId.set(p.id);
    this.epType.set(p.type);
    this.epViaType.set(p.viaType ?? 'Calle');
    this.epViaName.set(p.viaName ?? '');
    this.epStreetNumber.set(p.streetNumber ?? '');
    this.epStaircase.set(p.staircase ?? '');
    this.epFloor.set(p.floor ?? '');
    this.epDoor.set(p.door ?? '');
    this.epMunicipality.set(p.municipality ?? '');
    this.epProvince.set(p.province ?? '');
    this.epParticipationQuota.set(p.participationQuota ?? null);
    this.epQuotaMonthly.set(p.quotaMonthly ?? null);
    this.epBuiltAreaM2.set(p.builtAreaM2 ?? null);
    this.showEditProperty.set(true);
  }

  closeEditProperty(): void {
    this.showEditProperty.set(false);
  }

  async saveEditProperty(): Promise<void> {
    const id = this.editPropertyId();
    if (!id) return;
    this.epSaving.set(true);
    try {
      const updated = await this.propertiesSvc.updateOwnerProperty(id, {
        type: this.epType(),
        viaType: this.epViaType(),
        viaName: this.epViaName().trim(),
        streetNumber: this.epStreetNumber().trim(),
        staircase: this.epStaircase().trim() || undefined,
        floor: this.epFloor().trim() || undefined,
        door: this.epDoor().trim() || undefined,
        municipality: this.epMunicipality().trim(),
        province: this.epProvince().trim() || undefined,
        // null (campo vacío) borra el coeficiente — a diferencia de
        // `undefined`, que el backend interpreta como "no tocar".
        participationQuota: this.epParticipationQuota(),
        // La cuota no admite null en BD: vacío significa "no tocar".
        quotaMonthly: this.epQuotaMonthly() ?? undefined,
        // Igual que el coeficiente: null (campo vacío) borra la superficie.
        builtAreaM2: this.epBuiltAreaM2(),
      });
      this.properties.set(this.properties().map(p => p.id === id ? { ...p, ...updated } : p));
      this.showEditProperty.set(false);
      this.showToast('Propiedad actualizada correctamente');
      this.setupChanged.emit();
    } catch (error) {
      console.error('Error actualizando la propiedad', error);
      this.showToast('No se pudo actualizar la propiedad');
    } finally {
      this.epSaving.set(false);
    }
  }


  // ── Eliminar propiedad ───────────────────────────────────────────────
  async deleteProperty(p: Property): Promise<void> {
    this.closePropertyMenu();
    if (!confirm(`¿Eliminar la propiedad ${this.locationLabel(p)}? Esta acción no se puede deshacer.`)) return;
    try {
      await this.propertiesSvc.deleteOwnerProperty(p.id);
      this.properties.set(this.properties().filter(x => x.id !== p.id));
      this.showToast('Propiedad eliminada');
      this.setupChanged.emit();
    } catch (error) {
      console.error('Error eliminando la propiedad', error);
      this.showToast('No se pudo eliminar la propiedad');
    }
  }
}
