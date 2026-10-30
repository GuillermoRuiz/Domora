import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, settle } from '../../core/testing/component-harness';
import { AlertasCComponent } from './alertas-c.component';
import type { AlertItem } from '../../core/models';

function makeAlert(overrides: Partial<AlertItem> = {}): AlertItem {
  return {
    id: 'receipt:r1', sourceType: 'receipt', sourceId: 'r1', userId: 'u1', type: 'pago',
    title: 'Cuota de marzo', description: 'Pendiente', date: '2026-01-01', urgent: true, read: false, propertyId: 'p1',
    ...overrides,
  };
}

async function flushLoad(http: any, alerts: AlertItem[]): Promise<void> {
  http.expectOne((r: any) => r.url === `${API}/alerts`).flush(alerts);
  await settle();
}

describe('AlertasCComponent', () => {
  it('carga las alertas al montar y refleja el contador de no leídas', async () => {
    const { fixture, http, el } = setupComponent(AlertasCComponent);
    fixture.detectChanges();
    await flushLoad(http, [makeAlert({ id: 'a1', read: false }), makeAlert({ id: 'a2', read: true })]);
    fixture.detectChanges();

    expect(el.querySelectorAll('.alert-row')).toHaveLength(2);
    expect(el.textContent).toContain('1 notificación');
  });

  it('un pago urgente navega a "recibos" de la propiedad al pulsar "Ver recibos"', async () => {
    const { fixture, http, el } = setupComponent(AlertasCComponent);
    fixture.detectChanges();
    await flushLoad(http, [makeAlert({ id: 'a1', type: 'pago', urgent: true, propertyId: 'p1', read: true })]);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    (el.querySelector('.alert-row') as HTMLElement).click();
    fixture.detectChanges();
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Ver recibos')) as HTMLElement).click();

    expect(navigateSpy).toHaveBeenCalledWith(['/c/properties', 'p1'], { queryParams: { tab: 'receipts' } });
  });

  it('una incidencia se abre en el módulo de incidencias (no en una propiedad) al pulsar "Ver solicitud"', async () => {
    const { fixture, http, el } = setupComponent(AlertasCComponent);
    fixture.detectChanges();
    await flushLoad(http, [makeAlert({ id: 'a1', type: 'incidencia', sourceType: 'issue', sourceId: 'i1', propertyId: undefined, read: true })]);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    (el.querySelector('.alert-row') as HTMLElement).click();
    fixture.detectChanges();
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Ver solicitud')) as HTMLElement).click();

    expect(navigateSpy).toHaveBeenCalledWith(['/c/incidencias'], { queryParams: { issue: 'i1' } });
  });

  it('una alerta de comunidad navega a "communications" de la propiedad al pulsar "Ver comunicado"', async () => {
    const { fixture, http, el } = setupComponent(AlertasCComponent);
    fixture.detectChanges();
    await flushLoad(http, [makeAlert({ id: 'a1', type: 'comunidad', propertyId: 'p1', read: true })]);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    (el.querySelector('.alert-row') as HTMLElement).click();
    fixture.detectChanges();
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Ver comunicado')) as HTMLElement).click();

    expect(navigateSpy).toHaveBeenCalledWith(['/c/properties', 'p1'], { queryParams: { tab: 'communications' } });
  });

  it('una alerta de documento abre ese documento en la página de Documentación al pulsar "Ver documento"', async () => {
    const { fixture, http, el } = setupComponent(AlertasCComponent);
    fixture.detectChanges();
    await flushLoad(http, [makeAlert({ id: 'document:d1', sourceType: 'document', sourceId: 'd1', type: 'documento', urgent: false, propertyId: undefined, read: true })]);
    fixture.detectChanges();
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (el.querySelector('.alert-row') as HTMLElement).click();
    fixture.detectChanges();
    expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent?.includes('Descargar documento'))).toBe(true);
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Ver documento')) as HTMLElement).click();

    expect(navigateSpy).toHaveBeenCalledWith(['/c/documentacion'], { queryParams: { doc: 'd1' } });
  });

  it('una alerta de junta muestra el mensaje honesto de "módulo de Juntas" en vez de un CTA que no lleva a ningún sitio', async () => {
    const { fixture, http, el } = setupComponent(AlertasCComponent);
    fixture.detectChanges();
    await flushLoad(http, [makeAlert({ id: 'a1', type: 'junta', read: true })]);
    fixture.detectChanges();

    (el.querySelector('.alert-row') as HTMLElement).click();
    fixture.detectChanges();

    expect(el.querySelector('.alert-row__detail')?.textContent).toContain('módulo de Juntas');
  });

  describe('descarga de documentos', () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:fake-url');
      URL.revokeObjectURL = vi.fn();
    });
    afterEach(() => {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('"Descargar documento" pide el fichero y limpia el object URL', async () => {
      const { fixture, http, el } = setupComponent(AlertasCComponent);
      fixture.detectChanges();
      await flushLoad(http, [makeAlert({ id: 'a1', type: 'documento', sourceId: 'd1', read: true })]);
      fixture.detectChanges();
      (el.querySelector('.alert-row') as HTMLElement).click();
      fixture.detectChanges();

      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Descargar documento')) as HTMLElement).click();
      const req = http.expectOne((r: any) => r.url === `${API}/documents/d1/file`);
      req.flush(new Blob(['contenido']));
      await settle();

      expect(URL.createObjectURL).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    });
  });
});
