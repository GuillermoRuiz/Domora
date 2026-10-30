import { setupComponent, settle, ComponentHarness } from '../../core/testing/component-harness';
import { ReportFiltersComponent } from './report-filters.component';
import { TEST_REPORT } from './reporting.fixtures.spec-helper';
import { defaultReportInput, reportInputError, reportPeriodLabel, formatReportCell } from './reporting.utils';

describe('ReportFiltersComponent', () => {
  let h: ComponentHarness<ReportFiltersComponent>;
  beforeEach(() => {
    h = setupComponent(ReportFiltersComponent);
    h.component.definition = { ...TEST_REPORT, periodMode: 'comparison', filters: ['accountCode', 'propertyId', 'spendBasis', 'days'] };
    h.component.value = defaultReportInput(h.component.definition);
  });
  it('presenta periodos, cuenta y criterio real, sin cargar datos al editar', async () => {
    h.fixture.detectChanges(); await settle(); h.fixture.detectChanges();
    expect(h.el.querySelectorAll('input[type="date"]')).toHaveLength(4);
    expect(h.el.textContent).toContain('Comparar desde');
    expect(h.el.textContent).toContain('Código de cuenta');
    expect(h.el.textContent).toContain('Devengado');
    expect(h.el.querySelector('select')?.disabled).toBe(true);
    const emit = vi.fn(); h.component.valueChange.subscribe(emit);
    h.component.filter({ accountCode: '572' });
    expect(emit.mock.calls[0][0].filters.accountCode).toBe('572');
    expect(h.component.value.filters?.accountCode).toBeUndefined();
  });
  it('rechaza rangos invertidos, cuentas ausentes y selección vacía', () => {
    const definition = h.component.definition;
    const input = { ...defaultReportInput(definition), scopeMode: 'selected' as const, estateIds: ['e1'] };
    expect(reportInputError({ ...input, from: '2026-10-30', to: '2026-10-01' }, definition)).toContain('rango');
    expect(reportInputError(input, definition)).toContain('cuenta');
    expect(reportInputError({ ...input, estateIds: [] }, definition)).toContain('una comunidad');
    expect(reportInputError({ ...input, filters: { accountCode: '572' } }, definition)).toBe('');
  });
  it('muestra fechas de negocio sin aplicar un desplazamiento UTC', () => {
    expect(reportPeriodLabel({ from: '2026-01-01', to: '2026-01-31' })).toContain('1/1/2026');
    expect(reportPeriodLabel({ asOf: '2026-10-15' })).toBe('A fecha de 15/10/2026');
    expect(formatReportCell('2026-10-15', 'text', 'date')).toBe('15/10/2026');
    expect(formatReportCell('2026-10-15', 'text', 'ref')).toBe('2026-10-15');
    expect(formatReportCell(50000, 'int')).toBe('50.000');
    expect(formatReportCell(400, 'money')).toBe(400);
  });
  it('el ejecutivo parte de un mes completo y rechaza un mes parcial', () => {
    const definition = { ...TEST_REPORT, key: 'monthly-executive', periodMode: 'range' as const };
    const input = { ...defaultReportInput(definition), estateIds: ['e1'] };
    expect(input.from).toMatch(/-01$/);
    expect(reportInputError(input, definition)).toBe('');
    expect(reportInputError({ ...input, from: '2026-10-01', to: '2026-10-15' }, definition)).toContain('mes natural');
  });
  it('elige el mes anterior completo, incluso en el cambio de año', () => {
    vi.useFakeTimers();
    try {
      const definition = { ...TEST_REPORT, key: 'monthly-executive', periodMode: 'range' as const };
      vi.setSystemTime(new Date('2026-03-01T12:00:00Z'));
      expect(defaultReportInput(definition)).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
      expect(defaultReportInput(definition)).toMatchObject({ from: '2025-12-01', to: '2025-12-31' });
    } finally { vi.useRealTimers(); }
  });
  it('rechaza cortes futuros de los informes compuestos usando el día de Madrid', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-14T22:30:00Z'));
      const definition = { ...TEST_REPORT, key: 'meeting-finance', periodMode: 'range' as const };
      const input = { ...defaultReportInput(definition), estateIds: ['e1'], from: '2026-10-01' };
      expect(reportInputError({ ...input, to: '2026-10-15' }, definition)).toBe('');
      expect(reportInputError({ ...input, to: '2026-10-16' }, definition)).toContain('futura');
      expect(reportInputError({ ...input, to: '2026-10-31' }, { ...definition, key: 'monthly-executive' })).toContain('futura');
    } finally { vi.useRealTimers(); }
  });
});
