import { SUPPLIER_CATEGORIES, SUPPLIER_CATEGORY_OPTIONS, supplierCategoryFor } from './supplier-categories';

describe('supplierCategoryFor', () => {
  it('reconoce el texto exacto de cada categoría del catálogo, sin importar tildes ni mayúsculas', () => {
    for (const category of SUPPLIER_CATEGORIES) expect(supplierCategoryFor(category.label).key).toBe(category.key);
    expect(supplierCategoryFor('FONTANERIA').key).toBe('fontaneria');
  });

  it('reconoce las categorías que siembra la demo', () => {
    expect(supplierCategoryFor('Protección contra incendios').key).toBe('incendios');
    expect(supplierCategoryFor('Piscinas').key).toBe('piscinas');
    expect(supplierCategoryFor('Seguridad').key).toBe('seguridad');
    expect(supplierCategoryFor('Calefacción').key).toBe('calefaccion');
    expect(supplierCategoryFor('Seguros').icon).toBe('shield');
  });

  it('reconoce textos libres por sus palabras clave, y solo palabras completas', () => {
    expect(supplierCategoryFor('Correduría de seguros').key).toBe('seguros');
    expect(supplierCategoryFor('Impermeabilización de tejados').key).toBe('cubiertas');
    expect(supplierCategoryFor('Gasolinera').key).toBe('otro'); // contiene "gas" pero no es "gas"
  });

  it('un texto desconocido, vacío o nulo cae en "Otro"', () => {
    for (const text of ['Algo raro', '', '   ', null, undefined]) expect(supplierCategoryFor(text).key).toBe('otro');
  });

  it('el catálogo no repite claves ni etiquetas y "Otro" va el último', () => {
    const keys = SUPPLIER_CATEGORIES.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(SUPPLIER_CATEGORIES.map(c => c.label)).size).toBe(keys.length);
    expect(keys[keys.length - 1]).toBe('otro');
    expect(SUPPLIER_CATEGORY_OPTIONS).toHaveLength(SUPPLIER_CATEGORIES.length);
  });
});
