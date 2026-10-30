import { AfterViewInit, Directive, ElementRef, HostListener, OnDestroy, inject, output } from '@angular/core';

const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';

/**
 * Comportamiento común de los diálogos de contratos (formularios, detalle, histórico): al abrirse lleva
 * el foco dentro, Escape los cierra estén donde estén los foco, y al cerrarse devuelve el foco a quien
 * lo tenía (normalmente el botón que lo abrió).
 */
@Directive({ selector: '[appContractDialog]', standalone: true })
export class ContractDialogDirective implements AfterViewInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly previous = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  /** Se pidió cerrar (Escape). */
  readonly dismiss = output<void>();

  ngAfterViewInit(): void {
    // Un microtask: los controles de los formularios (selects, inputs con ngModel) existen ya, pero no se pierde el foco al pintarse.
    queueMicrotask(() => {
      const target = this.host.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? this.host).focus();
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    event.stopPropagation();
    this.dismiss.emit();
  }

  ngOnDestroy(): void {
    // Si el elemento que lo abrió sigue en pantalla, recupera el foco.
    if (this.previous && document.contains(this.previous)) queueMicrotask(() => this.previous?.focus());
  }
}
