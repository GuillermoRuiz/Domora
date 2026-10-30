import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';

const SLOT = /^\d{2}:00$/;

export class CreateBookingDto {
  @IsUUID()
  amenityId!: string;

  @IsOptional()
  @IsUUID()
  propertyId?: string;

  @IsDateString()
  date!: string;

  /** Slot inicial 'HH:00' (inclusive). */
  @Matches(SLOT)
  startSlot!: string;

  /** Slot final 'HH:00' (exclusive — una reserva 10:00→12:00 ocupa 10 y 11). */
  @Matches(SLOT)
  endSlot!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  guests?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
