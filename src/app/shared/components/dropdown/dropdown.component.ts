import { Component, DestroyRef, ElementRef, Renderer2, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { IconComponent } from '../icon/icon.component';

export interface DropdownItem {
  id: string | number;
  label: string;
  /** Nombre de un icono de `app-icon`. */
  icon?: string;
  /** Línea de apoyo bajo la etiqueta, solo en la lista (no en el botón). */
  description?: string;
}

let nextId = 0;

/** Medidas (px) con las que se decide hacia qué lado se abre la lista y cuánto puede crecer. */
const PANEL_MAX_HEIGHT = 280;
const PANEL_MIN_HEIGHT = 120;
const PANEL_GAP = 8;
const PANEL_ROW = 36;
const PANEL_PADDING = 16;

/**
 * Desplegable de selección única (o múltiple con `multiple`). Es "controlado": lo que muestra sale
 * siempre de `selectedId` / `selectedIds`; al elegir una opción solo emite `selectionChange` y es el
 * padre quien actualiza la selección. En modo múltiple la lista no se cierra al elegir y cada opción
 * emitida es la que hay que marcar o desmarcar. Patrón ARIA "select-only combobox": el foco se queda en el
 * botón y la opción resaltada se anuncia con `aria-activedescendant`.
 */
@Component({
  selector: 'app-dropdown',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './dropdown.component.html',
  styleUrl: './dropdown.component.scss',
  host: { '[class.dropdown--open]': 'open()' },
})
export class DropdownComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly doc = inject(DOCUMENT);
  private readonly renderer = inject(Renderer2);

  /** Texto cuando no hay ninguna opción seleccionada. */
  readonly label = input('');
  /** Nombre accesible del botón (p. ej. "Comunidad"); si falta, se usa el texto visible. */
  readonly ariaLabel = input('');
  readonly items = input<DropdownItem[]>([]);
  readonly selectedId = input<string | number | null | undefined>(null);
  readonly disabled = input(false);
  /** Resalta el control (p. ej. un filtro aplicado). */
  readonly active = input(false);

  /** Selección múltiple: la lista sigue abierta al elegir y cada opción elegida lleva su check. */
  readonly multiple = input(false);
  readonly selectedIds = input<ReadonlyArray<string | number>>([]);
  /** Texto del botón con selección múltiple (p. ej. "2 etiquetas"); sin él se muestra `label`. */
  readonly summary = input('');
  /** Icono a la izquierda del botón; sin él se usa el de la opción seleccionada. */
  readonly icon = input('');
  /** Texto cuando no hay ninguna opción que mostrar. */
  readonly emptyText = input('');
  /** Si se indica, la lista termina con una acción para vaciar la selección múltiple. */
  readonly clearLabel = input('');
  /** Hacia qué lado se abre la lista respecto al botón. */
  readonly align = input<'start' | 'end'>('start');
  /** Se pinta como el botón principal (borde dorado fino, sin halo) en vez de como un campo. */
  readonly cta = input(false);

  readonly selectionChange = output<DropdownItem>();
  readonly cleared = output<void>();

  readonly open = signal(false);
  /** La lista se abre hacia arriba cuando debajo del botón no cabe (p. ej. al final de un diálogo con scroll). */
  readonly openUp = signal(false);
  readonly panelMaxHeight = signal(PANEL_MAX_HEIGHT);
  readonly activeIndex = signal(-1);

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  readonly uid = `dropdown-${++nextId}`;
  readonly listId = `${this.uid}-list`;

  readonly selectedIndex = computed(() => this.items().findIndex((item) => item.id === this.selectedId()));
  readonly selected = computed<DropdownItem | null>(() => (this.multiple() ? null : (this.items()[this.selectedIndex()] ?? null)));
  readonly triggerText = computed(() => (this.multiple() ? this.summary() || this.label() : (this.selected()?.label ?? this.label())));
  readonly isPlaceholder = computed(() => (this.multiple() ? !this.summary() : !this.selected()));
  readonly triggerIcon = computed(() => this.icon() || this.selected()?.icon || '');
  private readonly selectedIdSet = computed(() => new Set(this.selectedIds()));
  readonly activeOptionId = computed(() => (this.open() && this.activeIndex() >= 0 ? this.optionId(this.activeIndex()) : null));

  private stopOutsideListener: (() => void) | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.removeOutsideListener());
  }

  optionId(index: number): string {
    return `${this.uid}-opt-${index}`;
  }

  toggle(): void {
    if (this.open()) this.close();
    else this.openMenu();
  }

  isSelected(item: DropdownItem, index: number): boolean {
    return this.multiple() ? this.selectedIdSet().has(item.id) : index === this.selectedIndex();
  }

  openMenu(): void {
    if (this.disabled() || this.open() || (this.items().length === 0 && !this.emptyText())) return;
    const first = this.multiple() ? this.items().findIndex((item) => this.selectedIdSet().has(item.id)) : this.selectedIndex();
    this.activeIndex.set(Math.max(first, 0));
    this.placePanel();
    this.open.set(true);
    // Un único listener de documento, solo mientras el menú está abierto.
    this.stopOutsideListener = this.renderer.listen(this.doc, 'pointerdown', (event: Event) => {
      if (!this.host.nativeElement.contains(event.target as Node)) this.close();
    });
    this.scrollActiveIntoView();
  }

  /**
   * Elige el lado con más sitio dentro del contenedor con scroll más cercano (o de la ventana) para que no haya que hacer
   * scroll para ver las opciones, y ajusta la altura máxima a ese hueco.
   */
  private placePanel(): void {
    const trigger = this.trigger().nativeElement;
    const rect = trigger.getBoundingClientRect();
    let top = 0;
    let bottom = this.doc.defaultView?.innerHeight ?? 0;
    for (let el = trigger.parentElement; el; el = el.parentElement) {
      const overflowY = this.doc.defaultView?.getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
        const box = el.getBoundingClientRect();
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
        break;
      }
    }
    const below = bottom - rect.bottom - PANEL_GAP;
    const above = rect.top - top - PANEL_GAP;
    const wanted = Math.min(PANEL_MAX_HEIGHT, this.items().length * PANEL_ROW + PANEL_PADDING);
    const up = below < wanted && above > below;
    this.openUp.set(up);
    this.panelMaxHeight.set(Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, up ? above : below)));
  }

  close(focusTrigger = false): void {
    this.removeOutsideListener();
    this.open.set(false);
    if (focusTrigger) this.trigger().nativeElement.focus();
  }

  choose(item: DropdownItem): void {
    if (this.multiple()) {
      this.selectionChange.emit(item);
      this.trigger().nativeElement.focus();
      return;
    }
    if (item.id !== this.selectedId()) this.selectionChange.emit(item);
    this.close(true);
  }

  clear(): void {
    this.cleared.emit();
    this.trigger().nativeElement.focus();
  }

  onKeydown(event: KeyboardEvent): void {
    const last = this.items().length - 1;
    const isOpen = this.open();

    switch (event.key) {
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = this.items()[this.activeIndex()];
        if (isOpen && item) this.choose(item);
        else this.openMenu();
        break;
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!isOpen) {
          this.openMenu();
          break;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.moveTo(Math.min(Math.max(this.activeIndex() + step, 0), last));
        break;
      }
      case 'Home':
      case 'End':
        if (isOpen) {
          event.preventDefault();
          this.moveTo(event.key === 'Home' ? 0 : last);
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (isOpen && this.multiple() && this.clearLabel() && this.selectedIds().length > 0) {
          event.preventDefault();
          this.clear();
        }
        break;
      case 'Escape':
        if (isOpen) {
          // Solo cierra este menú: que no cierre también el cajón o diálogo que lo contiene.
          event.preventDefault();
          event.stopPropagation();
          this.close(true);
        }
        break;
      case 'Tab':
        // Tab sigue su curso natural; solo se cierra el menú.
        if (isOpen) this.close();
        break;
    }
  }

  /** Escape dentro del contenido propio: cierra solo el menú y devuelve el foco al botón. */
  onExtraEscape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.close(true);
  }

  /** Evita el "click" tardío que algunos navegadores disparan al soltar la barra espaciadora. */
  onKeyup(event: KeyboardEvent): void {
    if (event.key === ' ') event.preventDefault();
  }

  hover(index: number): void {
    if (this.open()) this.activeIndex.set(index);
  }

  private moveTo(index: number): void {
    this.activeIndex.set(index);
    this.scrollActiveIntoView();
  }

  private scrollActiveIntoView(): void {
    const index = this.activeIndex();
    queueMicrotask(() => {
      const option = this.panel().nativeElement.children[index] as HTMLElement | undefined;
      option?.scrollIntoView?.({ block: 'nearest' });
    });
  }

  private removeOutsideListener(): void {
    this.stopOutsideListener?.();
    this.stopOutsideListener = null;
  }
}
