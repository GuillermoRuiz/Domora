import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { Installation } from '../../../core/installations.models';
import type { Inspection } from '../../../core/models';
import { InstallationDetailModalComponent } from './installation-detail-modal.component';

function installation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: 'a1', name: 'Ascensor A', category: 'Ascensor', location: 'Portal 1', manufacturer: 'Orona', serialNumber: 'SN-1', notes: 'Revisar el cuadro',
    operationalStatus: 'operativa', displayStatus: 'revision_proxima', supplier: { id: 's1', name: 'Ascensores Levante' },
    lastReviewDate: '2026-01-15', nextReviewDate: '2026-10-19', nextReviewDaysLeft: 3, openIssues: 2, ...overrides,
  };
}

const raw = (id: string, assetId: string, name: string, status: string, dates: { last?: string; next?: string; appointment?: string }) => ({
  id, estateId: 'e1', assetId, asset: { id: assetId, estateId: 'e1', name: 'x', category: 'Ascensor' },
  inspectionType: { id: 't', code: 'C', name, requiresOca: false }, status,
  nextDueDate: dates.next ?? null, appointmentDate: dates.appointment ?? null, lastDoneDate: dates.last ?? null,
  reminderDaysBefore: 30, notes: null, results: [], correctiveActions: [],
}) as unknown as Inspection;

describe('InstallationDetailModalComponent', () => {
  let h: ComponentHarness<InstallationDetailModalComponent>;
  const url = `${API}/estates/e1/inspections`;

  async function mount(target: Installation, body: unknown[] | { status: number }) {
    h = setupComponent(InstallationDetailModalComponent);
    h.component.estateId = 'e1';
    h.component.installation = target;
    h.fixture.detectChanges();
    const req = h.http.expectOne((r) => r.url === url);
    if (!Array.isArray(body)) req.flush({ message: 'x' }, { status: body.status, statusText: 'Error' });
    else req.flush(body);
    await settle();
    h.fixture.detectChanges();
  }
  const detail = (id: string) => h.el.querySelector(`[data-detail="${id}"] dd`)?.textContent?.replace(/\s+/g, ' ').trim();

  afterEach(() => h.http.verify());

  it('muestra el nombre, el estado y todos los datos con sus plazos', async () => {
    await mount(installation(), []);
    expect(h.el.querySelector('h4')?.textContent).toBe('Ascensor A');
    expect(h.el.querySelector('app-status-pill')?.textContent).toContain('Revisión próxima');
    expect(detail('type')).toBe('Ascensor');
    expect(detail('location')).toBe('Portal 1');
    expect(detail('supplier')).toBe('Ascensores Levante');
    expect(detail('manufacturer')).toBe('Orona');
    expect(detail('serial')).toBe('SN-1');
    expect(detail('last')).toMatch(/^15 ene\.? 2026$/);
    expect(detail('next')).toMatch(/^19 oct\.? 2026 \(en 3 días\)$/);
    expect(detail('issues')).toBe('2');
    expect(h.el.querySelector('[data-detail="notes"]')?.textContent).toContain('Revisar el cuadro');
  });

  it('lo que falta se muestra con guion y sin notas no hay bloque de notas', async () => {
    await mount(installation({ location: null, supplier: null, manufacturer: null, serialNumber: null, notes: null, lastReviewDate: null, nextReviewDate: null, nextReviewDaysLeft: null }), []);
    for (const id of ['location', 'supplier', 'manufacturer', 'serial', 'last', 'next']) expect(detail(id)).toBe('—');
    expect(h.el.querySelector('[data-detail="notes"]')).toBeNull();
  });

  it('el historial solo tiene las inspecciones de ESTA instalación, la más reciente primero', async () => {
    await mount(installation(), [
      raw('i1', 'a1', 'Revisión anual', 'Realizada', { last: '2025-01-10' }),
      raw('i2', 'a2', 'De otra instalación', 'Realizada', { last: '2026-05-01' }),
      raw('i3', 'a1', 'Revisión anual', 'Planificada', { next: '2026-10-19' }),
      raw('i4', 'a1', 'Inspección ITC', 'Realizada', { last: '2026-01-15' }),
    ]);
    expect(Array.from(h.el.querySelectorAll('[data-inspection]')).map(li => li.getAttribute('data-inspection'))).toEqual(['i3', 'i4', 'i1']);
    expect(h.el.querySelector('[data-inspection="i3"]')?.textContent).toContain('Planificada');
    expect(h.el.textContent).not.toContain('De otra instalación');
  });

  it('sin inspecciones lo dice, y si falla la carga avisa sin tumbar la ficha', async () => {
    await mount(installation(), []);
    expect(h.el.textContent).toContain('aún no tiene revisiones registradas');
    h.fixture.destroy();
  });

  it('si falla el historial avisa pero los datos siguen visibles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount(installation(), { status: 500 });
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo cargar el historial');
    expect(detail('supplier')).toBe('Ascensores Levante');
  });

  it('"Editar" y "Cerrar" emiten sus eventos', async () => {
    await mount(installation(), []);
    const edit = vi.fn();
    const closed = vi.fn();
    h.component.edit.subscribe(edit);
    h.component.closed.subscribe(closed);
    (h.el.querySelector('[data-action="edit"]') as HTMLButtonElement).click();
    (h.el.querySelector('.close-btn') as HTMLButtonElement).click();
    expect(edit).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
