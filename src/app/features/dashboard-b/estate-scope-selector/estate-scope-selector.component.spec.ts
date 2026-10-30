import { Router } from "@angular/router";
import { TestBed } from "@angular/core/testing";
import {
  API,
  makeUser,
  setupComponent,
  settle,
} from "../../../core/testing/component-harness";
import { CommunityScopeService } from "../../../core/community-scope.service";
import { EstateScopeSelectorComponent } from "./estate-scope-selector.component";

describe("EstateScopeSelectorComponent", () => {
  it("Todas, permisos, búsqueda por nombre/dirección y selección", async () => {
    const h = setupComponent(EstateScopeSelectorComponent, {
      user: makeUser({ role: "B", administratorId: "a1", estateIds: ["e1"] }),
    });
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain("Todas mis comunidades");
    h.component.toggle();
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates`).flush([
      {
        id: "e1",
        administratorId: "a1",
        name: "Los Pinos",
        address: "Calle Jardín",
        streetNumber: "24",
        location: "Madrid",
        type: "Edificio",
      },
      {
        id: "e2",
        administratorId: "other",
        name: "Ajena",
        address: "",
        location: "",
        type: "Edificio",
      },
    ]);
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelectorAll("[data-estate-id]")).toHaveLength(1);
    h.component.query.set("JARDÍN 24");
    h.fixture.detectChanges();
    expect(h.el.querySelectorAll("[data-estate-id]")).toHaveLength(1);
    const input = h.el.querySelector("input")!;
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(document.activeElement?.textContent).toContain(
      "Todas mis comunidades",
    );
    const navigate = vi
      .spyOn(TestBed.inject(Router), "navigate")
      .mockResolvedValue(true);
    (h.el.querySelector("[data-estate-id]") as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(["/b/estates", "e1"]);
    h.component.toggle();
    h.fixture.detectChanges();
    (h.el.querySelector(".scope-all") as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(["/b/estates"]);
    h.http.verify();
  });
  it("loading, error/retry, empty y Escape devuelven foco", async () => {
    const h = setupComponent(EstateScopeSelectorComponent);
    h.fixture.detectChanges();
    h.component.toggle();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain("Cargando");
    h.http
      .expectOne(`${API}/estates`)
      .flush({}, { status: 500, statusText: "Error" });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector("[role=alert]")).not.toBeNull();
    void h.component.load();
    h.http.expectOne(`${API}/estates`).flush([]);
    await settle();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain("No se encontraron");
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    h.fixture.detectChanges();
    expect(h.el.querySelector(".scope-menu")).toBeNull();
    expect(document.activeElement).toBe(h.el.querySelector(".scope-trigger"));
    h.http.verify();
  });

  it("elegir una finca la comparte con el resto de pantallas y el botón la muestra", async () => {
    const h = setupComponent(EstateScopeSelectorComponent, {
      user: makeUser({ role: "B", administratorId: "a1", estateIds: ["e1"] }),
    });
    const navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    h.fixture.detectChanges();
    h.component.toggle();
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates`).flush([
      { id: "e1", administratorId: "a1", name: "Los Pinos", address: "Calle Jardín", location: "Madrid", type: "Edificio" },
    ]);
    await settle();
    h.fixture.detectChanges();
    (h.el.querySelector("[data-estate-id]") as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(TestBed.inject(CommunityScopeService).selected()).toEqual({ id: "e1", name: "Los Pinos" });
    expect(h.el.querySelector(".scope-trigger")?.textContent).toContain("Los Pinos");
    expect(navigate).toHaveBeenCalledWith(["/b/estates", "e1"]);
    h.component.toggle();
    h.fixture.detectChanges();
    (h.el.querySelector(".scope-all") as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(TestBed.inject(CommunityScopeService).selected()).toBeNull();
    expect(h.el.querySelector(".scope-trigger")?.textContent).toContain("Todas mis comunidades");
  });

  it("con redirect=false (Vista general) cambia la selección pero NO navega", async () => {
    const h = setupComponent(EstateScopeSelectorComponent, {
      user: makeUser({ role: "B", administratorId: "a1", estateIds: ["e1"] }),
    });
    h.fixture.componentRef.setInput("redirect", false);
    const navigate = vi.spyOn(TestBed.inject(Router), "navigate").mockResolvedValue(true);
    h.fixture.detectChanges();
    h.component.toggle();
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates`).flush([
      { id: "e1", administratorId: "a1", name: "Los Pinos", address: "Calle Jardín", location: "Madrid", type: "Edificio" },
    ]);
    await settle();
    h.fixture.detectChanges();
    (h.el.querySelector("[data-estate-id]") as HTMLButtonElement).click();
    expect(TestBed.inject(CommunityScopeService).selected()).toEqual({ id: "e1", name: "Los Pinos" });
    h.component.toggle();
    h.fixture.detectChanges();
    (h.el.querySelector(".scope-all") as HTMLButtonElement).click();
    expect(TestBed.inject(CommunityScopeService).selected()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });
});
