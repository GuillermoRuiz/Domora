import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type AiBatch, type AiRequest } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAiService, type RemoteBatch } from './openai.service';
import { AiConfigService } from './ai-config.service';
import { AiResultsService } from './ai-results.service';
import { safeError } from './ai-queue.service';
import { requestPromptVersion, json } from './ai.types';
import type { AiUseCase } from './use-cases';
export interface BatchLine {
  custom_id: string;
  response?: { status_code: number; body: unknown } | null;
  error?: unknown;
}
export function parseBatchLine(line: string): BatchLine {
  if (line.length > 100000) throw new Error('AI_BATCH_LINE_TOO_LARGE');
  const x = JSON.parse(line) as BatchLine;
  if (
    !x ||
    typeof x.custom_id !== 'string' ||
    !x.custom_id ||
    (!x.error && (!x.response || typeof x.response.status_code !== 'number'))
  )
    throw new Error('AI_BATCH_LINE_INVALID');
  return x;
}
@Injectable()
export class AiBatchService {
  private readonly logger = new Logger(AiBatchService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: OpenAiService,
    private readonly results: AiResultsService,
    private readonly config: AiConfigService,
  ) {}
  /**
   * Encola una petición por lotes. Solo entra un CASO DE USO del catálogo y sus datos de origen: el caso de uso
   * decide qué campos (y qué binarios) salen hacia el modelo.
   */
  async enqueue<Source, Output>(
    estateId: string,
    useCase: AiUseCase<Source, Output>,
    entityId: string,
    key: string,
    source: Source,
    context: unknown,
    model = this.config.model,
  ) {
    const dedupeKey = `${key}:prompt-v${useCase.promptVersion}`;
    return this.prisma.aiRequest.upsert({
      where: { dedupeKey },
      create: {
        estateId,
        kind: useCase.kind,
        entityId,
        dedupeKey,
        model,
        payload: json(this.ai.body(useCase.prepare(source), model)),
        context: json({
          ...(context as Record<string, unknown>),
          useCase: useCase.name,
          promptVersion: useCase.promptVersion,
        }),
      },
      update: {},
    });
  }
  async submit() {
    if (!this.config.enabled) return;
    const preparing = await this.prisma.aiBatch.findFirst({
      where: { status: 'preparing' },
      orderBy: { createdAt: 'asc' },
    });
    if (preparing) {
      await this.uploadAndSubmit(preparing);
      return;
    }
    const first = await this.prisma.aiRequest.findFirst({
      where: {
        status: 'pending',
        attempts: { lt: 3 },
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!first) return;
    const requests = await this.prisma.aiRequest.findMany({
      where: {
        status: 'pending',
        model: first.model,
        attempts: { lt: 3 },
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    const selected: AiRequest[] = [];
    let bytes = 0;
    for (const req of requests) {
      const size = Buffer.byteLength(JSON.stringify(req.payload)) + 200;
      if (size > 10 * 1024 * 1024) {
        await this.fail(req, 'AI_BATCH_ITEM_TOO_LARGE');
        continue;
      }
      if (bytes + size > 10 * 1024 * 1024) break;
      selected.push(req);
      bytes += size;
    }
    if (!selected.length) return;
    const batch = await this.prisma.$transaction(async (tx) => {
      const local = await tx.aiBatch.create({ data: { model: first.model } });
      const claimed = await tx.aiRequest.updateMany({
        where: { id: { in: selected.map((x) => x.id) }, status: 'pending' },
        data: {
          status: 'batched',
          batchId: local.id,
          attempts: { increment: 1 },
        },
      });
      if (claimed.count !== selected.length)
        throw new Error('AI_BATCH_CLAIM_CONFLICT');
      return local;
    });
    await this.uploadAndSubmit(batch);
  }
  private async uploadAndSubmit(batch: AiBatch) {
    const requests = await this.prisma.aiRequest.findMany({
      where: { batchId: batch.id, status: 'batched' },
      orderBy: { id: 'asc' },
    });
    if (!requests.length) return;
    let fileId = batch.inputFileId;
    if (!fileId) {
      const jsonl =
        requests
          .map((r) =>
            JSON.stringify({
              custom_id: r.id,
              method: 'POST',
              url: '/v1/responses',
              body: r.payload,
            }),
          )
          .join('\n') + '\n';
      fileId = await this.ai.upload(
        Buffer.from(jsonl),
        'domora-' + batch.id + '.jsonl',
        'batch',
      );
      await this.prisma.aiBatch.update({
        where: { id: batch.id },
        data: { inputFileId: fileId },
      });
    }
    // Mark the uncertain-action boundary BEFORE POST. Never blindly replay Batch creation.
    const claimed = await this.prisma.aiBatch.updateMany({
      where: { id: batch.id, status: 'preparing' },
      data: { status: 'submitting' },
    });
    if (!claimed.count) return;
    try {
      const remote = await this.ai.request<RemoteBatch>('/batches', 'POST', {
        input_file_id: fileId,
        endpoint: '/v1/responses',
        completion_window: '24h',
        metadata: {
          domora_batch: batch.id,
          prompt_version: [
            ...new Set(requests.map((r) => requestPromptVersion(r.context))),
          ]
            .sort()
            .join(','),
        },
      });
      if (
        !/^batch_[A-Za-z0-9_-]+$/.test(remote.id) ||
        remote.input_file_id !== fileId
      )
        throw new Error('AI_REMOTE_BATCH_INVALID');
      await this.prisma.aiBatch.update({
        where: { id: batch.id },
        data: { remoteId: remote.id, status: remote.status },
      });
    } catch (error) {
      await this.prisma.aiBatch.updateMany({
        where: { id: batch.id, remoteId: null },
        data: { status: 'submission_unknown' },
      });
      this.logger.warn(safeError(error));
    }
  }
  async poll() {
    if (!this.config.enabled) return;
    const batches = await this.prisma.aiBatch.findMany({
      where: { status: { notIn: ['processed', 'needs_review'] } },
      orderBy: { updatedAt: 'asc' },
      take: 1,
    });
    for (const batch of batches) {
      try {
        if (batch.status === 'preparing') {
          await this.prisma.aiBatch.update({
            where: { id: batch.id },
            data: { updatedAt: new Date() },
          });
          continue;
        }
        if (!batch.remoteId) {
          await this.prisma.aiBatch.update({
            where: { id: batch.id },
            data: { updatedAt: new Date() },
          });
          const remote = await this.ai.findBatch(batch.id);
          if (remote && remote.input_file_id === batch.inputFileId)
            await this.prisma.aiBatch.update({
              where: { id: batch.id },
              data: { remoteId: remote.id, status: remote.status },
            });
          // Not found is NOT proof that the POST failed. Operator must investigate an unknown submission.
          continue;
        }
        const remote = await this.ai.request<RemoteBatch>(
          `/batches/${batch.remoteId}`,
        );
        if (
          remote.id !== batch.remoteId ||
          remote.input_file_id !== batch.inputFileId
        )
          throw new Error('AI_REMOTE_BATCH_INVALID');
        await this.prisma.aiBatch.update({
          where: { id: batch.id },
          data: {
            status: remote.status,
            outputFileId: remote.output_file_id,
            errorFileId: remote.error_file_id,
          },
        });
        if (
          !['completed', 'failed', 'expired', 'cancelled'].includes(
            remote.status,
          )
        )
          continue;
        for (const fileId of [remote.output_file_id, remote.error_file_id])
          if (fileId) {
            if (!/^file-[A-Za-z0-9_-]+$/.test(fileId))
              throw new Error('AI_FILE_ID_INVALID');
            const content = await this.ai.request<string>(
              `/files/${fileId}/content`,
            );
            for (const line of content.split('\n').filter((s) => s.trim()))
              await this.consume(batch.id, line);
          }
        const remaining = await this.prisma.aiRequest.findMany({
          where: { batchId: batch.id, status: 'batched' },
        });
        for (const req of remaining)
          await this.fail(
            req,
            `AI_BATCH_${remote.status.toUpperCase()}_ITEM_MISSING`,
          );
        await this.prisma.aiBatch.update({
          where: { id: batch.id },
          data: { status: 'processed' },
        });
      } catch (error) {
        this.logger.warn(`Batch ${batch.id}: ${safeError(error)}`);
      }
    }
  }
  async consume(batchId: string, line: string) {
    const item = parseBatchLine(line);
    const request = await this.prisma.aiRequest.findFirst({
      where: { id: item.custom_id, batchId },
    });
    if (!request) throw new Error('AI_BATCH_REQUEST_NOT_MAPPED');
    if (request.status !== 'batched') return;
    if (item.error || !item.response || item.response.status_code !== 200) {
      await this.fail(request, 'AI_BATCH_ITEM_FAILED');
      return;
    }
    try {
      await this.results.apply(request, item.response.body);
    } catch (error) {
      await this.fail(request, safeError(error));
    }
  }
  /**
   * Limpieza de lo que ya no hace falta (los plazos son configuración; 0 = enseguida):
   *  - Ficheros de Batch en OpenAI (entrada, salida y errores) de lotes ya procesados: sus resultados ya están
   *    en nuestra base de datos, no hay motivo para dejarlos abandonados en la cuenta del proveedor.
   *  - `AiRequest.payload` (el prompt y los adjuntos en base64) de peticiones completadas.
   *  - `AiRequest.result` ya materializado, SOLO si `AI_REQUEST_RESULT_RETENTION_HOURS` está configurado.
   * La auditoría conserva solo metadatos técnicos; su plazo es una decisión legal/de producto pendiente.
   */
  async cleanup(now: Date = new Date()): Promise<{
    filesDeleted: number;
    payloadsPurged: number;
    resultsPurged: number;
  }> {
    const payloadsPurged = await this.purgePayloads(now);
    const resultsPurged = await this.purgeResults(now);
    const filesDeleted = this.config.enabled
      ? await this.deleteRemoteFiles(now)
      : 0;
    return { filesDeleted, payloadsPurged, resultsPurged };
  }

  /**
   * `AiRequest.result` ya está materializado en su entidad cuando la petición está `completed` (se aplica en la misma
   * transacción que lo marca así), así que es purgable. Solo si se configuró `AI_REQUEST_RESULT_RETENTION_HOURS`: sin
   * él no se purga nada (el plazo está pendiente de decisión legal/producto).
   */
  private async purgeResults(now: Date): Promise<number> {
    const hours = this.config.requestResultRetentionHours;
    if (typeof hours !== 'number') return 0;
    const cutoff = new Date(now.getTime() - hours * 3_600_000);
    const rows = await this.prisma.aiRequest.findMany({
      where: {
        status: 'completed',
        resultPurgedAt: null,
        result: { not: Prisma.DbNull },
        completedAt: { lte: cutoff },
      },
      select: { id: true },
      take: 500,
    });
    if (rows.length === 0) return 0;
    const purged = await this.prisma.aiRequest.updateMany({
      where: {
        id: { in: rows.map((r) => r.id) },
        status: 'completed',
        resultPurgedAt: null,
      },
      data: { result: Prisma.DbNull, resultPurgedAt: now },
    });
    return purged.count;
  }

  private async purgePayloads(now: Date): Promise<number> {
    const cutoff = new Date(
      now.getTime() - this.config.requestPayloadRetentionHours * 3_600_000,
    );
    const rows = await this.prisma.aiRequest.findMany({
      where: {
        status: 'completed',
        payloadPurgedAt: null,
        completedAt: { lte: cutoff },
      },
      select: { id: true },
      take: 500,
    });
    if (rows.length === 0) return 0;
    const purged = await this.prisma.aiRequest.updateMany({
      where: {
        id: { in: rows.map((r) => r.id) },
        status: 'completed',
        payloadPurgedAt: null,
      },
      data: { payload: {}, payloadPurgedAt: now },
    });
    return purged.count;
  }

  private async deleteRemoteFiles(now: Date): Promise<number> {
    const cutoff = new Date(
      now.getTime() - this.config.batchFileRetentionHours * 3_600_000,
    );
    const batches = await this.prisma.aiBatch.findMany({
      where: {
        status: 'processed',
        remoteFilesDeletedAt: null,
        updatedAt: { lte: cutoff },
      },
      orderBy: { updatedAt: 'asc' },
      take: 20,
    });
    let deleted = 0;
    for (const batch of batches) {
      const files = [
        batch.inputFileId,
        batch.outputFileId,
        batch.errorFileId,
      ].filter((id): id is string => !!id);
      try {
        for (const fileId of files) {
          try {
            await this.ai.deleteFile(fileId);
            deleted += 1;
          } catch (error) {
            // Ya no existe en OpenAI: el objetivo (que no quede) está cumplido.
            if (!(
              error instanceof Error && error.message === 'OPENAI_HTTP_404'
            ))
              throw error;
          }
        }
        await this.prisma.aiBatch.updateMany({
          where: { id: batch.id, remoteFilesDeletedAt: null },
          data: { remoteFilesDeletedAt: now },
        });
      } catch (error) {
        // Se reintenta en la siguiente pasada; mientras tanto el lote queda marcado como pendiente de limpiar.
        this.logger.warn(`Limpieza del lote ${batch.id}: ${safeError(error)}`);
      }
    }
    return deleted;
  }

  private async fail(request: AiRequest, error: string) {
    const retry = request.attempts < 3 && error !== 'AI_BATCH_ITEM_TOO_LARGE';
    await this.prisma.aiRequest.updateMany({
      where: {
        id: request.id,
        batchId: request.batchId,
        status: { in: ['batched', 'pending'] },
      },
      data: {
        status: retry ? 'pending' : 'failed',
        batchId: null,
        lastError: error,
        nextAttemptAt: new Date(Date.now() + 60000 * 2 ** request.attempts),
      },
    });
    if (!retry && request.kind === 'weekly-intelligence')
      await this.prisma.aiWeeklySnapshot.updateMany({
        where: {
          id: request.entityId,
          estateId: request.estateId,
          status: { not: 'completed' },
        },
        data: { status: 'failed' },
      });
  }
}
