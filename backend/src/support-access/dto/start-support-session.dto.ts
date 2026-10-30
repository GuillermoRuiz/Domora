import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class StartSupportSessionDto {
  @IsUUID()
  administratorId!: string;

  /** Why staff needs to operate on the despacho; required for accountability. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'Indica el motivo de la sesión de soporte.' })
  @MaxLength(500)
  reason!: string;

  /** Ticket or request the session is tied to, when there is one. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  ticketRef?: string;
}
