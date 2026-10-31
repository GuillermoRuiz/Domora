import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ReportFilters, ReportInput } from '../reporting.types';

export class ReportFiltersDto implements ReportFilters {
  @IsOptional() @IsString() @Matches(/^[0-9]{1,10}$/) accountCode?: string;
  @IsOptional() @IsUUID() propertyId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional()
  @IsIn([
    'cuota_ordinaria',
    'derrama',
    'fondo_reserva',
    'saldo_anterior',
    'intereses_demora',
    'gastos_devolucion',
    'otros',
  ])
  receiptKind?: string;
  @IsOptional() @IsIn(['current', 'history']) assignmentMode?:
    'current' | 'history';
  @IsOptional() @IsIn(['invoiced', 'accrued', 'paid']) spendBasis?:
    'invoiced' | 'accrued' | 'paid';
  @IsOptional() @IsInt() @Min(1) @Max(3650) days?: number;
}

export class ReportQueryDto implements ReportInput {
  @IsIn(['all', 'selected']) scopeMode!: 'all' | 'selected';
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  estateIds?: string[];
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) asOf?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) compareFrom?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) compareTo?: string;
  @IsOptional() @IsInt() @Min(2000) @Max(2100) fiscalYear?: number;
  @IsOptional() @IsInt() @Min(1) @Max(4) quarter?: number;
  @IsOptional()
  @ValidateNested()
  @Type(() => ReportFiltersDto)
  filters?: ReportFiltersDto;
}

export class ReportExportDto extends ReportQueryDto {
  @IsOptional() @IsUUID() snapshotId?: string;
  @IsIn(['pdf', 'xlsx']) format!: 'pdf' | 'xlsx';
}
