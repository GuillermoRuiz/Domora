import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy, inject } from '@angular/core';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Gestión de foco de los diálogos y paneles modales de Tareas:
 *  - al abrirse, el foco entra en el diálogo (en `[data-autofocus]` si lo hay);
 *  - el tabulador se queda DENTRO (Tab en el último control vuelve al primero);
 *  - al cerrarse, el foco regresa al elemento que lo abrió.
 *
 * Sin esto, un diálogo `aria-modal` deja que el teclado siga recorriendo la
 * página que queda detrás, que ni se ve ni debería poder usarse.
 */
@Directive({ selector: '[appFocusTrap]', standalone: true })
export class FocusTrapDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private opener: HTMLElement | null = null;

  ngAfterViewInit(): void {
    const active = document.activeElement;
    this.opener = active instanceof HTMLElement && active !== document.body ? active : null;
    const root = this.host.nativeElement;
    const target = root.querySelector<HTMLElement>('[data-autofocus]') ?? this.focusables()[0] ?? root;
    if (target === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1');
    target.focus();
  }

  ngOnDestroy(): void {
    // Si el elemento que abrió el diálogo ya no existe (p. ej. se recreó), no se roba el foco a otro sitio.
    if (this.opener && this.opener.isConnected) this.opener.focus();
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items = this.focusables();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && this.host.nativeElement.contains(active);
    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusables(): HTMLElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.getAttribute('aria-hidden') !== 'true' && !el.closest('[inert]'),
    );
  }
}
