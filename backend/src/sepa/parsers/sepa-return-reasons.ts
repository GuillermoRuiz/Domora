/**
 * Motivos de devolución y rechazo de adeudos SEPA (ISO 20022,
 * ExternalStatusReason1Code / ExternalReturnReason1Code), con el texto que
 * ve la gestora. Son los códigos que usa el EPC en el esquema de adeudos
 * directos (SDD Core y B2B).
 */
export const SEPA_RETURN_REASONS: Readonly<Record<string, string>> = {
  AC01: 'IBAN incorrecto',
  AC04: 'Cuenta cancelada',
  AC06: 'Cuenta bloqueada',
  AC13: 'La cuenta del deudor es de un consumidor (no admite B2B)',
  AG01: 'Operación no permitida en esta cuenta',
  AG02: 'Código de operación no válido',
  AM04: 'Fondos insuficientes',
  AM05: 'Adeudo duplicado',
  BE05: 'Acreedor no reconocido',
  CNOR: 'El banco del acreedor no está registrado',
  DNOR: 'El banco del deudor no está registrado',
  FF01: 'Formato del fichero no válido',
  MD01: 'Sin mandato válido',
  MD02: 'Faltan datos obligatorios del mandato',
  MD06: 'Devolución solicitada por el deudor',
  MD07: 'Deudor fallecido',
  MS02: 'Motivo no especificado por el deudor',
  MS03: 'Motivo no especificado por el banco',
  RC01: 'BIC incorrecto',
  RR01: 'Falta la cuenta o la identificación del deudor',
  RR02: 'Falta el nombre o la dirección del deudor',
  RR03: 'Falta el nombre o la dirección del acreedor',
  RR04: 'Motivo regulatorio',
  SL01: 'Servicio específico del banco del deudor',
};

/** Texto del motivo; si el código no es de la lista, se muestra tal cual. */
export function returnReasonText(
  code: string | null | undefined,
): string | null {
  if (!code) return null;
  return SEPA_RETURN_REASONS[code] ?? `Motivo ${code}`;
}
