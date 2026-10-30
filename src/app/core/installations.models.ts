/** Lo que el gestor declara a mano de una instalación. */
export type AssetOperationalStatus = 'operativa' | 'en_mantenimiento' | 'fuera_de_servicio';

/**
 * Lo que se muestra: lo declarado, o — si está operativa — lo que dice su
 * próxima revisión (próxima ≤ 30 días, o vencida). El backend lo deriva.
 */
export type InstallationDisplayStatus = AssetOperationalStatus | 'revision_proxima' | 'revision_vencida';

/** Una fila del panel de Instalaciones (`GET estates/:id/installations`). */
export interface Installation {
  id: string;
  name: string;
  /** Texto guardado: puede ser uno del catálogo (`installation-types.ts`) o libre. */
  category: string;
  location: string | null;
  manufacturer: string | null;
  serialNumber: string | null;
  notes: string | null;
  operationalStatus: AssetOperationalStatus;
  displayStatus: InstallationDisplayStatus;
  supplier: { id: string; name: string } | null;
  /** AAAA-MM-DD de la última revisión hecha. */
  lastReviewDate: string | null;
  /** AAAA-MM-DD de la próxima pendiente. */
  nextReviewDate: string | null;
  /** Negativo si ya venció. */
  nextReviewDaysLeft: number | null;
  /** Incidencias activas vinculadas. */
  openIssues: number;
}

/** Una revisión pendiente del calendario (vencida, o dentro de los próximos ~6 meses). */
export interface UpcomingReview {
  inspectionId: string;
  assetId: string;
  assetName: string;
  category: string;
  location: string | null;
  /** Nombre del tipo de inspección: "Revisión anual obligatoria". */
  title: string;
  dueDate: string;
  daysLeft: number;
  overdue: boolean;
  supplierName: string | null;
}

export interface EstateInstallations {
  items: Installation[];
  upcoming: UpcomingReview[];
}

/** Alta y edición: lo que se envía (en edición, `null` borra un campo opcional). */
export interface InstallationInput {
  name: string;
  category: string;
  location?: string | null;
  manufacturer?: string | null;
  serialNumber?: string | null;
  notes?: string | null;
  operationalStatus?: AssetOperationalStatus;
  supplierId?: string | null;
}

export type InstallationTone = 'positive' | 'warning' | 'danger' | 'info' | 'neutral';

export const INSTALLATION_STATUS: Record<InstallationDisplayStatus, { text: string; tone: InstallationTone }> = {
  operativa: { text: 'Operativa', tone: 'positive' },
  revision_proxima: { text: 'Revisión próxima', tone: 'warning' },
  revision_vencida: { text: 'Revisión vencida', tone: 'danger' },
  en_mantenimiento: { text: 'En mantenimiento', tone: 'info' },
  fuera_de_servicio: { text: 'Fuera de servicio', tone: 'neutral' },
};

/** Los estados que el gestor puede declarar (los de revisión se derivan, no se eligen). */
export const OPERATIONAL_STATUS_OPTIONS: { value: AssetOperationalStatus; label: string }[] = [
  { value: 'operativa', label: 'Operativa' },
  { value: 'en_mantenimiento', label: 'En mantenimiento' },
  { value: 'fuera_de_servicio', label: 'Fuera de servicio' },
];

/**
 * "en 3 días", "en 2 meses", "hace 20 días", "hoy"; "" si no hay fecha. A
 * partir de ~2 meses cuenta en meses (30 días = 1 mes) para que la columna
 * se lea de un vistazo.
 */
export function reviewDeadlineLabel(daysLeft: number | null): string {
  if (daysLeft === null) return '';
  if (daysLeft === 0) return 'hoy';
  const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (daysLeft < 0) {
    const ago = -daysLeft;
    return ago <= 60 ? `hace ${unit(ago, 'día', 'días')}` : `hace ${unit(Math.round(ago / 30), 'mes', 'meses')}`;
  }
  return daysLeft <= 60 ? `en ${unit(daysLeft, 'día', 'días')}` : `en ${unit(Math.round(daysLeft / 30), 'mes', 'meses')}`;
}
