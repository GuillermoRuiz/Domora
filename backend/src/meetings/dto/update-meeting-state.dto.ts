import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Todos los campos son opcionales porque cada acción del panel de
 * anfitrión ("Estoy listo", "Redirigir ahora", reprogramar, anunciar) solo
 * toca un subconjunto — `MeetingsService.updateState` aplica un merge, no
 * un reemplazo completo del estado.
 */
export class UpdateMeetingStateDto {
  @IsOptional()
  @IsBoolean()
  adminReady?: boolean;

  @IsOptional()
  @IsDateString()
  scheduledStartAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  announcement?: string;

  /**
   * Cuando llega en `true`, el service ignora su valor y escribe
   * `redirectRequestedAt = now()` — es un disparador, no un dato a
   * persistir tal cual (equivalente al `broadcast('redirect_now')` del
   * canal realtime original).
   */
  @IsOptional()
  @IsBoolean()
  redirectNow?: boolean;
}
