import {
  BadRequestException,
  Controller,
  Get,
  Param,
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
import { LedgerReportsService } from './ledger-reports.service';

type Format = 'json' | 'xlsx' | 'pdf';

function parseFormat(value: string | undefined): Format {
  const format = (value ?? 'json') as Format;
  if (!['json', 'xlsx', 'pdf'].includes(format)) {
    throw new BadRequestException('Formato no válido: json, xlsx o pdf.');
  }
  return format;
}

function parseYear(value: string | undefined): number {
  const year = Number(value ?? new Date().getUTCFullYear());
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new BadRequestException('Año no válido.');
  }
  return year;
}

const MIME: Record<Exclude<Format, 'json'>, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** JSON para la pantalla; Excel o PDF como descarga. Compartido por los dos controladores de este módulo. */
async function respondReport<T>(
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

/** Informes contables (fase 12): sumas y saldos, mayor, balance de situación y presupuesto frente a ejecutado. */
@Controller('estates/:estateId/reports')
@UseGuards(EstateScopeGuard)
@Roles('A', 'B')
export class LedgerReportsController {
  constructor(private readonly reports: LedgerReportsService) {}

  @Get('trial-balance')
  async trialBalance(
    @Param('estateId') estateId: string,
    @Query('fiscalYear') fiscalYear: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reports.trialBalance(
      estateId,
      parseYear(fiscalYear),
      user,
    );
    return respondReport(
      data,
      this.reports.documentTrialBalance(data),
      parseFormat(format),
      res,
    );
  }

  @Get('general-ledger')
  async generalLedger(
    @Param('estateId') estateId: string,
    @Query('accountCode') accountCode: string | undefined,
    @Query('propertyId') propertyId: string | undefined,
    @Query('supplierId') supplierId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!accountCode) {
      throw new BadRequestException('Falta el código de cuenta (accountCode).');
    }
    const data = await this.reports.generalLedger(
      estateId,
      { accountCode, propertyId, supplierId, from, to },
      user,
    );
    return respondReport(
      data,
      this.reports.documentGeneralLedger(data),
      parseFormat(format),
      res,
    );
  }

  @Get('balance-sheet')
  async balanceSheet(
    @Param('estateId') estateId: string,
    @Query('asOf') asOf: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reports.balanceSheet(
      estateId,
      asOf ?? new Date().toISOString().slice(0, 10),
      user,
    );
    return respondReport(
      data,
      this.reports.documentBalanceSheet(data),
      parseFormat(format),
      res,
    );
  }

  @Get('budget-vs-actual')
  async budgetVsActual(
    @Param('estateId') estateId: string,
    @Query('fiscalYear') fiscalYear: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reports.budgetVsActual(
      estateId,
      parseYear(fiscalYear),
      user,
    );
    return respondReport(
      data,
      this.reports.documentBudgetVsActual(data),
      parseFormat(format),
      res,
    );
  }

  @Get('cash-settlement')
  async cashSettlement(
    @Param('estateId') estateId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!from || !to) {
      throw new BadRequestException(
        'Faltan las fechas del periodo (from, to).',
      );
    }
    const data = await this.reports.cashSettlement(
      estateId,
      { from, to },
      user,
    );
    return respondReport(
      data,
      this.reports.documentCashSettlement(data),
      parseFormat(format),
      res,
    );
  }
}

/**
 * Extracto por propiedad — igual que el mayor de la 430, pero también para
 * el rol C. `@Roles('A','B','C')` dice "cualquiera de los tres puede
 * entrar" — la comprobación fina (que sea SU propiedad) es por
 * `PropertyMembership`, dentro del servicio, no por finca. Ver el
 * comentario de `LedgerReportsService.propertyStatement`.
 */
@Controller('properties/:propertyId/ledger-extract')
@Roles('A', 'B', 'C')
export class PropertyLedgerController {
  constructor(private readonly reports: LedgerReportsService) {}

  @Get()
  async statement(
    @Param('propertyId') propertyId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('format') format: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.reports.propertyStatement(
      propertyId,
      { from, to },
      user,
    );
    return respondReport(
      data,
      this.reports.documentPropertyStatement(data),
      parseFormat(format),
      res,
    );
  }
}
