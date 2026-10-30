import { TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import {
  API,
  setupComponent,
  settle,
} from "../../../core/testing/component-harness";
import { EstateManagementSearchComponent } from "./estate-management-search.component";

describe("EstateManagementSearchComponent", () => {
  afterEach(() => vi.useRealTimers());
  it("debounce, respuesta obsoleta y navegación al deep link real", async () => {
    const h = setupComponent(EstateManagementSearchComponent);
    h.fixture.detectChanges();
    vi.useFakeTimers();
    h.component.onInput("asc");
    vi.advanceTimersByTime(274);
    h.http.expectNone((r) => r.url.includes("management-search"));
    vi.advanceTimersByTime(1);
    const old = h.http.expectOne(`${API}/estates/management-search?q=asc`);
    h.component.onInput("ascensor");
    vi.advanceTimersByTime(275);
    const current = h.http.expectOne(
      `${API}/estates/management-search?q=ascensor`,
    );
    old.flush([
      {
        kind: "community",
        id: "old",
        label: "Vieja",
        estateId: "old",
        estateName: "Vieja",
        address: "",
      },
    ]);
    current.flush([
      {
        kind: "issue",
        id: "i1",
        label: "Ascensor averiado",
        estateId: "e1",
        estateName: "Sol",
        address: "",
        issueId: "i1",
      },
    ]);
    await Promise.resolve();
    await Promise.resolve();
    h.fixture.detectChanges();
    expect(h.el.textContent).not.toContain("Vieja");
    expect(h.el.textContent).toContain("Ascensor averiado");
    const navigate = vi
      .spyOn(TestBed.inject(Router), "navigate")
      .mockResolvedValue(true);
    (h.el.querySelector(".search-results button") as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(["/b/estates", "e1"], {
      queryParams: { tab: "issues", entity: "i1" },
    });
    h.http.verify();
  });
  it("empty/error/retry y Escape", async () => {
    const h = setupComponent(EstateManagementSearchComponent);
    h.fixture.detectChanges();
    h.component.query.set("sol");
    void h.component.load();
    h.http.expectOne(`${API}/estates/management-search?q=sol`).flush([]);
    await settle();
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain("No se encontraron resultados");
    void h.component.load();
    h.http
      .expectOne(`${API}/estates/management-search?q=sol`)
      .flush({}, { status: 500, statusText: "Error" });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector("[role=alert]")).not.toBeNull();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    h.fixture.detectChanges();
    expect(h.el.querySelector(".search-results")).toBeNull();
    h.http.verify();
  });
});
