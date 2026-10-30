import { afterRenderEffect, AfterViewInit, Directive, ElementRef, inject, input, OnDestroy } from '@angular/core';

/** Moves one shared chip background without changing estate navigation. */
@Directive({ selector: '[appEstateChipTabs]', standalone: true })
export class EstateChipTabsDirective implements AfterViewInit, OnDestroy {
  readonly selected = input.required<string>({ alias: 'appEstateChipTabs' });
  /** How to find the active item: section links use aria-current; a tablist uses aria-selected. */
  readonly activeSelector = input('[aria-current="page"]', { alias: 'chipActiveSelector' });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private resizeObserver?: ResizeObserver;

  constructor() {
    afterRenderEffect({
      earlyRead: () => {
        this.selected();
        return this.measure();
      },
      write: bounds => {
        this.position(bounds());
        // A section change replaces its buttons; keep observing their new sizes.
        this.host.querySelectorAll('button').forEach(button => this.resizeObserver?.observe(button));
      },
    });
  }

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.position(this.measure()));
    this.resizeObserver.observe(this.host);
    this.host.querySelectorAll('button').forEach(button => this.resizeObserver!.observe(button));
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  private measure() {
    const active = this.host.querySelector<HTMLElement>(this.activeSelector());
    if (!active?.offsetWidth) return null;
    return { x: active.offsetLeft, y: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight };
  }

  private position(bounds: ReturnType<EstateChipTabsDirective['measure']>): void {
    this.host.classList.toggle('estate-subnav--ready', bounds !== null);
    if (!bounds) return;
    this.host.style.setProperty('--chip-x', `${bounds.x}px`);
    this.host.style.setProperty('--chip-y', `${bounds.y}px`);
    this.host.style.setProperty('--chip-width', `${bounds.width}px`);
    this.host.style.setProperty('--chip-height', `${bounds.height}px`);
  }
}
