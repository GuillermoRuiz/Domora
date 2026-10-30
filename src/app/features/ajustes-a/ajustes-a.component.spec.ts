import { setupComponent, makeUser } from '../../core/testing/component-harness';
import { AjustesAComponent } from './ajustes-a.component';

describe('AjustesAComponent', () => {
  it('muestra el nombre del super usuario autenticado', () => {
    const { fixture, el } = setupComponent(AjustesAComponent, { user: makeUser({ role: 'A', fullName: 'Nora Admin' }) });
    fixture.detectChanges();

    expect(el.querySelector('.profile-row__name')?.textContent?.trim()).toBe('Nora Admin');
  });
});
