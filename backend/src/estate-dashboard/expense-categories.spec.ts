import { EXPENSE_CATEGORIES, expenseCategoryFor } from './expense-categories';

describe('expenseCategoryFor', () => {
  it.each([
    ['622', 'maintenance'],
    ['628', 'supplies'],
    ['640', 'staff'],
    ['642', 'staff'],
    ['645', 'staff'],
    ['625', 'insurance'],
    ['623', 'services'],
    ['629', 'services'],
  ])('%s -> %s', (code, key) => {
    expect(expenseCategoryFor(code)).toBe(key);
  });

  it.each(['621', '626', '631', '650', '669', '678', '6299', '999'])(
    '%s (sin categoría propia) cae en "Otros"',
    (code) => {
      expect(expenseCategoryFor(code)).toBe('other');
    },
  );

  it('toda categoría devuelta existe en el listado con su etiqueta', () => {
    const keys = EXPENSE_CATEGORIES.map((c) => c.key);
    for (const code of ['622', '628', '640', '625', '623', '999'])
      expect(keys).toContain(expenseCategoryFor(code));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
