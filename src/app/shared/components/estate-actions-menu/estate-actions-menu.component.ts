import { Component, ElementRef, HostListener, Injector, OnDestroy, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type EstateAction = 'open-setup' | 'edit' | 'office-history' | 'import-catastro' | 'new-property';

interface MenuPosition {
  top: number;
  left: number;
}

const PHONE_QUERY = '(max-width: 640px)';
const PANEL_WIDTH = 264;
const VIEWPORT_GAP = 8;

/**
 * Menú de acciones de una finca (Puesta en marcha, Editar, Importar del Catastro y Nueva propiedad).
 * Lo comparten el listado de fincas (botón «⋯») y la cabecera de la ficha (botón «Acciones»); el padre
 * decide qué hace cada acción. El panel es `position: fixed` para que ni el scroll de la tabla ni el
 * `overflow` de las tarjetas lo recorten; en móvil se muestra como hoja inferior.
 */
@Component({
  selector: 'app-estate-actions-menu',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './estate-actions-menu.component.html',
  styleUrl: './estate-actions-menu.component.scss',
})
export class EstateActionsMenuComponent implements OnDestroy {
  /** `button`: «Acciones» con etiqueta (ficha). `icon`: solo «⋯» (filas y tarjetas del listado). */
  readonly variant = input<'button' | 'icon'>('button');
  readonly estateId = input.required<string>();
  readonly estateName = input<string>('');
  /** Pasos imprescindibles que faltan; `null` mientras no se conoce. */
  readonly setupRemaining = input<number | null>(null);

  readonly openSetup = output<void>();
  readonly edit = output<void>();
  readonly officeHistory = output<void>();
  readonly importCatastro = output<void>();
  readonly newProperty = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  readonly isOpen = signal(false);
  readonly sheet = signal(false);
  readonly position = signal<MenuPosition>({ top: 0, left: 0 });
  private openedWidth = 0;
  private scrollListener: ((event: Event) => void) | null = null;

  readonly pending = computed(() => Math.max(0, this.setupRemaining() ?? 0));
  readonly menuId = computed(() => `estate-actions-menu-${this.estateId()}-${this.variant()}`);
  readonly triggerLabel = computed(() => {
    const base = this.variant() === 'icon' && this.estateName() ? `Acciones de ${this.estateName()}` : 'Acciones';
    return this.pending() > 0 ? `${base}, ${this.pendingText()}` : base;
  });
  readonly setupLabel = computed(() => `Puesta en marcha, ${this.pendingText()}`);
  readonly sheetTitle = computed(() => (this.estateName() ? `Acciones de ${this.estateName()}` : 'Acciones'));

  private pendingText(): string {
    const n = this.pending();
    return n === 1 ? '1 paso pendiente' : `${n} pasos pendientes`;
  }

  toggle(event: Event): void {
    // El clic no debe llegar a un enlace o tarjeta que envuelva al botón.
    event.stopPropagation();
    if (this.isOpen()) this.close(true);
    else this.open();
  }

  onTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      if (!this.isOpen()) this.open(event.key === 'ArrowUp' ? 'last' : 'first');
    }
  }

  open(focus: 'first' | 'last' = 'first'): void {
    const button = this.trigger()?.nativeElement;
    if (!button) return;
    this.sheet.set(window.matchMedia?.(PHONE_QUERY).matches ?? false);
    this.openedWidth = window.innerWidth;
    this.position.set(this.place(button.getBoundingClientRect(), this.estimatedHeight()));
    this.isOpen.set(true);
    this.scrollListener = (event: Event) => {
      if (this.panel()?.nativeElement.contains(event.target as Node)) return;
      this.followTrigger();
    };
    document.addEventListener('scroll', this.scrollListener, true);
    // El panel solo existe tras el siguiente render: entonces se mide, se recoloca y se enfoca.
    afterNextRender(() => {
      this.reposition();
      const items = this.items();
      (focus === 'last' ? items[items.length - 1] : items[0])?.focus();
    }, { injector: this.injector });
  }

  close(restoreFocus = false): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false);
    this.detachScroll();
    if (restoreFocus) this.trigger()?.nativeElement.focus();
  }

  choose(action: EstateAction): void {
    // Se cierra antes de emitir: la acción suele abrir un modal o navegar.
    this.close(true);
    if (action === 'open-setup') this.openSetup.emit();
    else if (action === 'edit') this.edit.emit();
    else if (action === 'office-history') this.officeHistory.emit();
    else if (action === 'import-catastro') this.importCatastro.emit();
    else this.newProperty.emit();
  }

  onPanelKeydown(event: KeyboardEvent): void {
    const items = this.items();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown': next = (current + 1) % items.length; break;
      case 'ArrowUp': next = (current - 1 + items.length) % items.length; break;
      case 'Home': next = 0; break;
      case 'End': next = items.length - 1; break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close(true);
        return;
      case 'Tab':
        this.close();
        return;
      default: return;
    }
    event.preventDefault();
    items[next]?.focus();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (this.isOpen() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  @HostListener('window:resize')
  onResize(): void {
    // El teclado virtual de móvil solo cambia el alto: no debe cerrar la hoja.
    if (this.isOpen() && window.innerWidth !== this.openedWidth) this.close();
  }

  ngOnDestroy(): void {
    this.detachScroll();
  }

  private detachScroll(): void {
    if (!this.scrollListener) return;
    document.removeEventListener('scroll', this.scrollListener, true);
    this.scrollListener = null;
  }

  private items(): HTMLButtonElement[] {
    return Array.from(this.panel()?.nativeElement.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  }

  private estimatedHeight(): number {
    return (this.pending() > 0 ? 5 : 3) * 44 + 12;
  }

  /** Debajo y alineado a la derecha del botón; si no cabe, hacia arriba y sin salirse por los lados. */
  private place(rect: DOMRect, height: number): MenuPosition {
    const below = rect.bottom + 4;
    const top = below + height > window.innerHeight - VIEWPORT_GAP
      ? Math.max(VIEWPORT_GAP, rect.top - 4 - height)
      : below;
    const left = Math.min(Math.max(VIEWPORT_GAP, rect.right - PANEL_WIDTH), window.innerWidth - PANEL_WIDTH - VIEWPORT_GAP);
    return { top, left: Math.max(VIEWPORT_GAP, left) };
  }

  /**
   * Un scroll (de la página o de la tabla que contiene el botón, incluido el que provoca el propio foco) mueve
   * el botón: el panel lo sigue mientras el botón siga a la vista y, si sale de ella, se cierra.
   */
  private followTrigger(): void {
    const button = this.trigger()?.nativeElement;
    if (!button || this.sheet()) return;
    const rect = button.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    if (visible) this.reposition();
    else this.close();
  }

  /** Con el panel ya pintado se coloca con su altura real. */
  private reposition(): void {
    const panel = this.panel()?.nativeElement;
    const button = this.trigger()?.nativeElement;
    if (!panel || !button || this.sheet()) return;
    this.position.set(this.place(button.getBoundingClientRect(), panel.offsetHeight));
  }
}
