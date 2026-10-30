import { IsString, MaxLength } from 'class-validator';

/** Comentarios del administrador sobre un punto del orden del día; salen en el acta. Vacío = borrarlos. */
export class UpdateAgendaItemCommentsDto {
  @IsString()
  @MaxLength(2000)
  comments!: string;
}
