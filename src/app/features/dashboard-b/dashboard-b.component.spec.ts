import { Router } from "@angular/router";
import { TestBed } from "@angular/core/testing";
import {
  API,
  setupComponent,
  settle,
} from "../../core/testing/component-harness";
import { StateService } from "../../core/state.service";
import { DashboardBComponent } from "./dashboard-b.component";
import type { Estate } from "../../core/models";

function makeEstate(overrides: Partial<Estate> = {}): Estate {
  return {
    id: "e1",
    administratorId: "a1",
    name: "Edificio Sol",
    type: "Edificio",
    address: "Calle Mayor",
    location: "Madrid",
    properties: 10,
    residents: 8,
    requests: 0,
    activeIssues: 0,
    occupancy: 80,
    reserveTarget: 0,
    ...overrides,
  };
}

function overview(estates: Estate[]) {
  return {
    items: estates.map((estate) => ({
      ...estate,
      ownersCount: 2,
      balance: "1250.25",
      pendingAmount: "100.50",
      pendingRequests: estate.requests,
      catastroFacadeUrl: null,
    })),
    page: 1,
    pageSize: 12,
    total: estates.length,
    totalPages: estates.length ? 1 : 0,
    pendingLabel: "Cuotas pendientes",
    summary: {
      communities: estates.length,
      properties: estates.reduce((sum, e) => sum + e.properties, 0),
      pendingRequests: estates.reduce((sum, e) => sum + e.requests, 0),
    },
  };
}

describe("DashboardBComponent", () => {
  beforeEach(() => localStorage.removeItem("domora-estates-view"));
  describe('modal "Nueva finca"', () => {
    it("sin nombre/dirección/localidad, no envía nada y marca los 3 campos con error", async () => {
      const { fixture, http, el, component } =
        setupComponent(DashboardBComponent);
      fixture.detectChanges();
      http
        .expectOne((r) => r.url === `${API}/estates/overview`)
        .flush(overview([makeEstate()]));
      await settle();
      fixture.detectChanges();

      (
        Array.from(el.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("Nueva finca"),
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        Array.from(el.querySelectorAll(".modal__footer button")).find((b) =>
          b.textContent?.includes("Crear finca"),
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(component.nfErrors()).toEqual({
        name: true,
        address: true,
        location: true,
      });
      expect(el.querySelectorAll(".form-error")).toHaveLength(3);
      http.expectNone((r) => r.method === "POST");
    });

    /** Carga la lista y rellena el modal — el envío lo dispara cada test, para capturar el POST en el momento justo. */
    async function fillForm(
      h: ReturnType<typeof setupComponent<DashboardBComponent>>,
    ): Promise<void> {
      h.fixture.detectChanges();
      h.http
        .expectOne((r) => r.url === `${API}/estates/overview`)
        .flush(overview([makeEstate({ id: "e-vieja", name: "Vieja" })]));
      await settle();
      h.fixture.detectChanges();
      h.component.openNuevaFinca();
      h.component.nfName.set("Edificio Nuevo");
      h.component.nfAddress.set("Calle Falsa 123");
      h.component.nfLocation.set("Sevilla");
    }

    it("con los campos completos, crea la finca, recarga la sesión y entra en ella", async () => {
      const h = setupComponent(DashboardBComponent);
      const navigateSpy = vi
        .spyOn(TestBed.inject(Router), "navigate")
        .mockResolvedValue(true);
      const reloadSpy = vi.spyOn(h.auth, "reloadSession");

      await fillForm(h);
      const submitPromise = h.component.submitNuevaFinca();
      const req = h.http.expectOne(
        (r) => r.url === `${API}/estates` && r.method === "POST",
      );
      expect(req.request.body).toMatchObject({
        name: "Edificio Nuevo",
        address: "Calle Falsa 123",
        location: "Sevilla",
      });
      req.flush(
        makeEstate({
          id: "e-nueva",
          name: "Edificio Nuevo",
          address: "Calle Falsa 123",
          location: "Sevilla",
        }),
      );
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.component.showNuevaFinca()).toBe(false);
      // Sin recargar la sesión, el guard de la finca la rechazaría: estateIds viene del token.
      expect(reloadSpy).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith(["/b/estates", "e-nueva"]);
      expect(reloadSpy.mock.invocationCallOrder[0]).toBeLessThan(
        navigateSpy.mock.invocationCallOrder[0],
      );
    });

    it("si recargar la sesión falla, no navega (rebotaría) y avisa de que hay que recargar", async () => {
      const h = setupComponent(DashboardBComponent);
      const navigateSpy = vi
        .spyOn(TestBed.inject(Router), "navigate")
        .mockResolvedValue(true);
      vi.spyOn(h.auth, "reloadSession").mockRejectedValueOnce(
        new Error("refresh caducado"),
      );
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await fillForm(h);
      const submitPromise = h.component.submitNuevaFinca();
      h.http
        .expectOne((r) => r.url === `${API}/estates` && r.method === "POST")
        .flush(makeEstate({ id: "e-nueva" }));
      await submitPromise;
      h.fixture.detectChanges();

      expect(navigateSpy).not.toHaveBeenCalled();
      expect(h.el.querySelector(".toast")?.textContent).toContain(
        "Recarga la página",
      );
    });

    it('"Crear e importar datos" crea la finca, recarga la sesión y va al asistente de migración con la finca elegida', async () => {
      const h = setupComponent(DashboardBComponent);
      const navigateSpy = vi
        .spyOn(TestBed.inject(Router), "navigate")
        .mockResolvedValue(true);
      const reloadSpy = vi.spyOn(h.auth, "reloadSession");

      await fillForm(h);
      const submitPromise = h.component.submitNuevaFinca("import");
      h.http
        .expectOne((r) => r.url === `${API}/estates` && r.method === "POST")
        .flush(makeEstate({ id: "e-nueva" }));
      await submitPromise;

      // La importación va contra /estates/:id/imports, protegido por el alcance del token: sin recargar, 403.
      expect(reloadSpy).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith(["/b/migracion"], {
        queryParams: {
          estateId: "e-nueva",
          entity: "property",
          returnTo: "setup",
        },
      });
    });

    it("si el alta falla, avisa y deja el modal abierto (antes quedaba colgado sin feedback)", async () => {
      const h = setupComponent(DashboardBComponent);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      await fillForm(h);
      const submitPromise = h.component.submitNuevaFinca();
      h.http
        .expectOne((r) => r.url === `${API}/estates` && r.method === "POST")
        .flush(
          { message: "boom" },
          { status: 500, statusText: "Server Error" },
        );
      await submitPromise;
      h.fixture.detectChanges();

      expect(h.component.showNuevaFinca()).toBe(true);
      expect(h.el.querySelector(".toast")?.textContent).toContain(
        "No se pudo crear la finca",
      );
    });

    async function openForm() {
      const h = setupComponent(DashboardBComponent);
      h.fixture.detectChanges();
      h.http
        .expectOne((r) => r.url === `${API}/estates/overview`)
        .flush(overview([]));
      await settle();
      h.fixture.detectChanges();
      h.component.nfName.set("Edificio Nuevo");
      h.component.nfAddress.set("Calle Falsa 123");
      h.component.nfLocation.set("Sevilla");
      return h;
    }

    it("provincia, código postal y referencia catastral opcionales viajan al backend (la referencia normalizada)", async () => {
      const { http, component } = await openForm();
      vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
      component.nfProvince.set(" Sevilla ");
      component.nfPostalCode.set("41001");
      component.nfCadastralReference.set(" 2853604vk4725d ");

      const submitPromise = component.submitNuevaFinca();
      const req = http.expectOne(
        (r) => r.url === `${API}/estates` && r.method === "POST",
      );
      expect(req.request.body).toMatchObject({
        province: "Sevilla",
        postalCode: "41001",
        cadastralReference: "2853604VK4725D",
      });
      req.flush(makeEstate({ id: "e-nueva" }));
      await submitPromise;
    });

    it("en blanco no se envían (el backend rechazaría una referencia vacía)", async () => {
      const { http, component } = await openForm();
      vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);

      const submitPromise = component.submitNuevaFinca();
      const req = http.expectOne(
        (r) => r.url === `${API}/estates` && r.method === "POST",
      );
      expect(req.request.body.cadastralReference).toBeUndefined();
      expect(req.request.body.province).toBeUndefined();
      expect(req.request.body.postalCode).toBeUndefined();
      req.flush(makeEstate({ id: "e-nueva" }));
      await submitPromise;
    });

    it("una referencia catastral que no tiene 14 caracteres marca el error y no envía nada", async () => {
      const { http, component, fixture, el } = await openForm();
      component.showNuevaFinca.set(true);
      component.nfCadastralReference.set("123");

      await component.submitNuevaFinca();
      fixture.detectChanges();

      expect(component.nfErrors()).toEqual({ cadastralReference: true });
      expect(el.textContent).toContain("Deben ser 14 caracteres");
      http.expectNone((r) => r.method === "POST");
    });

    it("abrir el formulario limpia los campos de la vez anterior", async () => {
      const { component } = await openForm();
      component.nfCadastralReference.set("2853604VK4725D");

      component.openNuevaFinca();

      expect(component.nfCadastralReference()).toBe("");
      expect(component.nfProvince()).toBe("");
      expect(component.nfPostalCode()).toBe("");
    });
  });
});
