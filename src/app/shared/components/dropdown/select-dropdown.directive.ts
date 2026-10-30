import {
  ApplicationRef, ComponentRef, Directive, ElementRef, EnvironmentInjector, OnDestroy, Renderer2, computed, createComponent, inject, signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { SelectPanelComponent, SelectPanelItem } from './select-panel.component';

let nextId = 0;

/**
 * Cambia el popup nativo de cualquier `<select>` por la lista de Domora (la de Tareas), sin tocar
 * el formulario: el `<select>` sigue siendo la fuente de verdad —`ngModel`, `[value]`, `(change)`,
 * `disabled`, `<option [ngValue]>`— y al elegir se le asigna la opción y se dispara `input`/`change`
 * como haría el navegador. Cada componente que use `<select>` debe importar esta directiva
 * (lo comprueba `scripts/check-select-dropdown.test.mjs`). No aplica a `<select multiple>` ni con `size`.
 */
@Directive({
  selector: 'select:not([multiple]):not([size])',
  standalone: true,
  host: {
    class: 'dd-select',
    '[class.dd-select--open]': 'open()',
    '[attr.aria-expanded]': 'open()',
    '[attr.aria-controls]': 'open() ? listId : null',
    '[attr.aria-activedescendant]': 'activeOptionId()',
    '(mousedown)': 'onMouseDown($event)',
    '(touchstart)': 'onTouchStart($event)',
    '(touchend)': 'onTouchEnd($event)',
    '(keydown)': 'onKeydown($event)',
  },
})
export class SelectDropdownDirective implements OnDestroy {
  private readonly select = inject<ElementRef<HTMLSelectElement>>(ElementRef).nativeElement;
  private readonly doc = inject(DOCUMENT);
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(EnvironmentInjector);
  private readonly renderer = inject(Renderer2);

  readonly listId = `dd-select-${++nextId}-list`;
  private readonly panelRef = signal<ComponentRef<SelectPanelComponent> | null>(null);
  readonly open = computed(() => this.panelRef() !== null);
  /** Opción resaltada (teclado o ratón) para `aria-activedescendant`: el foco se queda en el <select>. */
  readonly activeOptionId = computed(() => {
    const panel = this.panelRef()?.instance;
    const position = panel?.activeIndex() ?? -1;
    return panel && position >= 0 ? panel.optionId(position) : null;
  });

  private stopListeners: Array<() => void> = [];
  private typeahead = '';
  private typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
  private touchStart: { x: number; y: number } | null = null;
  /** Abierta con el dedo: no se enfoca el <select>, porque en iOS enfocarlo durante el gesto abre el selector nativo. */
  private openedByTouch = false;
  private repositionFrame = 0;

  private get panel(): SelectPanelComponent | null {
    return this.panelRef()?.instance ?? null;
  }

  ngOnDestroy(): void {
    clearTimeout(this.typeaheadTimer);
    this.close();
  }

  onMouseDown(event: MouseEvent): void {
    if (event.button !== 0 || this.select.disabled) return;
    // Evita el popup nativo y deja el foco en el campo.
    event.preventDefault();
    this.select.focus();
    if (this.open()) this.close();
    else this.openPanel();
  }

  onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    this.touchStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  /**
   * En móvil el selector nativo se abre con el toque (iOS/Android), no con el mousedown: se cancela el
   * final del toque —y con él el mousedown/click sintéticos— y se abre la lista de Domora. Si el dedo
   * se ha desplazado es un scroll de la página y se deja pasar.
   */
  onTouchEnd(event: TouchEvent): void {
    const start = this.touchStart;
    const touch = event.changedTouches[0];
    this.touchStart = null;
    if (this.select.disabled || !start || !touch) return;
    if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) return;
    event.preventDefault();
    if (this.open()) {
      this.close();
    } else {
      this.openedByTouch = true;
      this.openPanel();
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.select.disabled || event.ctrlKey || event.metaKey) return;

    if (!this.open()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'F4'].includes(event.key)) {
        event.preventDefault();
        this.openPanel();
      }
      return;
    }

    switch (event.key) {
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const panel = this.panel;
        const active = panel?.items()[panel.activeIndex()];
        if (active && !active.group && !active.disabled) this.choose(active.index);
        else this.close();
        break;
      }
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        this.move(event.key === 'ArrowDown' ? 1 : -1);
        break;
      case 'Home':
      case 'End':
        event.preventDefault();
        this.moveTo(event.key === 'Home' ? 1 : -1, event.key === 'Home' ? -1 : this.items().length);
        break;
      case 'Escape':
        // Solo cierra la lista: que no cierre también el modal o el cajón que la contiene.
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;
      case 'Tab':
        this.close();
        break;
      default:
        if (event.key.length === 1 && !event.altKey) this.search(event.key);
    }
  }

  private openPanel(): void {
    if (this.open()) return;
    const items = this.items();
    if (items.every((item) => item.group)) return;

    const panel = createComponent(SelectPanelComponent, { environmentInjector: this.injector });
    panel.setInput('listId', this.listId);
    panel.setInput('ariaLabel', this.select.getAttribute('aria-label') ?? this.labelText());
    panel.setInput('items', items);
    panel.setInput('anchor', this.select);
    panel.instance.chosen.subscribe((index) => this.choose(index));
    const selectedPosition = items.findIndex((item) => item.selected && !item.disabled);
    panel.instance.activeIndex.set(selectedPosition >= 0 ? selectedPosition : this.step(items, -1, 1));

    this.appRef.attachView(panel.hostView);
    this.doc.body.appendChild(panel.location.nativeElement);
    panel.changeDetectorRef.detectChanges();
    panel.instance.reposition();
    panel.instance.scrollActiveIntoView();

    this.panelRef.set(panel);

    const panelEl: HTMLElement = panel.location.nativeElement;
    // Como mucho una medición por frame; el scroll de la propia lista no mueve el campo.
    const reposition = (event?: Event) => {
      // El destino puede ser `window` (resize, scroll del documento), que no es un Node.
      if (this.repositionFrame || (event?.target instanceof Node && panelEl.contains(event.target))) return;
      this.repositionFrame = requestAnimationFrame(() => {
        this.repositionFrame = 0;
        this.panel?.reposition();
      });
    };
    this.stopListeners = [
      // Clic fuera: ni en la lista ni en el propio campo.
      this.renderer.listen(this.doc, 'pointerdown', (event: Event) => {
        const target = event.target as Node;
        if (!this.select.contains(target) && !panelEl.contains(target)) this.close();
      }),
      this.renderer.listen('window', 'resize', reposition),
      this.renderer.listen('window', 'scroll', reposition, { capture: true, passive: true }),
      this.renderer.listen(this.select, 'blur', () => this.close()),
    ];
  }

  private close(): void {
    this.touchStart = null;
    const panel = this.panelRef();
    if (!panel) return;
    cancelAnimationFrame(this.repositionFrame);
    this.repositionFrame = 0;
    this.stopListeners.forEach((stop) => stop());
    this.stopListeners = [];
    this.appRef.detachView(panel.hostView);
    panel.destroy();
    this.panelRef.set(null);
    this.openedByTouch = false;
  }

  private choose(index: number): void {
    const changed = this.select.selectedIndex !== index;
    const byTouch = this.openedByTouch;
    this.close();
    if (!byTouch) this.select.focus();
    if (!changed) return;
    this.select.selectedIndex = index;
    this.select.dispatchEvent(new Event('input', { bubbles: true }));
    this.select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private items(): SelectPanelItem[] {
    const items: SelectPanelItem[] = [];
    const addOption = (option: HTMLOptionElement, groupDisabled: boolean) => {
      if (option.hidden) return;
      items.push({
        index: option.index,
        label: (option.label || option.text).trim(),
        disabled: option.disabled || groupDisabled,
        selected: option.index === this.select.selectedIndex,
        group: false,
      });
    };
    for (const child of Array.from(this.select.children)) {
      if (child instanceof HTMLOptGroupElement) {
        items.push({ index: -1, label: child.label, disabled: child.disabled, selected: false, group: true });
        for (const option of Array.from(child.children)) if (option instanceof HTMLOptionElement) addOption(option, child.disabled);
      } else if (child instanceof HTMLOptionElement) {
        addOption(child, false);
      }
    }
    return items;
  }

  /** Posición de la siguiente fila seleccionable a partir de `from` en la dirección `direction`; -1 si no hay. */
  private step(items: SelectPanelItem[], from: number, direction: 1 | -1): number {
    for (let i = from + direction; i >= 0 && i < items.length; i += direction) {
      if (!items[i].group && !items[i].disabled) return i;
    }
    return -1;
  }

  private move(direction: 1 | -1): void {
    const panel = this.panel;
    if (!panel) return;
    const next = this.step(panel.items(), panel.activeIndex(), direction);
    if (next >= 0) this.activate(next);
  }

  /** Home/End: primera o última fila seleccionable. */
  private moveTo(direction: 1 | -1, from: number): void {
    const next = this.step(this.panel?.items() ?? [], from, direction);
    if (next >= 0) this.activate(next);
  }

  private activate(position: number): void {
    this.panel?.activeIndex.set(position);
    this.panel?.scrollActiveIntoView();
  }

  /** Búsqueda por letras: "ba" salta a la primera opción que empieza por "ba". */
  private search(char: string): void {
    const items = this.panel?.items();
    if (!items) return;
    clearTimeout(this.typeaheadTimer);
    this.typeahead += char.toLowerCase();
    this.typeaheadTimer = setTimeout(() => (this.typeahead = ''), 700);
    const start = this.panel?.activeIndex() ?? -1;
    const sameChar = [...this.typeahead].every((c) => c === this.typeahead[0]);
    const needle = sameChar ? this.typeahead[0] : this.typeahead;
    const order = [...items.keys()].map((_, n) => (start + (sameChar ? 1 : 0) + n + items.length) % items.length);
    const hit = order.find((i) => !items[i].group && !items[i].disabled && items[i].label.toLowerCase().startsWith(needle));
    if (hit !== undefined) this.activate(hit);
  }

  /** Texto del <label> del campo sin las opciones, que también cuelgan del label cuando lo envuelve. */
  private labelText(): string {
    const label = this.select.labels?.[0]?.cloneNode(true) as HTMLElement | undefined;
    label?.querySelectorAll('select').forEach((el) => el.remove());
    return (label?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }
}
