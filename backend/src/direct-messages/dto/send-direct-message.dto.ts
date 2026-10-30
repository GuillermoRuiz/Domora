import { IsString, IsUUID, MinLength, ValidateIf } from 'class-validator';

/**
 * Sirve tanto para el primer mensaje a alguien nuevo (recipientUserId) como
 * para seguir una conversación existente (conversationId) — el cliente no
 * necesita saber de antemano si ya existe la conversación.
 */
export class SendDirectMessageDto {
  @ValidateIf((o: SendDirectMessageDto) => !o.conversationId)
  @IsUUID()
  recipientUserId?: string;

  @ValidateIf((o: SendDirectMessageDto) => !o.recipientUserId)
  @IsUUID()
  conversationId?: string;

  @IsString()
  @MinLength(1)
  text!: string;
}
