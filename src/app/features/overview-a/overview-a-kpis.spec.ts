import type { MrrMonth, MrrOverview } from '../../core/platform-metrics.service';
import { buildKpis, historyMonths, monthLabel, sinceLabel, type KpiSources } from './overview-a-kpis';

const month = (m: string, mrr: number, payingClients: number): MrrMonth => ({
  month: m,
  mrr,
  payingClients,
  movements: { new: 0, expansion: 0, contraction: 0, churn: 0, reactivation: 0, net: 0, signups: 0, cancellations: 0 },
});

const mrr = (over: Partial<MrrOverview> = {}): MrrOverview => ({
  currentMrr: 1350,
  payingClients: 12,
  dataSince: '2026-08',
  months: [month('2026-07', 0, 0), month('2026-08', 1000, 9), month('2026-09', 1200, 10), month('2026-10', 1300, 12)],
  ...over,
});

const sources = (over: Partial<KpiSources> = {}): KpiSources => ({
  mrr: { data: mrr(), error: false },
  clients: { data: { trials: 3, pendingInvoices: { count: 4, amount: 2150, overdueCount: 2, overdueAmount: 1200 } }, error: false },
  completeness: { data: { average: 62.5, offices: [] }, error: false },
  ...over,
});

const kpi = (s: KpiSources, key: string) => buildKpis(s).find(k => k.key === key)!;

describe('overview-a KPIs', () => {
  it('muestra los seis indicadores del panel en orden', () => {
    expect(buildKpis(sources()).map(k => k.label)).toEqual([
      'Clientes activos', 'MRR total', 'Cuentas en prueba', 'Pagos pendientes', 'Tickets abiertos', 'Completitud media',
    ]);
  });

  it('MRR total: el MRR actual y su variación porcentual frente al mes anterior, con su tendencia desde que hay datos', () => {
    const k = kpi(sources(), 'mrr');
    expect(k.value).toBe('1350 €');
    expect(k.change).toBe('+12,5 % vs. mes anterior');
    expect(k.tone).toBe('positive');
    expect(k.trend).toEqual([1000, 1200, 1300]);
    expect(k.info).toContain('sin IVA');
    expect(k.info).toContain('excluye las cuentas en prueba');
  });

  it('una caída del MRR se marca como negativa', () => {
    const k = kpi(sources({ mrr: { data: mrr({ currentMrr: 1100 }), error: false } }), 'mrr');
    expect(k.change).toBe('−8,3 % vs. mes anterior');
    expect(k.tone).toBe('danger');
  });

  it('Clientes activos: los despachos que pagan hoy y la diferencia absoluta con el mes anterior', () => {
    const k = kpi(sources(), 'clients');
    expect(k.value).toBe('12');
    expect(k.change).toBe('+2 vs. mes anterior');
    expect(k.tone).toBe('positive');
    expect(k.trend).toEqual([9, 10, 12]);
  });

  it('sin un mes anterior con datos no inventa la variación y dice desde cuándo hay histórico', () => {
    const s = sources({ mrr: { data: mrr({ dataSince: '2026-10', months: [month('2026-09', 0, 0), month('2026-10', 1300, 12)] }), error: false } });
    const k = kpi(s, 'mrr');
    expect(k.change).toBe('Histórico desde octubre de 2026');
    expect(k.tone).toBe('neutral');
    expect(k.trend).toBeNull();
    expect(k.info).toContain('octubre de 2026');
  });

  it('Cuentas en prueba: número de despachos en periodo de prueba', () => {
    expect(kpi(sources(), 'trials').value).toBe('3');
  });

  it('Pagos pendientes: número de facturas y total en €, distinguiendo las vencidas de las que están en plazo', () => {
    const k = kpi(sources(), 'pending');
    expect(k.value).toBe('4 facturas · 2150 €');
    expect(k.sub).toBe('2 vencidas · 1200 € · 2 en plazo · 950 €');
    expect(k.tone).toBe('danger');
  });

  it('sin facturas pendientes lo dice en positivo', () => {
    const k = kpi(sources({ clients: { data: { trials: 0, pendingInvoices: { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 } }, error: false } }), 'pending');
    expect(k.value).toBe('0 facturas');
    expect(k.sub).toBe('Todo cobrado');
  });

  it('Tickets abiertos: «Próximamente» hasta que exista el módulo de soporte', () => {
    const k = kpi(sources(), 'tickets');
    expect(k.value).toBe('—');
    expect(k.sub).toBe('Próximamente');
  });

  it('Completitud media: porcentaje con un decimal; sin despachos que contar, guion', () => {
    expect(kpi(sources(), 'completeness').value).toBe('62,5 %');
    expect(kpi(sources({ completeness: { data: { average: null, offices: [] }, error: false } }), 'completeness').value).toBe('—');
  });

  it('cada indicador explica su cálculo', () => {
    for (const k of buildKpis(sources())) expect(k.info.length).toBeGreaterThan(20);
  });

  it('si falla una fuente, solo sus indicadores quedan sin dato y los demás se siguen viendo', () => {
    const s = sources({ mrr: { data: null, error: true } });
    expect(kpi(s, 'mrr').value).toBe('—');
    expect(kpi(s, 'mrr').sub).toBe('No se pudo cargar');
    expect(kpi(s, 'clients').sub).toBe('No se pudo cargar');
    expect(kpi(s, 'trials').value).toBe('3');
    expect(kpi(s, 'completeness').value).toBe('62,5 %');
  });

  it('mientras carga una fuente, sus indicadores muestran puntos suspensivos', () => {
    const s = sources({ clients: { data: null, error: false } });
    expect(kpi(s, 'trials').value).toBe('…');
    expect(kpi(s, 'pending').value).toBe('…');
  });

  it('historyMonths deja fuera los meses anteriores al primer dato capturado', () => {
    expect(historyMonths(mrr()).map(m => m.month)).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('etiquetas de mes cortas y fecha de inicio larga', () => {
    expect(monthLabel('2026-01')).toBe('ene 26');
    expect(sinceLabel('2026-10')).toBe('octubre de 2026');
  });
});
