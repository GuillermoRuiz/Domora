import { IsISO8601 } from 'class-validator';

export class CollectRemesaDto {
  /** Fecha en que el banco abonó la remesa (AAAA-MM-DD). */
  @IsISO8601({ strict: true }, { message: 'La fecha de abono no es válida.' })
  date!: string;
}
