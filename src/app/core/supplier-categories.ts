/**
 * Catálogo de categorías de proveedor. En la base de datos `Supplier.category`
 * es texto libre; este catálogo es lo que la interfaz ofrece al dar de alta y
 * lo que decide el icono de la tabla. Un texto que no encaja con ninguna cae
 * en "Otro" sin perder lo que escribió el gestor.
 */
export interface SupplierCategory {
  key: string;
  /** Texto que se guarda en `Supplier.category` al elegirla. */
  label: string;
  icon: string;
  /** Palabras que la identifican en textos libres (sin tildes y en minúsculas). */
  aliases: string[];
}

export const SUPPLIER_CATEGORIES: SupplierCategory[] = [
  { key: 'ascensores', label: 'Ascensores', icon: 'elevator', aliases: ['ascensor', 'ascensores', 'elevador'] },
  { key: 'fontaneria', label: 'Fontanería', icon: 'droplet', aliases: ['fontaneria', 'fontanero', 'agua', 'saneamiento'] },
  { key: 'limpieza', label: 'Limpieza', icon: 'sparkles', aliases: ['limpieza', 'limpiezas'] },
  { key: 'jardineria', label: 'Jardinería', icon: 'leaf', aliases: ['jardineria', 'jardin', 'jardines', 'paisajismo'] },
  { key: 'seguros', label: 'Seguros', icon: 'shield', aliases: ['seguro', 'seguros', 'correduria', 'aseguradora'] },
  { key: 'calefaccion', label: 'Calefacción', icon: 'flame', aliases: ['calefaccion', 'caldera', 'calderas', 'climatizacion', 'gas'] },
  { key: 'electricidad', label: 'Electricidad', icon: 'bolt', aliases: ['electricidad', 'electrica', 'electricista', 'iluminacion'] },
  { key: 'incendios', label: 'Protección contra incendios', icon: 'extinguisher', aliases: ['incendio', 'incendios', 'pci', 'extintores', 'proteccion'] },
  { key: 'piscinas', label: 'Piscinas', icon: 'pool', aliases: ['piscina', 'piscinas', 'depuradora'] },
  { key: 'seguridad', label: 'Seguridad', icon: 'camera', aliases: ['seguridad', 'vigilancia', 'cctv', 'alarma', 'alarmas'] },
  { key: 'automatismos', label: 'Automatismos', icon: 'door', aliases: ['automatismos', 'puertas', 'portales', 'garaje'] },
  { key: 'cubiertas', label: 'Cubiertas y fachadas', icon: 'roof', aliases: ['cubierta', 'cubiertas', 'tejado', 'tejados', 'fachada', 'fachadas', 'impermeabilizacion'] },
  { key: 'otro', label: 'Otro', icon: 'wrench', aliases: [] },
];

const OTHER = SUPPLIER_CATEGORIES[SUPPLIER_CATEGORIES.length - 1];

const normalize = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Categoría del catálogo a la que corresponde un texto ("Otro" si ninguna). */
export function supplierCategoryFor(category: string | null | undefined): SupplierCategory {
  const text = normalize(category ?? '');
  if (!text) return OTHER;
  const exact = SUPPLIER_CATEGORIES.find(c => normalize(c.label) === text);
  if (exact) return exact;
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  return SUPPLIER_CATEGORIES.find(c => c.aliases.some(alias => words.includes(alias))) ?? OTHER;
}

/** Opciones para el alta de proveedor ("Otro" va al final). */
export const SUPPLIER_CATEGORY_OPTIONS: { key: string; label: string }[] = SUPPLIER_CATEGORIES.map(({ key, label }) => ({ key, label }));
