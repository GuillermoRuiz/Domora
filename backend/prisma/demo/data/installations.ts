import type { EstateKey } from './estates';

/**
 * Instalaciones (elementos comunes) del demo, por finca. Datos FICTICIOS; las
 * fechas son offsets en días respecto al ancla del seed (negativo = pasado).
 * Cada `inspections[]` es un ciclo real: `lastDoneDaysAgo` genera la revisión
 * ya realizada y `dueInDays` la siguiente pendiente (negativo = vencida).
 */
export interface InstallationInspectionSpec {
  /** Código del catálogo global de tipos de inspección. */
  typeCode: string;
  /** Hace cuántos días se hizo la última (null = nunca registrada). */
  lastDoneDaysAgo: number | null;
  /** En cuántos días vence la siguiente (negativo = ya vencida; null = sin pendiente). */
  dueInDays: number | null;
}

export interface InstallationIssueSpec {
  title: string;
  description: string;
  type: 'Averia' | 'Fuga' | 'Seguridad' | 'Otro';
  priority: 'Normal' | 'Urgente';
}

export interface InstallationSpec {
  name: string;
  category: string;
  location: string;
  manufacturer?: string;
  operationalStatus?: 'operativa' | 'en_mantenimiento' | 'fuera_de_servicio';
  /** Categoría del proveedor responsable (null = sin proveedor). */
  supplierCategory: string | null;
  inspections: InstallationInspectionSpec[];
  /** Incidencias abiertas vinculadas a esta instalación. */
  issues?: InstallationIssueSpec[];
}

/** Proveedores que la fase crea si la finca aún no tiene uno de esa categoría (F2 solo siembra tres por finca). */
export const INSTALLATION_SUPPLIERS: Record<string, { name: string; phone: string }> = {
  Ascensores: { name: 'Ascensores Levante Mantenimiento S.L.', phone: '96 341 09 77' },
  Calefacción: { name: 'Calefacciones Turia S.L.', phone: '96 337 21 40' },
  'Protección contra incendios': { name: 'Protección Integral Levante S.L.', phone: '96 350 18 36' },
  Automatismos: { name: 'Automatismos Puertas del Sur S.L.', phone: '96 366 02 91' },
  Seguridad: { name: 'Vigilancia y Seguridad Costa S.L.', phone: '96 322 47 15' },
  Piscinas: { name: 'Aquaservicios Levante S.L.', phone: '96 388 30 52' },
  Electricidad: { name: 'Instalaciones Eléctricas Mediterráneo S.L.', phone: '96 345 77 03' },
};

export const INSTALLATIONS: Record<EstateKey, InstallationSpec[]> = {
  // Colón 24 (40 unidades): el panel completo, con todos los estados posibles.
  val: [
    { name: 'Ascensor A', category: 'Ascensor', location: 'Portal 1', manufacturer: 'Orona', supplierCategory: 'Ascensores',
      inspections: [{ typeCode: 'ASCENSOR_ITC_AEM1', lastDoneDaysAgo: 225, dueInDays: 140 }] },
    { name: 'Ascensor B', category: 'Ascensor', location: 'Portal 2', manufacturer: 'Orona', supplierCategory: 'Ascensores',
      inspections: [{ typeCode: 'ASCENSOR_ITC_AEM1', lastDoneDaysAgo: 120, dueInDays: 240 }],
      issues: [{ title: 'Avería en ascensor B', description: 'El ascensor B se queda parado entre plantas de forma intermitente.', type: 'Averia', priority: 'Urgente' }] },
    { name: 'Caldera de calefacción', category: 'Calefacción / ACS', location: 'Sala de calderas', supplierCategory: 'Calefacción',
      inspections: [{ typeCode: 'RITE_SALA_CALDERAS', lastDoneDaysAgo: 360, dueInDays: 3 }] },
    { name: 'Portal automático', category: 'Accesos', location: 'Entrada principal', supplierCategory: 'Automatismos',
      inspections: [{ typeCode: 'PUERTAS_GARAJE', lastDoneDaysAgo: 200, dueInDays: 165 }] },
    { name: 'Sistema contra incendios', category: 'PCI', location: 'Zonas comunes', supplierCategory: 'Protección contra incendios',
      inspections: [{ typeCode: 'PCI_EXTINTORES', lastDoneDaysAgo: 180, dueInDays: 3 }],
      issues: [{ title: 'Extintor descargado en el rellano', description: 'El extintor de la planta 3 marca presión baja.', type: 'Seguridad', priority: 'Normal' }] },
    { name: 'CCTV', category: 'Videovigilancia', location: 'Zonas comunes', supplierCategory: 'Seguridad', inspections: [] },
    { name: 'Piscina', category: 'Piscina', location: 'Zona exterior', operationalStatus: 'en_mantenimiento', supplierCategory: 'Piscinas',
      inspections: [{ typeCode: 'LEGIONELLA_ACS', lastDoneDaysAgo: 40, dueInDays: 60 }],
      issues: [{ title: 'Depuradora de la piscina averiada', description: 'La depuradora no arranca; el agua está turbia.', type: 'Averia', priority: 'Normal' }] },
    { name: 'Grupo electrógeno', category: 'Electricidad', location: 'Cuarto técnico', supplierCategory: 'Electricidad',
      inspections: [{ typeCode: 'GRUPO_ELECTROGENO', lastDoneDaysAgo: 275, dueInDays: 90 }] },
    { name: 'Cubierta / tejado', category: 'Cubierta', location: 'Azotea', supplierCategory: null,
      inspections: [{ typeCode: 'ITE_IEE', lastDoneDaysAgo: 3650, dueInDays: -20 }],
      issues: [{ title: 'Goteras en la cubierta', description: 'Entra agua en el último piso cuando llueve; humedad en el falso techo del rellano.', type: 'Fuga', priority: 'Urgente' }] },
  ],
  mad: [
    { name: 'Ascensor', category: 'Ascensor', location: 'Portal', supplierCategory: 'Ascensores',
      inspections: [{ typeCode: 'ASCENSOR_ITC_AEM1', lastDoneDaysAgo: 300, dueInDays: 25 }] },
    { name: 'Caldera de gas', category: 'Calefacción / ACS', location: 'Sala de calderas', supplierCategory: 'Calefacción',
      inspections: [{ typeCode: 'RITE_SALA_CALDERAS', lastDoneDaysAgo: 200, dueInDays: 165 }] },
    { name: 'Extintores', category: 'PCI', location: 'Zonas comunes', supplierCategory: 'Protección contra incendios',
      inspections: [{ typeCode: 'PCI_EXTINTORES', lastDoneDaysAgo: 100, dueInDays: 80 }] },
    { name: 'Portero automático', category: 'Accesos', location: 'Entrada principal', supplierCategory: null, inspections: [] },
  ],
  valb: [
    { name: 'Ascensor', category: 'Ascensor', location: 'Portal', supplierCategory: 'Ascensores',
      inspections: [{ typeCode: 'ASCENSOR_ITC_AEM1', lastDoneDaysAgo: 50, dueInDays: 315 }] },
    { name: 'Extintores', category: 'PCI', location: 'Zonas comunes', supplierCategory: 'Protección contra incendios',
      inspections: [{ typeCode: 'PCI_EXTINTORES', lastDoneDaysAgo: 330, dueInDays: -10 }] },
  ],
};

/** Cifras que el seed debe cumplir (mismo criterio que `F2_FIGURES`). */
export const INSTALLATION_FIGURES = {
  assets: { val: 9, mad: 4, valb: 2 },
  /** Revisiones pendientes (la siguiente de cada ciclo). */
  pendingInspections: { val: 8, mad: 3, valb: 2 },
  /** Revisiones ya realizadas (historial). */
  doneInspections: { val: 8, mad: 3, valb: 2 },
  /** Incidencias abiertas vinculadas a una instalación. */
  linkedIssues: { val: 4, mad: 0, valb: 0 },
} as const;
