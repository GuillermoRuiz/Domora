import { contractDeadlineLabel, SUPPLIER_STATUS, type SupplierPanelContract } from './supplier-panel.models';

const contract = (daysLeft: number | null): SupplierPanelContract => ({
  id: 'c1', serviceType: 'Mantenimiento', status: 'Activo', endDate: null, daysLeft,
});

describe('contractDeadlineLabel', () => {
  it('sin contrato lo dice claramente', () => {
    expect(contractDeadlineLabel(null)).toBe('Sin contrato');
  });

  it('un contrato sin fecha de fin es indefinido', () => {
    expect(contractDeadlineLabel(contract(null))).toBe('Indefinido');
  });

  it('cuenta en días hasta ~2 meses y en meses a partir de ahí', () => {
    expect(contractDeadlineLabel(contract(0))).toBe('Vence hoy');
    expect(contractDeadlineLabel(contract(1))).toBe('Vence en 1 día');
    expect(contractDeadlineLabel(contract(12))).toBe('Vence en 12 días');
    expect(contractDeadlineLabel(contract(60))).toBe('Vence en 60 días');
    expect(contractDeadlineLabel(contract(210))).toBe('Vence en 7 meses');
  });

  it('un contrato vencido dice hace cuánto', () => {
    expect(contractDeadlineLabel(contract(-1))).toBe('Venció hace 1 día');
    expect(contractDeadlineLabel(contract(-25))).toBe('Venció hace 25 días');
    expect(contractDeadlineLabel(contract(-120))).toBe('Venció hace 4 meses');
  });
});

describe('SUPPLIER_STATUS', () => {
  it('define texto y tono para cada estado mostrado', () => {
    expect(Object.keys(SUPPLIER_STATUS).sort()).toEqual(['activo', 'baja', 'renovar', 'vencido']);
    expect(SUPPLIER_STATUS.vencido.tone).toBe('danger');
    expect(SUPPLIER_STATUS.renovar.tone).toBe('warning');
  });
});
