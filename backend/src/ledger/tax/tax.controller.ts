import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { EstateScopeGuard } from '../../estate-access/estate-scope.guard';
import {
  renderReportPdf,
  renderReportXlsx,
  type TableReport,
} from '../../common/reports/table-report';
import { TaxReportsService } from './tax-reports.service';
import { document111, document190, document347 } from './tax-report-documents';
import type { Quarter } from './tax.rules';
import {
  CreateTaxSettlementDto,
  TaxSettlementsService,
  UndoTaxSettlementDto,
} from './tax-settlements.service';

type Format = 'json' | 'xlsx' | 'pdf';

function parseYear(value: string | undefined): number {
  const year = Number(value ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException('Año no válido.');
  }
  return year;
}

function parseFormat(value: string | undefined): Format {
  const format = (value ?? 'json') as Format;
  if (!['json', 'xlsx', 'pdf'].includes(format)) {
    throw new BadRequestException('Formato no válido: json, xlsx o pdf.');
  }
  return format;
}

const MIME: Record<Exclude<Format, 'json'>, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** Modelos fiscales (111, 190 y 347) de la finca: solo gestión. */
@Controller('estates/:estateId/tax')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class TaxReportsController {
  constructor(private readonly reports: TaxReportsService) {}

  @Get('111')
  async model111(
    @Param('estateId') estateId: string,
    @Query('year') year: string | undefined,
    @Query('quarter') quarter: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const q = Number(quarter);
    if (![1, 2, 3, 4].includes(q))
      throw new BadRequestException('Trimestre no válido: 1 a 4.');
    const data = await this.reports.model111(
      estateId,
      parseYear(year),
      q as Quarter,
      user,
    );
    return this.respond(data, document111(data), parseFormat(format), res);
  }

  @Get('190')
  async model190(
    @Param('estateId') estateId: string,
    @Query('year') year: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reports.model190(estateId, parseYear(year), user);
    return this.respond(data, document190(data), parseFormat(format), res);
  }

  @Get('347')
  async model347(
    @Param('estateId') estateId: string,
    @Query('year') year: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reports.model347(estateId, parseYear(year), user);
    return this.respond(data, document347(data), parseFormat(format), res);
  }

  /** JSON para la pantalla; Excel o PDF como descarga. */
  private async respond<T>(
    data: T,
    document: TableReport,
    format: Format,
    res: Response,
  ) {
    if (format === 'json') return data;
    const file =
      format === 'xlsx'
        ? await renderReportXlsx(document)
        : await renderReportPdf(document);
    res.setHeader('Content-Type', MIME[format]);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    res.send(file.content);
    return undefined;
  }
}

/** Ingresos del 111 y pagos a la Seguridad Social de la finca: solo gestión. */
@Controller('estates/:estateId/tax-settlements')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class EstateTaxSettlementsController {
  constructor(private readonly settlements: TaxSettlementsService) {}

  @Get()
  list(
    @Param('estateId') estateId: string,
    @Query('year') year: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settlements.list(
      estateId,
      { year: year ? parseYear(year) : undefined },
      user,
    );
  }

  @Post()
  create(
    @Param('estateId') estateId: string,
    @Body() dto: CreateTaxSettlementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settlements.create(estateId, dto, user);
  }
}

/** Deshacer un ingreso registrado por error: solo gestión. */
@Controller('tax-settlements')
@Roles('A', 'B')
export class TaxSettlementsController {
  constructor(private readonly settlements: TaxSettlementsService) {}

  @Post(':id/undo')
  @HttpCode(200)
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UndoTaxSettlementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.settlements.undo(id, dto, user);
  }
}
