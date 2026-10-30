import { validatePropertyRow } from './property-import.validator';

describe('validatePropertyRow', () => {
  it('acepta una fila completa y válida', () => {
    const result = validatePropertyRow(
      { ref: 'A-101', type: 'Piso', participationQuota: '2,5', floor: '1', door: 'A', quotaMonthly: '45,00' },
      2,
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toEqual({
      ref: 'A-101',
      type: 'Piso',
      participationQuota: 2.5,
      floor: '1',
      door: 'A',
      quotaMonthly: 45,
    });
  });

  it('reconoce el tipo sin distinguir mayúsculas', () => {
    const result = validatePropertyRow({ ref: 'A-101', type: 'parking' }, 2);
    expect(result.data?.type).toBe('Parking');
  });

  it('tipo no reconocido: se importa como "Piso" con aviso, no bloquea', () => {
    const result = validatePropertyRow({ ref: 'A-101', type: 'Ático dúplex' }, 2);
    expect(result.ok).toBe(true);
    expect(result.data?.type).toBe('Piso');
    expect(result.warnings.some((w) => w.includes('no reconocido'))).toBe(true);
  });

  it('sin tipo en el origen: se importa como "Piso" con aviso, no bloquea', () => {
    const result = validatePropertyRow({ ref: 'A-101' }, 2);
    expect(result.ok).toBe(true);
    expect(result.data?.type).toBe('Piso');
    expect(result.warnings.some((w) => w.includes('Sin tipo de unidad'))).toBe(true);
  });

  it('sin referencia: avisa pero no bloquea (se generará una automática más adelante)', () => {
    const result = validatePropertyRow({ participationQuota: '10' }, 2);
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('Sin referencia de unidad — se generará una automáticamente.');
  });

  it('sin coeficiente: avisa pero no bloquea', () => {
    const result = validatePropertyRow({ ref: 'A-101' }, 2);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('coeficiente'))).toBe(true);
  });

  it('coeficiente no numérico: bloquea con error', () => {
    const result = validatePropertyRow({ ref: 'A-101', participationQuota: 'no-es-numero' }, 2);
    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.errors[0]).toContain('Coeficiente de participación inválido');
  });

  it('coeficiente fuera de rango (>100): bloquea con error', () => {
    const result = validatePropertyRow({ ref: 'A-101', participationQuota: '150' }, 2);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('fuera de rango');
  });

  it('coeficiente negativo: bloquea con error', () => {
    const result = validatePropertyRow({ ref: 'A-101', participationQuota: '-5' }, 2);
    expect(result.ok).toBe(false);
  });

  it('formato español con miles ("1.234,56") se interpreta correctamente en la cuota', () => {
    const result = validatePropertyRow({ ref: 'A-101', quotaMonthly: '1.234,56' }, 2);
    expect(result.ok).toBe(true);
    expect(result.data?.quotaMonthly).toBe(1234.56);
  });

  it('cuota mensual negativa: bloquea con error', () => {
    const result = validatePropertyRow({ ref: 'A-101', quotaMonthly: '-10' }, 2);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('Cuota mensual negativa');
  });

  it('conserva el rowNumber recibido, para poder señalar la fila exacta en la UI', () => {
    const result = validatePropertyRow({ ref: 'A-101' }, 47);
    expect(result.rowNumber).toBe(47);
  });
});
