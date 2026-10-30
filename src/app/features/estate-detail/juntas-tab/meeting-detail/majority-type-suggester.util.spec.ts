import { suggestMajorityType } from './majority-type-suggester.util';

describe('suggestMajorityType', () => {
  it('sugiere unanimidad si el punto menciona los estatutos', () => {
    expect(suggestMajorityType('Modificación de los estatutos de la comunidad', '').type).toBe('unanimidad');
  });

  it('sugiere unanimidad sin importar acentos ni mayúsculas', () => {
    expect(suggestMajorityType('MODIFICACION DEL TÍTULO CONSTITUTIVO', '').type).toBe('unanimidad');
  });

  it('sugiere mayoría simple si el punto menciona instalar un ascensor (art. 17.2 LPH, no 3/5)', () => {
    const result = suggestMajorityType('Instalación de ascensor en el portal 2', '');
    expect(result.type).toBe('mayoriaSimple');
    expect(result.reason).toContain('17.2');
  });

  it('sugiere mayoría simple si el punto menciona accesibilidad', () => {
    expect(suggestMajorityType('Obras de accesibilidad para personas con movilidad reducida', '').type).toBe('mayoriaSimple');
  });

  it('sugiere tres quintos si el punto menciona alteración de la estructura', () => {
    expect(suggestMajorityType('Alteración de la estructura del edificio', '').type).toBe('tresQuintos');
  });

  it('busca también en el título de la pregunta, no solo en el del punto', () => {
    expect(suggestMajorityType('Punto 3', '¿Aprobar la instalación de ascensor?').type).toBe('mayoriaSimple');
  });

  it('sin coincidencias, sugiere mayoría simple como régimen residual', () => {
    const result = suggestMajorityType('Aprobación de las cuentas del ejercicio 2025', '¿Aprobar?');
    expect(result.type).toBe('mayoriaSimple');
    expect(result.reason).toContain('régimen residual');
  });

  it('estatutos gana sobre ascensor si el punto menciona ambos (unanimidad tiene prioridad)', () => {
    expect(suggestMajorityType('Modificación de estatutos para permitir instalar ascensor', '').type).toBe('unanimidad');
  });

  it('siempre devuelve un motivo legible, nunca vacío', () => {
    const result = suggestMajorityType('Reparación de la caldera comunitaria', '');
    expect(result.reason.length).toBeGreaterThan(10);
  });
});
