import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, makeUser, setupComponent, settle } from '../../../core/testing/component-harness';
import { EstateCommunitySelectorComponent } from './estate-community-selector.component';
import { Estate } from '../../../core/models';

const current: Estate = { id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio', address: 'Calle Jardines', streetNumber: '24', location: 'Madrid', properties: 1, residents: 1, requests: 0, activeIssues: 0, occupancy: 100, reserveTarget: 0 };
function estate(id: string, name: string, overrides: Partial<Estate> = {}): Estate {
  return { id, name, administratorId: 'a1', type: 'Edificio', address: 'Calle Jardines', streetNumber: '24', location: 'Madrid', properties: 1, residents: 1, requests: 0, activeIssues: 0, occupancy: 100, reserveTarget: 0, ...overrides };
}
function setup() {
  const h = setupComponent(EstateCommunitySelectorComponent, { user: makeUser({ role: 'B', administratorId: 'a1', estateIds: ['e1', 'e2', 'e3'] }) });
  h.fixture.componentRef.setInput('estate', current);
  h.fixture.componentRef.setInput('activeTab', 'documents');
  h.fixture.detectChanges();
  return h;
}
async function open(h: ReturnType<typeof setup>, rows: Estate[] = [estate('e1', current.name), estate('e2', 'Residencial Los Pinos', { address: 'Avenida de Europa', streetNumber: '12', location: 'Pozuelo' })]) {
  (h.el.querySelector('.community-selector__trigger') as HTMLButtonElement).click();
  h.fixture.detectChanges();
  h.http.expectOne(`${API}/estates`).flush(rows);
  await settle();
  h.fixture.detectChanges();
}
function search(h: ReturnType<typeof setup>, value: string) {
  const input = h.el.querySelector('input')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  h.fixture.detectChanges();
}

describe('EstateCommunitySelectorComponent', () => {
  it('carga el listado solo al abrir, filtra permisos y marca la comunidad activa', async () => {
    const h = setup();
    expect(h.el.querySelector('.community-selector__menu')).toBeNull();
    h.http.expectNone(`${API}/estates`);
    await open(h, [estate('e1', current.name), estate('e2', 'Otra comunidad'), estate('e4', 'Sin acceso'), estate('e3', 'Otra gestora', { administratorId: 'a2' })]);
    expect(h.el.querySelectorAll('[data-community-id]')).toHaveLength(2);
    expect(h.el.querySelector('[data-community-id="e1"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(h.el.textContent).toContain('Calle Jardines 24, Madrid');
    expect(document.activeElement).toBe(h.el.querySelector('input'));
    h.http.verify();
  });

  it('busca por nombre y dirección y muestra un estado vacío', async () => {
    const h = setup();
    await open(h);
    for (const q of ['PÍNOS', 'europa', 'pozuelo']) {
      search(h, q);
      expect(h.el.querySelectorAll('[data-community-id]')).toHaveLength(1);
      expect(h.el.querySelector('[data-community-id]')?.getAttribute('data-community-id')).toBe('e2');
    }
    search(h, 'inexistente');
    expect(h.el.textContent).toContain('No se encontraron comunidades');
    h.http.verify();
  });

  it('cambia la comunidad conservando Documentos y cierra el desplegable', async () => {
    const h = setup();
    await open(h);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-community-id="e2"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith(['/b/estates', 'e2'], { queryParams: { tab: 'documents' } });
    expect(h.el.querySelector('.community-selector__menu')).toBeNull();
    h.http.verify();
  });

  it('seleccionar la comunidad actual cierra sin navegar y no recarga el listado al reabrir', async () => {
    const h = setup();
    await open(h);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('[data-community-id="e1"]') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(navigate).not.toHaveBeenCalled();
    (h.el.querySelector('.community-selector__trigger') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    h.http.expectNone(`${API}/estates`);
    h.http.verify();
  });

  it('permite navegar con flechas y cerrar con Escape devolviendo el foco', async () => {
    const h = setup();
    await open(h);
    const input = h.el.querySelector('input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect((document.activeElement as HTMLElement).getAttribute('data-community-id')).toBe('e1');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect((document.activeElement as HTMLElement).getAttribute('data-community-id')).toBe('e2');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    h.fixture.detectChanges();
    expect(h.el.querySelector('.community-selector__menu')).toBeNull();
    expect(document.activeElement).toBe(h.el.querySelector('.community-selector__trigger'));
    h.http.verify();
  });

  it('cierra al pulsar fuera y Ver todas las fincas abre el listado de fincas', async () => {
    const h = setup();
    await open(h);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    h.fixture.detectChanges();
    expect(h.el.querySelector('.community-selector__menu')).toBeNull();
    (h.el.querySelector('.community-selector__trigger') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (h.el.querySelector('.community-selector__all') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/b/estates']);
    h.http.verify();
  });

  it('un fallo del listado muestra Reintentar y permite recuperar la búsqueda', async () => {
    const h = setup();
    (h.el.querySelector('.community-selector__trigger') as HTMLButtonElement).click();
    h.fixture.detectChanges();
    h.http.expectOne(`${API}/estates`).flush({}, { status: 500, statusText: 'Error' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar');
    (h.el.querySelector('.community-selector__retry') as HTMLButtonElement).click();
    h.http.expectOne(`${API}/estates`).flush([estate('e1', current.name)]);
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelectorAll('[data-community-id]')).toHaveLength(1);
    h.http.verify();
  });
});
