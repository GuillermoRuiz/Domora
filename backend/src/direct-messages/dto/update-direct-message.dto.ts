import { IsString, MaxLength } from 'class-validator';

/** Nuevo texto de un mensaje propio. Puede venir vacío solo si el mensaje tiene adjuntos (se comprueba en el servicio). */
export class UpdateDirectMessageDto {
  @IsString()
  @MaxLength(10000)
  text!: string;
}
