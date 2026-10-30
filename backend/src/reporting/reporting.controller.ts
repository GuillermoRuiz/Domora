import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { SkipSubscriptionGate } from '../auth/decorators/skip-subscription-gate.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ReportExportDto, ReportQueryDto } from './dto/report-query.dto';
import { ReportingService } from './reporting.service';

@Controller('reports')
@Roles('B')
// POSTs here are read-only; fresh DB scope still rejects blocked/deleted tenants.
@SkipSubscriptionGate()
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('catalog')
  catalog(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.reporting.catalog(user);
  }

  @Get('estates')
  estates(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.reporting.estates(user);
  }

  @Post(':reportKey/query')
  @HttpCode(200)
  @Throttle({ global: { limit: 30, ttl: 60000 } })
  async query(
    @Param('reportKey') key: string,
    @Body() input: ReportQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    const { result, requestId } = await this.reporting.execute(
      key,
      input,
      user,
    );
    res.setHeader('X-Request-ID', requestId);
    return result;
  }

  @Post(':reportKey/export')
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60000 } })
  async export(
    @Param('reportKey') key: string,
    @Body() dto: ReportExportDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    const { format, snapshotId, ...input } = dto;
    const { document, requestId } = await this.reporting.execute(
      key,
      input,
      user,
      format,
      snapshotId,
    );
    res.setHeader('X-Request-ID', requestId);
    res.setHeader(
      'Content-Type',
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${document!.fileName}"`,
    );
    res.send(document!.content);
  }
}
