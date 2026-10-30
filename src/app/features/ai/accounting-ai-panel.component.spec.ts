import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it, vi } from "vitest";
import { AccountingAiPanelComponent } from "./accounting-ai-panel.component";
import { AiService } from "../../core/ai.service";
import { SuppliersStaffService } from "../../core/suppliers-staff.service";
describe("Accounting AI UI records", () => {
  it("renders actual response counts and keeps pagination independent of estate changes", async () => {
    const reconciliation = vi
      .fn()
      .mockResolvedValue({
        counts: {
          bankMovements: 38,
          automaticallyReconciled: 34,
          manuallyReconciled: 0,
          suggested: 2,
          unmatched: 2,
        },
        data: [],
        page: 1,
        pageSize: 30,
        total: 60,
      });
    await TestBed.configureTestingModule({
      imports: [AccountingAiPanelComponent],
      providers: [
        provideRouter([]),
        {
          provide: AiService,
          useValue: {
            reconciliation,
            documents: vi
              .fn()
              .mockResolvedValue({ data: [], page: 1, pageSize: 30, total: 0 }),
          },
        },
        {
          provide: SuppliersStaffService,
          useValue: { listSuppliers: vi.fn().mockResolvedValue([]) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AccountingAiPanelComponent);
    fixture.componentRef.setInput("estateId", "e1");
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(fixture.componentInstance.view()).not.toBeNull(),
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("38");
    expect(fixture.nativeElement.textContent).toContain("34");
    fixture.componentInstance.changePage(1);
    await vi.waitFor(() =>
      expect(reconciliation).toHaveBeenLastCalledWith("e1", 2),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance.page()).toBe(2);
    expect(reconciliation).toHaveBeenLastCalledWith("e1", 2);
  });
});
