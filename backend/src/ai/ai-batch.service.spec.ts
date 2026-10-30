/* eslint-disable @typescript-eslint/no-explicit-any */
import { AiBatchService, parseBatchLine } from './ai-batch.service';
import { AiResultsService } from './ai-results.service';
import { AiOutputService } from './ai-output.service';
import { weeklyIntelligence } from './use-cases';
const response = (value: any) => ({
  status: 'completed',
  output: [
    {
      type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify(value) }],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 20 },
});
function fixture() {
  const store: any = {
    request: {
      id: 'request',
      estateId: 'e1',
      kind: 'weekly-intelligence',
      entityId: 'snapshot',
      batchId: 'batch',
      status: 'batched',
      attempts: 1,
      model: 'mock-model',
      context: {},
    },
    snapshot: {
      id: 'snapshot',
      estateId: 'e1',
      status: 'pending',
      signals: [{ id: 's1', entity_type: 'issue', entity_id: 'issue' }],
      intelligence: null,
    },
    old: {
      id: 'old',
      status: 'completed',
      intelligence: { summary: 'Previous week' },
    },
  };
  const db: any = {
    aiRequest: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            where.id === store.request.id &&
              where.batchId === store.request.batchId
              ? store.request
              : null,
          ),
        ),
      updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
        const valid =
          store.request.id === where.id &&
          store.request.batchId === where.batchId &&
          (Array.isArray(where.status?.in)
            ? where.status.in.includes(store.request.status)
            : store.request.status === where.status);
        if (valid) Object.assign(store.request, data);
        return Promise.resolve({ count: valid ? 1 : 0 });
      }),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve(Object.assign(store.request, data)),
        ),
    },
    estate: { findFirst: jest.fn().mockResolvedValue({ id: 'e1' }) },
    aiWeeklySnapshot: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          Promise.resolve(
            where.estateId === store.snapshot.estateId ? store.snapshot : null,
          ),
        ),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve(Object.assign(store.snapshot, data)),
        ),
      updateMany: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve(Object.assign(store.snapshot, data)),
        ),
    },
    issue: { count: jest.fn().mockResolvedValue(1) },
    aiAudit: { create: jest.fn().mockResolvedValue({}) },
  };
  db.$transaction = async (fn: any) => {
    const before = structuredClone(store);
    try {
      return await fn(db);
    } catch (e) {
      Object.assign(store, before);
      throw e;
    }
  };
  const results = new AiResultsService(db, new AiOutputService());
  const service = new AiBatchService(db, {} as any, results, {
    enabled: true,
  } as any);
  const output = {
    summary: 'Fuga pendiente',
    items: [
      {
        signal_id: 's1',
        priority: 'high',
        title: 'Revisar fuga',
        explanation: 'Se informó una fuga',
        recommended_action: 'Consultar el estado',
        entity_type: 'issue',
        entity_id: 'issue',
      },
    ],
  };
  return { store, db, results, service, output };
}
describe('OpenAI Batch mapping and atomic application', () => {
  it('maps unordered results by persistent custom ID', async () => {
    const f = fixture();
    await f.service.consume(
      'batch',
      JSON.stringify({
        custom_id: 'request',
        response: { status_code: 200, body: response(f.output) },
      }),
    );
    expect(f.store.snapshot.status).toBe('completed');
    expect(f.store.request.status).toBe('completed');
  });
  it('does not apply another batch or an invented request ID', async () => {
    const f = fixture();
    await expect(
      f.service.consume(
        'foreign',
        JSON.stringify({
          custom_id: 'request',
          response: { status_code: 200, body: response(f.output) },
        }),
      ),
    ).rejects.toThrow('AI_BATCH_REQUEST_NOT_MAPPED');
    expect(f.store.snapshot.intelligence).toBeNull();
  });
  it('applies a result idempotently', async () => {
    const f = fixture();
    const line = JSON.stringify({
      custom_id: 'request',
      response: { status_code: 200, body: response(f.output) },
    });
    await f.service.consume('batch', line);
    await f.service.consume('batch', line);
    expect(f.db.aiWeeklySnapshot.update).toHaveBeenCalledTimes(1);
  });
  it('does not publish invented entities', async () => {
    const f = fixture();
    f.output.items[0].entity_id = 'foreign';
    await f.service.consume(
      'batch',
      JSON.stringify({
        custom_id: 'request',
        response: { status_code: 200, body: response(f.output) },
      }),
    );
    expect(f.store.snapshot.intelligence).toBeNull();
    expect(f.store.request.status).toBe('pending');
    expect(f.store.old.intelligence.summary).toBe('Previous week');
  });
  it('retains previous intelligence on batch failure', async () => {
    const f = fixture();
    f.store.request.attempts = 3;
    await f.service.consume(
      'batch',
      JSON.stringify({
        custom_id: 'request',
        error: { code: 'batch_expired' },
      }),
    );
    expect(f.store.request.status).toBe('failed');
    expect(f.store.snapshot.status).toBe('failed');
    expect(f.store.old.status).toBe('completed');
  });
  it('retries a failed item with backoff without modifying accounting', async () => {
    const f = fixture();
    await f.service.consume(
      'batch',
      JSON.stringify({ custom_id: 'request', error: { code: 'rate_limit' } }),
    );
    expect(f.store.request.status).toBe('pending');
    expect(f.store.request.batchId).toBeNull();
    expect(f.store.request.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('rejects malformed batch lines', () =>
    expect(() => parseBatchLine('{"custom_id":1}')).toThrow());
});

function submissionFixture() {
  const local: any = {
    id: 'local-batch',
    model: 'configured-model',
    status: 'preparing',
    inputFileId: null,
    remoteId: null,
  };
  const requests: any[] = [
    {
      id: 'request-1',
      model: 'configured-model',
      payload: { model: 'configured-model', input: 'community one' },
    },
    {
      id: 'request-2',
      model: 'configured-model',
      payload: { model: 'configured-model', input: 'community two' },
    },
  ];
  const db: any = {
    aiBatch: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([local]),
      create: jest.fn().mockResolvedValue(local),
      update: jest
        .fn()
        .mockImplementation(({ data }: any) =>
          Promise.resolve(Object.assign(local, data)),
        ),
      updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
        if (where.status && where.status !== local.status)
          return Promise.resolve({ count: 0 });
        Object.assign(local, data);
        return Promise.resolve({ count: 1 });
      }),
    },
    aiRequest: {
      findFirst: jest.fn().mockResolvedValue(requests[0]),
      findMany: jest.fn().mockResolvedValue(requests),
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
  db.$transaction = (work: any) => work(db);
  const remote = {
    id: 'batch_remote',
    input_file_id: 'file-input',
    status: 'in_progress',
  };
  const ai: any = {
    upload: jest.fn().mockResolvedValue('file-input'),
    request: jest.fn().mockResolvedValue(remote),
    findBatch: jest.fn().mockResolvedValue(remote),
  };
  return {
    local,
    requests,
    db,
    ai,
    service: new AiBatchService(db, ai, {} as any, { enabled: true } as any),
  };
}
describe('Batch submission boundary', () => {
  it('persists per-request IDs and submits correct Responses JSONL', async () => {
    const f = submissionFixture();
    await f.service.submit();
    const content = f.ai.upload.mock.calls[0][0].toString('utf8');
    const lines = content
      .trim()
      .split('\n')
      .map((x: string) => JSON.parse(x));
    expect(lines.map((x: any) => x.custom_id)).toEqual([
      'request-1',
      'request-2',
    ]);
    expect(new Set(lines.map((x: any) => x.custom_id)).size).toBe(2);
    expect(
      lines.every(
        (x: any) =>
          x.url === '/v1/responses' && x.body.model === 'configured-model',
      ),
    ).toBe(true);
    expect(f.local.remoteId).toBe('batch_remote');
    expect(f.ai.request.mock.calls[0][2].metadata.domora_batch).toBe(
      'local-batch',
    );
  });
  it('keeps an uncertain POST for adoption without blind replay', async () => {
    const f = submissionFixture();
    f.ai.request.mockRejectedValueOnce(new Error('timeout'));
    await f.service.submit();
    expect(f.local.status).toBe('submission_unknown');
    await f.service.poll();
    expect(f.local.remoteId).toBe('batch_remote');
    expect(f.ai.request).toHaveBeenCalledTimes(1);
    expect(f.ai.findBatch).toHaveBeenCalledWith('local-batch');
  });
  it('does not treat a missing remote lookup as proof that submission failed', async () => {
    const f = submissionFixture();
    f.local.status = 'submission_unknown';
    f.local.inputFileId = 'file-input';
    f.ai.findBatch.mockResolvedValue(null);
    await f.service.poll();
    expect(f.ai.request).not.toHaveBeenCalled();
    expect(f.local.status).toBe('submission_unknown');
  });
});

describe('Prompt version provenance', () => {
  it('freezes the actual prompt version in queued request context', async () => {
    const db: any = { aiRequest: { upsert: jest.fn().mockResolvedValue({}) } };
    const ai: any = { body: jest.fn().mockReturnValue({ instructions: 'v2' }) };
    const service = new AiBatchService(
      db,
      ai,
      {} as any,
      { model: 'configured-model' } as any,
    );
    await service.enqueue(
      'e1',
      weeklyIntelligence,
      'snapshot',
      'key',
      {},
      { signalCount: 2 },
    );
    expect(db.aiRequest.upsert.mock.calls[0][0].create.context).toEqual({
      signalCount: 2,
      useCase: 'weekly_intelligence',
      promptVersion: 2,
    });
  });
  it('audits the queued request version rather than the current prompt version', async () => {
    const f = fixture();
    f.store.request.context.promptVersion = 2;
    await f.service.consume(
      'batch',
      JSON.stringify({
        custom_id: 'request',
        response: { status_code: 200, body: response(f.output) },
      }),
    );
    expect(
      f.db.aiAudit.create.mock.calls[0][0].data.details.promptVersion,
    ).toBe(2);
  });
  it('keeps legacy unversioned request audit at v1 on replay', async () => {
    const f = fixture();
    await f.service.consume(
      'batch',
      JSON.stringify({
        custom_id: 'request',
        response: { status_code: 200, body: response(f.output) },
      }),
    );
    expect(
      f.db.aiAudit.create.mock.calls[0][0].data.details.promptVersion,
    ).toBe(1);
  });
});

describe('Limpieza de lo que ya no hace falta', () => {
  function cleanupFixture(config: Record<string, unknown> = {}) {
    const db: any = {
      aiBatch: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'b1',
            inputFileId: 'file-in',
            outputFileId: 'file-out',
            errorFileId: null,
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      aiRequest: {
        findMany: jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const ai: any = { deleteFile: jest.fn().mockResolvedValue(undefined) };
    const service = new AiBatchService(
      db,
      ai,
      {} as any,
      {
        enabled: true,
        batchFileRetentionHours: 0,
        requestPayloadRetentionHours: 0,
        // Sin plazo configurado el resultado no se purga (decisión legal/de producto pendiente).
        requestResultRetentionHours: null,
        ...config,
      } as any,
    );
    return { db, ai, service };
  }
  const now = new Date('2026-10-23T12:00:00Z');

  it('borra de OpenAI los ficheros de entrada y salida de un lote procesado y lo anota', async () => {
    const f = cleanupFixture();
    const out = await f.service.cleanup(now);
    expect(f.ai.deleteFile.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      'file-in',
      'file-out',
    ]);
    expect(out.filesDeleted).toBe(2);
    expect(f.db.aiBatch.updateMany.mock.calls[0][0].data).toEqual({
      remoteFilesDeletedAt: now,
    });
    // Solo lotes ya procesados y aún sin limpiar.
    expect(f.db.aiBatch.findMany.mock.calls[0][0].where).toMatchObject({
      status: 'processed',
      remoteFilesDeletedAt: null,
    });
  });

  it('respeta el plazo configurado: no toca lo más reciente que él', async () => {
    const f = cleanupFixture({ batchFileRetentionHours: 24 });
    await f.service.cleanup(now);
    expect(f.db.aiBatch.findMany.mock.calls[0][0].where.updatedAt.lte).toEqual(
      new Date('2026-10-22T12:00:00Z'),
    );
  });

  it('un fichero que ya no existe cuenta como borrado; cualquier otro error deja el lote para la siguiente pasada', async () => {
    const gone = cleanupFixture();
    gone.ai.deleteFile.mockRejectedValue(new Error('OPENAI_HTTP_404'));
    await gone.service.cleanup(now);
    expect(gone.db.aiBatch.updateMany).toHaveBeenCalledTimes(1);

    const failing = cleanupFixture();
    failing.ai.deleteFile.mockRejectedValue(new Error('OPENAI_HTTP_500'));
    await failing.service.cleanup(now);
    expect(failing.db.aiBatch.updateMany).not.toHaveBeenCalled();
  });

  it('vacía el prompt (y los adjuntos en base64) de las peticiones completadas, sin tocar su resultado', async () => {
    const f = cleanupFixture();
    const out = await f.service.cleanup(now);
    expect(out.payloadsPurged).toBe(2);
    const call = f.db.aiRequest.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({
      status: 'completed',
      payloadPurgedAt: null,
    });
    expect(call.data).toEqual({ payload: {}, payloadPurgedAt: now });
    expect(call.data).not.toHaveProperty('result');
  });

  it('sin IA utilizable no sale a OpenAI, pero los prompts guardados se vacían igual', async () => {
    const f = cleanupFixture({ enabled: false });
    const out = await f.service.cleanup(now);
    expect(f.ai.deleteFile).not.toHaveBeenCalled();
    expect(out).toEqual({
      filesDeleted: 0,
      payloadsPurged: 2,
      resultsPurged: 0,
    });
  });

  it('el resultado del modelo NO se purga mientras no se configure su plazo', async () => {
    const f = cleanupFixture();
    const out = await f.service.cleanup(now);
    expect(out.resultsPurged).toBe(0);
    // Solo se tocó `aiRequest` para vaciar el prompt.
    expect(f.db.aiRequest.updateMany).toHaveBeenCalledTimes(1);
    expect(f.db.aiRequest.updateMany.mock.calls[0][0].data).not.toHaveProperty(
      'result',
    );
  });

  it('con plazo configurado vacía el resultado de lo ya materializado (completed) y respeta el plazo', async () => {
    const f = cleanupFixture({ requestResultRetentionHours: 48 });
    const out = await f.service.cleanup(now);
    expect(out.resultsPurged).toBe(2);
    const find = f.db.aiRequest.findMany.mock.calls[1][0];
    expect(find.where).toMatchObject({
      status: 'completed',
      resultPurgedAt: null,
    });
    expect(find.where.completedAt.lte).toEqual(
      new Date('2026-10-21T12:00:00Z'),
    );
    const update = f.db.aiRequest.updateMany.mock.calls[1][0];
    expect(update.where).toMatchObject({
      status: 'completed',
      resultPurgedAt: null,
    });
    expect(update.data).toMatchObject({ resultPurgedAt: now });
    // El prompt y el resultado se vacían por separado: cada uno con su propio plazo.
    expect(update.data).not.toHaveProperty('payload');
  });

  it('0 horas = enseguida (cuando se decida el plazo definitivo)', async () => {
    const f = cleanupFixture({ requestResultRetentionHours: 0 });
    await f.service.cleanup(now);
    expect(
      f.db.aiRequest.findMany.mock.calls[1][0].where.completedAt.lte,
    ).toEqual(now);
  });
});
