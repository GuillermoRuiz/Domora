import {
  ArrayNotEmpty,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAmenityDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  bg?: string;

  @IsInt()
  @Min(1)
  maxHours!: number;

  /** Franjas horarias reservables 'HH:00', mismas cada día (sin distinción por día de la semana). */
  @ArrayNotEmpty()
  @IsIn(
    [
      '00:00',
      '01:00',
      '02:00',
      '03:00',
      '04:00',
      '05:00',
      '06:00',
      '07:00',
      '08:00',
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
      '17:00',
      '18:00',
      '19:00',
      '20:00',
      '21:00',
      '22:00',
      '23:00',
    ],
    { each: true },
  )
  slots!: string[];

  @IsOptional()
  @IsString()
  rules?: string;

  @IsInt()
  @Min(1)
  capacity!: number;

  @IsOptional()
  @IsBoolean()
  seasonal?: boolean;

  @IsOptional()
  @IsString()
  seasonLabel?: string;
}
