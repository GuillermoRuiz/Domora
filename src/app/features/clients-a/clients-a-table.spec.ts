import type { Administrator, ClientCommercialRow, Lead, OfficeHealth } from '../../core/models';
import { buildClientRows, filterClients, isOpenLead, riskClients, sortClients, type ClientRow } from './clients-a-table';

const TODAY = new Date('2026-10-26T10:00:00Z');

function admin(id: string, overrides: Partial<Administrator> = {}): Administrator {
  return {
    id, name: `Despacho ${id}`, cif: `B${id}`, plan: 'BASE', tier: 'base', endDate: '', usersActive: 1, usersMax: 25,
    status: 'Activa', phone: '600000000', contactName: `Contacto ${id}`, contactEmail: `${id}@test.es`, mrr: 29,
    discountPct: 0, billingInterval: 'month', notes: '', billing: null, fincas: [], invoices: [], activity: [],
    clientStatus: 'Activo', paymentStatus: 'Al día',
    ...overrides,
  };
}

function health(administratorId: string, salud: number | null, atRisk = false, motivo: string | null = null): OfficeHealth {
  return {
    administratorId, name: '', plan: 'BASE', createdAt: '2026-01-01', clientStatus: 'Activo', paymentStatus: 'Al día',
    completeness: 50, salud, atRisk, motivo: motivo ? { code: 'payment', label: motivo } : null, signals: [],
    usage: { activeDays: 0, activeUsers: 0, staffUsers: 0, observedDays: 0 }, attention: [],
  };
}

function commercial(administratorId: string, overrides: Partial<ClientCommercialRow> = {}): ClientCommercialRow {
  return { administratorId, signupAt: '2026-01-15', nextRenewal: null, lastActiveDay: null, nextAction: null, nextActionAt: null, ...overrides };
}

function rows(): ClientRow[] {
  return buildClientRows(
    [
      admin('a', { name: 'Fincas Alba', plan: 'PREMIUM', mrr: 99, clientStatus: 'Activo' }),
      admin('b', { name: 'Gestión Bravo', contactName: 'Lucía Pérez', mrr: 29, clientStatus: 'En prueba' }),
      admin('c', { name: 'Admin Centro', plan: 'STANDARD', mrr: 59, clientStatus: 'Suspendido' }),
    ],
    new Map([['a', health('a', 92)], ['b', health('b', 40, true, 'Uso muy bajo')], ['c', health('c', 60, true, 'Pagos pendientes')]]),
    new Map([
      ['a', commercial('a', { signupAt: '2026-10-01', nextRenewal: { date: '2027-01-10', amount: 1188 }, nextActionAt: '2026-11-02', nextAction: 'Llamar' })],
      ['b', commercial('b', { signupAt: '2025-09-01', nextActionAt: '2026-10-30', nextAction: 'Demo' })],
      ['c', commercial('c', { signupAt: '2026-08-01', nextRenewal: { date: '2026-11-15', amount: 708 } })],
    ]),
  );
}

describe('filterClients', () => {
  it('busca por nombre, CIF, contacto o email', () => {
    expect(filterClients(rows(), { query: 'lucía', status: 'TODOS', plan: 'TODOS', signup: 'all' }, TODAY).map(r => r.admin.id)).toEqual(['b']);
    expect(filterClients(rows(), { query: 'bc', status: 'TODOS', plan: 'TODOS', signup: 'all' }, TODAY).map(r => r.admin.id)).toEqual(['c']);
  });

  it('filtra por estado comercial y por plan', () => {
    expect(filterClients(rows(), { query: '', status: 'En prueba', plan: 'TODOS', signup: 'all' }, TODAY).map(r => r.admin.id)).toEqual(['b']);
    expect(filterClients(rows(), { query: '', status: 'TODOS', plan: 'STANDARD', signup: 'all' }, TODAY).map(r => r.admin.id)).toEqual(['c']);
  });

  it('filtra por fecha de alta (últimos 30 días, 90 días, último año)', () => {
    expect(filterClients(rows(), { query: '', status: 'TODOS', plan: 'TODOS', signup: '30' }, TODAY).map(r => r.admin.id)).toEqual(['a']);
    expect(filterClients(rows(), { query: '', status: 'TODOS', plan: 'TODOS', signup: '90' }, TODAY).map(r => r.admin.id)).toEqual(['a', 'c']);
    expect(filterClients(rows(), { query: '', status: 'TODOS', plan: 'TODOS', signup: '365' }, TODAY).map(r => r.admin.id)).toEqual(['a', 'c']);
  });
});

describe('sortClients', () => {
  it('ordena por nombre, MRR, salud, fecha de alta, próxima renovación o próxima acción; los vacíos al final', () => {
    const ids = (key: Parameters<typeof sortClients>[1], dir: 'asc' | 'desc' = 'asc') => sortClients(rows(), key, dir).map(r => r.admin.id);
    expect(ids('name')).toEqual(['c', 'a', 'b']);
    expect(ids('mrr', 'desc')).toEqual(['a', 'c', 'b']);
    expect(ids('salud')).toEqual(['b', 'c', 'a']);
    expect(ids('signupAt', 'desc')).toEqual(['a', 'c', 'b']);
    expect(ids('nextRenewal')).toEqual(['c', 'a', 'b']);
    expect(ids('nextRenewal', 'desc')).toEqual(['a', 'c', 'b']);
    expect(ids('nextAction')).toEqual(['b', 'a', 'c']);
  });
});

describe('riskClients', () => {
  it('lista los despachos «En riesgo» con menor salud primero', () => {
    expect(riskClients(rows()).map(r => r.admin.id)).toEqual(['b', 'c']);
  });
});

describe('isOpenLead', () => {
  it('solo las oportunidades por trabajar (Nuevo, Contactado, En prueba)', () => {
    const lead = (status: Lead['status']) => ({ status }) as Lead;
    expect(['nuevo', 'contactado', 'en_prueba', 'convertido', 'descartado'].map(s => isOpenLead(lead(s as Lead['status'])))).toEqual([true, true, true, false, false]);
  });
});
