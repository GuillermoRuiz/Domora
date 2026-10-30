import { API, setupComponent, settle } from '../../../../core/testing/component-harness';
import type { ContractRenewal, EstateContract } from '../../../../core/models';
import { ContractDetailComponent } from './contract-detail.component';

function contract(over: Partial<EstateContract> = {}): EstateContract {
  return {
    id: 'c1', supplierId: 's1', estateId: 'e1', serviceType: 'Ascensor (mantenimiento)', startDate: '2024-01-01', endDate: '2026-03-15',
    renewalType: 'tacita', costAmount: 300, costFrequency: 'MONTHLY', currency: 'EUR', reviewFrequency: 'Cuatrimestral', notes: 'Revisión en octubre',
    status: 'Activo', createdAt: '', updatedAt: '', supplier: { id: 's1', name: 'Schindler', category: 'Ascensores' }, daysLeft: 200,
    annualCost: 3600, monthlyCost: 300, documentCount: 2, ...over,
  };
}
const docsUrl = `${API}/estates/e1/suppliers/s1/documents`;
const DOCS = [
  { id: 'd1', supplierId: 's1', contractId: 'c1', documentType: 'Contrato', title: 'Contrato de Ascensor', fileName: 'contrato.pdf', mimeType: 'application/pdf', createdAt: '2024-01-01' },
  { id: 'd2', supplierId: 's1', contractId: 'otro', documentType: 'Seguro', title: 'Seguro de otro contrato', fileName: 'seguro.pdf', mimeType: 'application/pdf', createdAt: '2024-01-01' },
  { id: 'd3', supplierId: 's1', contractId: null, documentType: 'Otro', title: 'Del proveedor', fileName: 'x.pdf', mimeType: 'application/pdf', createdAt: '2024-01-01' },
];
const RENEWALS: ContractRenewal[] = [
  { id: 'r1', contractId: 'c1', serviceType: 'Ascensor', supplier: { id: 's1', name: 'Schindler', category: 'Ascensores' }, renewedAt: '2025-03-15', previousEndDate: '2025-03-15', newEndDate: '2026-03-15', annualCost: 3500, currency: 'EUR', kind: 'tacita', notes: 'Subida del IPC' },
  { id: 'r2', contractId: 'otro', serviceType: 'Otro', supplier: { id: 's2', name: 'Otro', category: 'x' }, renewedAt: '2025-01-01', newEndDate: '2026-01-01', kind: 'manual' },
];
const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').replace(/ /g, ' ').trim() ?? '';

describe('ContractDetailComponent', () => {

  async function mount(c: EstateContract = contract(), docs: object | 'error' = DOCS) {
    const h = setupComponent(ContractDetailComponent);
    h.component.estateId = 'e1';
    h.component.contract = c;
    h.component.renewals = RENEWALS;
    h.fixture.detectChanges();
    const req = h.http.expectOne(docsUrl);
    if (docs === 'error') req.flush({}, { status: 500, statusText: 'Error' });
    else req.flush(docs);
    await settle();
    h.fixture.detectChanges();
    return h;
  }
  const q = (h: { el: HTMLElement }, key: string) => text(h.el.querySelector(`[data-detail="${key}"]`));

  it('muestra los datos del contrato, el importe anual y mensual y la alerta', async () => {
    const h = await mount();
    expect(text(h.el.querySelector('#cd-title'))).toBe('Ascensor (mantenimiento)');
    expect(text(h.el.querySelector('.drawer__subtitle'))).toBe('Schindler · Ascensores');
    expect(q(h, 'start')).toBe('01/01/2024');
    expect(q(h, 'end')).toBe('15/03/2026');
    expect(q(h, 'renewal')).toBe('Automática');
    expect(q(h, 'annual')).toContain('3600,00 €');
    expect(q(h, 'annual')).toContain('(300,00 €/mes)');
    expect(q(h, 'cost')).toBe('300,00 € · mensual');
    expect(q(h, 'alert')).toContain('Vence en');
    expect(text(h.el.querySelector('.facts__notes'))).toBe('Revisión en octubre');
  });

  it('enseña solo los documentos de este contrato', async () => {
    const h = await mount();
    const rows = h.el.querySelectorAll('[data-detail="documents"] .list__row');
    expect(rows).toHaveLength(1);
    expect(text(rows[0]!)).toContain('Contrato de Ascensor');
  });

  it('si falla la descarga avisa y no guarda nada', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = await mount();
    const saveFile = vi.spyOn(h.component, 'saveFile').mockResolvedValue();
    (h.el.querySelector('.list__action') as HTMLButtonElement).click();
    h.http.expectOne(`${docsUrl}/d1/file`).error(new ProgressEvent('error'));
    await settle();
    h.fixture.detectChanges();
    expect(saveFile).not.toHaveBeenCalled();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo descargar');
  });

  it('descarga el fichero con su nombre cuando todo va bien', async () => {
    const h = await mount();
    const saveFile = vi.spyOn(h.component, 'saveFile').mockResolvedValue();
    const done = h.component.download(h.component.documents()![0]!);
    h.http.expectOne(`${docsUrl}/d1/file`).flush(new Blob(['%PDF-'], { type: 'application/pdf' }));
    await done;
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0]![1]).toBe('contrato.pdf');
  });

  it('sin documentos lo dice', async () => {
    const h = await mount(contract(), []);
    expect(h.el.textContent).toContain('no tiene documentos adjuntos');
  });

  it('si falla la carga de documentos avisa', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = await mount(contract(), 'error');
    expect(h.el.textContent).toContain('No se pudieron cargar los documentos');
  });

  it('lista las renovaciones de este contrato con su tipo y nuevo vencimiento', async () => {
    const h = await mount();
    const rows = h.el.querySelectorAll('[data-detail="renewals"] .list__row');
    expect(rows).toHaveLength(1);
    expect(text(rows[0]!)).toContain('15/03/2025 · Automática');
    expect(text(rows[0]!)).toContain('Nuevo vencimiento 15/03/2026');
    expect(text(rows[0]!)).toContain('Subida del IPC');
  });

  it('un contrato sin renovaciones lo explica', async () => {
    const h = await mount(contract({ id: 'otro-sin-renovaciones' }), []);
    expect(h.el.textContent).toContain('Todavía no se ha registrado ninguna renovación');
  });

  it('un contrato activo tiene todas las acciones', async () => {
    const h = await mount();
    const labels = Array.from(h.el.querySelectorAll('.drawer__footer app-btn')).map((b) => text(b));
    expect(labels).toEqual(['Cancelar contrato', 'Renovar', 'Editar']);
  });

  it('un cancelado solo se consulta: muestra cuándo y por qué se canceló', async () => {
    const h = await mount(contract({ status: 'Cancelado', cancelledAt: '2026-02-01', cancelledReason: 'Sustituido' }));
    expect(h.el.querySelectorAll('.drawer__footer app-btn')).toHaveLength(0);
    expect(q(h, 'cancelled')).toContain('01/02/2026');
    expect(q(h, 'cancelled')).toContain('Sustituido');
    expect(h.el.querySelector('.drawer__link')).not.toBeNull(); // «Ver proveedor» siempre
  });

  it('un contrato indefinido no se puede renovar', async () => {
    const h = await mount(contract({ endDate: null, daysLeft: null }));
    const labels = Array.from(h.el.querySelectorAll('.drawer__footer app-btn')).map((b) => text(b));
    expect(labels).toEqual(['Cancelar contrato', 'Editar']);
    expect(q(h, 'end')).toBe('Indefinido');
  });

  it('cada acción emite el contrato', async () => {
    const h = await mount();
    const seen: string[] = [];
    h.component.edit.subscribe(() => seen.push('edit'));
    h.component.renew.subscribe(() => seen.push('renew'));
    h.component.cancel.subscribe(() => seen.push('cancel'));
    h.component.openSupplier.subscribe(() => seen.push('supplier'));
    h.component.closed.subscribe(() => seen.push('closed'));
    const buttons = h.el.querySelectorAll<HTMLButtonElement>('.drawer__footer app-btn button');
    buttons.forEach((b) => b.click());
    (h.el.querySelector('.drawer__link') as HTMLButtonElement).click();
    (h.el.querySelector('.drawer__close') as HTMLButtonElement).click();
    expect(seen).toEqual(['cancel', 'renew', 'edit', 'supplier', 'closed']);
  });
});
