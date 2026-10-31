import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, settle } from '../../core/testing/component-harness';
import { ActivityCComponent } from './activity-c.component';
import type { ActivityItem } from '../../core/models';

function makeActivity(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return { id: 'act1', type: 'incidencia', title: 'Fuga de agua', description: 'Portal', date: '2026-01-01', propertyId: 'p1', ...overrides };
}

describe('ActivityCComponent', () => {
  it('muestra "Cargando actividad…" mientras la petición está en vuelo', () => {
    const { fixture, http, el } = setupComponent(ActivityCComponent);
    fixture.detectChanges();

    expect(el.textContent).toContain('Cargando actividad');
    http.expectOne((r: any) => r.url === `${API}/activity`).flush([]);
  });

  it('sin actividad, muestra el estado vacío', async () => {
    const { fixture, http, el } = setupComponent(ActivityCComponent);
    fixture.detectChanges();
    http.expectOne((r: any) => r.url === `${API}/activity`).flush([]);
    await settle();
    fixture.detectChanges();

    expect(el.textContent).toContain('No hay actividad reciente');
  });

  it('pinta la lista de actividad reciente', async () => {
    const { fixture, http, el } = setupComponent(ActivityCComponent);
    fixture.detectChanges();
    http.expectOne((r: any) => r.url === `${API}/activity`).flush([
      makeActivity({ id: 'a1', title: 'Fuga de agua' }),
      makeActivity({ id: 'a2', title: 'Recibo cobrado', type: 'recibo' }),
    ]);
    await settle();
    fixture.detectChanges();

    expect(el.querySelectorAll('.activity-item')).toHaveLength(2);
    expect(el.textContent).toContain('Fuga de agua');
    expect(el.textContent).toContain('Recibo cobrado');
  });

  it('una incidencia siempre se abre (es de la comunidad); un comunicado no navega', async () => {
    const { fixture, http, el } = setupComponent(ActivityCComponent);
    fixture.detectChanges();
    http.expectOne((r: any) => r.url === `${API}/activity`).flush([
      makeActivity({ id: 'issue:abc', type: 'incidencia', propertyId: '' }),
      makeActivity({ id: 'a2', type: 'comunicado', propertyId: '' }),
      makeActivity({ id: 'receipt:r1', type: 'recibo', propertyId: 'p1' }),
    ]);
    await settle();
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    const items = el.querySelectorAll('.activity-item');
    (items[1] as HTMLElement).click();
    expect(navigateSpy).not.toHaveBeenCalled();

    (items[0] as HTMLElement).click();
    expect(navigateSpy).toHaveBeenLastCalledWith(['/c/incidencias'], { queryParams: { issue: 'abc' } });

    (items[2] as HTMLElement).click();
    expect(navigateSpy).toHaveBeenLastCalledWith(['/c/recibos'], { queryParams: { propertyId: 'p1' } });
  });

  it('un documento abre la página de Documentación con ese documento (o sin selección si no hay id)', async () => {
    const { fixture, http, el } = setupComponent(ActivityCComponent);
    fixture.detectChanges();
    http.expectOne((r: any) => r.url === `${API}/activity`).flush([
      makeActivity({ id: 'document:d1', type: 'documento', propertyId: null as never }),
      makeActivity({ id: 'a9', type: 'documento', propertyId: null as never }),
    ]);
    await settle();
    fixture.detectChanges();
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const items = el.querySelectorAll('.activity-item');
    expect(items[0].className).toContain('activity-item--clickable');
    (items[0] as HTMLElement).click();
    expect(navigateSpy).toHaveBeenLastCalledWith(['/c/documentacion'], { queryParams: { doc: 'd1' } });

    (items[1] as HTMLElement).click();
    expect(navigateSpy).toHaveBeenLastCalledWith(['/c/documentacion'], { queryParams: {} });
  });
});
