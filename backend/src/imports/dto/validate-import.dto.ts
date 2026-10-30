import { IsIn, IsObject } from 'class-validator';
import type { ImportEntityType } from '../presets/gesfincas-net.presets';

const ENTITY_TYPES: ImportEntityType[] = ['property', 'owner', 'movement', 'receipt', 'remesa'];

export class ValidateImportDto {
  @IsIn(ENTITY_TYPES)
  entityType!: ImportEntityType;

  /** targetField (p. ej. "ref", "participationQuota") → nombre EXACTO de la columna del origen, tal cual viene en `headers` de `/parse`. */
  @IsObject()
  mapping!: Record<string, string>;
}
