import { Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import type { Estate } from '../../../core/models';
import { CommunityScopeService } from '../../../core/community-scope.service';
import { EstateHeaderComponent } from './estate-header.component';

function makeEstate(overrides: Partial<Estate> = {}): Estate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Residencial Plaza', type: 'Edificio',
    address: 'Calle Gran Vía', streetNumber: '12', location: 'Madrid',
    properties: 0, residents: 0, requests: 0, activeIssues: 0, occupancy: 0,
    reserveTarget: 0, iban: undefined, color: null,
    ...overrides,
  };
}

describe('EstateHeaderComponent', () => {
  function setup(estate: Estate, setupRemaining: number | null = null) {
    TestBed.configureTestingModule({ imports: [EstateHeaderComponent], providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(EstateHeaderComponent);
    fixture.componentRef.setInput('estate', estate);
    fixture.componentRef.setInput('setupRemaining', setupRemaining);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, cmp: fixture.componentInstance };
  }

  it('muestra nombre, dirección y el enlace de vuelta al listado de fincas', () => {
    const { el } = setup(makeEstate());
    expect(el.querySelector('.estate-header__name')?.textContent?.trim()).toBe('Residencial Plaza');
    expect(el.querySelector('.estate-header__address')?.textContent?.trim()).toBe('Calle Gran Vía 12, Madrid');
    expect(el.querySelector('.estate-header__back')?.getAttribute('href')).toBe('/b/estates');
  });

  it('«Volver a todas las fincas» deja sin comunidad elegida para que el listado no redirija a la ficha', () => {
    const { el } = setup(makeEstate());
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const select = vi.spyOn(TestBed.inject(CommunityScopeService), 'select');
    (el.querySelector('.estate-header__back') as HTMLAnchorElement).click();
    expect(select).toHaveBeenCalledWith(null);
  });

  it('sin número ni localidad no deja comas ni huecos sueltos', () => {
    const { el } = setup(makeEstate({ streetNumber: undefined, location: '' }));
    expect(el.querySelector('.estate-header__address')?.textContent?.trim()).toBe('Calle Gran Vía');
  });

  it('pinta la fachada del Catastro y, sin ella, el icono de respaldo', () => {
    const withPhoto = setup(makeEstate({ catastroFacadeUrl: 'https://catastro.test/f.jpg' }));
    expect(withPhoto.el.querySelector('.estate-header__photo img')?.getAttribute('src')).toBe('https://catastro.test/f.jpg');

    TestBed.resetTestingModule();
    const without = setup(makeEstate({ catastroFacadeUrl: null }));
    expect(without.el.querySelector('.estate-header__photo img')).toBeNull();
    expect(without.el.querySelector('.facade-fallback')).not.toBeNull();
  });

  it('estado: sin datos de puesta en marcha no se pinta; con pasos pendientes "En puesta en marcha"; completa "Activa"', () => {
    expect(setup(makeEstate(), null).el.querySelector('app-status-pill')).toBeNull();

    TestBed.resetTestingModule();
    const pending = setup(makeEstate(), 3);
    expect(pending.el.querySelector('app-status-pill')?.textContent).toContain('En puesta en marcha');
    expect(pending.el.querySelector('.pill--warning')).not.toBeNull();

    TestBed.resetTestingModule();
    const done = setup(makeEstate(), 0);
    expect(done.el.querySelector('app-status-pill')?.textContent).toContain('Activa');
    expect(done.el.querySelector('.pill--positive')).not.toBeNull();
  });

  it('las acciones viven en un único botón «Acciones» y ya no hay botones sueltos en la cabecera', () => {
    const { el } = setup(makeEstate(), 3);
    expect(el.querySelectorAll('app-estate-actions-menu')).toHaveLength(1);
    expect(el.querySelector('.estate-header__actions .trigger')?.textContent).toContain('Acciones');
    expect(el.querySelector('.setup-entry-btn')).toBeNull();
    expect(el.querySelectorAll('.estate-header__row > .estate-header__actions button')).toHaveLength(1);
  });

  it('el botón anuncia los pasos de puesta en marcha que faltan', () => {
    const { el } = setup(makeEstate(), 3);
    expect(el.querySelector('.trigger')?.getAttribute('aria-label')).toBe('Acciones, 3 pasos pendientes');
    TestBed.resetTestingModule();
    expect(setup(makeEstate(), 0).el.querySelector('.trigger')?.getAttribute('aria-label')).toBe('Acciones');
  });

  it('cada acción del menú emite su evento', async () => {
    const { fixture, el, cmp } = setup(makeEstate(), 2);
    const calls: string[] = [];
    cmp.edit.subscribe(() => calls.push('edit'));
    cmp.importCatastro.subscribe(() => calls.push('import'));
    cmp.newProperty.subscribe(() => calls.push('new'));
    cmp.openSetup.subscribe(() => calls.push('setup'));

    for (const label of ['Editar finca', 'Importar del Catastro', 'Nueva propiedad', 'Puesta en marcha']) {
      (el.querySelector('.trigger') as HTMLButtonElement).click();
      fixture.detectChanges();
      const item = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
        .find((b) => b.textContent?.includes(label));
      item!.click();
      fixture.detectChanges();
    }

    expect(calls).toEqual(['edit', 'import', 'new', 'setup']);
  });
});
