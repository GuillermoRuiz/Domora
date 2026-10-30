import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Superficies de la app que usan el RAG: cada una mantiene su propio historial. */
export const ASSISTANT_CHANNELS = ['intelligence', 'domo'] as const;
export type AssistantChannel = (typeof ASSISTANT_CHANNELS)[number];

export class AskAssistantDto {
  @IsString()
  @MinLength(2)
  @MaxLength(5000)
  question!: string;

  @IsIn(ASSISTANT_CHANNELS)
  channel!: AssistantChannel;

  /** Finca sobre la que se pregunta. Debe estar entre las del usuario autenticado. */
  @IsOptional()
  @IsUUID()
  estateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  conversationId?: string;
}
