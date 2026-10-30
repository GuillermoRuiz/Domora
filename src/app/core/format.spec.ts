import { formatQuota } from './format';

describe('formatQuota', () => {
  it('formatea con coma decimal, dos decimales y el símbolo %', () => {
    expect(formatQuota(2.5)).toBe('2,50 %');
    expect(formatQuota(100)).toBe('100,00 %');
    expect(formatQuota(0)).toBe('0,00 %');
  });

  it('un coeficiente sin informar se muestra como "—" (no como 0)', () => {
    expect(formatQuota(null)).toBe('—');
    expect(formatQuota(undefined)).toBe('—');
  });
});
