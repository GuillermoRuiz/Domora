import { IsIn } from 'class-validator';
import type { ImportScope, ImportSourcePlatform } from '../../prisma/client';

const SOURCE_PLATFORMS: ImportSourcePlatform[] = ['GESFINCAS_NET', 'GENERIC'];
const SCOPES: ImportScope[] = ['current_state', 'historical_accounting'];

/** Acompaña al multipart del fichero — llega como `Body` junto al `file`. */
export class CreateImportBatchDto {
  @IsIn(SOURCE_PLATFORMS)
  sourcePlatform!: ImportSourcePlatform;

  @IsIn(SCOPES)
  scope!: ImportScope;
}
