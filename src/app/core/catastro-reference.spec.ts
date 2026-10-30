import { isCatastroReference, isParcelReference, normalizeReference } from './catastro-reference';

describe('catastro-reference', () => {
  it('normalizeReference quita espacios (también internos) y pasa a mayúsculas', () => {
    expect(normalizeReference(' 2853604vk4725d ')).toBe('2853604VK4725D');
    expect(normalizeReference('2853604 VK4725D')).toBe('2853604VK4725D');
    expect(normalizeReference('')).toBe('');
  });

  it('isParcelReference: exactamente 14 caracteres alfanuméricos en mayúsculas', () => {
    expect(isParcelReference('2853604VK4725D')).toBe(true);
    expect(isParcelReference('2853604VK4725D0001YP')).toBe(false); // 20: es de una unidad
    expect(isParcelReference('2853604VK4725')).toBe(false); // 13
    expect(isParcelReference('2853604vk4725d')).toBe(false); // sin normalizar
    expect(isParcelReference('')).toBe(false);
  });

  it('isCatastroReference: 14, 18 o 20 caracteres, y nada intermedio', () => {
    expect(isCatastroReference('2853604VK4725D')).toBe(true);
    expect(isCatastroReference('2853604VK4725D0001')).toBe(true);
    expect(isCatastroReference('2853604VK4725D0001YP')).toBe(true);
    expect(isCatastroReference('2853604VK4725D00')).toBe(false); // 16
    expect(isCatastroReference('2853604VK4725D0001Y')).toBe(false); // 19
    expect(isCatastroReference('2853604VK4725D0001YP1')).toBe(false); // 21
  });
});
