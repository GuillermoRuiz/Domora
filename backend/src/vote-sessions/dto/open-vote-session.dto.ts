import {
  IsIn,
  IsInt,
  IsOptional,
  Min,
  MinLength,
  IsString,
} from 'class-validator';

export class OpenVoteSessionDto {
  /** Debe coincidir con el `id` de un AgendaItem dentro de Meeting.agenda. */
  @IsString()
  @MinLength(1)
  agendaItemId!: string;

  @IsInt()
  @Min(0)
  questionIndex!: number;

  /**
   * Solo para preguntas de juntas antiguas, cuya plantilla no fijó la mayoría: si la
   * pregunta ya la trae, se usa esa y este campo se ignora. Ver VoteTallyService para
   * el denominador exacto de cada tipo.
   */
  @IsOptional()
  @IsIn(['unanimidad', 'tresQuintos', 'mayoriaSimple'])
  majorityType?: 'unanimidad' | 'tresQuintos' | 'mayoriaSimple';
}
