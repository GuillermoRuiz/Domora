/**
 * «Datos generales» de cada finca demo (F6). Coordenadas aproximadas de cada
 * dirección ficticia: el entorno demo no consulta el Catastro ni Nominatim.
 */
export interface GeneralDataSpec {
  yearBuilt: number;
  mainUse: 'Residencial' | 'Mixto' | 'Comercial';
  internalRef: string;
  notes: string;
  parcelAreaM2: number;
  latitude: number;
  longitude: number;
  /** Tipos de documento esencial que la finca NO tiene (se ve «Sin subir»). */
  missingDocuments?: readonly string[];
  /** Vicepresidentes que se nombran (1 por defecto). */
  vicePresidents?: number;
}

const TAX_REGIME = 'Entidad en régimen de atribución de rentas';

export const GENERAL_TAX_REGIME = TAX_REGIME;

/** Por nombre de finca: las 3 de F1 y las 7 de la cartera (F4). */
export const GENERAL_DATA: Record<string, GeneralDataSpec> = {
  'Comunidad de Propietarios Colón 24': {
    yearBuilt: 1968, mainUse: 'Mixto', internalRef: 'FIN-0001', parcelAreaM2: 612, latitude: 39.469700, longitude: -0.373500,
    notes: 'Locales comerciales en planta baja con acceso independiente. Revisar en 2027 la impermeabilización del patio de luces.',
  },
  'Comunidad de Propietarios Ponzano 45': {
    yearBuilt: 1975, mainUse: 'Residencial', internalRef: 'FIN-0002', parcelAreaM2: 540, latitude: 40.442500, longitude: -3.701200, vicePresidents: 2,
    notes: 'Comunidad con buen grado de participación. Se recomienda estudiar la renovación del ascensor según el informe técnico.',
  },
  'Comunidad de Propietarios Cuba 18': {
    yearBuilt: 1959, mainUse: 'Residencial', internalRef: 'FIN-0003', parcelAreaM2: 318, latitude: 39.462200, longitude: -0.378900,
    notes: 'Edificio sin ascensor. Cobro de cuotas por recibo manual (sin domiciliación SEPA).',
  },
  'Residencial Los Olivos': {
    yearBuilt: 2004, mainUse: 'Residencial', internalRef: 'FIN-0004', parcelAreaM2: 1248, latitude: 40.419500, longitude: -3.709000,
    notes: 'Portero físico de lunes a viernes por la mañana.',
  },
  'Edificio Mediterráneo': {
    yearBuilt: 1988, mainUse: 'Residencial', internalRef: 'FIN-0005', parcelAreaM2: 870, latitude: 39.460500, longitude: -0.333000,
    notes: 'Ascensor fuera de servicio pendiente de reparación.',
  },
  'Residencial Parque Norte': {
    yearBuilt: 2011, mainUse: 'Residencial', internalRef: 'FIN-0006', parcelAreaM2: 2310, latitude: 40.479000, longitude: -3.701000,
    notes: 'Dos portales con ascensor y garaje común.',
  },
  'Comunidad Sol y Mar': {
    yearBuilt: 1979, mainUse: 'Residencial', internalRef: 'FIN-0007', parcelAreaM2: 960, latitude: 36.718000, longitude: -4.405000,
    notes: 'Piscina comunitaria en azotea: temporada de baño de junio a septiembre.',
  },
  'Edificio Vallehermoso': {
    yearBuilt: 1965, mainUse: 'Mixto', internalRef: 'FIN-0008', parcelAreaM2: 455, latitude: 40.444000, longitude: -3.710500,
    notes: 'Grupo electrógeno en el sótano para los servicios comunes.',
  },
  'Comunidad Castellana 14': {
    yearBuilt: 1992, mainUse: 'Residencial', internalRef: 'FIN-0009', parcelAreaM2: 705, latitude: 40.429000, longitude: -3.688000,
    notes: 'Fachada catalogada: cualquier obra exterior requiere licencia municipal.',
  },
  'Urbanización Las Palmeras': {
    yearBuilt: 1998, mainUse: 'Residencial', internalRef: 'FIN-0010', parcelAreaM2: 4120, latitude: 38.346000, longitude: -0.490000,
    missingDocuments: ['IBI'],
    notes: 'Urbanización con garaje comunitario y zonas ajardinadas.',
  },
};
