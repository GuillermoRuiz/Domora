import { IsOptional, IsUUID } from 'class-validator';

/** Vincula la incidencia a una instalación, o la desvincula con `null`. */
export class SetIssueAssetDto {
  @IsOptional()
  @IsUUID()
  assetId?: string | null;
}
