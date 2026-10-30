import { Component, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { setupComponent, settle } from '../../../core/testing/component-harness';
import { PageActionDirective, PageActionRegistry } from './page-action.directive';

@Component({ selector: 'app-action-fixture', imports: [PageActionDirective], template: `
  <button *appPageAction [disabled]="disabled()" (click)="clicks.update(increment)">Crear registro</button>` })
class ActionFixture {
  disabled = signal(false);
  clicks = signal(0);
  increment = (value: number) => value + 1;
}
@Component({ imports: [ActionFixture, NgTemplateOutlet], providers: [PageActionRegistry], template: `
  <header class="actions"><ng-container [ngTemplateOutlet]="registry.action()" /></header>
  @if (visible()) { <app-action-fixture /> }` })
class PageFixture {
  registry = inject(PageActionRegistry);
  visible = signal(true);
}

describe('PageActionDirective', () => {
  it('retains the inline action when the feature has no page outlet', () => {
    const h = setupComponent(ActionFixture); h.fixture.detectChanges();
    h.el.querySelector<HTMLButtonElement>('button')!.click();
    expect(h.component.clicks()).toBe(1);
  });
  it('renders one action in the header with the original handler and disabled state, then removes it on tab exit', async () => {
    const h = setupComponent(PageFixture); h.fixture.detectChanges(); await settle(); h.fixture.detectChanges();
    expect(h.el.querySelectorAll('button')).toHaveLength(1);
    const child = h.fixture.debugElement.children.find(node => node.componentInstance instanceof ActionFixture)!.componentInstance as ActionFixture;
    const action = h.el.querySelector<HTMLButtonElement>('.actions button')!;
    action.click(); expect(child.clicks()).toBe(1);
    child.disabled.set(true); h.fixture.detectChanges();
    expect(action.disabled).toBe(true);
    h.component.visible.set(false); h.fixture.detectChanges();
    expect(h.component.registry.action()).toBeNull();
    h.fixture.detectChanges(); expect(h.el.querySelector('button')).toBeNull();
  });
  it('does not publish an action if its tab is destroyed before registration', async () => {
    const h = setupComponent(PageFixture); h.fixture.detectChanges();
    h.component.visible.set(false); h.fixture.detectChanges(); await settle();
    expect(h.component.registry.action()).toBeNull();
  });
});
