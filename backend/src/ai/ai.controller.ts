import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { AiAccessService } from './ai-access.service';
import { InvoiceLinkDto } from './ai.dto';
import { InvoiceAiService, type InvoiceUpload } from './invoice-ai.service';
import { AccountingAiService } from './accounting-ai.service';
import { AiQueueService } from './ai-queue.service';
import { type Intelligence, type Signal } from './ai.types';
const pageOf = (value: string | undefined) =>
  Math.max(
    1,
    Math.min(100000, Number.isInteger(Number(value)) ? Number(value) : 1),
  );
@Controller('estates/:estateId/ai')
@Roles('A', 'B')
export class EstateAiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AiAccessService,
    private readonly invoices: InvoiceAiService,
    private readonly accounting: AccountingAiService,
    private readonly queue: AiQueueService,
  ) {}
  @Post('invoices/documents')
  @UseInterceptors(
    FileInterceptor('file', {
      defParamCharset: 'utf8',
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @UploadedFile() file: InvoiceUpload | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.upload(estateId, file, user);
  }
  @Get('invoices/documents') async documents(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Query('page') page: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.access.manager(estateId, user);
    const [total, data] = await Promise.all([
      this.prisma.aiInvoiceDocument.count({ where: { estateId } }),
      this.prisma.aiInvoiceDocument.findMany({
        where: { estateId },
        orderBy: { createdAt: 'desc' },
        skip: (pageOf(page) - 1) * 30,
        take: 30,
        select: {
          id: true,
          fileName: true,
          status: true,
          extraction: true,
          invoiceId: true,
          createdAt: true,
        },
      }),
    ]);
    return { total, page: pageOf(page), pageSize: 30, data };
  }
  @Get('invoices/documents/:id/original') async original(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const { doc, bytes } = await this.invoices.original(estateId, id, user);
    response.setHeader('Content-Type', doc.mimeType);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
    );
    response.send(bytes);
  }
  @Post('invoices/documents/:id/invoice-link') link(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvoiceLinkDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoices.link(estateId, id, dto.invoiceId, user);
  }
  @Get('reconciliation') async reconciliation(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Query('page') page: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.access.manager(estateId, user);
    const [bankMovements, auto, suggestions, data, total] = await Promise.all([
      this.prisma.bankExtractEntry.count({ where: { estateId } }),
      this.prisma.bankExtractEntry.count({
        where: { estateId, reconciliationGroup: { method: 'auto' } },
      }),
      this.prisma.aiReconciliationSuggestion.findMany({
        where: { estateId, status: 'suggested' },
        select: { entryIds: true },
      }),
      this.prisma.aiReconciliationSuggestion.findMany({
        where: { estateId, status: 'suggested' },
        orderBy: { createdAt: 'desc' },
        skip: (pageOf(page) - 1) * 30,
        take: 30,
      }),
      this.prisma.aiReconciliationSuggestion.count({
        where: { estateId, status: 'suggested' },
      }),
    ]);
    const pending = await this.prisma.bankExtractEntry.findMany({
        where: { estateId, reconciliationGroupId: null },
        select: { id: true },
      }),
      pendingIds = new Set(pending.map((x) => x.id));
    const proposed = new Set(
      suggestions.flatMap((s) => s.entryIds).filter((id) => pendingIds.has(id)),
    );
    const ids = [...new Set(data.flatMap((s) => s.entryIds))],
      lineIds = [...new Set(data.flatMap((s) => s.lineIds))],
      invoiceIds = [...new Set(data.flatMap((s) => s.invoiceIds))];
    const [entries, lines, invoices] = await Promise.all([
      this.prisma.bankExtractEntry.findMany({
        where: { estateId, id: { in: ids } },
      }),
      this.prisma.journalLine.findMany({
        where: { estateId, id: { in: lineIds } },
        select: {
          id: true,
          date: true,
          concept: true,
          debit: true,
          credit: true,
        },
      }),
      this.prisma.supplierInvoice.findMany({
        where: { estateId, id: { in: invoiceIds } },
        select: {
          id: true,
          number: true,
          concept: true,
          payable: true,
          status: true,
          supplier: { select: { name: true } },
        },
      }),
    ]);
    return {
      counts: {
        bankMovements,
        automaticallyReconciled: auto,
        manuallyReconciled: bankMovements - auto - pending.length,
        suggested: proposed.size,
        unmatched: pending.length - proposed.size,
      },
      data: data.map((s) => ({
        ...s,
        entries: entries.filter((x) => s.entryIds.includes(x.id)),
        lines: lines.filter((x) => s.lineIds.includes(x.id)),
        invoices: invoices.filter((x) => s.invoiceIds.includes(x.id)),
      })),
      total,
      page: pageOf(page),
      pageSize: 30,
    };
  }
  @Post('banks/:bankId/reconciliation-runs') async run(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Param('bankId', ParseUUIDPipe) bankId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.access.manager(estateId, user);
    if (
      !(await this.prisma.bankAccount.count({
        where: { id: bankId, estateId },
      }))
    )
      throw new BadRequestException('Cuenta no encontrada.');
    const job = await this.queue.enqueue(
      estateId,
      'accounting',
      bankId,
      `accounting:${estateId}:${bankId}:${Date.now()}`,
    );
    return { jobId: job.id };
  }
  @Post('reconciliation/:id/acceptance') accept(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accounting.accept(estateId, id, user);
  }
  @Post('reconciliation/:id/rejection') reject(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.accounting.reject(estateId, id, user);
  }
  @Get('intelligence') async intelligence(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.access.manager(estateId, user);
    const latest = await this.prisma.aiWeeklySnapshot.findFirst({
      where: { estateId, status: 'completed' },
      orderBy: { weekKey: 'desc' },
    });
    const processing = await this.prisma.aiWeeklySnapshot.findFirst({
      where: {
        estateId,
        status: { in: ['pending', 'failed'] },
        ...(latest ? { weekKey: { gt: latest.weekKey } } : {}),
      },
      orderBy: { weekKey: 'desc' },
      select: { status: true, weekKey: true, snapshotAt: true },
    });
    if (!latest) return { latest: null, processing };
    const values = latest.intelligence as unknown as Intelligence,
      signals = latest.signals as unknown as Signal[];
    return {
      latest: {
        id: latest.id,
        weekKey: latest.weekKey,
        snapshotAt: latest.snapshotAt,
        completedAt: latest.completedAt,
        ...values,
        items: values.items.map((item) => ({
          ...item,
          link:
            signals.find((s) => s.id === item.signal_id)?.link ??
            `/b/estates/${estateId}`,
        })),
      },
      processing,
    };
  }
  @Get('jobs') async jobs(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.access.manager(estateId, user);
    return this.prisma.aiJob.findMany({
      where: { estateId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        kind: true,
        status: true,
        attempts: true,
        lastError: true,
        createdAt: true,
      },
    });
  }
  @Post('jobs/:id/retry') async retry(
    @Param('estateId', ParseUUIDPipe) estateId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.access.manager(estateId, user);
    const changed = await this.prisma.aiJob.updateMany({
      where: { id, estateId, status: 'failed', kind: { not: 'send' } },
      data: {
        status: 'pending',
        attempts: 0,
        availableAt: new Date(),
        leaseUntil: null,
        leaseToken: null,
      },
    });
    return { retried: changed.count === 1 };
  }
}
