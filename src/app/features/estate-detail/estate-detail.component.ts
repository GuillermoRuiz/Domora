import { NgTemplateOutlet } from '@angular/common';
import { SelectDropdownDirective } from '../../shared/components/dropdown/select-dropdown.directive';
import { Component, DestroyRef, OnInit, OnDestroy, inject, signal, computed, effect } from '@angular/core';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { StateService } from '../../core/state.service';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { AuthService } from '../../core/auth.service';
import { ALL_ESTATE_TAB_IDS, EstateNavigationService, estateTabLabel, isLegacyEstateTab, type EstateTab, type EstateNavigationContext } from '../../core/estate-navigation.service';
import { PageActionRegistry } from '../../shared/components/page-action/page-action.directive';
import { OfficeHistoryDialogComponent } from './office-history-dialog/office-history-dialog.component';
import { EstateCommunitySelectorComponent } from './estate-community-selector/estate-community-selector.component';
import { EstateChipTabsDirective } from './estate-chip-tabs.directive';
import { IntelligencePanelComponent } from '../ai/intelligence-panel.component';
import { AdhesionRequest, CatastroImportResult, ESTATE_MAIN_USES, Estate, EstateMainUse, EstateSetupStatus, ExternalOwner, OwnerProperty as Property, RoleType } from '../../core/models';
import { TicketsAdhesionService } from '../../core/tickets-adhesion.service';
import { EstatesService, ESTATE_COLOR_PALETTE } from '../../core/estates.service';
import { PropertiesService } from '../../core/properties.service';
import { MembershipsMessagingService } from '../../core/memberships-messaging.service';
import { isParcelReference, normalizeReference } from '../../core/catastro-reference';
import { ProveedoresTabComponent } from '../accounting/proveedores-tab/proveedores-tab.component';
import { SuppliersPanelComponent } from './suppliers-panel/suppliers-panel.component';
import { PersonalTabComponent } from './personal-tab/personal-tab.component';
import { LibraryTabComponent } from './library-tab/library-tab.component';
import { SepaTabComponent } from './sepa-tab/sepa-tab.component';
import { PropertiesTabComponent } from './properties-tab/properties-tab.component';
import { EstateHeaderComponent } from './estate-header/estate-header.component';
import { SummaryTabComponent } from './summary-tab/summary-tab.component';
import { AdhesionesTabComponent } from './adhesiones-tab/adhesiones-tab.component';
import { ContractsTabComponent } from './contracts-tab/contracts-tab.component';
import { InstallationsPanelComponent } from './installations-panel/installations-panel.component';
import { EstatePhotoFieldComponent, type EstatePhotoChange } from './estate-photo-field/estate-photo-field.component';
import { GeneralTabComponent } from './general-tab/general-tab.component';
import { AmenitiesTabComponent } from './amenities-tab/amenities-tab.component';
import { JuntasTabComponent } from './juntas-tab/juntas-tab.component';
import { InspeccionesTabComponent } from './inspecciones-tab/inspecciones-tab.component';
import { ComunicadosTabComponent } from './comunicados-tab/comunicados-tab.component';
import { CatastroImportModalComponent } from './catastro-import-modal/catastro-import-modal.component';
import { CoefficientRecalcModalComponent } from './coefficient-recalc-modal/coefficient-recalc-modal.component';
import { EstateSetupCardComponent, type EstateSetupAction } from './estate-setup-card/estate-setup-card.component';

// Validación de UX, alineada con los DTOs del backend — quien valida de verdad es el servidor.
const CIF_PATTERN = /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/i;


@Component({
  selector: 'app-estate-detail',
  standalone: true,
  providers: [PageActionRegistry],
  imports: [SelectDropdownDirective, NgTemplateOutlet, IntelligencePanelComponent, EstateCommunitySelectorComponent, EstateChipTabsDirective, TopbarComponent, BtnComponent, IconComponent, FormsModule, ProveedoresTabComponent, SuppliersPanelComponent, PersonalTabComponent, LibraryTabComponent, SepaTabComponent, AdhesionesTabComponent, SummaryTabComponent, EstateHeaderComponent, AmenitiesTabComponent, PropertiesTabComponent, JuntasTabComponent, InspeccionesTabComponent, ComunicadosTabComponent, CatastroImportModalComponent, EstateSetupCardComponent, CoefficientRecalcModalComponent, ContractsTabComponent, GeneralTabComponent, InstallationsPanelComponent, EstatePhotoFieldComponent, OfficeHistoryDialogComponent],
  templateUrl: './estate-detail.component.html',
  styleUrl: './estate-detail.component.scss'
})
export class EstateDetailComponent implements OnInit, OnDestroy {
  router = inject(Router);
  route = inject(ActivatedRoute);
  state = inject(StateService);
  estatesSvc = inject(EstatesService);
  propertiesSvc = inject(PropertiesService);
  membershipsMessaging = inject(MembershipsMessagingService);
  adhesion = inject(TicketsAdhesionService);
  auth = inject(AuthService);

  readonly estateNavigation = inject(EstateNavigationService);
  readonly pageActions = inject(PageActionRegistry);
  /** «Historial de cargos» del menú de acciones de la finca. */
  readonly showOfficeHistory = signal(false);
  get pageTitle(): string {
    if (this.activeTab() === 'providers') return this.providersSubTab() === 'staff' ? 'Personal' : 'Proveedores';
    return this.activeTabLabel();
  }
  private readonly destroyRef = inject(DestroyRef);
  activeTab = signal<EstateTab>('summary');
  /** Título de la sección abierta (también para las que ya no tienen pestaña propia). */
  readonly activeTabLabel = computed(() => estateTabLabel(this.activeTab()));
  /** Sección sin pestaña en la barra: se llega por deep link o desde los accesos del Resumen. */
  readonly isLegacyTab = computed(() => isLegacyEstateTab(this.activeTab()));
  /** Secciones desplazadas fuera de la barra de pestañas (ver `LEGACY_ESTATE_NAV_GROUPS`). Juntas e Incidencias no: tienen acceso propio en el menú lateral. */
  readonly legacyLinks: { id: EstateTab; label: string }[] = (
    ['requests', 'communications'] as EstateTab[]
  ).map(id => ({ id, label: estateTabLabel(id) }));

  // ── Proveedores y Personal ────────────────────────────────────────────
  // Ambos son componentes autosuficientes (su propio fetch/estado/modales);
  // aquí solo se decide cuál mostrar.
  providersSubTab = signal<'suppliers' | 'billing' | 'staff'>('suppliers');

  estateData = signal<Estate | null>(null);
  private readonly navigationContext: EstateNavigationContext = {
    estate: this.estateData, activeTab: this.activeTab, selectTab: tab => this.selectTab(tab),
  };
  private destroyed = false;

  /**
   * Instalaciones agrupa tres vistas: el panel de instalaciones (por
   * defecto), las inspecciones normativas y las zonas comunes reservables.
   */
  installationsSubTab = signal<'panel' | 'inspections' | 'amenities'>('panel');

  /** Desde el panel de Instalaciones: ir a las incidencias de esa instalación (en el listado de Incidencias). */
  openIssuesOf(asset: { id: string; name: string }): void {
    const estateId = this.estateData()?.id;
    if (estateId) void this.router.navigate(['/b/incidencias'], { queryParams: { estateId, assetId: asset.id } });
  }

  selectTab(tab: EstateTab): void {
    // Las incidencias ya no son una sección de la finca: viven en su propio listado, acotado a esta comunidad.
    if (tab === 'issues') {
      const estateId = this.estateData()?.id;
      if (estateId) void this.router.navigate(['/b/incidencias'], { queryParams: { estateId } });
      return;
    }
    // `inspections` ya no es una pestaña: vive dentro de Instalaciones (los enlaces antiguos siguen valiendo).
    if (tab === 'inspections') {
      this.installationsSubTab.set('inspections');
      tab = 'amenities';
    }
    this.activeTab.set(tab);
  }

  tabCount(tab: EstateTab): number | null {
    if (tab === 'properties') return this.properties().length;
    if (tab === 'requests') return this.requests().length || null;
    if (tab === 'amenities') return this.amenitiesCount() || null;
    return null;
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.estateNavigation.context() === this.navigationContext) this.estateNavigation.context.set(null);
  }

  properties = signal<Property[]>([]);
  /** La carga inicial terminó con éxito: sin esto, "0 propiedades" es solo que aún no han llegado. */
  propertiesLoaded = signal(false);
  requests = signal<AdhesionRequest[]>([]);
  toastMessage = signal<string | null>(null);

  // ── Documentos ────────────────────────────────────────────────────────
  // La pestaña vive ahora en `documentos-tab/`, con su propio estado y carga.
  // Aquí solo queda lo que necesita para pintarse (ver plantilla).

  amenitiesCount = signal(0);

  // ── Editar finca modal ───────────────────────────────────────────────
  showEditEstate = signal(false);
  eeName = signal('');
  eeType = signal<Estate['type']>('Edificio');
  eeAddress = signal('');
  eeStreetNumber = signal('');
  eeLocation = signal('');
  eeDescription = signal('');
  eeProvince = signal('');
  eePostalCode = signal('');
  eeCadastralReference = signal('');
  eeReserveTarget = signal<number | null>(0);
  eeIban = signal('');
  eeColor = signal<string | null>(null);
  eeCif = signal('');
  // Datos generales (la pestaña «Datos generales» solo los muestra).
  eeYearBuilt = signal<number | null>(null);
  eeMainUse = signal<EstateMainUse | ''>('');
  eeInternalRef = signal('');
  eeTaxRegime = signal('');
  eeApplicableLaw = signal('');
  eeNotes = signal('');
  readonly eeMainUseOptions = ESTATE_MAIN_USES;
  /** «Editar finca» por pestañas: las inactivas se ocultan (no se destruyen) para no perder lo escrito ni la foto elegida. */
  readonly eeTabs = [
    { id: 'general', label: 'General' },
    { id: 'location', label: 'Ubicación' },
    { id: 'finance', label: 'Finanzas y contabilidad' },
    { id: 'personalization', label: 'Personalización' },
  ] as const;
  readonly eeTab = signal<'general' | 'location' | 'finance' | 'personalization'>('general');
  readonly eeCadastralInvalid = computed(() => {
    const reference = normalizeReference(this.eeCadastralReference());
    return !!reference && !isParcelReference(reference);
  });
  readonly eeYearInvalid = computed(() => {
    const year = this.eeYearBuilt();
    return year != null && (!Number.isInteger(year) || year < 1500 || year > this.eeMaxYear);
  });
  /** Pestañas con un dato que revisar: se marcan aunque no estén abiertas. */
  readonly eeTabAlerts = computed(() => ({
    general: this.eeYearInvalid(),
    location: this.eeCadastralInvalid(),
    finance: this.eeCifInvalid(),
    personalization: false,
  }));
  readonly eeMaxYear = new Date().getFullYear() + 5;
  eeSaving = signal(false);
  /** Lo que se hará con la foto al guardar (la elige el campo de foto del formulario). */
  eePhoto = signal<EstatePhotoChange>({ file: null, remove: false });
  /** Mismo patrón que el `@Matches` del backend; vacío es válido (no obliga a informarlo). */
  eeCifInvalid = computed(() => {
    const cif = this.eeCif().trim();
    return cif.length > 0 && !CIF_PATTERN.test(cif);
  });
  eeTypeOptions: Estate['type'][] = ['Edificio', 'Urbanización', 'Garaje', 'Trasteros', 'Local'];
  eeColorOptions = ESTATE_COLOR_PALETTE;

  // Titular principal por propiedad, precargado (la API es asíncrona y la
  // tabla lo pinta por fila).
  titularByProperty = signal<Record<string, { name: string; roleType: RoleType }>>({});

  /** Propiedad cuya edición se abre al montar la pestaña Propiedades (enlace desde el Resumen). */
  deepLinkPropertyId = signal<string | null>(null);
  estateProperties = computed(() => this.properties());

  // ── Puesta en marcha ──────────────────────────────────────────────────
  // Sin banner automático: el único punto de entrada es el botón de
  // cabecera, visible siempre que falte algo imprescindible — ni se
  // oculta ni hay que "recuperarla", así que no hace falta persistir nada.
  setupStatus = signal<EstateSetupStatus | null>(null);
  setupDrawerOpen = signal(false);

  /** Pasos imprescindibles que faltan (`null` mientras no ha llegado la puesta en marcha). */
  setupRemaining = computed(() => {
    const status = this.setupStatus();
    return status ? (status.complete ? 0 : status.requiredTotal - status.requiredDone) : null;
  });

  hasPendingSetup = computed(() => {
    const status = this.setupStatus();
    return !!status && !status.complete;
  });

  /** Recalcula tras cualquier cambio que pueda completar un paso (edición, SEPA, titulares, alta/baja de propiedades). */
  async refreshSetupStatus(): Promise<void> {
    const estateId = this.estateData()?.id;
    if (!estateId) return;
    try {
      this.setupStatus.set(await this.estatesSvc.getSetupStatus(estateId));
    } catch (error) {
      console.error('Error cargando la puesta en marcha de la finca', error);
    }
  }

  openSetupDrawer(): void {
    this.setupDrawerOpen.set(true);
  }

  closeSetupDrawer(): void {
    this.setupDrawerOpen.set(false);
  }

  onSetupActionFromDrawer(action: EstateSetupAction): void {
    this.closeSetupDrawer();
    this.onSetupAction(action);
  }

  onSetupAction(action: EstateSetupAction): void {
    const estateId = this.estateData()?.id;
    switch (action) {
      case 'edit-estate':
        this.openEditEstate();
        break;
      case 'add-property':
        this.openNewProperty();
        break;
      case 'review-properties':
        this.activeTab.set('properties');
        break;
      case 'open-sepa':
        this.activeTab.set('general');
        break;
      case 'open-opening-balances':
        if (!estateId) return;
        void this.router.navigate(['/b/accounting', estateId], { queryParams: { tab: 'opening' } });
        break;
      case 'import-properties':
      case 'import-owners':
        if (!estateId) return;
        void this.router.navigate(['/b/migracion'], {
          queryParams: { estateId, entity: action === 'import-properties' ? 'property' : 'owner', returnTo: 'setup' },
        });
        break;
      case 'recalculate-coefficients':
        this.openCoefficientRecalc();
        break;
    }
  }

  get estate(): Estate | null {
    return this.estateData();
  }

  // Se dispara cuando el wizard compartido de alta (AddPropertyComponent)
  // crea una propiedad para esta finca — recarga la tabla sin depender de
  // que estate-detail conozca los detalles del wizard.
  private lastPropertiesVersion = this.state.propertiesVersion();
  private readonly reloadOnPropertiesVersionChange = effect(() => {
    const v = this.state.propertiesVersion();
    if (v === this.lastPropertiesVersion) return;
    this.lastPropertiesVersion = v;
    const estate = this.estateData();
    if (!estate) return;
    void this.reloadProperties(estate.id);
  });

  private async reloadProperties(estateId: string): Promise<void> {
    try {
      const properties = await this.propertiesSvc.listPropertiesByEstate(estateId);
      this.properties.set(properties);
      void this.loadTitulares(properties);
      void this.refreshSetupStatus();
    } catch (error) {
      console.error('Error recargando las propiedades', error);
    }
  }

  async ngOnInit(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? this.state.selectedEstate()?.id;
    if (!id) return;
    this.estateNavigation.context.set(this.navigationContext);
    // Intelligence cards link to another tab of this same, reused detail.
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => {
      if (this.propertiesLoaded() && this.route.snapshot.paramMap.get('id') === this.estateData()?.id) {
        this.applyQueryParamDeepLink();
      }
    });
    try {
      const estate = await this.estatesSvc.findEstateById(id);
      if (this.destroyed) return;
      this.estateData.set(estate);
      if (!estate) return;
      const [properties, requests] = await Promise.all([
        this.propertiesSvc.listPropertiesByEstate(estate.id),
        this.adhesion.listPendingAdhesionRequestsByEstate(estate.id),
      ]);
      if (this.destroyed) return;
      this.properties.set(properties);
      this.propertiesLoaded.set(true);
      this.requests.set(requests);
      void this.loadTitulares(properties);
      void this.refreshSetupStatus();
    } catch (error) {
      console.error('Error cargando el detalle de la finca', error);
    }

    if (!this.destroyed) this.applyQueryParamDeepLink();
  }

  /**
   * `?tab=` + `?entity=<issueId>` (deep-link desde CTAs de alertas rol B, ej.
   * "Asignar proveedor" -> incidencia concreta) y `?action=` (enlaces de la
   * puesta en marcha que abren directamente un modal).
   */
  private applyQueryParamDeepLink(): void {
    const tab = this.route.snapshot.queryParamMap.get('tab');
    const validTabs = ALL_ESTATE_TAB_IDS;
    // Use the same lazy-loading handlers for links and for the horizontal menu.
    this.selectTab(tab && (validTabs as string[]).includes(tab) ? tab as EstateTab : 'summary');

    const action = this.route.snapshot.queryParamMap.get('action');
    if (action === 'edit-estate') this.openEditEstate();
    else if (action === 'add-property') this.openNewProperty();
    else if (action === 'import-catastro') this.openCatastroImport();
    else if (action === 'open-setup') this.openSetupDrawer();
    else if (action === 'office-history') this.showOfficeHistory.set(true);
    else return;
    this.clearActionParam();
  }

  /** Quita `?action=` de la URL (sin añadir historial) para que no vuelva a abrir el modal al recargar o navegar. */
  private clearActionParam(): void {
    const tree = this.router.parseUrl(this.router.url);
    if (!('action' in tree.queryParams)) return;
    delete tree.queryParams['action'];
    void this.router.navigateByUrl(tree, { replaceUrl: true });
  }

  private async loadTitulares(properties: Property[]): Promise<void> {
    const entries: Record<string, { name: string; roleType: RoleType }> = {};
    const estateId = this.estateData()?.id;
    // Los propietarios importados o dados de alta a mano no tienen cuenta
    // (ExternalOwner), así que `findPrimaryContact` no los ve: sin este
    // respaldo, una finca recién importada mostraba "—" en todas las filas.
    const externalOwnersPromise = estateId
      ? this.propertiesSvc.listExternalOwnersByEstate(estateId).catch(() => [])
      : Promise.resolve([]);
    await Promise.all(properties.map(async (p) => {
      try {
        const pc = await this.membershipsMessaging.findPrimaryContact(p.id);
        if (pc) {
          entries[p.id] = { name: pc.user.fullName, roleType: pc.membership.roleType as RoleType };
        }
      } catch {
        // sin titular resoluble — se prueba con el titular externo
      }
    }));
    const unpromoted: Record<string, ExternalOwner> = {};
    for (const owner of await externalOwnersPromise) {
      if (owner.promotedToUserId) continue;
      unpromoted[owner.propertyId] ??= owner;
      if (!entries[owner.propertyId]) {
        entries[owner.propertyId] = { name: owner.fullName, roleType: 'Propietario' };
      }
    }
    this.titularByProperty.set(entries);
    this.externalOwnerByProperty.set(unpromoted);
  }

  /** Titular importado (sin cuenta) de cada propiedad — el que se puede invitar a la app. */
  externalOwnerByProperty = signal<Record<string, ExternalOwner>>({});

  /** Solo los nombres, que es lo que necesita la pestaña de documentos. */
  titularNamesByProperty = computed(() =>
    Object.fromEntries(
      Object.entries(this.titularByProperty()).map(([id, t]) => [id, t.name]),
    ),
  );

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  openPropertyFromSummary(id: string): void {
    this.deepLinkPropertyId.set(id);
    this.selectTab('properties');
  }

  onTitularAdded(): void {
    void this.loadTitulares(this.properties());
    void this.refreshSetupStatus();
  }

  onRequestResolved(id: string): void {
    this.requests.set(this.requests().filter(r => r.id !== id));
  }

  // ── Nueva propiedad ──────────────────────────────────────────────────
  // El alta en sí la maneja el wizard compartido (AddPropertyComponent,
  // montado en app.html) parametrizado con el contexto de esta finca —
  // ver StateService.addPropertyEstateContext. Al guardar, incrementa
  // propertiesVersion, que el effect del constructor usa para recargar.
  openNewProperty(): void {
    const e = this.estate;
    if (!e) return;
    this.state.addPropertyEstateContext.set({
      id: e.id,
      name: e.name,
      address: e.address,
      streetNumber: e.streetNumber,
      location: e.location,
    });
    this.state.showAddPropertyModal.set(true);
  }

  // ── Importar desde el Catastro ───────────────────────────────────────
  // El modal es autosuficiente (consulta, revisión e importación); aquí solo
  // se abre/cierra y se refrescan los datos al terminar.
  showCatastroImport = signal(false);

  openCatastroImport(): void {
    this.showCatastroImport.set(true);
  }

  closeCatastroImport(): void {
    this.showCatastroImport.set(false);
  }

  /** Recarga la tabla (vía propertiesVersion) y la finca (la importación puede haberle rellenado provincia/CP/referencia). */
  async onCatastroImported(result: CatastroImportResult): Promise<void> {
    if (result.created > 0) this.state.propertiesVersion.update((v) => v + 1);
    const estate = this.estateData();
    if (!estate) return;
    // findEstateById no lanza: ante cualquier error devuelve null y se deja la finca como estaba.
    const fresh = await this.estatesSvc.findEstateById(estate.id);
    if (fresh) this.estateData.set(fresh);
  }

  // ── Recalcular coeficientes por m² ──────────────────────────────────
  showCoefficientRecalc = signal(false);

  openCoefficientRecalc(): void {
    this.showCoefficientRecalc.set(true);
  }

  closeCoefficientRecalc(): void {
    this.showCoefficientRecalc.set(false);
  }

  onCoefficientsRecalculated(): void {
    this.state.propertiesVersion.update((v) => v + 1);
    void this.refreshSetupStatus();
    this.showToast('Coeficientes actualizados correctamente');
  }

  // ── Editar finca ─────────────────────────────────────────────────────
  openEditEstate(): void {
    const e = this.estate;
    if (!e) return;
    this.eeName.set(e.name);
    this.eeType.set(e.type);
    this.eeAddress.set(e.address);
    this.eeStreetNumber.set(e.streetNumber ?? '');
    this.eeLocation.set(e.location);
    this.eeDescription.set(e.description ?? '');
    this.eeProvince.set(e.province ?? '');
    this.eePostalCode.set(e.postalCode ?? '');
    this.eeCadastralReference.set(e.cadastralReference ?? '');
    this.eeReserveTarget.set(e.reserveTarget ?? 0);
    this.eeIban.set(e.iban ?? '');
    this.eeColor.set(e.color ?? null);
    this.eeCif.set(e.cif ?? '');
    this.eeYearBuilt.set(e.yearBuilt ?? null);
    this.eeMainUse.set(e.mainUse ?? '');
    this.eeInternalRef.set(e.internalRef ?? '');
    this.eeTaxRegime.set(e.taxRegime ?? '');
    // LPH by default (also the column default); a value the manager cleared on purpose stays empty.
    this.eeApplicableLaw.set(e.applicableLaw === undefined ? 'Ley de Propiedad Horizontal' : (e.applicableLaw ?? ''));
    this.eeNotes.set(e.notes ?? '');
    this.eePhoto.set({ file: null, remove: false });
    this.eeTab.set('general');
    this.showEditEstate.set(true);
  }

  /** Tablist pattern: arrows move (with wrap-around), Home/End jump; the focused tab is selected. */
  onEeTabKeydown(event: KeyboardEvent): void {
    const ids = this.eeTabs.map((t) => t.id);
    const current = ids.indexOf(this.eeTab());
    const next = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: ids.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const id = ids[(next + ids.length) % ids.length];
    this.eeTab.set(id);
    (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus();
  }

  closeEditEstate(): void {
    this.showEditEstate.set(false);
  }

  async saveEditEstate(): Promise<void> {
    const e = this.estate;
    if (!e) return;
    const cadastralReference = normalizeReference(this.eeCadastralReference());
    if (cadastralReference && !isParcelReference(cadastralReference)) {
      this.eeTab.set('location');
      this.showToast('La referencia catastral de la parcela debe tener 14 caracteres');
      return;
    }
    const yearBuilt = this.eeYearBuilt();
    if (this.eeYearInvalid()) {
      this.eeTab.set('general');
      this.showToast(`El año de construcción debe estar entre 1500 y ${this.eeMaxYear}`);
      return;
    }
    this.eeSaving.set(true);
    try {
      const updated = await this.estatesSvc.updateEstate(e.id, {
        name: this.eeName().trim(),
        type: this.eeType(),
        address: this.eeAddress().trim(),
        streetNumber: this.eeStreetNumber().trim() || undefined,
        location: this.eeLocation().trim(),
        description: this.eeDescription().trim() || null,
        // null (no undefined) para poder BORRAR el dato desde el formulario.
        province: this.eeProvince().trim() || null,
        postalCode: this.eePostalCode().trim() || null,
        cadastralReference: cadastralReference || null,
        reserveTarget: this.eeReserveTarget() ?? 0,
        iban: this.eeIban().trim() || undefined,
        color: this.eeColor(),
        // Vacío borra el CIF (null), igual que el color "automático".
        cif: this.eeCif().trim().toUpperCase() || null,
        yearBuilt: yearBuilt ?? null,
        mainUse: this.eeMainUse() || null,
        internalRef: this.eeInternalRef().trim() || null,
        taxRegime: this.eeTaxRegime().trim() || null,
        applicableLaw: this.eeApplicableLaw().trim() || null,
        notes: this.eeNotes().trim() || null,
      });
      // La foto va aparte (otro endpoint): primero los datos y luego la foto, para que un fallo de la foto no pierda lo demás.
      const photo = this.eePhoto();
      let saved = updated;
      try {
        if (photo.file) saved = await this.estatesSvc.uploadEstatePhoto(e.id, photo.file);
        else if (photo.remove) saved = await this.estatesSvc.removeEstatePhoto(e.id);
      } catch (photoError) {
        console.error('Error guardando la foto de la finca', photoError);
        this.estateData.set(updated);
        this.eePhoto.set({ file: null, remove: false });
        this.showToast(`La finca se guardó, pero la foto no: ${this.photoErrorMessage(photoError)}`);
        void this.refreshSetupStatus();
        return; // el formulario sigue abierto para reintentar la foto
      }
      this.estateData.set(saved);
      this.showEditEstate.set(false);
      this.showToast('Finca actualizada correctamente');
      void this.refreshSetupStatus();
    } catch (error) {
      console.error('Error actualizando la finca', error);
      // Antes mostraba siempre el mismo genérico, aunque el backend ya manda
      // el motivo real (p. ej. "cif debe tener formato de CIF español…", o
      // el de OTRO campo del mismo formulario si ese es el que en realidad
      // falló) — sin esto, "Añadir CIF" parecía fallar sin explicación.
      this.showToast(this.messageFrom(error, 'No se pudo actualizar la finca'));
    } finally {
      this.eeSaving.set(false);
    }
  }

  /** `class-validator` (ValidationPipe) manda `message` como array incluso con un solo error — mismo criterio que coefficient-recalc-modal/catastro-import-modal. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /** El límite de tamaño lo corta el servidor con un 413 de texto en inglés: se traduce. */
  private photoErrorMessage(error: any): string {
    if (error?.status === 413) return 'supera el máximo de 5 MB.';
    return this.messageFrom(error, 'no se pudo subir. Inténtalo de nuevo.');
  }

  private messageFrom(error: any, fallback: string): string {
    const msg = error?.error?.message;
    if (typeof msg === 'string' && msg) return msg;
    if (Array.isArray(msg) && msg.length > 0) return msg.join(' ');
    return fallback;
  }
}
