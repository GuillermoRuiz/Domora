import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type AiJob } from '../prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { toCents } from '../ledger/money';
import { AiAccessService } from './ai-access.service';
import { AiBatchService } from './ai-batch.service';
import { reviewReconciliation } from './use-cases';
import { AiConfigService } from './ai-config.service';
import { reconcile, type MatchRecord } from './reconciliation-engine';
import { json } from './ai.types';
@Injectable()
export class AccountingAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AiAccessService,
    private readonly batch: AiBatchService,
    private readonly config: AiConfigService,
  ) {}
  async process(job: AiJob) {
    const bank = await this.prisma.bankAccount.findFirst({
      where: { id: job.entityId, estateId: job.estateId },
    });
    if (!bank) throw new Error('BANK_NOT_IN_ESTATE');
    const entries = await this.prisma.bankExtractEntry.findMany({
      where: {
        estateId: job.estateId,
        bankAccountId: bank.id,
        reconciliationGroupId: null,
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: 5000,
    });
    if (entries.length === 5000)
      throw new Error('ACCOUNTING_REVIEW_WINDOW_REQUIRED');
    // Invoices are linked through the payment journal's counterpart lines. Unposted invoices cannot be reconciled to a bank ledger line.
    const lines = await this.prisma.journalLine.findMany({
      where: {
        estateId: job.estateId,
        accountId: bank.chartAccountId,
        reconciliation: null,
      },
      include: {
        entry: {
          include: {
            lines: { include: { supplier: true, supplierInvoice: true } },
          },
        },
      },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: 5000,
    });
    if (lines.length === 5000)
      throw new Error('ACCOUNTING_REVIEW_WINDOW_REQUIRED');
    const lineRecords: MatchRecord[] = lines.map((l) => {
      const counterparts = l.entry.lines.filter(
        (x) => x.estateId === job.estateId,
      );
      const invoices = counterparts
        .map((x) => x.supplierInvoice)
        .filter(
          (x): x is NonNullable<typeof x> =>
            x !== null && x.estateId === job.estateId,
        );
      return {
        id: l.id,
        estateId: job.estateId,
        bankAccountId: bank.id,
        date: l.date.toISOString().slice(0, 10),
        cents: toCents(l.debit) - toCents(l.credit),
        concept: l.concept ?? l.entry.concept,
        reference: invoices.length === 1 ? invoices[0].number : null,
        supplierName: counterparts.find(
          (x) => x.supplier?.estateId === job.estateId,
        )?.supplier?.name,
        invoiceIds: invoices.map((x) => x.id),
      };
    });
    const entryRecords: MatchRecord[] = entries.map((e) => ({
      id: e.id,
      estateId: e.estateId,
      bankAccountId: e.bankAccountId,
      date: e.date.toISOString().slice(0, 10),
      cents: toCents(e.amount),
      concept: e.concept,
      reference: e.bankRef,
    }));
    // Partition by 31 calendar days with a 30-day lookaround. Oversized windows are visibly held for review, never silently auto-matched.
    const buckets = new Map<string, MatchRecord[]>();
    for (const e of entryRecords) {
      const key = e.date.slice(0, 7);
      buckets.set(key, [...(buckets.get(key) ?? []), e]);
    }
    let overflow = false;
    const seen = new Set<string>();
    for (const group of buckets.values()) {
      const start =
          Math.min(...group.map((x) => Date.parse(x.date))) - 30 * 86400000,
        end = Math.max(...group.map((x) => Date.parse(x.date))) + 30 * 86400000;
      const windowLines = lineRecords.filter(
        (x) => Date.parse(x.date) >= start && Date.parse(x.date) <= end,
      );
      if (group.length > 30 || windowLines.length > 30) {
        overflow = true;
        continue;
      }
      const candidates = reconcile(group, windowLines);
      for (const c of candidates) {
        if (seen.has(c.key)) continue;
        seen.add(c.key);
        // A cross-month competitor must also inhibit automatic matching.
        const competingOutside = entryRecords.some(
          (x) =>
            !group.some((g) => g.id === x.id) &&
            c.lineIds.some((id) => {
              const l = lineRecords.find((y) => y.id === id)!;
              return (
                x.cents === l.cents &&
                Math.abs(Date.parse(x.date) - Date.parse(l.date)) <=
                  30 * 86400000
              );
            }),
        );
        if (competingOutside) c.tier = 'medium';
        const suggestion = await this.prisma.aiReconciliationSuggestion.upsert({
          where: { candidateKey: c.key },
          create: {
            estateId: job.estateId,
            bankAccountId: bank.id,
            candidateKey: c.key,
            entryIds: c.entryIds,
            lineIds: c.lineIds,
            invoiceIds: c.invoiceIds,
            evidence: json(c),
            status: 'suggested',
          },
          update: {},
        });
        if (
          c.tier === 'high' &&
          this.config.autoReconcile &&
          suggestion.status === 'suggested'
        ) {
          try {
            await this.commit(job.estateId, suggestion.id, null, true);
          } catch (error) {
            if (!(error instanceof ConflictException)) throw error;
          }
        }
      }
      const medium = candidates.filter((c) => c.tier === 'medium').slice(0, 12);
      if (medium.length && this.config.enabled) {
        const key = createHash('sha256')
          .update(
            medium
              .map((x) => x.key)
              .sort()
              .join('|'),
          )
          .digest('hex');
        const involvedEntries = entryRecords.filter((x) =>
            medium.some((c) => c.entryIds.includes(x.id)),
          ),
          involvedLines = lineRecords.filter((x) =>
            medium.some((c) => c.lineIds.includes(x.id)),
          );
        await this.batch.enqueue(
          job.estateId,
          reviewReconciliation,
          bank.id,
          `reconciliation:${job.estateId}:${bank.id}:${key}`,
          {
            candidates: medium.map((c) => ({ ...c, candidate_key: c.key })),
            bank_entries: involvedEntries,
            journal_lines: involvedLines,
          },
          { candidateKeys: medium.map((c) => c.key) },
        );
      }
    }

    const unpaid = await this.prisma.supplierInvoice.findMany({
      where: {
        estateId: job.estateId,
        cancelledAt: null,
        outstanding: { gt: 0 },
        supplier: { estateId: job.estateId },
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { receivedDate: 'desc' },
      take: 100,
    });
    const invoiceRecords: MatchRecord[] = unpaid.map((i) => ({
      id: i.id,
      estateId: job.estateId,
      bankAccountId: bank.id,
      cents: -toCents(i.outstanding),
      date: (i.dueDate ?? i.receivedDate).toISOString().slice(0, 10),
      reference: i.number,
      concept: i.concept,
      supplierName: i.supplier.name,
      invoiceIds: [i.id],
    }));
    for (const group of buckets.values()) {
      const start =
          Math.min(...group.map((x) => Date.parse(x.date))) - 30 * 86400000,
        end = Math.max(...group.map((x) => Date.parse(x.date))) + 30 * 86400000;
      const relevant = invoiceRecords.filter(
        (x) => Date.parse(x.date) >= start && Date.parse(x.date) <= end,
      );
      if (group.length > 30 || relevant.length > 30) continue;
      const proposed = reconcile(group, relevant).slice(0, 12);
      const keys: string[] = [];
      for (const candidate of proposed) {
        const key = `invoice-payment:${candidate.key}`;
        keys.push(key);
        await this.prisma.aiReconciliationSuggestion.upsert({
          where: { candidateKey: key },
          create: {
            estateId: job.estateId,
            bankAccountId: bank.id,
            candidateKey: key,
            entryIds: candidate.entryIds,
            lineIds: [],
            invoiceIds: candidate.lineIds,
            status: 'suggested',
            evidence: json({
              ...candidate,
              key,
              tier: 'medium',
              source: 'unposted_invoice_payment',
              requiresPaymentPosting: true,
            }),
          },
          update: {},
        });
      }
      if (keys.length && this.config.enabled) {
        const digest = createHash('sha256')
          .update([...keys].sort().join('|'))
          .digest('hex');
        await this.batch.enqueue(
          job.estateId,
          reviewReconciliation,
          bank.id,
          `invoice-payment-review:${job.estateId}:${digest}`,
          {
            candidates: proposed.map((c, index) => ({
              ...c,
              candidate_key: keys[index],
              advisory_only: true,
            })),
            bank_entries: group,
            invoice_candidates: relevant,
          },
          { candidateKeys: keys },
        );
      }
    }
    if (overflow)
      await this.prisma.aiAudit.create({
        data: {
          estateId: job.estateId,
          workflow: 'accounting',
          entityId: bank.id,
          action: 'dense_window_requires_review',
          status: 'needs_review',
          details: json({ automaticMatchingSkipped: true }),
        },
      });
  }
  /** Atomic n:m bank-to-journal reconciliation; no payment posting, spending, or invoice mutation. */
  private async commit(
    estateId: string,
    id: string,
    userId: string | null,
    automatic = false,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        const s = await tx.aiReconciliationSuggestion.findFirst({
          where: { id, estateId },
        });
        if (!s) throw new NotFoundException('Propuesta no encontrada.');
        if (['accepted', 'automatic'].includes(s.status))
          return { groupId: s.groupId };
        if (s.status !== 'suggested')
          throw new ConflictException('Propuesta ya revisada.');
        const changed = await tx.aiReconciliationSuggestion.updateMany({
          where: { id, estateId, status: 'suggested' },
          data: { status: 'applying' },
        });
        if (!changed.count) throw new ConflictException('Propuesta cambió.');
        const bank = await tx.bankAccount.findFirst({
          where: { id: s.bankAccountId, estateId },
        });
        if (!bank) throw new Error('BANK_NOT_IN_ESTATE');
        const entries = await tx.bankExtractEntry.findMany({
          where: { id: { in: s.entryIds }, estateId, bankAccountId: bank.id },
        });
        const lines = await tx.journalLine.findMany({
          where: {
            id: { in: s.lineIds },
            estateId,
            accountId: bank.chartAccountId,
          },
          include: { reconciliation: true },
        });
        if (
          entries.length !== s.entryIds.length ||
          lines.length !== s.lineIds.length ||
          entries.some((x) => x.reconciliationGroupId) ||
          lines.some((x) => x.reconciliation) ||
          !entries.length ||
          !lines.length
        )
          throw new ConflictException('Partidas cambiadas o ya conciliadas.');
        const total = entries.reduce((sum, x) => sum + toCents(x.amount), 0),
          ledgerTotal = lines.reduce(
            (sum, x) => sum + toCents(x.debit) - toCents(x.credit),
            0,
          );
        if (total !== ledgerTotal || total === 0)
          throw new ConflictException('Los importes no cuadran.');
        if (automatic) {
          const evidence = s.evidence as unknown as {
            tier: string;
            entryIds: string[];
            lineIds: string[];
          };
          if (
            evidence.tier !== 'high' ||
            entries.length !== 1 ||
            lines.length !== 1
          )
            throw new Error('AUTO_RECONCILIATION_NOT_ALLOWED');
          // Recheck conflicting amounts at commit time; a stale earlier score is never enough.
          const otherBank = await tx.bankExtractEntry.count({
            where: {
              estateId,
              bankAccountId: bank.id,
              reconciliationGroupId: null,
              amount: entries[0].amount,
              date: {
                gte: new Date(lines[0].date.getTime() - 30 * 86400000),
                lte: new Date(lines[0].date.getTime() + 30 * 86400000),
              },
            },
          });
          const otherLines = await tx.journalLine.findMany({
            where: {
              estateId,
              accountId: bank.chartAccountId,
              reconciliation: null,
              date: {
                gte: new Date(entries[0].date.getTime() - 30 * 86400000),
                lte: new Date(entries[0].date.getTime() + 30 * 86400000),
              },
            },
            select: { debit: true, credit: true },
          });
          if (
            otherBank !== 1 ||
            otherLines.filter(
              (x) => toCents(x.debit) - toCents(x.credit) === total,
            ).length !== 1
          )
            throw new ConflictException(
              'La propuesta tiene candidatos nuevos.',
            );
        }
        const group = await tx.reconciliationGroup.create({
          data: {
            estateId,
            bankAccountId: bank.id,
            method: automatic ? 'auto' : 'manual',
            createdByUserId: userId,
          },
        });
        await tx.reconciliationLine.createMany({
          data: s.lineIds.map((journalLineId) => ({
            groupId: group.id,
            journalLineId,
          })),
        });
        const updated = await tx.bankExtractEntry.updateMany({
          where: {
            id: { in: s.entryIds },
            estateId,
            bankAccountId: bank.id,
            reconciliationGroupId: null,
          },
          data: { reconciliationGroupId: group.id },
        });
        if (updated.count !== s.entryIds.length)
          throw new ConflictException(
            'Partidas conciliadas por otra operación.',
          );
        await tx.aiReconciliationSuggestion.update({
          where: { id: s.id },
          data: {
            status: automatic ? 'automatic' : 'accepted',
            groupId: group.id,
            reviewedByUserId: userId,
          },
        });
        await tx.aiAudit.create({
          data: {
            estateId,
            workflow: 'accounting',
            entityId: s.id,
            action: 'reconciliation_committed',
            status: 'completed',
            details: json({
              groupId: group.id,
              approvalSource: automatic
                ? 'deterministic_policy'
                : 'administrator',
              userId,
              evidence: s.evidence,
              financialPosting: false,
            }),
          },
        });
        return { groupId: group.id };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
  async accept(estateId: string, id: string, user: AuthenticatedUser) {
    await this.access.manager(estateId, user);
    return this.commit(estateId, id, user.id);
  }
  async reject(estateId: string, id: string, user: AuthenticatedUser) {
    await this.access.manager(estateId, user);
    await this.prisma.aiReconciliationSuggestion.updateMany({
      where: { id, estateId, status: 'suggested' },
      data: { status: 'rejected', reviewedByUserId: user.id },
    });
    return { rejected: true };
  }
}
