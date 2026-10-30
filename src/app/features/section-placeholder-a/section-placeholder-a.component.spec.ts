import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { setupComponent, makeUser } from '../../core/testing/component-harness';
import { SectionPlaceholderAComponent } from './section-placeholder-a.component';

describe('SectionPlaceholderAComponent', () => {
  function setup(data: Record<string, string>) {
    const harness = setupComponent(SectionPlaceholderAComponent, {
      user: makeUser({ role: 'A' }),
      providers: [{ provide: ActivatedRoute, useValue: { snapshot: { data }, data: of(data) } }],
    });
    harness.fixture.detectChanges();
    return harness;
  }

  it('muestra el título y la descripción de la sección y avisa de que está en preparación', () => {
    const { el, http } = setup({ title: 'Clientes', description: 'Gestión comercial de los despachos.', icon: 'user' });
    expect(el.querySelector('.page-intro__title')?.textContent?.trim()).toBe('Clientes');
    expect(el.querySelector('.page-intro__subtitle')?.textContent?.trim()).toBe('Gestión comercial de los despachos.');
    expect(el.querySelector('.empty-state__title')?.textContent?.trim()).toBe('Sección en preparación');
    http.expectNone(() => true);
  });
});
