import { setupComponent } from "../../../core/testing/component-harness";
import { EstateTypeFilterComponent } from "./estate-type-filter.component";

describe("EstateTypeFilterComponent", () => {
  function mount() {
    const h = setupComponent(EstateTypeFilterComponent);
    h.fixture.componentRef.setInput("options", [
      { type: "Edificio" },
      { type: "Garaje" },
      { type: "Local" },
    ]);
    h.component.selectionChange.subscribe((types) =>
      h.fixture.componentRef.setInput("selected", types),
    );
    h.fixture.detectChanges();
    const trigger = h.el.querySelector<HTMLButtonElement>(".dd__trigger")!;
    trigger.click();
    h.fixture.detectChanges();
    const options = () =>
      Array.from(h.el.querySelectorAll<HTMLElement>(".dd__option"));
    return { h, trigger, options };
  }

  it("combines types, keeps the dropdown open and clears the selection", () => {
    const { h, trigger, options } = mount();
    options()[0].click();
    h.fixture.detectChanges();
    options()[1].click();
    h.fixture.detectChanges();
    expect(h.component.selected()).toEqual(["Edificio", "Garaje"]);
    expect(
      options().map((option) => option.getAttribute("aria-selected")),
    ).toEqual(["true", "true", "false"]);
    expect(trigger.textContent?.trim()).toBe("Filtrar (2)");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    (h.el.querySelector(".dd__clear") as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(h.component.selected()).toEqual([]);
    expect(trigger.textContent?.trim()).toBe("Filtrar");
  });

  it("supports arrow keys, Enter to toggle, Escape and outside dismissal", () => {
    const { h, trigger, options } = mount();
    const press = (key: string) => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
      h.fixture.detectChanges();
    };
    press("ArrowDown");
    press("Enter");
    expect(h.component.selected()).toEqual(["Garaje"]);
    expect(options()[1].classList).toContain("dd__option--selected");
    press("Escape");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.click();
    h.fixture.detectChanges();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    h.fixture.detectChanges();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
