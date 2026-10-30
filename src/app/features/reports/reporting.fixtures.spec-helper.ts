import { ReportCatalog, ReportDefinition, ReportResult } from '../../core/reporting.models';

export const TEST_REPORT: ReportDefinition = {
  key: 'trial-balance', category: 'finance', title: 'Balance de sumas y saldos',
  description: 'Consulta la situación contable.', icon: 'chart', scopeMode: 'single',
  periodMode: 'year', formats: ['pdf', 'xlsx'], status: 'available', sensitivity: 'financial', filters: [],
};
export const TEST_CATALOG: ReportCatalog = {
  categories: [{ key: 'finance', title: 'Contabilidad y finanzas', description: 'Contabilidad de comunidades.', icon: 'chart' }],
  reports: [TEST_REPORT, { ...TEST_REPORT, key: 'hidden', title: 'No disponible', status: 'disabled' }],
};
export const TEST_RESULT: ReportResult = {
  metadata: { reportKey: TEST_REPORT.key, title: TEST_REPORT.title, generatedAt: '2026-10-15T10:00:00Z',
    scope: { mode: 'selected', estates: [{ id: 'e1', name: 'Comunidad Sol' }] }, period: { fiscalYear: 2026 }, currency: 'EUR',
    warnings: ['Importes del ejercicio seleccionado.'], sensitivity: 'financial' },
  summary: [], sections: [{ columns: [{ key: 'name', header: 'Cuenta' }, { key: 'amount', header: 'Saldo', kind: 'money' }],
    rows: [{ name: 'Bancos', amount: 400 }] }], rowCount: 1,
};
