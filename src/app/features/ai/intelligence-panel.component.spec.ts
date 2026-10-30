import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it, vi } from "vitest";
import { IntelligencePanelComponent } from "./intelligence-panel.component";
import { AiService, type AiIntelligenceView } from "../../core/ai.service";
const complete: AiIntelligenceView = {
  latest: {
    id: "one",
    weekKey: "2026-10-03",
    snapshotAt: "2026-10-03T00:00:00Z",
    completedAt: "2026-10-03T12:00:00Z",
    summary: "Hay una incidencia pendiente.",
    items: [
      {
        signal_id: "s1",
        priority: "high",
        title: "Revisar fuga",
        explanation: "Se registró una fuga.",
        recommended_action: "Consultar al proveedor.",
        entity_type: "issue",
        entity_id: "i1",
        link: "/b/estates/e1?tab=issues&issue=i1",
      },
    ],
  },
  processing: {
    status: "pending",
    weekKey: "2026-10-10",
    snapshotAt: "2026-10-10T00:00:00Z",
  },
};
describe("Intelligence panel runtime", () => {
  it("retains the completed analysis while the next batch processes", async () => {
    await TestBed.configureTestingModule({
      imports: [IntelligencePanelComponent],
      providers: [
        provideRouter([]),
        {
          provide: AiService,
          useValue: { intelligence: vi.fn().mockResolvedValue(complete) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(IntelligencePanelComponent);
    fixture.componentRef.setInput("estateId", "e1");
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      "Hay una incidencia pendiente.",
    );
    expect(fixture.nativeElement.textContent).toContain(
      "Preparando la revisión de esta semana",
    );
    expect(
      fixture.nativeElement.querySelector("a").getAttribute("href"),
    ).toContain("issue=i1");
  });
  it("escapes untrusted model text", async () => {
    const value = structuredClone(complete);
    value.latest!.summary = "<img src=x onerror=alert(1)>";
    await TestBed.configureTestingModule({
      imports: [IntelligencePanelComponent],
      providers: [
        provideRouter([]),
        {
          provide: AiService,
          useValue: { intelligence: vi.fn().mockResolvedValue(value) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(IntelligencePanelComponent);
    fixture.componentRef.setInput("estateId", "e1");
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector("img")).toBeNull();
    expect(fixture.nativeElement.textContent).toContain("<img");
  });
  it("discards a slow result from a previously selected community", async () => {
    let first: (v: AiIntelligenceView) => void = () => {};
    const api = {
      intelligence: vi
        .fn()
        .mockImplementation((id: string) =>
          id === "e1"
            ? new Promise<AiIntelligenceView>((resolve) => (first = resolve))
            : Promise.resolve({ latest: null, processing: null }),
        ),
    };
    await TestBed.configureTestingModule({
      imports: [IntelligencePanelComponent],
      providers: [provideRouter([]), { provide: AiService, useValue: api }],
    }).compileComponents();
    const fixture = TestBed.createComponent(IntelligencePanelComponent);
    fixture.componentRef.setInput("estateId", "e1");
    fixture.detectChanges();
    fixture.componentRef.setInput("estateId", "e2");
    fixture.detectChanges();
    first(complete);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.view()?.latest).toBeNull();
  });
});
