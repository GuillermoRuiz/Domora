import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { EstateType } from '../../prisma/client';

export type OverviewFilter = 'all' | 'issues' | 'pending' | 'requests';
export type OverviewSort =
  'name' | 'ownersCount' | 'balance' | 'activeIssues' | 'pendingAmount';

export class EstateOverviewFilterDto {
  @IsOptional() @IsString() @MaxLength(100) search = '';
  @IsIn(['all', 'issues', 'pending', 'requests']) filter: OverviewFilter =
    'all';
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter(Boolean) : value,
  )
  @IsArray()
  @ArrayMaxSize(5)
  @IsEnum(EstateType, { each: true })
  types: EstateType[] = [];
  @IsIn(['name', 'ownersCount', 'balance', 'activeIssues', 'pendingAmount'])
  sort: OverviewSort = 'name';
  @IsIn(['asc', 'desc']) direction: 'asc' | 'desc' = 'asc';
}

export class EstateOverviewQueryDto extends EstateOverviewFilterDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(60) pageSize = 12;
}

export class EstateOverviewItemDto {
  id!: string;
  name!: string;
  address!: string;
  streetNumber!: string | null;
  location!: string;
  type!: EstateType;
  cadastralReference!: string | null;
  catastroFacadeUrl!: string | null;
  /** Cuándo se subió la foto de la finca (null = no hay); la foto se pide por GET estates/:id/photo. */
  photoUpdatedAt!: Date | null;
  ownersCount!: number;
  balance!: string;
  activeIssues!: number;
  pendingAmount!: string;
  pendingRequests!: number;
}

export class EstateOverviewDto {
  items!: EstateOverviewItemDto[];
  page!: number;
  pageSize!: number;
  total!: number;
  totalPages!: number;
  pendingLabel!: 'Cuotas pendientes';
  summary!: {
    communities: number;
    properties: number;
    pendingRequests: number;
  };
}

export class EstateManagementSearchQueryDto {
  @IsString() @MaxLength(100) q = '';
}

export class EstateManagementSearchResultDto {
  kind!: 'community' | 'owner' | 'issue';
  id!: string;
  label!: string;
  estateId!: string;
  estateName!: string;
  address!: string;
  issueId?: string;
}
