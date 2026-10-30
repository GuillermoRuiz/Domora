/**
 * Canales por los que entra un aviso (`IssueReport.channel`). Catálogo abierto
 * (varchar): un canal nuevo se añade aquí. Hoy solo el formulario tiene
 * entrada automática; la llamada se registra a mano y el email entrante de
 * propietarios queda preparado en el modelo, sin canal que lo alimente aún.
 */
export const ISSUE_REPORT_CHANNELS = ['form', 'call', 'email'] as const;
export type IssueReportChannel = (typeof ISSUE_REPORT_CHANNELS)[number];
