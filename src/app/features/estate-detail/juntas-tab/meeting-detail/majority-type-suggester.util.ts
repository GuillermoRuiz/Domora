import { VoteMajorityType } from '../../../../core/models';

export const MAJORITY_TYPE_OPTIONS: { value: VoteMajorityType; label: string; legend: string }[] = [
  { value: 'mayoriaSimple', label: 'Mayoría simple', legend: '>50% de propietarios y cuotas PRESENTES — reparaciones ordinarias, elección de cargos (art. 17.7 LPH), y también accesibilidad/ascensor (art. 17.2 LPH).' },
  { value: 'tresQuintos', label: 'Tres quintas partes (3/5)', legend: '≥60% del TOTAL de propietarios y cuotas de la finca (art. 17.3/17.4 LPH) — nuevos servicios comunes, alteración de la estructura, segregación/división de fincas.' },
  { value: 'unanimidad', label: 'Unanimidad', legend: '100% del TOTAL de propietarios y cuotas de la finca — modificar el título constitutivo o los estatutos.' },
];

export interface MajoritySuggestion {
  type: VoteMajorityType;
  /** Motivo mostrado a la gestora — nunca le quita la decisión final, solo la orienta. */
  reason: string;
}

interface Trigger {
  type: VoteMajorityType;
  /** Minúsculas, sin acentos — comparado contra el texto ya normalizado. */
  keywords: string[];
  reason: string;
}

/**
 * Heurístico de palabras clave, no un clasificador de verdad (sin NLP, sin
 * modelo) — a propósito: la gestora sigue eligiendo el tipo de mayoría en
 * `meeting-detail`, esto solo pre-selecciona una sugerencia razonable y
 * explica por qué, para reducir errores sin quitarle la decisión final.
 * Ver plan Fase 2 — backlog, punto 5.
 *
 * Orden de prioridad: unanimidad > mayoría simple explícita (accesibilidad)
 * > tres quintos > mayoría simple (residual, art. 17.7 LPH) — un punto que
 * mencione "estatutos" Y "ascensor" a la vez es, casi siempre, una
 * modificación de estatutos con el ascensor como excusa, así que unanimidad
 * gana.
 *
 * Las obras de accesibilidad (ascensor, barreras arquitectónicas) NO son
 * 3/5: el art. 17.2 LPH las rebajó a mayoría simple en la reforma de 2021/22
 * — verificado contra el texto consolidado del BOE. Antes estaban mal
 * etiquetadas aquí como tresQuintos (bug real, corregido); el 3/5 real
 * (art. 17.3/17.4 LPH) es para alteración de la estructura del edificio,
 * división/segregación de fincas y nuevos servicios comunes tipo portería.
 */
const TRIGGERS: Trigger[] = [
  {
    type: 'unanimidad',
    keywords: ['estatuto', 'titulo constitutivo', 'modificar el titulo'],
    reason: 'menciona los estatutos o el título constitutivo de la finca (art. 17.6 LPH).',
  },
  {
    type: 'mayoriaSimple',
    keywords: ['ascensor', 'accesibilidad', 'barrera arquitectonica', 'barreras arquitectonicas'],
    reason: 'menciona obras de accesibilidad o ascensor — desde la reforma de la LPH solo exigen mayoría simple, no 3/5 (art. 17.2 LPH).',
  },
  {
    type: 'tresQuintos',
    keywords: [
      'estructura del edificio', 'fabrica del edificio', 'alteracion de la estructura',
      'segregacion', 'agregacion de piso', 'division de piso', 'division de local',
      'nuevo servicio comun', 'servicio comun de interes general',
    ],
    reason: 'menciona alteración de la estructura del edificio, división/segregación de fincas o un nuevo servicio común (art. 17.3/17.4 LPH).',
  },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // quita acentos — "título" -> "titulo"
}

/**
 * Nunca devuelve `null`: si no hay coincidencia, sugiere `mayoriaSimple`
 * explícitamente como régimen residual — es lo que dice el art. 17.7 LPH
 * para "los demás acuerdos", no una ausencia de sugerencia.
 */
export function suggestMajorityType(agendaTitle: string, questionTitle: string): MajoritySuggestion {
  const haystack = normalize(`${agendaTitle} ${questionTitle}`);
  for (const trigger of TRIGGERS) {
    if (trigger.keywords.some((k) => haystack.includes(k))) {
      return { type: trigger.type, reason: trigger.reason };
    }
  }
  return {
    type: 'mayoriaSimple',
    reason: 'no se detectaron palabras clave de 3/5 o unanimidad — la mayoría simple es el régimen residual (art. 17.7 LPH).',
  };
}
