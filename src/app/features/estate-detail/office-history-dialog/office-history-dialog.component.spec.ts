import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import { OfficeHistoryDialogComponent } from './office-history-dialog.component';

const URL = `${API}/estates/e1/office-terms`;
const term = (over: Record<string, unknown>) => ({
  estateId: 'e1', role: 'PRESIDENT', propertyId: 'p1', userId: null, externalOwnerId: null,
  holderNameSnapshot: 'Titular', startsAt: '2024-01-01', endsAt: null, propertyReference: '1ºA', ...over,
});

describe('OfficeHistoryDialogComponent', () => {
  let h: ComponentHarness<OfficeHistoryDialogComponent>;
  const rows = () => Array.from(h.el.querySelectorAll('tbody tr')).map((tr) =>
    Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.replace(/\s+/g, ' ').trim()));

  beforeEach(() => {
    h = setupComponent(OfficeHistoryDialogComponent);
    h.fixture.componentRef.setInput('estateId', 'e1');
    h.fixture.componentRef.setInput('estateName', 'Alcalá 100');
    h.fixture.detectChanges();
  });

  afterEach(() => h.http.verify());

  async function respond(body: object[] | null, status = 200) {
    const req = h.http.expectOne(URL);
    if (status === 200) req.flush(body);
    else req.flush({ message: 'x' }, { status, statusText: 'Error' });
    await settle();
    h.fixture.detectChanges();
  }

  it('lista los cargos del más reciente al más antiguo, con «Vigente» y el puesto de los vicepresidentes en el cargo', async () => {
    await respond([
      term({ id: 'old', holderNameSnapshot: 'Antiguo Presidente', startsAt: '2022-01-01', endsAt: '2024-01-01', propertyReference: '2ºB' }),
      term({ id: 'pres', holderNameSnapshot: 'Pilar Ruiz', startsAt: '2024-01-01' }),
      term({ id: 'v1', role: 'VICE_PRESIDENT', holderNameSnapshot: 'Ana Gil', startsAt: '2024-02-01', propertyReference: null }),
      term({ id: 'v0', role: 'VICE_PRESIDENT', holderNameSnapshot: 'Exvice', startsAt: '2023-01-01', endsAt: '2023-12-31' }),
    ]);
    expect(h.el.querySelector('h4')?.textContent).toBe('Historial de cargos');
    expect(h.el.textContent).toContain('Presidentes y vicepresidentes de Alcalá 100, con sus fechas');
    expect(rows()).toEqual([
      ['Vicepresidente 1º', 'Ana Gil', '—', '01/02/2024', 'Vigente'],
      ['Presidente', 'Pilar Ruiz', '1ºA', '01/01/2024', 'Vigente'],
      ['Vicepresidente', 'Exvice', '1ºA', '01/01/2023', '31/12/2023'],
      ['Presidente', 'Antiguo Presidente', '2ºB', '01/01/2022', '01/01/2024'],
    ]);
  });

  it('sin cargos registrados lo dice', async () => {
    await respond([]);
    expect(h.el.textContent).toContain('Esta comunidad aún no tiene cargos registrados.');
    expect(h.el.querySelector('table')).toBeNull();
  });

  it('un fallo de carga se distingue de «sin cargos» y permite reintentar', async () => {
    await respond(null, 500);
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar el historial de cargos.');
    expect(h.el.textContent).not.toContain('aún no tiene cargos');
    (h.el.querySelector('.retry') as HTMLButtonElement).click();
    await respond([term({ id: 'pres', holderNameSnapshot: 'Pilar Ruiz' })]);
    expect(rows()).toHaveLength(1);
  });

  it('se cierra con el botón, con Escape y al pulsar fuera', async () => {
    await respond([]);
    let closes = 0;
    h.component.closed.subscribe(() => closes++);
    (h.el.querySelector('.close-btn') as HTMLButtonElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    (h.el.querySelector('.modal-backdrop') as HTMLElement).click();
    (h.el.querySelector('.modal') as HTMLElement).click();
    expect(closes).toBe(3);
  });
});
