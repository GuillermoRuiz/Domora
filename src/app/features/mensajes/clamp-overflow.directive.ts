import { Directive, ElementRef, OnDestroy, afterNextRender, inject, input, output } from '@angular/core';

/**
 * Avisa de si el contenido del elemento no cabe en su altura máxima (texto recortado por `line-clamp`).
 * Solo mide mientras `appClampOverflow` es true: al expandir el mensaje el recorte desaparece y
 * no hay nada que medir, así que se conserva el último valor.
 */
@Directive({ selector: '[appClampOverflow]', standalone: true })
export class ClampOverflowDirective implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly appClampOverflow = input(true);
  readonly overflowChange = output<boolean>();
  private observer: ResizeObserver | null = null;
  private last: boolean | null = null;

  constructor() {
    afterNextRender(() => {
      this.measure();
      if (typeof ResizeObserver === 'undefined') return;
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(this.host);
    });
  }

  ngOnDestroy(): void { this.observer?.disconnect(); }

  private measure(): void {
    if (!this.appClampOverflow()) return;
    const overflows = this.host.scrollHeight > this.host.clientHeight + 1;
    if (overflows === this.last) return;
    this.last = overflows;
    this.overflowChange.emit(overflows);
  }
}
