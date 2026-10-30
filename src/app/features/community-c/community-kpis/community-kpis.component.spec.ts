import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import type { PropertyOverview } from '../../../core/owner-community.models';
import { CommunityKpisComponent, type KpiTarget } from './community-kpis.component';

const overview = (overrides: Partial<PropertyOverview> = {}): PropertyOverview => ({
  propertyId: 'p1', estateId: 'e1',
  nextReceipt: { id: 'r1', concept: 'Cuota ordinaria', amount: 125, dueDate: '2099-04-05', status: 'Pendiente' },
  requests: { open: 2, newLast30Days: 1 },
  nextMeeting: { id: 'm1', title: 'Junta ordinaria', scheduledAt: '2099-03-15T17:00:00.000Z' },
  documents: { newLast30Days: 3 },
  ...overrides,
});

describe('CommunityKpisComponent', () => {
  let h: ComponentHarness<CommunityKpisComponent>;

  function mount(o: PropertyOverview | null, failed = false): void {
    h = setupComponent(CommunityKpisComponent);
    h.fixture.componentRef.setInput('overview', o);
    h.fixture.componentRef.setInput('failed', failed);
    h.fixture.detectChanges();
  }
  const tile = (id: string) => h.el.querySelector(`[data-kpi="${id}"]`) as HTMLElement;
  const text = (id: string) => tile(id).textContent?.replace(/\s+/g, ' ').trim();

  it('muestra las cuatro fichas con sus datos', () => {
    mount(overview());
    expect(h.el.querySelectorAll('[data-kpi]')).toHaveLength(4);
    expect(text('receipt')).toMatch(/Próximo recibo\s?125,00\s?€\s?5 abr 2099/);
    expect(text('requests')).toMatch(/Incidencias abiertas\s?2\s?\+1 en los últimos 30 días/);
    expect(text('meeting')).toMatch(/Próxima junta\s?15 mar 2099\s?18:00/); // 17:00 UTC = 18:00 en Madrid (invierno)
    expect(text('documents')).toMatch(/Documentos nuevos\s?3\s?en el último mes/);
  });

  it('cada ficha lleva su color de icono y una flecha hacia su sección', () => {
    mount(overview());
    const tones = ['receipt', 'requests', 'meeting', 'documents'].map(id => tile(id).querySelector('.kpi__icon')?.className);
    expect(tones).toEqual([
      expect.stringContaining('kpi__icon--accent'),
      expect.stringContaining('kpi__icon--error'),
      expect.stringContaining('kpi__icon--success'),
      expect.stringContaining('kpi__icon--purple'),
    ]);
    for (const id of ['receipt', 'requests', 'meeting', 'documents']) expect(tile(id).querySelector('.kpi-btn__chevron')).not.toBeNull();
  });

  describe('próximo recibo', () => {
    it('sin recibos por pagar lo dice', () => {
      mount(overview({ nextReceipt: null }));
      expect(text('receipt')).toMatch(/—\s?Sin recibos pendientes/);
    });

    it('un recibo ya vencido avisa en ámbar', () => {
      mount(overview({ nextReceipt: { id: 'r1', concept: 'Cuota', amount: 174.96, dueDate: '2020-10-05', status: 'Pendiente' } }));
      expect(text('receipt')).toMatch(/174,96\s?€\s?5 oct 2020 · vencido/);
      expect(tile('receipt').querySelector('.kpi--warning')).not.toBeNull();
    });

    it('un recibo por vencer no se marca como vencido', () => {
      mount(overview());
      expect(text('receipt')).not.toContain('vencido');
      expect(tile('receipt').querySelector('.kpi--default')).not.toBeNull();
    });

    it('sin fecha de vencimiento lo dice', () => {
      mount(overview({ nextReceipt: { id: 'r1', concept: 'Cuota', amount: 50, dueDate: null, status: 'Devuelto' } }));
      expect(text('receipt')).toContain('Sin fecha de vencimiento');
    });

    it('el día se lee tal cual viene, sin que la zona horaria lo corra', () => {
      mount(overview({ nextReceipt: { id: 'r1', concept: 'Cuota', amount: 10, dueDate: '2099-01-01T00:00:00.000Z', status: 'Pendiente' } }));
      expect(text('receipt')).toContain('1 ene 2099');
    });
  });

  describe("incidencias abiertas", () => {
    it('sin ninguna abierta ni nueva sale en neutro y lo dice', () => {
      mount(overview({ requests: { open: 0, newLast30Days: 0 } }));
      expect(text('requests')).toMatch(/Incidencias abiertas\s?0\s?Ninguna nueva en 30 días/);
      expect(tile('requests').querySelector('.kpi--default')).not.toBeNull();
    });

    it('con abiertas sale en rojo', () => {
      mount(overview());
      expect(tile('requests').querySelector('.kpi--danger')).not.toBeNull();
    });

    it('puede haber nuevas aunque ya no queden abiertas', () => {
      mount(overview({ requests: { open: 0, newLast30Days: 2 } }));
      expect(text('requests')).toContain('+2 en los últimos 30 días');
      expect(tile('requests').querySelector('.kpi--default')).not.toBeNull();
    });

    it.each([
      [3, 2, '+1 vs. mes anterior'],
      [1, 3, '−2 vs. mes anterior'],
      [2, 2, 'Igual que el mes anterior'],
      [0, 0, 'Ninguna nueva en 30 días'],
    ])('con %i nuevas frente a %i el mes anterior dice «%s»', (newLast30Days, newPrevious30Days, expected) => {
      mount(overview({ requests: { open: 2, newLast30Days, newPrevious30Days } }));
      expect(text('requests')).toMatch(new RegExp(`Incidencias abiertas\\s?2\\s?${expected.replace('+', '\\+').replace(/\./g, '\\.')}$`));
    });
  });

  describe('próxima junta', () => {
    it('sin ninguna convocada lo dice', () => {
      mount(overview({ nextMeeting: null }));
      expect(text('meeting')).toMatch(/—\s?Sin juntas convocadas/);
    });

    it('la hora es la de Madrid también en verano', () => {
      mount(overview({ nextMeeting: { id: 'm1', title: 'Junta', scheduledAt: '2099-07-10T16:00:00.000Z' } }));
      expect(text('meeting')).toMatch(/10 jul 2099\s?18:00/);
    });
  });

  describe('sin datos', () => {
    it('mientras carga muestra guiones y sin textos secundarios', () => {
      mount(null);
      for (const id of ['receipt', 'requests', 'meeting', 'documents']) expect(text(id)).toMatch(/—$/);
      expect(h.el.querySelector('[role="alert"]')).toBeNull();
    });

    it('si falló la carga lo avisa', () => {
      mount(null, true);
      expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudieron cargar los datos de tu propiedad');
    });
  });

  it('cada ficha lleva a su sección de la propiedad', () => {
    mount(overview());
    const opened: KpiTarget[] = [];
    h.component.open.subscribe(t => opened.push(t));
    for (const id of ['receipt', 'requests', 'meeting', 'documents']) {
      tile(id).click();
    }
    expect(opened).toEqual(['receipts', 'issues', 'juntas', 'documents']);
  });
});
