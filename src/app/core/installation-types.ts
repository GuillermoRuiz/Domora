/**
 * Catálogo de tipos de instalación (elementos comunes). En la base de datos
 * `Asset.category` es texto libre; este catálogo es lo que la interfaz ofrece
 * al dar de alta y lo que decide el icono y el filtro "Tipo". Un texto que no
 * encaja con ninguno cae en "Otro" sin perder lo que escribió el gestor.
 */
export interface InstallationType {
  key: string;
  /** Texto que se guarda en `Asset.category` al elegirlo. */
  label: string;
  icon: string;
  /** Palabras que lo identifican en textos libres (sin tildes y en minúsculas). */
  aliases: string[];
}

export const INSTALLATION_TYPES: InstallationType[] = [
  { key: 'ascensor', label: 'Ascensor', icon: 'elevator', aliases: ['ascensor', 'ascensores', 'elevador', 'montacoches', 'salvaescaleras'] },
  { key: 'calefaccion', label: 'Calefacción / ACS', icon: 'flame', aliases: ['calefaccion', 'acs', 'caldera', 'calderas', 'rite', 'climatizacion', 'gas'] },
  { key: 'accesos', label: 'Accesos', icon: 'door', aliases: ['acceso', 'accesos', 'portal', 'puerta', 'puertas', 'garaje', 'portero', 'barrera'] },
  { key: 'pci', label: 'PCI', icon: 'extinguisher', aliases: ['pci', 'incendio', 'incendios', 'extintor', 'extintores', 'bie'] },
  { key: 'videovigilancia', label: 'Videovigilancia', icon: 'camera', aliases: ['videovigilancia', 'cctv', 'camara', 'camaras', 'vigilancia'] },
  { key: 'piscina', label: 'Piscina', icon: 'pool', aliases: ['piscina', 'piscinas', 'depuradora'] },
  { key: 'electricidad', label: 'Electricidad', icon: 'bolt', aliases: ['electricidad', 'electrica', 'electrogeno', 'cuadro', 'alumbrado'] },
  { key: 'cubierta', label: 'Cubierta / tejado', icon: 'roof', aliases: ['cubierta', 'tejado', 'azotea', 'terraza'] },
  { key: 'fachada', label: 'Fachada', icon: 'building', aliases: ['fachada', 'balcones', 'medianera'] },
  { key: 'estructura', label: 'Estructura', icon: 'layers', aliases: ['estructura', 'cimentacion', 'forjado'] },
  { key: 'otro', label: 'Otro', icon: 'wrench', aliases: [] },
];

const OTHER = INSTALLATION_TYPES[INSTALLATION_TYPES.length - 1];

const normalize = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Tipo del catálogo al que corresponde un texto de categoría ("Otro" si ninguno). */
export function installationTypeFor(category: string | null | undefined): InstallationType {
  const text = normalize(category ?? '');
  if (!text) return OTHER;
  const exact = INSTALLATION_TYPES.find(t => normalize(t.label) === text);
  if (exact) return exact;
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  return INSTALLATION_TYPES.find(t => t.aliases.some(alias => words.includes(alias))) ?? OTHER;
}

/** Opciones para el filtro "Tipo" y para el alta (todas menos nada: "Otro" va al final). */
export const INSTALLATION_TYPE_OPTIONS: { key: string; label: string }[] = INSTALLATION_TYPES.map(({ key, label }) => ({ key, label }));
