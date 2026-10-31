import { ValidateIf } from 'class-validator';

/**
 * Para campos de un PATCH que son obligatorios en base de datos: se pueden omitir (`undefined`),
 * pero un `null` explícito falla la validación (400). `@IsOptional()` los dejaría pasar y los
 * servicios, que solo comprueban `!== undefined`, mandarían el `null` a Prisma (500 o una fecha 1970).
 * Se combina con los validadores del tipo (`@IsString()`, `@IsIn(...)`…).
 */
export const OptionalButNotNull = () =>
  ValidateIf((_object, value) => value !== undefined);
