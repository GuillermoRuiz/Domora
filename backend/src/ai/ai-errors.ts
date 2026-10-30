/** Por qué no se puede llamar al modelo ahora mismo. Todas son condiciones PERMANENTES (no mejoran reintentando). */
export type AiUnavailableReason =
  | 'AI_DISABLED'
  | 'AI_NOT_CONFIGURED'
  | 'AI_REGION_UNAVAILABLE'
  /** La gestora no tiene contratada la capacidad (entitlement): no es un fallo, es otro producto. */
  | 'AI_NOT_ENTITLED';

/** La IA no está disponible: lo que iba a hacer Domora lo tiene que hacer una persona. */
export class AiUnavailableError extends Error {
  constructor(readonly reason: AiUnavailableReason) {
    super(reason);
    this.name = 'AiUnavailableError';
  }
}

const PERMANENT_CODES = new Set([
  'AI_DISABLED',
  'AI_NOT_CONFIGURED',
  'AI_REGION_UNAVAILABLE',
  'AI_NOT_ENTITLED',
  'AI_MODEL_MISSING',
  'AI_REFUSAL',
  'AI_RESPONSE_INVALID',
  'AI_INPUT_TOO_LARGE',
  'AI_BINARY_NOT_ALLOWED',
  'AI_PROVIDER_CATEGORY_NOT_ALLOWED',
  'AI_CANONICAL_NOT_ALLOWED',
  'AI_DUPLICATE_INCONSISTENT',
  'AI_APPOINTMENT_DATE_INVALID',
  'AI_DRAFT_MARKERS_INVALID',
  'UNSAFE_PROVIDER_DRAFT',
]);

/**
 * ¿Reintentar serviría de algo? Una salida que no cumple el esquema (con salida estructurada estricta)
 * o un 4xx de autenticación/petición no mejoran con el tiempo; un 429, un 5xx, un timeout o un fallo
 * de red sí. Lo permanente escala a una persona de inmediato en lugar de agotar los reintentos.
 */
export function isPermanentAiError(error: unknown): boolean {
  if (error instanceof AiUnavailableError) return true;
  const message = error instanceof Error ? error.message : '';
  if (PERMANENT_CODES.has(message)) return true;
  if (message.startsWith('AI_SCHEMA_INVALID')) return true;
  if (message.startsWith('AI_DEV_MOCK_UNSUPPORTED')) return true;
  const http = /^OPENAI_HTTP_(\d{3})$/.exec(message);
  if (http) {
    const status = Number(http[1]);
    return status >= 400 && status < 500 && ![408, 409, 429].includes(status);
  }
  return false;
}
