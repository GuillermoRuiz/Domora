import { existingInvoiceIds } from './invoice-duplicates';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiJob } from '../prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { AiAccessService } from './ai-access.service';
import { AiQueueService } from './ai-queue.service';
import { AiBatchService } from './ai-batch.service';
import { extractInvoice } from './use-cases';
import { AiConfigService } from './ai-config.service';
import {
  extractInvoiceText,
  isDeterministicallyComplete,
  sniffInvoice,
  validateInvoice,
} from './invoice-extraction';
import { json } from './ai.types';
const runFile = promisify(execFile);
export interface InvoiceUpload {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype: string;
}
@Injectable()
export class InvoiceAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AiAccessService,
    private readonly storage: StorageService,
    private readonly queue: AiQueueService,
    private readonly batch: AiBatchService,
    private readonly config: AiConfigService,
  ) {}
  async upload(
    estateId: string,
    file: InvoiceUpload | undefined,
    user: AuthenticatedUser,
  ) {
    await this.access.manager(estateId, user);
    if (!file?.buffer.length || file.buffer.length > 5 * 1024 * 1024)
      throw new BadRequestException('Factura vacía o superior a 5 MB.');
    const mime = sniffInvoice(file.buffer);
    if (!mime || mime !== file.mimetype)
      throw new BadRequestException(
        'El contenido no coincide con un PDF o imagen permitido.',
      );
    const hash = createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.prisma.aiInvoiceDocument.findUnique({
      where: { estateId_fileHash: { estateId, fileHash: hash } },
    });
    if (existing) {
      await this.queue.enqueue(estateId, 'invoice', existing.id);
      return { id: existing.id, status: existing.status, duplicate: true };
    }
    const key = await this.storage.put(
      `ai-invoices/${estateId}`,
      file.originalname,
      file.buffer,
    );
    let doc;
    try {
      doc = await this.prisma.aiInvoiceDocument.create({
        data: {
          estateId,
          fileName: file.originalname.slice(-255),
          mimeType: mime,
          storageKey: key,
          fileHash: hash,
          uploadedByUserId: user.id,
        },
      });
    } catch (error) {
      await this.storage.delete(key);
      throw error;
    }
    // A recovery scanner also enqueues pending documents if this insert succeeds but enqueue fails.
    await this.queue.enqueue(estateId, 'invoice', doc.id);
    return { id: doc.id, status: doc.status, duplicate: false };
  }
  async process(job: AiJob) {
    const doc = await this.prisma.aiInvoiceDocument.findFirst({
      where: { id: job.entityId, estateId: job.estateId },
    });
    if (!doc) throw new Error('DOCUMENT_NOT_IN_ESTATE');
    if (doc.extraction || doc.status === 'batched') return;
    const bytes = await this.storage.get(doc.storageKey);
    if (
      createHash('sha256').update(bytes).digest('hex') !== doc.fileHash ||
      sniffInvoice(bytes) !== doc.mimeType
    )
      throw new Error('DOCUMENT_CONTENT_CHANGED');
    let text = '';
    if (doc.mimeType === 'application/pdf' && this.config.pdftotext) {
      const directory = await mkdtemp(join(tmpdir(), 'domora-invoice-'));
      try {
        const input = join(directory, 'input.pdf');
        await writeFile(input, bytes);
        const result = await runFile(
          this.config.pdftotext,
          ['-layout', '-enc', 'UTF-8', input, '-'],
          { timeout: 20000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
        );
        text = result.stdout.slice(0, 40000);
      } catch {
        text = '';
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
    const extracted = extractInvoiceText(text);
    if (isDeterministicallyComplete(extracted)) {
      await this.queue.fenced(job, async (tx) => {
        const duplicateInvoiceIds = await existingInvoiceIds(
          tx,
          job.estateId,
          extracted,
        );
        const warnings = validateInvoice(extracted);
        if (duplicateInvoiceIds.length)
          warnings.push('existing_invoice_number_for_supplier');
        await tx.aiInvoiceDocument.update({
          where: { id: doc.id },
          data: {
            status: 'needs_review',
            extraction: json({
              fields: extracted,
              warnings,
              duplicateInvoiceIds,
              source: 'deterministic',
            }),
          },
        });
        await tx.aiAudit.create({
          data: {
            estateId: job.estateId,
            workflow: 'invoice',
            entityId: doc.id,
            action: 'deterministic_extraction',
            status: 'needs_review',
            details: json({ originalPreserved: true }),
          },
        });
      });
      return;
    }
    if (!this.config.enabled) {
      await this.queue.fenced(job, (tx) =>
        tx.aiInvoiceDocument.update({
          where: { id: doc.id },
          data: {
            status: 'needs_review',
            extraction: json({
              fields: extracted,
              warnings: ['ai_unavailable', ...validateInvoice(extracted)],
              source: 'deterministic_partial',
            }),
          },
        }),
      );
      return;
    }
    // No public or model-provided URLs. The private original is copied only for this single authorized document:
    // `extract_invoice` is the only use case that admits a binary.
    await this.batch.enqueue(
      job.estateId,
      extractInvoice,
      doc.id,
      `invoice:${doc.id}`,
      {
        text,
        file: { fileName: doc.fileName, mimeType: doc.mimeType, bytes },
      },
      { fileHash: doc.fileHash },
      this.config.visionModel,
    );
    await this.queue.fenced(job, (tx) =>
      tx.aiInvoiceDocument.update({
        where: { id: doc.id },
        data: { status: 'batched' },
      }),
    );
  }
  async original(estateId: string, id: string, user: AuthenticatedUser) {
    await this.access.manager(estateId, user);
    const doc = await this.prisma.aiInvoiceDocument.findFirst({
      where: { id, estateId },
    });
    if (!doc) throw new NotFoundException('Documento no encontrado.');
    return { doc, bytes: await this.storage.get(doc.storageKey) };
  }
  async link(
    estateId: string,
    id: string,
    invoiceId: string,
    user: AuthenticatedUser,
  ) {
    await this.access.manager(estateId, user);
    const invoice = await this.prisma.supplierInvoice.findFirst({
      where: { id: invoiceId, estateId },
    });
    if (!invoice)
      throw new NotFoundException('Factura no encontrada en la finca.');
    return this.prisma.$transaction(async (tx) => {
      const doc = await tx.aiInvoiceDocument.findFirst({
        where: { id, estateId },
      });
      if (!doc) throw new NotFoundException('Documento no encontrado.');
      await tx.aiInvoiceDocument.update({
        where: { id },
        data: { invoiceId, status: 'linked' },
      });
      await tx.supplierInvoice.updateMany({
        where: { id: invoiceId, estateId, s3Key: null },
        data: {
          s3Key: doc.storageKey,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
        },
      });
      await tx.aiAudit.create({
        data: {
          estateId,
          workflow: 'invoice',
          entityId: id,
          action: 'original_linked',
          status: 'completed',
          details: json({
            invoiceId,
            actorId: user.id,
            financialPosting: false,
          }),
        },
      });
      return { linked: true };
    });
  }
}
