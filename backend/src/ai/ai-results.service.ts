import { issuesOfEstate } from '../issues/issue-estate';
import { existingInvoiceIds } from './invoice-duplicates';
import { Injectable } from '@nestjs/common';
import { Prisma, type AiRequest } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiOutputService } from './ai-output.service';
import {
  requestPromptVersion,
  json,
  type AiKind,
  type Intelligence,
  type InvoiceExtraction,
  type Review,
  type Signal,
} from './ai.types';
import { validateInvoice } from './invoice-extraction';
@Injectable()
export class AiResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outputs: AiOutputService,
  ) {}
  async apply(request: AiRequest, raw: unknown) {
    const value = this.outputs.parseResponse<
      Intelligence | InvoiceExtraction | Review
    >(request.kind as AiKind, raw);
    const source = raw as {
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    };
    const usage = {
      input_tokens: source.usage?.input_tokens ?? null,
      output_tokens: source.usage?.output_tokens ?? null,
      total_tokens: source.usage?.total_tokens ?? null,
    };
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.aiRequest.updateMany({
        where: {
          id: request.id,
          estateId: request.estateId,
          batchId: request.batchId,
          status: 'batched',
        },
        data: { status: 'applying' },
      });
      if (!claim.count) return; // one transaction claims, applies, and commits once
      const active = await tx.estate.findFirst({
        where: { id: request.estateId, deletedAt: null },
      });
      if (!active) throw new Error('AI_ESTATE_INACTIVE');
      if (request.kind === 'weekly-intelligence')
        await this.weekly(tx, request, value as Intelligence);
      else if (request.kind === 'invoice-extraction')
        await this.invoice(tx, request, value as InvoiceExtraction);
      else if (request.kind === 'reconciliation-review')
        await this.review(tx, request, value as Review);
      else throw new Error('AI_BATCH_KIND_INVALID');
      await tx.aiRequest.update({
        where: { id: request.id },
        data: {
          status: 'completed',
          result: json(value),
          usage: json(usage),
          completedAt: new Date(),
          lastError: null,
        },
      });
      await tx.aiAudit.create({
        data: {
          estateId: request.estateId,
          workflow: request.kind,
          entityId: request.entityId,
          action: 'batch_result_applied',
          status: 'completed',
          details: json({
            requestId: request.id,
            batchId: request.batchId,
            model: request.model,
            promptVersion: requestPromptVersion(request.context),
            usage,
            externalAction: false,
          }),
        },
      });
    });
  }
  private async weekly(
    tx: Prisma.TransactionClient,
    request: AiRequest,
    value: Intelligence,
  ) {
    const snapshot = await tx.aiWeeklySnapshot.findFirst({
      where: { id: request.entityId, estateId: request.estateId },
    });
    if (!snapshot) throw new Error('AI_SNAPSHOT_SCOPE');
    const signals = snapshot.signals as unknown as Signal[];
    const ids = new Set<string>();
    for (const item of value.items) {
      const signal = signals.find((s) => s.id === item.signal_id);
      if (
        !signal ||
        signal.entity_type !== item.entity_type ||
        signal.entity_id !== item.entity_id ||
        ids.has(signal.id)
      )
        throw new Error('AI_WEEKLY_ENTITY_INVALID');
      ids.add(signal.id);
      const exists =
        item.entity_type === 'issue'
          ? await tx.issue.count({
              where: {
                id: item.entity_id,
                deletedAt: null,
                ...issuesOfEstate(request.estateId),
              },
            })
          : item.entity_type === 'contract'
            ? await tx.supplierContract.count({
                where: { id: item.entity_id, estateId: request.estateId },
              })
            : item.entity_type === 'invoice'
              ? await tx.supplierInvoice.count({
                  where: { id: item.entity_id, estateId: request.estateId },
                })
              : item.entity_type === 'bank'
                ? await tx.bankAccount.count({
                    where: { id: item.entity_id, estateId: request.estateId },
                  })
                : item.entity_type === 'event'
                  ? await tx.propertyEvent.count({
                      where: { id: item.entity_id, estateId: request.estateId },
                    })
                  : Number(item.entity_id === request.estateId);
      if (exists !== 1) throw new Error('AI_WEEKLY_ENTITY_STALE');
    }
    await tx.aiWeeklySnapshot.update({
      where: { id: snapshot.id },
      data: {
        status: 'completed',
        intelligence: json(value),
        completedAt: new Date(),
      },
    });
  }
  private async invoice(
    tx: Prisma.TransactionClient,
    request: AiRequest,
    value: InvoiceExtraction,
  ) {
    const doc = await tx.aiInvoiceDocument.findFirst({
      where: { id: request.entityId, estateId: request.estateId },
    });
    if (!doc) throw new Error('AI_DOCUMENT_SCOPE');
    const warnings = validateInvoice(value);
    const duplicateInvoiceIds = await existingInvoiceIds(
      tx,
      request.estateId,
      value,
    );
    if (duplicateInvoiceIds.length)
      warnings.push('existing_invoice_number_for_supplier');
    await tx.aiInvoiceDocument.update({
      where: { id: doc.id },
      data: {
        status: 'needs_review',
        extraction: json({
          fields: value,
          warnings,
          duplicateInvoiceIds,
          source: 'ai',
          requestId: request.id,
        }),
      },
    });
  }
  private async review(
    tx: Prisma.TransactionClient,
    request: AiRequest,
    value: Review,
  ) {
    const context = request.context as unknown as { candidateKeys: string[] };
    if (!value.needs_review) throw new Error('AI_REVIEW_MUST_BE_ADVISORY');
    if (value.candidate_key === null) return;
    if (!context.candidateKeys.includes(value.candidate_key))
      throw new Error('AI_CANDIDATE_NOT_ALLOWED');
    const suggestion = await tx.aiReconciliationSuggestion.findFirst({
      where: {
        candidateKey: value.candidate_key,
        estateId: request.estateId,
        status: 'suggested',
      },
    });
    if (!suggestion) throw new Error('AI_RECONCILIATION_STALE');
    await tx.aiReconciliationSuggestion.update({
      where: { id: suggestion.id },
      data: { aiReview: json(value) },
    });
  }
}
