import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Consulta de las unidades de un inmueble: por referencia catastral (14, 18
 * o 20 caracteres — siempre se lee la parcela entera) o por dirección. Los
 * campos de dirección solo son obligatorios si no hay referencia.
 */
export class LookupCatastroDto {
  @IsOptional()
  @Matches(/^[0-9A-Za-z]{14}([0-9A-Za-z]{4}([0-9A-Za-z]{2})?)?$/, {
    message:
      'La referencia catastral debe tener 14, 18 o 20 caracteres alfanuméricos.',
  })
  refCat?: string;

  @ValidateIf((o: LookupCatastroDto) => !o.refCat)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  provincia?: string;

  @ValidateIf((o: LookupCatastroDto) => !o.refCat)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  municipio?: string;

  @ValidateIf((o: LookupCatastroDto) => !o.refCat)
  @IsString()
  @MinLength(1)
  @MaxLength(5)
  sigla?: string;

  @ValidateIf((o: LookupCatastroDto) => !o.refCat)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  calle?: string;

  @ValidateIf((o: LookupCatastroDto) => !o.refCat)
  @Matches(/^\d{1,4}$/, {
    message: 'El número debe tener entre 1 y 4 dígitos.',
  })
  numero?: string;
}
