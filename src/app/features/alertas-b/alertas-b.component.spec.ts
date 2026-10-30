import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, settle } from '../../core/testing/component-harness';
import { StateService } from '../../core/state.service';
import { AlertasBComponent } from './alertas-b.component';
import type { AlertItem } from '../../core/models';

function makeAlert(overrides: Partial<AlertItem> = {}): AlertItem {
  return {
    id: 'issue:i1', sourceType: 'issue', sourceId: 'i1', userId: 'u1', type: 'incidencia',
    title: 'Fuga de agua', description: 'Portal', date: '2026-01-01', urgent: false, read: false, estateId: 'e1',
    ...overrides,
  };
}

async function flushLoad(http: any, alerts: AlertItem[]): Promise<void> {
  http.expectOne((r: any) => r.url === `${API}/alerts`).flush(alerts);
  await settle();
}

describe('AlertasBComponent', () => {
  it('carga las alertas al montar y refleja el contador de no leídas', async () => {
    const { fixture, http, el } = setupComponent(AlertasBComponent);
    fixture.detectChanges();
    await flushLoad(http, [makeAlert({ id: 'a1', read: false }), makeAlert({ id: 'a2', read: true })]);
    fixture.detectChanges();

    expect(el.querySelectorAll('.alert-row')).toHaveLength(2);
    expect(el.textContent).toContain('1 notificación');
  });

  describe('filtros', () => {
    it('"Sin leer" solo muestra las no leídas', async () => {
      const { fixture, http, el } = setupComponent(AlertasBComponent);
      fixture.detectChanges();
      await flushLoad(http, [makeAlert({ id: 'a1', read: false }), makeAlert({ id: 'a2', read: true })]);
      fixture.detectChanges();

      (Array.from(el.querySelectorAll('.pill')).find((b) => b.textContent?.includes('Sin leer')) as HTMLElement).click();
      fixture.detectChanges();

      expect(el.querySelectorAll('.alert-row')).toHaveLength(1);
    });

    it('"Comunidad" agrupa comunidad + junta + documento', async () => {
      const { fixture, http, el } = setupComponent(AlertasBComponent);
      fixture.detectChanges();
      await flushLoad(http, [
        makeAlert({ id: 'a1', type: 'comunidad' }),
        makeAlert({ id: 'a2', type: 'junta' }),
        makeAlert({ id: 'a3', type: 'documento' }),
        makeAlert({ id: 'a4', type: 'pago' }),
      ]);
      fixture.detectChanges();

      (Array.from(el.querySelectorAll('.pill')).find((b) => b.textContent?.trim() === 'Comunidad') as HTMLElement).click();
      fixture.detectChanges();

      expect(el.querySelectorAll('.alert-row')).toHaveLength(3);
    });
  });

  it('al expandir una alerta no leída, la marca como leída de forma optimista y persiste el cambio', async () => {
    const { fixture, http, el } = setupComponent(AlertasBComponent);
    fixture.detectChanges();
    await flushLoad(http, [makeAlert({ id: 'a1', sourceType: 'issue', sourceId: 'i1', read: false })]);
    fixture.detectChanges();

    (el.querySelector('.alert-row') as HTMLElement).click();
    fixture.detectChanges();

    expect(el.querySelector('.alert-row')?.className).not.toContain('alert-row--unread');
    const req = http.expectOne((r: any) => r.url === `${API}/resource-reads` && r.method === 'POST');
    expect(req.request.body).toEqual({ sourceType: 'issue', sourceId: 'i1' });
    req.flush(null);
    await settle();

    expect(TestBed.inject(StateService).notificationsVersion()).toBe(1);
  });

  describe('goToSource', () => {
    it('sin estateId, no muestra ningún CTA para ir al origen', async () => {
      const { fixture, http, el } = setupComponent(AlertasBComponent);
      fixture.detectChanges();
      await flushLoad(http, [makeAlert({ id: 'a1', type: 'incidencia', estateId: null, read: true })]);
      fixture.detectChanges();

      (el.querySelector('.alert-row') as HTMLElement).click();
      fixture.detectChanges();

      expect(el.querySelector('.alert-row__detail')).toBeNull();
    });

    it('una alerta de pago navega a Contabilidad > recibos', async () => {
      const { fixture, http, el } = setupComponent(AlertasBComponent);
      fixture.detectChanges();
      await flushLoad(http, [makeAlert({ id: 'a1', type: 'pago', estateId: 'e9', read: true })]);
      fixture.detectChanges();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      (el.querySelector('.alert-row') as HTMLElement).click();
      fixture.detectChanges();
      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Ver recibos')) as HTMLElement).click();

      expect(navigateSpy).toHaveBeenCalledWith(['/b/accounting', 'e9'], { queryParams: { tab: 'receipts' } });
    });

    it('una alerta de presupuesto navega a Contabilidad > presupuesto', async () => {
      const { fixture, http, el } = setupComponent(AlertasBComponent);
      fixture.detectChanges();
      await flushLoad(http, [makeAlert({ id: 'a1', type: 'presupuesto', sourceType: 'budget_item', estateId: 'e9', read: true })]);
      fixture.detectChanges();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      (el.querySelector('.alert-row') as HTMLElement).click();
      fixture.detectChanges();
      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Ver presupuesto')) as HTMLElement).click();

      expect(navigateSpy).toHaveBeenCalledWith(['/b/accounting', 'e9'], { queryParams: { tab: 'budget' } });
    });

    it('una alerta de comunidad navega a la pestaña de comunicados de la finca', async () => {
      const { fixture, http, el } = setupComponent(AlertasBComponent);
      fixture.detectChanges();
      await flushLoad(http, [makeAlert({ id: 'a1', type: 'comunidad', estateId: 'e9', read: true })]);
      fixture.detectChanges();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      (el.querySelector('.alert-row') as HTMLElement).click();
      fixture.detectChanges();
      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Ver comunicado')) as HTMLElement).click();

      expect(navigateSpy).toHaveBeenCalledWith(['/b/estates', 'e9'], { queryParams: { tab: 'communications' } });
    });
  });

  it('"Marcar todas como leídas" recarga la lista y avisa por toast', async () => {
    const { fixture, http, el } = setupComponent(AlertasBComponent);
    fixture.detectChanges();
    await flushLoad(http, [makeAlert({ id: 'a1', read: false })]);
    fixture.detectChanges();

    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Marcar todas como leídas')) as HTMLElement).click();

    http.expectOne((r: any) => r.url === `${API}/alerts/read-all` && r.method === 'POST').flush(null);
    await settle();
    http.expectOne((r: any) => r.url === `${API}/alerts`).flush([makeAlert({ id: 'a1', read: true })]);
    await settle();
    fixture.detectChanges();

    expect(el.querySelector('.toast')?.textContent).toContain('Todas las alertas marcadas como leídas');
  });
});
