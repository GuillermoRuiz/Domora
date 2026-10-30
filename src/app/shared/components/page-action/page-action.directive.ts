import { DestroyRef, Directive, Injectable, TemplateRef, ViewContainerRef, inject, signal } from '@angular/core';

/** One registry per detail page, so changing a tab cannot affect another page. */
@Injectable()
export class PageActionRegistry {
  readonly action = signal<TemplateRef<unknown> | null>(null);
}

/** Keeps the action's bindings in its feature, while the page owns its position. */
@Directive({ selector: '[appPageAction]', standalone: true })
export class PageActionDirective {
  constructor() {
    const template = inject<TemplateRef<unknown>>(TemplateRef);
    const registry = inject(PageActionRegistry, { optional: true });
    const container = inject(ViewContainerRef);
    if (!registry) {
      container.createEmbeddedView(template);
      return;
    }
    let destroyed = false;
    // Register after the current check; the parent outlet may already be checked.
    queueMicrotask(() => { if (!destroyed) registry.action.set(template); });
    inject(DestroyRef).onDestroy(() => {
      destroyed = true;
      if (registry.action() === template) registry.action.set(null);
    });
  }
}
