import type { AccountRole } from '../../prisma/client';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/** Destinos admitidos para la aplicación del resultado (D15) — la devolución por coeficiente queda fuera de alcance. */
export const RESULT_APPLICATION_TARGETS = ['retained', 'reserve_fund'] as const;
export type ResultApplicationTarget =
  (typeof RESULT_APPLICATION_TARGETS)[number];

/** Cuerpo de `POST estates/:estateId/fiscal-years/:year/reopen`. */
export class ReopenFiscalYearDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

/** Cuerpo de `POST estates/:estateId/fiscal-years/:year/apply-result`. */
export class ApplyResultDto {
  @IsIn(RESULT_APPLICATION_TARGETS)
  target!: Extract<AccountRole, ResultApplicationTarget>;
}
