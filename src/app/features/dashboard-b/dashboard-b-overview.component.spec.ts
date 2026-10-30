import {
  API,
  setupComponent,
  settle,
} from "../../core/testing/component-harness";
import { DashboardBComponent } from "./dashboard-b.component";

const row = {
  id: "e1",
  name: "Sol",
  address: "Gran Vía 12",
  streetNumber: "12",
  location: "Madrid",
  type: "Edificio",
  ownersCount: 24,
  balance: "-1234.56",
  activeIssues: 2,
  pendingAmount: "100",
  pendingRequests: 3,
  catastroFacadeUrl: null,
  cadastralReference: null,
};
function result(patch = {}) {
  return {
    items: [row],
    page: 1,
    pageSize: 12,
    total: 25,
    totalPages: 3,
    pendingLabel: "Cuotas pendientes",
    summary: { communities: 25, properties: 100, pendingRequests: 3 },
    ...patch,
  };
}
async function mount() {
  const h = setupComponent(DashboardBComponent);
  h.fixture.detectChanges();
  h.http.expectOne((r) => r.url === `${API}/estates/overview`).flush(result());
  h.http
    .expectOne((r) => r.url === `${API}/estates/setup-summary`)
    .flush([
      { estateId: "e1", requiredDone: 2, requiredTotal: 5, complete: false, invitableOwners: 0 },
    ]);
  await settle();
  h.fixture.detectChanges();
  return h;
}

describe("Fincas overview UI", () => {
  beforeEach(() => localStorage.removeItem("domora-estates-view"));
  afterEach(() => vi.useRealTimers());
  it("descarga un Excel con filtros sin paginación, evita doble descarga y permite reintentar", async () => {
    const h = await mount();
    expect(h.el.querySelector(".sort-control")).toBeNull();
    expect(h.el.querySelector(".direction-btn")).toBeNull();
    h.component.searchValue.set("Sol");
    h.component.typeFilters.set(["Edificio", "Garaje"]);
    h.component.page.set(2);
    const create = vi.fn().mockReturnValue("blob:export");
    const revoke = vi.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      const failed = h.component.downloadExcel();
      await h.component.downloadExcel();
      const req = h.http.expectOne((r) =>
        r.url.includes("/overview/export.xlsx"),
      );
      const url = new URL(req.request.url, "http://localhost");
      expect(url.searchParams.get("search")).toBe("Sol");
      expect(url.searchParams.get("types")).toBe("Edificio,Garaje");
      expect(url.searchParams.has("page")).toBe(false);
      expect(url.searchParams.has("pageSize")).toBe(false);
      expect(req.request.responseType).toBe("blob");
      h.fixture.detectChanges();
      expect(
        h.el.querySelector<HTMLButtonElement>(".download-btn")?.disabled,
      ).toBe(true);
      req.flush(new Blob(["error"]), { status: 500, statusText: "Error" });
      await failed;
      expect(h.component.exporting()).toBe(false);
      expect(h.component.exportError()).toContain("Vuelve a intentarlo");
      const retry = h.component.downloadExcel();
      h.http
        .expectOne((r) => r.url.includes("/overview/export.xlsx"))
        .flush(new Blob(["xlsx"]));
      await retry;
      expect(h.component.exportError()).toBeNull();
      expect(click).toHaveBeenCalledOnce();
      expect(create).toHaveBeenCalledOnce();
      expect(revoke).toHaveBeenCalledWith("blob:export");
      expect(h.component.exporting()).toBe(false);
      h.http.verify();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      click.mockRestore();
    }
  });
  it("tabla por defecto, columnas sin Estado, saldo semántico, dirección y Ver finca", async () => {
    const h = await mount();
    expect(h.component.view()).toBe("table");
    expect(h.el.querySelector(".scope-label")).toBeNull();
    expect(h.el.querySelector(".quick-filters")).toBeNull();
    expect(
      Array.from(h.el.querySelectorAll("th")).map((th) =>
        th.textContent?.trim(),
      ),
    ).toEqual([
      "Comunidad ↑",
      "Propietarios",
      "Incidencias",
      "Cuotas pendientes",
      "Saldo actual",
      "Acciones",
    ]);
    expect(h.el.querySelector(".money-cell.text-error")?.textContent).toContain(
      "1234,56",
    );
    expect(h.el.querySelector(".community-address")?.textContent).toBe(
      "Gran Vía 12, Madrid",
    );
    expect(h.el.querySelector(".view-estate")?.getAttribute("href")).toBe(
      "/b/estates/e1",
    );
    expect(h.el.querySelector("th")?.getAttribute("aria-sort")).toBe(
      "ascending",
    );
    h.http.verify();
  });
  it("toggle conserva filtros, sort, página y resultados sin consulta; cards contienen solo campos permitidos", async () => {
    const h = await mount();
    h.component.setTypes(["Edificio"]);
    h.http.expectOne((r) => r.url.endsWith("/overview")).flush(result());
    await settle();
    h.component.setSort("balance");
    h.http.expectOne((r) => r.url.endsWith("/overview")).flush(result());
    await settle();
    h.component.goToPage(2);
    h.http
      .expectOne((r) => r.params.get("page") === "2")
      .flush(result({ page: 2 }));
    await settle();
    h.component.setView("cards");
    h.fixture.detectChanges();
    expect(h.component.page()).toBe(2);
    expect(h.component.typeFilters()).toEqual(["Edificio"]);
    expect(h.component.sortColumn()).toBe("balance");
    expect(localStorage.getItem("domora-estates-view")).toBe("cards");
    const card = h.el.querySelector(".estate-card")!;
    expect(card.tagName).toBe("ARTICLE");
    expect(card.textContent).toContain("Sol");
    const link = card.querySelector("a.estate-card__link")!;
    expect(link.getAttribute("href")).toBe("/b/estates/e1");
    expect(link.getAttribute("aria-label")).toBe("Abrir Sol");
    // El menú de acciones es hermano del enlace, no va dentro de él.
    expect(link.querySelector("app-estate-actions-menu")).toBeNull();
    expect(card.querySelector("app-estate-actions-menu")).not.toBeNull();
    expect(
      Array.from(card.querySelectorAll("dt")).map((dt) => dt.textContent),
    ).toEqual(["Propietarios", "Saldo actual", "Cuotas pendientes"]);
    expect(card.querySelector(".estate-card__issues")?.textContent).toContain(
      "Incidencias",
    );
    expect(card.querySelector(".estate-card__issues strong")?.textContent).toBe(
      "2",
    );
    expect(
      card.querySelector(".card-pending.text-warning")?.textContent,
    ).toContain("100,00");
    expect(card.querySelector(".card-pending")?.textContent).toContain("€");
    for (const forbidden of [
      "solicitudes",
      "Ocupación",
      "Propiedades",
      "Edificio",
      "Estado",
      "Configuración",
      "Ver finca",
    ])
      expect(card.textContent).not.toContain(forbidden);
    expect(card.querySelector("app-estate-facade-thumbnail")).not.toBeNull();
    h.component.setView("table");
    h.fixture.detectChanges();
    expect(h.el.querySelector("table")).not.toBeNull();
    h.http.expectNone((r) => r.url.endsWith("/overview"));
    h.http.verify();
  });
  describe("menú de acciones de cada finca", () => {
    async function choose(
      h: Awaited<ReturnType<typeof mount>>,
      host: string,
      label: string,
    ): Promise<void> {
      (h.el.querySelector(`${host} .trigger`) as HTMLButtonElement).click();
      h.fixture.detectChanges();
      await settle();
      h.fixture.detectChanges();
      const item = Array.from(
        h.el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      ).find((b) => b.textContent?.includes(label));
      item!.click();
      h.fixture.detectChanges();
    }

    it("la fila avisa de los pasos pendientes y ofrece sus acciones", async () => {
      const h = await mount();
      const trigger = h.el.querySelector("tbody .trigger")!;
      expect(trigger.getAttribute("aria-label")).toBe(
        "Acciones de Sol, 3 pasos pendientes",
      );
      expect(h.el.querySelector("tbody .trigger__dot")).not.toBeNull();
      (trigger as HTMLButtonElement).click();
      h.fixture.detectChanges();
      expect(
        Array.from(h.el.querySelectorAll('[role="menuitem"] .item__label')).map(
          (l) => l.textContent?.trim(),
        ),
      ).toEqual([
        "Puesta en marcha",
        "Editar finca",
        "Historial de cargos",
        "Importar del Catastro",
        "Nueva propiedad",
      ]);
    });

    it.each([
      ["Puesta en marcha", "open-setup"],
      ["Editar finca", "edit-estate"],
      ["Importar del Catastro", "import-catastro"],
      ["Historial de cargos", "office-history"],
    ])("«%s» abre la ficha con ?action=%s", async (label, action) => {
      const h = await mount();
      const navigate = vi
        .spyOn(h.component.router, "navigate")
        .mockResolvedValue(true);
      await choose(h, "tbody", label);
      expect(navigate).toHaveBeenCalledWith(["/b/estates", "e1"], {
        queryParams: { action },
      });
    });

    it("«Nueva propiedad» abre el asistente con el contexto de la finca, sin navegar", async () => {
      const h = await mount();
      const navigate = vi
        .spyOn(h.component.router, "navigate")
        .mockResolvedValue(true);
      await choose(h, "tbody", "Nueva propiedad");
      expect(navigate).not.toHaveBeenCalled();
      expect(h.component.state.showAddPropertyModal()).toBe(true);
      expect(h.component.state.addPropertyEstateContext()).toEqual({
        id: "e1",
        name: "Sol",
        address: "Gran Vía 12",
        streetNumber: "12",
        location: "Madrid",
      });
    });

    it("en tarjetas el menú funciona igual", async () => {
      localStorage.setItem("domora-estates-view", "cards");
      const h = await mount();
      const navigate = vi
        .spyOn(h.component.router, "navigate")
        .mockResolvedValue(true);
      await choose(h, ".estate-card", "Editar finca");
      expect(navigate).toHaveBeenCalledWith(["/b/estates", "e1"], {
        queryParams: { action: "edit-estate" },
      });
    });

    it("si el resumen de puesta en marcha falla, no hay indicador pero el menú sigue", async () => {
      const h = setupComponent(DashboardBComponent);
      h.fixture.detectChanges();
      h.http.expectOne((r) => r.url === `${API}/estates/overview`).flush(result());
      h.http
        .expectOne((r) => r.url === `${API}/estates/setup-summary`)
        .flush({}, { status: 500, statusText: "Error" });
      await settle();
      h.fixture.detectChanges();
      expect(h.el.querySelector("tbody .trigger__dot")).toBeNull();
      expect(h.el.querySelector("tbody .trigger")?.getAttribute("aria-label")).toBe(
        "Acciones de Sol",
      );
    });
  });
  it("preferencia guardada inicia en cards", async () => {
    localStorage.setItem("domora-estates-view", "cards");
    const h = await mount();
    expect(h.component.view()).toBe("cards");
    h.http.verify();
  });
  it("valor inválido inicia en tabla", async () => {
    localStorage.setItem("domora-estates-view", "invalid");
    const h = await mount();
    expect(h.component.view()).toBe("table");
    h.http.verify();
  });
  it("búsqueda local debounce; filtro, tipo y sort resetean página antes de consultar", async () => {
    const h = await mount();
    vi.useFakeTimers();
    h.component.page.set(2);
    h.component.onLocalSearch("Gran Vía");
    vi.advanceTimersByTime(274);
    h.http.expectNone((r) => r.url.endsWith("/overview"));
    vi.advanceTimersByTime(1);
    const req = h.http.expectOne((r) => r.url.endsWith("/overview"));
    expect(req.request.params.get("search")).toBe("Gran Vía");
    expect(req.request.params.get("page")).toBe("1");
    expect(req.request.params.get("filter")).toBe("all");
    req.flush(result());
    await Promise.resolve();
    await Promise.resolve();
    h.component.setTypes(["Urbanización", "Garaje"]);
    const type = h.http.expectOne((r) => r.url.endsWith("/overview"));
    expect(type.request.params.get("types")).toBe("Urbanizacion,Garaje");
    type.flush(result());
    await Promise.resolve();
    await Promise.resolve();
    h.component.page.set(2);
    h.component.setSort("ownersCount");
    const sort = h.http.expectOne((r) => r.url.endsWith("/overview"));
    expect(sort.request.params.get("sort")).toBe("ownersCount");
    expect(sort.request.params.get("page")).toBe("1");
    sort.flush(result());
    h.http.verify();
  });
  it("loading no inventa KPI a cero; error/retry, empty database y empty filter", async () => {
    const h = setupComponent(DashboardBComponent);
    h.fixture.detectChanges();
    expect(h.el.querySelector(".skeleton-row")).not.toBeNull();
    expect(h.el.querySelector(".compact-summary strong")).toBeNull();
    h.http
      .expectOne((r) => r.url === `${API}/estates/setup-summary`)
      .flush([]);
    h.http
      .expectOne((r) => r.url.endsWith("/overview"))
      .flush({}, { status: 500, statusText: "Error" });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain(
      "No se pudieron cargar las comunidades.",
    );
    void h.component.loadOverview();
    h.http
      .expectOne((r) => r.url.endsWith("/overview"))
      .flush(result({ items: [], total: 0, totalPages: 0 }));
    await settle();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain("No hay comunidades que coincidan");
    expect(h.el.textContent).not.toContain("Da de alta");
    h.component.clearFilters();
    h.http
      .expectOne((r) => r.url.endsWith("/overview"))
      .flush(
        result({
          items: [],
          total: 0,
          totalPages: 0,
          summary: { communities: 0, properties: 0, pendingRequests: 0 },
        }),
      );
    await settle();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain("Da de alta tu primera finca");
    h.http.verify();
  });
  it("solo la respuesta overview más reciente actualiza el listado", async () => {
    const h = await mount();
    h.component.setTypes(["Edificio"]);
    const old = h.http.expectOne((r) => r.params.get("types") === "Edificio");
    h.component.setTypes(["Garaje"]);
    const fresh = h.http.expectOne((r) => r.params.get("types") === "Garaje");
    fresh.flush(result({ items: [{ ...row, name: "Nueva" }] }));
    old.flush(result({ items: [{ ...row, name: "Vieja" }] }));
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector(".community-name")?.textContent).toBe("Nueva");
    h.http.verify();
  });
});
