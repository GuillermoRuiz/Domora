/**
 * Campos que nunca salen en una respuesta de la API. Usar siempre con `omit` al
 * devolver (o anidar) un `User` o un `Estate` en lugar de `include: { x: true }`.
 */

/** Credenciales de acceso de un usuario: hash de contraseña y secreto TOTP del 2FA. */
export const USER_SECRETS_OMIT = {
  passwordHash: true,
  totpSecret: true,
} as const;

/**
 * Los datos SEPA salen solo por GET .../sepa-billing (descifrados ahí mismo) y la
 * clave de almacenamiento de la foto no sale nunca (la interfaz usa
 * `photoUpdatedAt` y GET .../photo).
 */
/** Internal data of the managing company: never sent to owners (role C). */
export const ESTATE_MANAGER_ONLY_FIELDS = ['notes', 'internalRef'] as const;

export function withoutManagerOnlyFields<T extends object>(
  estate: T,
  role: string,
): T {
  if (role !== 'C') return estate;
  const copy = { ...estate } as Record<string, unknown>;
  for (const field of ESTATE_MANAGER_ONLY_FIELDS) delete copy[field];
  return copy as T;
}

export const ESTATE_PRIVATE_OMIT = {
  creditorId: true,
  creditorIban: true,
  creditorBic: true,
  creditorPostalAddress: true,
  photoKey: true,
  photoContentType: true,
} as const;
