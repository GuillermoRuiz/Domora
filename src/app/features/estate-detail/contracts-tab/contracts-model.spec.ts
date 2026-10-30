import type { EstateContract } from '../../../core/models';
import {
  ALERT_DAYS, DEFAULT_FILTERS, activeShortcut, canCancel, canEdit, canRenew, amountText, categoryColor, formatDate, shortcutFilters, categoryOptions, contractAlert, contractKpis, durationText, filterContracts, filtersFromParams,
  filtersToParams, normalizeText, sortContracts, supplierOptions, upcomingExpirations, type ContractFilters,
} from './contracts-model';

let seq = 0;
function contract(over: Partial<EstateContract> = {}): EstateContract {
  seq += 1;
  return {
    id: `c${seq}`, supplierId: 's1', estateId: 'e1', serviceType: 'Ascensor', startDate: '2025-01-01', endDate: '2027-01-01', renewalType: 'manual',
    costAmount: 1200, costFrequency: 'ANNUAL', currency: 'EUR', status: 'Activo', createdAt: '', updatedAt: '',
    supplier: { id: 's1', name: 'Schindler', category: 'Ascensores' }, daysLeft: 200, annualCost: 1200, monthlyCost: 100, documentCount: 0, ...over,
  };
}
const withDays = (days: number | null, over: Partial<EstateContract> = {}) =>
  contract({ daysLeft: days, status: days !== null && days < 0 ? 'Vencido' : days !== null && days <= 30 ? 'PorVencer' : 'Activo', ...over });
const f = (over: Partial<ContractFilters> = {}): ContractFilters => ({ ...DEFAULT_FILTERS, ...over });

describe('durationText', () => {
  it('días hasta 60, meses hasta el año y después años', () => {
    expect(durationText(1)).toBe('1 día');
    expect(durationText(45)).toBe('45 días');
    expect(durationText(60)).toBe('60 días');
    expect(durationText(61)).toBe('2 meses');
    expect(durationText(250)).toBe('8 meses');
    expect(durationText(400)).toBe('1 año');
    expect(durationText(800)).toBe('2 años');
  });
});

describe('contractAlert (D4)', () => {
  it('vencido → rojo; ≤30 → rojo; 31–90 → ámbar; más lejos → neutro', () => {
    expect(contractAlert(withDays(-12))).toEqual({ text: 'Vencido hace 12 días', tone: 'danger' });
    expect(contractAlert(withDays(0))).toEqual({ text: 'Vence hoy', tone: 'danger' });
    expect(contractAlert(withDays(30))).toEqual({ text: 'Vence en 30 días', tone: 'danger' });
    expect(contractAlert(withDays(31))).toEqual({ text: 'Vence en 31 días', tone: 'warning' });
    expect(contractAlert(withDays(ALERT_DAYS))).toEqual({ text: 'Vence en 3 meses', tone: 'warning' });
    expect(contractAlert(withDays(ALERT_DAYS + 1))).toEqual({ text: 'Vence en 3 meses', tone: 'neutral' });
    expect(contractAlert(withDays(500))).toEqual({ text: 'Vence en 1 año', tone: 'neutral' });
  });
  it('sin fin, cancelado y programado', () => {
    expect(contractAlert(withDays(null))).toEqual({ text: 'Sin vencimiento', tone: 'neutral' });
    expect(contractAlert(contract({ status: 'Cancelado', daysLeft: 100 }))).toEqual({ text: 'Cancelado', tone: 'neutral' });
    const now = new Date('2026-10-19T10:00:00Z');
    expect(contractAlert(contract({ status: 'Programado', startDate: '2026-11-18' }), now)).toEqual({ text: 'Empieza en 30 días', tone: 'neutral' });
    expect(contractAlert(contract({ status: 'Programado', startDate: '2026-10-19' }), now).text).toBe('Empieza hoy');
  });
});

describe('contractKpis (D5, D7)', () => {
  const list = [
    withDays(200, { annualCost: 3600, renewalType: 'tacita' }), // activo
    withDays(20, { annualCost: 600, renewalType: 'tacita' }), // por vencer (cuenta para «vencen pronto»)
    withDays(80, { annualCost: 1000 }), // activo, vence en ≤90
    withDays(150, { annualCost: null, costFrequency: 'ONE_OFF' }), // vigente sin anualizar
    withDays(150, { annualCost: 500, currency: 'USD' }), // otra moneda
    withDays(-10, { annualCost: 9999 }), // vencido: no suma
    contract({ status: 'Cancelado', daysLeft: 100, annualCost: 7777 }),
    contract({ status: 'Programado', daysLeft: 400, annualCost: 8888 }),
    withDays(null, { annualCost: 300 }), // sin fin, activo
  ];
  const k = contractKpis(list);
  it('activos = activos + por vencer; total = todos; vencidos aparte', () => {
    expect(k.active).toBe(6);
    expect(k.total).toBe(9);
    expect(k.expired).toBe(1);
  });
  it('vencen pronto = vigentes con vencimiento en 0–90 días (los vencidos no)', () => {
    expect(k.expiringSoon).toBe(2);
  });
  it('renovaciones automáticas = vigentes con renovación tácita', () => {
    expect(k.autoRenewals).toBe(2);
  });
  it('importe anual: solo vigentes en euros con coste anual; avisa de los que no se pueden sumar', () => {
    expect(k.annualAmount).toBe(3600 + 600 + 1000 + 300);
    expect(k.withoutAnnual).toBe(1);
    expect(k.otherCurrency).toBe(1);
  });
  it('sin contratos todo es 0', () => {
    expect(contractKpis([])).toEqual({ active: 0, total: 0, expiringSoon: 0, expired: 0, autoRenewals: 0, annualAmount: 0, withoutAnnual: 0, otherCurrency: 0 });
  });
});

describe('filterContracts (D8)', () => {
  const lift = contract({ serviceType: 'Ascensor (mantenimiento)', supplier: { id: 's1', name: 'Schindler', category: 'Ascensores' }, endDate: '2026-03-15', renewalType: 'tacita' });
  const clean = contract({ serviceType: 'Limpieza de zonas comunes', supplier: { id: 's2', name: 'Limpiezas Madrid', category: 'Limpieza' }, endDate: '2026-04-30' });
  const insurance = contract({ serviceType: 'Seguro', supplier: { id: 's3', name: 'Mapfre', category: 'Seguros' }, endDate: '2025-12-31', status: 'Vencido' });
  const forever = contract({ serviceType: 'Portería', supplier: { id: 's4', name: 'Conserjes SL', category: 'Personal' }, endDate: null });
  const cancelled = contract({ serviceType: 'Antiguo', status: 'Cancelado', endDate: '2026-02-01', supplier: { id: 's5', name: 'Otros', category: 'Varios' } });
  const all = [lift, clean, insurance, forever, cancelled];

  it('sin filtros devuelve todo', () => expect(filterContracts(all, f())).toHaveLength(5));
  it('busca sin acentos ni mayúsculas en servicio, proveedor y categoría', () => {
    expect(filterContracts(all, f({ search: 'ASCENSOR' }))).toEqual([lift]);
    expect(filterContracts(all, f({ search: 'limpiezas' }))).toEqual([clean]);
    expect(filterContracts(all, f({ search: 'porteria' }))).toEqual([forever]);
    expect(filterContracts(all, f({ search: 'seguros' }))).toEqual([insurance]);
    expect(filterContracts(all, f({ search: 'zzz' }))).toEqual([]);
  });
  it('vigencia: activos = activos + por vencer; el resto, su estado', () => {
    expect(filterContracts(all, f({ vigencia: 'activos' }))).toEqual([lift, clean, forever]);
    expect(filterContracts(all, f({ vigencia: 'vencidos' }))).toEqual([insurance]);
    expect(filterContracts(all, f({ vigencia: 'cancelados' }))).toEqual([cancelled]);
    expect(filterContracts([contract({ status: 'PorVencer' }), lift], f({ vigencia: 'por_vencer' }))).toHaveLength(1);
    expect(filterContracts([contract({ status: 'Programado' }), lift], f({ vigencia: 'programados' }))).toHaveLength(1);
  });
  it('proveedor, renovación y categoría', () => {
    expect(filterContracts(all, f({ supplierId: 's2' }))).toEqual([clean]);
    expect(filterContracts(all, f({ renewal: 'tacita' }))).toEqual([lift]);
    expect(filterContracts(all, f({ category: 'Seguros' }))).toEqual([insurance]);
  });
  it('rango de fechas sobre el vencimiento, extremos incluidos; los sin fin no entran', () => {
    expect(filterContracts(all, f({ from: '2026-03-15', to: '2026-04-30' }))).toEqual([lift, clean]);
    expect(filterContracts(all, f({ from: '2026-03-16' }))).toEqual([clean]);
    expect(filterContracts(all, f({ to: '2025-12-31' }))).toEqual([insurance]);
  });
  it('los filtros se combinan', () => {
    expect(filterContracts(all, f({ vigencia: 'activos', renewal: 'tacita', search: 'asc' }))).toEqual([lift]);
  });
});

describe('sortContracts (D8, D11)', () => {
  const a = contract({ id: 'a', endDate: '2026-05-01', annualCost: 100, startDate: '2024-01-01', supplier: { id: 's1', name: 'Zeta', category: 'x' } });
  const b = contract({ id: 'b', endDate: '2026-01-01', annualCost: 900, startDate: '2025-06-01', supplier: { id: 's2', name: 'Alfa', category: 'x' } });
  const none = contract({ id: 'n', endDate: null, annualCost: null, startDate: '2023-01-01', supplier: { id: 's3', name: 'Medio', category: 'x' } });
  const cancelled = contract({ id: 'x', status: 'Cancelado', endDate: '2025-01-01', annualCost: 5000, supplier: { id: 's4', name: 'Aaa', category: 'x' } });
  const all = [a, none, cancelled, b];
  const ids = (s: Parameters<typeof sortContracts>[1]) => sortContracts(all, s).map((c) => c.id);

  it('vencimiento más próximo: con fecha primero, luego sin fin; cancelados siempre al final', () => expect(ids('vencimiento_asc')).toEqual(['b', 'a', 'n', 'x']));
  it('vencimiento más lejano', () => expect(ids('vencimiento_desc')).toEqual(['a', 'b', 'n', 'x']));
  it('importe anual mayor primero, sin importe al final de los no cancelados', () => expect(ids('importe_desc')).toEqual(['b', 'a', 'n', 'x']));
  it('proveedor A-Z', () => expect(ids('proveedor')).toEqual(['b', 'n', 'a', 'x']));
  it('inicio más reciente', () => expect(ids('inicio_desc')).toEqual(['b', 'a', 'n', 'x']));
  it('no modifica la lista original', () => {
    const copy = [...all];
    sortContracts(all, 'proveedor');
    expect(all).toEqual(copy);
  });
});

describe('upcomingExpirations', () => {
  it('los 5 vigentes con fecha que vencen antes; sin vencidos, cancelados ni sin fin', () => {
    const list = [
      withDays(300), withDays(10), withDays(-5), withDays(null), contract({ status: 'Cancelado', daysLeft: 3 }),
      withDays(40), withDays(90), withDays(120), withDays(5), withDays(500),
    ];
    expect(upcomingExpirations(list).map((c) => c.daysLeft)).toEqual([5, 10, 40, 90, 120]);
    expect(upcomingExpirations(list, 2)).toHaveLength(2);
  });
});

describe('opciones de desplegable', () => {
  const list = [
    contract({ supplier: { id: 's2', name: 'Zeta', category: 'Limpieza' } }),
    contract({ supplier: { id: 's1', name: 'Álamo', category: 'Ascensores' } }),
    contract({ supplier: { id: 's1', name: 'Álamo', category: 'Ascensores' } }),
  ];
  it('proveedores únicos ordenados y categorías únicas ordenadas', () => {
    expect(supplierOptions(list)).toEqual([{ id: 's1', name: 'Álamo' }, { id: 's2', name: 'Zeta' }]);
    expect(categoryOptions(list)).toEqual(['Ascensores', 'Limpieza']);
  });
});

describe('estado en la URL (D8)', () => {
  const read = (q: Record<string, string>) => filtersFromParams((k) => q[k] ?? null);
  it('sin parámetros son los valores por defecto', () => expect(read({})).toEqual(DEFAULT_FILTERS));
  it('ida y vuelta de todos los filtros', () => {
    const filters = f({ search: 'asc', vigencia: 'vencidos', supplierId: 's1', renewal: 'tacita', category: 'Ascensores', from: '2026-01-01', to: '2026-12-31', sort: 'importe_desc' });
    const params = filtersToParams(filters);
    expect(params).toEqual({ q: 'asc', vig: 'vencidos', prov: 's1', ren: 'tacita', cat: 'Ascensores', desde: '2026-01-01', hasta: '2026-12-31', orden: 'importe_desc' });
    expect(read(params as Record<string, string>)).toEqual(filters);
  });
  it('solo escribe lo que difiere del valor por defecto (el resto se quita con null)', () => {
    expect(filtersToParams(f({ vigencia: 'activos' }))).toEqual({ q: null, vig: 'activos', prov: null, ren: null, cat: null, desde: null, hasta: null, orden: null });
  });
  it('un valor no válido vuelve al valor por defecto', () => {
    expect(read({ vig: 'raro', ren: 'otra', orden: 'x', desde: 'ayer', hasta: '2026-13' })).toEqual(DEFAULT_FILTERS);
  });
});

describe('normalizeText', () => {
  it('quita acentos y mayúsculas', () => expect(normalizeText('  Calefacción ÁÉÍ ')).toBe('calefaccion aei'));
});

describe('atajos de las fichas (D9)', () => {
  const now = new Date('2026-10-19T10:00:00Z');
  it('cada ficha aplica sus filtros; «vencen pronto» filtra de hoy a hoy + 90 días', () => {
    expect(shortcutFilters('active', now)).toEqual(f({ vigencia: 'activos' }));
    expect(shortcutFilters('expiring', now)).toEqual(f({ vigencia: 'activos', from: '2026-10-19', to: '2027-01-17' }));
    expect(shortcutFilters('auto', now)).toEqual(f({ vigencia: 'activos', renewal: 'tacita' }));
    expect(shortcutFilters('amount', now)).toEqual(f({ vigencia: 'activos', sort: 'importe_desc' }));
  });
  it('detecta qué ficha corresponde a los filtros actuales (y ninguna si se cambia algo más)', () => {
    expect(activeShortcut(shortcutFilters('auto', now), now)).toBe('auto');
    expect(activeShortcut(shortcutFilters('expiring', now), now)).toBe('expiring');
    expect(activeShortcut(DEFAULT_FILTERS, now)).toBeNull();
    expect(activeShortcut({ ...shortcutFilters('active', now), search: 'x' }, now)).toBeNull();
  });
});

describe('presentación de celdas', () => {
  it('formatDate: dd/mm/aaaa, acepta ISO y «—» si no hay', () => {
    expect(formatDate('2026-03-15')).toBe('15/03/2026');
    expect(formatDate('2026-03-15T00:00:00.000Z')).toBe('15/03/2026');
    expect(formatDate(null)).toBe('—');
  });
  it('cancelado muestra desde cuándo si se sabe', () => {
    expect(contractAlert(contract({ status: 'Cancelado', cancelledAt: '2026-02-01' }))).toEqual({ text: 'Cancelado el 01/02/2026', tone: 'neutral' });
  });
  it('amountText: anual y mensual; puntual; sin importe; otra moneda', () => {
    const base = { costAmount: 300, costFrequency: 'MONTHLY' as const, currency: 'EUR', annualCost: 3600, monthlyCost: 300 };
    const plain = (a: { main: string; sub: string | null }) => ({ main: a.main.replace(/ /g, ' '), sub: a.sub?.replace(/ /g, ' ') ?? null });
    expect(plain(amountText(base))).toEqual({ main: '3600,00 €', sub: '(300,00 €/mes)' });
    expect(plain(amountText({ ...base, costAmount: 900, costFrequency: 'ONE_OFF', annualCost: null, monthlyCost: null }))).toEqual({ main: '900,00 €', sub: 'Pago único' });
    expect(amountText({ ...base, costFrequency: 'OTHER', annualCost: null, monthlyCost: null }).sub).toBe('Periodicidad no anualizable');
    expect(amountText({ ...base, costAmount: null, annualCost: null, monthlyCost: null })).toEqual({ main: '—', sub: null });
    expect(amountText({ ...base, currency: 'USD' }).main).toContain('US$');
  });
  it('categoryColor es estable y sale de la paleta', () => {
    expect(categoryColor('Ascensores')).toBe(categoryColor('Ascensores'));
    expect(categoryColor('Ascensores')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('acciones permitidas (D1)', () => {
  it('un cancelado solo se consulta; renovar exige fecha de fin', () => {
    expect([canEdit(contract()), canCancel(contract()), canRenew(contract())]).toEqual([true, true, true]);
    const cancelled = contract({ status: 'Cancelado' });
    expect([canEdit(cancelled), canCancel(cancelled), canRenew(cancelled)]).toEqual([false, false, false]);
    const indefinite = contract({ endDate: null, daysLeft: null });
    expect([canEdit(indefinite), canCancel(indefinite), canRenew(indefinite)]).toEqual([true, true, false]);
    expect(canRenew(contract({ status: 'Vencido', daysLeft: -3 }))).toBe(true);
  });
});
