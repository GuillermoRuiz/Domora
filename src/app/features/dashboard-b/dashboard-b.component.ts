import {
  Component,
  signal,
  inject,
  computed,
  OnInit,
  OnDestroy,
} from "@angular/core";
import { Router } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { TopbarComponent } from "../../layout/topbar/topbar.component";
import { BtnComponent } from "../../shared/components/btn/btn.component";
import { IconComponent } from "../../shared/components/icon/icon.component";
import { Estate, EstateType } from "../../core/models";
import { EmptyStateComponent } from "../../shared/components/empty-state/empty-state.component";
import { StateService } from "../../core/state.service";
import { EstatesService } from "../../core/estates.service";
import {
  isParcelReference,
  normalizeReference,
} from "../../core/catastro-reference";
import { AuthService } from "../../core/auth.service";

import {
  EstateOverview,
  EstateOverviewSort,
  EstateOverviewQuery,
} from "../../core/estate-overview.models";
import { EstateScopeSelectorComponent } from "./estate-scope-selector/estate-scope-selector.component";
import { EstateManagementSearchComponent } from "./estate-management-search/estate-management-search.component";
import {
  EstateOverviewViewsComponent,
  type EstateActionRequest,
} from "./estate-overview-views/estate-overview-views.component";

import { EstateOverviewSkeletonComponent } from "./estate-overview-skeleton/estate-overview-skeleton.component";
import { EstateTypeFilterComponent } from "./estate-type-filter/estate-type-filter.component";

interface EstateTypeOption {
  type: EstateType;
  icon: string;
}

const ESTATE_TYPE_OPTIONS: EstateTypeOption[] = [
  { type: "Edificio", icon: "building" },
  { type: "Urbanización", icon: "city" },
  { type: "Garaje", icon: "car" },
  { type: "Trasteros", icon: "package" },
  { type: "Local", icon: "store" },
];

@Component({
  selector: "app-dashboard-b",
  standalone: true,
  imports: [
    TopbarComponent,
    BtnComponent,
    IconComponent,
    FormsModule,
    EmptyStateComponent,
    EstateScopeSelectorComponent,
    EstateManagementSearchComponent,
    EstateOverviewViewsComponent,
    EstateOverviewSkeletonComponent,
    EstateTypeFilterComponent,
  ],
  templateUrl: "./dashboard-b.component.html",
  styleUrl: "./dashboard-b.component.scss",
})
export class DashboardBComponent implements OnInit, OnDestroy {
  router = inject(Router);
  state = inject(StateService);
  data = inject(EstatesService);
  private auth = inject(AuthService);

  readonly overview = signal<EstateOverview | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  readonly searchValue = signal("");
  readonly typeFilters = signal<EstateType[]>([]);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  readonly sortColumn = signal<EstateOverviewSort>("name");
  readonly direction = signal<"asc" | "desc">("asc");
  readonly page = signal(1);
  readonly pageSize = 12;
  readonly view = signal<"table" | "cards">(this.readView());
  readonly items = computed(() => this.overview()?.items ?? []);
  readonly firstResult = computed(() =>
    this.overview()?.total ? (this.page() - 1) * this.pageSize + 1 : 0,
  );
  readonly lastResult = computed(() =>
    Math.min(this.page() * this.pageSize, this.overview()?.total ?? 0),
  );
  readonly pageNumbers = computed(() => {
    const pages = this.overview()?.totalPages ?? 0;
    const start = Math.max(1, Math.min(this.page() - 2, pages - 4));
    return Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  });
  readonly estateTypeOptions = ESTATE_TYPE_OPTIONS;
  readonly toastMessage = signal<string | null>(null);
  private timer?: ReturnType<typeof setTimeout>;
  private requestVersion = 0;

  /** Pasos de puesta en marcha que faltan por finca; las que no llegan no pintan indicador. */
  readonly setupRemaining = signal<Record<string, number>>({});

  ngOnInit(): void {
    void this.loadOverview();
    void this.loadSetupSummary();
  }
  private async loadSetupSummary(): Promise<void> {
    try {
      const summary = await this.data.getSetupSummary();
      this.setupRemaining.set(
        Object.fromEntries(
          summary.map((s) => [
            s.estateId,
            s.complete ? 0 : s.requiredTotal - s.requiredDone,
          ]),
        ),
      );
    } catch {
      // Es solo un indicador: sin él el menú sigue funcionando.
    }
  }
  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.requestVersion++;
  }
  private readView(): "table" | "cards" {
    try {
      return localStorage.getItem("domora-estates-view") === "cards"
        ? "cards"
        : "table";
    } catch {
      return "table";
    }
  }
  setView(view: "table" | "cards"): void {
    this.view.set(view);
    try {
      localStorage.setItem("domora-estates-view", view);
    } catch {
      /* UI still works with storage disabled. */
    }
  }
  private queryFilters(): Omit<EstateOverviewQuery, "page" | "pageSize"> {
    return {
      search: this.searchValue().trim(),
      filter: "all",
      types: this.typeFilters(),
      sort: this.sortColumn(),
      direction: this.direction(),
    };
  }
  async loadOverview(): Promise<void> {
    clearTimeout(this.timer);
    const version = ++this.requestVersion;
    this.loading.set(true);
    this.loadError.set(false);
    try {
      const result = await this.data.getOverview({
        ...this.queryFilters(),
        page: this.page(),
        pageSize: this.pageSize,
      });
      if (version === this.requestVersion) {
        this.overview.set(result);
        this.page.set(result.page);
      }
    } catch {
      if (version === this.requestVersion) this.loadError.set(true);
    } finally {
      if (version === this.requestVersion) this.loading.set(false);
    }
  }
  onLocalSearch(value: string): void {
    this.searchValue.set(value);
    this.page.set(1);
    this.requestVersion++;
    this.loading.set(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.loadOverview(), 275);
  }
  private refreshQuery(): void {
    this.page.set(1);
    void this.loadOverview();
  }
  setTypes(types: EstateType[]): void {
    this.typeFilters.set(types);
    this.refreshQuery();
  }
  setSort(sort: EstateOverviewSort, toggle = false): void {
    this.direction.set(
      toggle && this.sortColumn() === sort && this.direction() === "asc"
        ? "desc"
        : "asc",
    );
    this.sortColumn.set(sort);
    this.refreshQuery();
  }
  clearFilters(): void {
    this.searchValue.set("");
    this.typeFilters.set([]);
    this.refreshQuery();
  }
  async downloadExcel(): Promise<void> {
    if (
      this.exporting() ||
      this.loading() ||
      this.loadError() ||
      !this.overview()?.total
    )
      return;
    this.exporting.set(true);
    this.exportError.set(null);
    try {
      const blob = await this.data.downloadOverviewExcel(this.queryFilters());
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = "comunidades.xlsx";
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      this.exportError.set(
        "No se pudo descargar el Excel. Vuelve a intentarlo.",
      );
    } finally {
      this.exporting.set(false);
    }
  }
  goToPage(page: number): void {
    if (
      this.loading() ||
      page < 1 ||
      page > (this.overview()?.totalPages ?? 0) ||
      page === this.page()
    )
      return;
    this.page.set(page);
    void this.loadOverview();
  }
  openEstate(estate: Pick<Estate, "id">): void {
    void this.router.navigate(["/b/estates", estate.id]);
  }
  /**
   * Acciones del menú de cada finca. «Nueva propiedad» abre el asistente compartido con el contexto de la finca;
   * el resto abre la ficha con `?action=`, que es quien tiene los modales y el panel de puesta en marcha.
   */
  onEstateAction({ estate, action }: EstateActionRequest): void {
    if (action === "new-property") {
      this.state.addPropertyEstateContext.set({
        id: estate.id,
        name: estate.name,
        address: estate.address,
        streetNumber: estate.streetNumber ?? undefined,
        location: estate.location,
      });
      this.state.showAddPropertyModal.set(true);
      return;
    }
    const queryAction = {
      edit: "edit-estate",
      "import-catastro": "import-catastro",
      "open-setup": "open-setup",
      "office-history": "office-history",
    }[action];
    void this.router.navigate(["/b/estates", estate.id], {
      queryParams: { action: queryAction },
    });
  }

  showNuevaFinca = signal(false);
  nfName = signal("");
  nfType = signal<EstateType>("Edificio");
  nfAddress = signal("");
  nfStreetNumber = signal("");
  nfLocation = signal("");
  // Opcionales: dejan la finca lista para consultar el Catastro (Importar del Catastro).
  nfProvince = signal("");
  nfPostalCode = signal("");
  nfCadastralReference = signal("");
  nfErrors = signal<{
    name?: boolean;
    address?: boolean;
    location?: boolean;
    cadastralReference?: boolean;
  }>({});

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  openNuevaFinca(): void {
    this.nfName.set("");
    this.nfType.set("Edificio");
    this.nfAddress.set("");
    this.nfStreetNumber.set("");
    this.nfLocation.set("");
    this.nfProvince.set("");
    this.nfPostalCode.set("");
    this.nfCadastralReference.set("");
    this.nfErrors.set({});
    this.showNuevaFinca.set(true);
  }

  closeNuevaFinca(): void {
    this.showNuevaFinca.set(false);
  }

  /**
   * `then: 'import'` lleva directo al asistente de migración con la finca
   * ya elegida: la importación necesita una finca existente, así que
   * "importar desde otro programa" es crear y luego importar.
   */
  async submitNuevaFinca(then: "open" | "import" = "open"): Promise<void> {
    const name = this.nfName().trim();
    const address = this.nfAddress().trim();
    const location = this.nfLocation().trim();
    const cadastralReference = normalizeReference(this.nfCadastralReference());
    const errors: {
      name?: boolean;
      address?: boolean;
      location?: boolean;
      cadastralReference?: boolean;
    } = {};
    if (!name) errors.name = true;
    if (!address) errors.address = true;
    if (!location) errors.location = true;
    // Opcional, pero si se rellena tiene que ser la referencia de la PARCELA (14 caracteres).
    if (cadastralReference && !isParcelReference(cadastralReference))
      errors.cadastralReference = true;
    if (
      errors.name ||
      errors.address ||
      errors.location ||
      errors.cadastralReference
    ) {
      this.nfErrors.set(errors);
      return;
    }
    let estate: Estate;
    try {
      estate = await this.data.createEstate({
        name,
        type: this.nfType(),
        address,
        streetNumber: this.nfStreetNumber().trim() || undefined,
        location,
        province: this.nfProvince().trim() || undefined,
        postalCode: this.nfPostalCode().trim() || undefined,
        cadastralReference: cadastralReference || undefined,
        properties: 0,
        residents: 0,
        requests: 0,
        activeIssues: 0,
        occupancy: 0,
        reserveTarget: 0,
      });
    } catch (error) {
      console.error("Error creando la finca", error);
      this.showToast("No se pudo crear la finca");
      return;
    }
    this.showNuevaFinca.set(false);

    try {
      await this.auth.reloadSession();
    } catch (error) {
      console.error("Error recargando la sesión tras crear la finca", error);
      this.showToast("Finca creada. Recarga la página para abrirla.");
      return;
    }
    if (then === "import") {
      this.state.selectedEstate.set(estate);
      void this.router.navigate(["/b/migracion"], {
        queryParams: {
          estateId: estate.id,
          entity: "property",
          returnTo: "setup",
        },
      });
      return;
    }
    this.openEstate(estate);
  }
}
