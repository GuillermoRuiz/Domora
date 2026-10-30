/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  startIssueHarness,
  type IssueHarness,
  type Tenant,
} from '../testing/manual-issues-harness';
import { createLedgerEstate } from '../testing/db-fixtures';
import { AiWorkerService } from './ai-worker.service';
import { AiBatchService } from './ai-batch.service';
import { AiQueueService } from './ai-queue.service';
import { WeeklyAiService } from './weekly-ai.service';
import { ActaNarrativeService } from '../meetings/acta/acta-narrative.service';

/**
 * Humo REAL de la infraestructura de IA que sigue viva tras retirar la automatización de Incidencias: Contabilidad
 * (facturas y conciliación), Juntas (redacción del acta) y Asistente (resumen semanal). Aplicación completa, PostgreSQL real,
 * cola, worker, Batch y validación de esquemas reales. Lo único simulado es el extremo HTTP de OpenAI, un servidor local que
 * contesta con salidas válidas (`OPENAI_BASE_URL` apunta a él; solo se admite loopback en pruebas).
 */
jest.setTimeout(240_000);

let h: IssueHarness;
let A: Tenant;
let stub: Server;
const batches = new Map<number, string[]>();
let uploads = 0;
const seen: string[] = [];

const readBody = (req: IncomingMessage): Promise<Buffer> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

const completed = (value: unknown) => ({
  id: 'resp_smoke',
  status: 'completed',
  usage: { input_tokens: 1, output_tokens: 1 },
  output: [
    {
      type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify(value) }],
    },
  ],
});

/** Salida válida para cada caso de uso, según el nombre del esquema que pide la petición. */
function synth(body: any): unknown {
  const name = body?.text?.format?.name as string;
  const input = typeof body.input === 'string' ? safeJson(body.input) : null;
  switch (name) {
    case 'meeting_minutes':
      return {
        sections: ((input?.sections ?? []) as any[]).map((s) => ({
          id: s.id,
          text: String(s.notes),
        })),
      };
    case 'weekly_intelligence':
      return { summary: 'Semana tranquila.', items: [] };
    case 'extract_invoice':
    case 'invoice_extraction':
      return {
        supplier_name: 'Fontanería Levante SL',
        supplier_tax_id: 'B12345674',
        invoice_number: 'F-2026-001',
        invoice_date: '2026-10-01',
        due_date: '2026-10-31',
        description: 'Reparación de bajante',
        net_amount: '100.00',
        vat_amount: '21.00',
        total_amount: '121.00',
        withholding_amount: null,
        currency: 'EUR',
        payment_reference: null,
        needs_review: false,
      };
    default:
      throw new Error(`stub: esquema no previsto ${name}`);
  }
}
const safeJson = (s: string): any => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

async function startStub(): Promise<number> {
  stub = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const url = (req.url ?? '').replace(/^\/v1/, '');
      seen.push(`${req.method} ${url}`);
      const json = (status: number, value: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': 'req_smoke' });
        res.end(JSON.stringify(value));
      };
      try {
        if (req.method === 'POST' && url === '/responses')
          return json(200, completed(synth(JSON.parse(raw.toString()))));
        if (req.method === 'POST' && url === '/files') {
          // Cada subida es un lote nuevo con sus propios identificadores (remoteId e inputFileId son únicos).
          const n = ++uploads;
          batches.set(n, []);
          for (const line of raw.toString().split(/\r?\n/))
            if (line.startsWith('{"custom_id"')) batches.get(n)!.push(line);
          return json(200, { id: `file-smokein${n}` });
        }
        if (req.method === 'POST' && url === '/batches') {
          const input = JSON.parse(raw.toString()).input_file_id as string;
          const n = Number(/(\d+)$/.exec(input)![1]);
          return json(200, {
            id: `batch_smoke${n}`,
            status: 'validating',
            input_file_id: input,
          });
        }
        const batchMatch = /^\/batches\/batch_smoke(\d+)$/.exec(url);
        if (req.method === 'GET' && batchMatch)
          return json(200, {
            id: `batch_smoke${batchMatch[1]}`,
            status: 'completed',
            input_file_id: `file-smokein${batchMatch[1]}`,
            output_file_id: `file-smokeout${batchMatch[1]}`,
          });
        const contentMatch = /^\/files\/file-smokeout(\d+)\/content$/.exec(url);
        if (req.method === 'GET' && contentMatch) {
          const lines = (batches.get(Number(contentMatch[1])) ?? []).map((l) => {
            const item = JSON.parse(l);
            return JSON.stringify({
              id: `batch_req_${item.custom_id}`,
              custom_id: item.custom_id,
              response: {
                status_code: 200,
                request_id: 'req_smoke',
                body: completed(synth(item.body)),
              },
              error: null,
            });
          });
          res.writeHead(200, { 'content-type': 'text/plain' });
          return res.end(lines.join('\n') + '\n');
        }
        if (req.method === 'DELETE') return json(200, { deleted: true });
        return json(404, { error: 'stub: ruta no prevista ' + url });
      } catch (e) {
        return json(500, { error: String(e) });
      }
    })();
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
  return (stub.address() as AddressInfo).port;
}

const ENV: Record<string, string> = {
  AI_ENABLED: 'true',
  OPENAI_API_KEY: 'sk-smoke-test-not-real',
  OPENAI_MODEL: 'gpt-smoke',
  AI_WORKER_ENABLED: 'true',
};
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  const port = await startStub();
  for (const [k, v] of Object.entries({
    ...ENV,
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
  })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  h = await startIssueHarness();
  // `poll()` atiende el lote más antiguo de toda la base: se parte sin restos de otras corridas (modelo propio de esta prueba).
  await h.prisma.aiBatch.deleteMany({ where: { model: 'gpt-smoke' } });
  A = await h.tenant('Smoke IA compartida');
});
afterAll(async () => {
  try {
    await h?.close(async () => {
      await h.prisma.aiBatch.deleteMany({ where: { model: 'gpt-smoke' } });
    });
  } finally {
    await new Promise<void>((r) => stub.close(() => r()));
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

const svc = <T>(type: new (...a: any[]) => T): T =>
  h.app.get(type as never, { strict: false });

describe('infraestructura compartida de IA tras retirar Incidencias', () => {
  it('el worker arranca, late y las tablas compartidas siguen utilizables; no hay rastro de las retiradas', async () => {
    await svc(AiWorkerService).work();
    const beats = await h.prisma.aiWorkerHeartbeat.count();
    expect(beats).toBeGreaterThan(0);
    for (const table of ['ai_jobs', 'ai_requests', 'ai_audit', 'ai_batches']) {
      const rows = await h.prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM ${table}`,
      );
      expect(rows[0].n).toBeGreaterThanOrEqual(0);
    }
    const gone = await h.prisma.$queryRaw<{ t: string }[]>`
      SELECT table_name AS t FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('ai_incidents','ai_messages','automation_rules','ai_policies','administrator_features')`;
    expect(gone).toEqual([]);
    expect(await h.automationArtifacts(A.estateId)).toEqual([]);
  });

  it('JUNTAS: la redacción del acta pasa por OpenAiService y devuelve texto del modelo validado', async () => {
    const result = await svc(ActaNarrativeService).draft([
      { id: 'a1', title: 'Presupuesto', notes: 'Se presenta el presupuesto.' },
    ] as never);
    expect(result.mode).toBe('llm');
    expect(result.sections.a1.mode).toBe('llm');
    expect(seen).toContain('POST /responses');
  });

  it('ASISTENTE: el resumen semanal recorre job → snapshot → Batch → resultado y se sirve por la API', async () => {
    // «Proveedor sin respuesta» sale ahora de IssueWait: una espera de proveedor de hace 80 h en una incidencia activa.
    const provider = await h.supplier(A, { name: 'Cerrajería Sur' });
    const issueId = await h.issue(A, { title: 'Cerradura rota' });
    await h.route(A, issueId, 'community_provider');
    const started = await h.interact(A, issueId, {
      channel: 'phone',
      direction: 'outbound',
      party: 'provider',
      supplierId: provider,
      summary: 'Aviso',
      nextStep: 'wait',
      effects: [
        { type: 'start_wait', kind: 'provider_reply', supplierId: provider },
      ],
    });
    const stale = new Date(Date.now() - 80 * 3_600_000);
    await h.prisma.issueWait.update({
      where: { id: started.body.effects[0].ref },
      data: { startedAt: stale },
    });
    // Una espera ya terminada y otra del propietario NO deben contar.
    await h.prisma.issueWait.create({
      data: {
        issueId,
        party: 'provider',
        kind: 'provider_reply',
        partyLabel: 'Otro',
        startedAt: stale,
        endedAt: new Date(),
        endReason: 'fulfilled',
      },
    });
    await h.prisma.issueWait.create({
      data: {
        issueId,
        party: 'owner',
        kind: 'owner_reply',
        partyLabel: 'Propietaria',
        startedAt: stale,
      },
    });

    const calculated = await svc(WeeklyAiService).snapshot(A.estateId, new Date());
    const unanswered = calculated.signals.filter((s) =>
      s.fact.includes('proveedor sin respuesta'),
    );
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0].fact).toMatch(/durante 80 horas/);

    await svc(AiQueueService).enqueue(
      A.estateId,
      'weekly',
      A.estateId,
      `weekly:${A.estateId}:smoke`,
    );
    await svc(AiWorkerService).work();
    const job = await h.prisma.aiJob.findFirstOrThrow({
      where: { estateId: A.estateId, kind: 'weekly' },
    });
    expect(job.status).toBe('completed');
    const snapshot = await h.prisma.aiWeeklySnapshot.findFirstOrThrow({
      where: { estateId: A.estateId },
    });
    expect(snapshot.status).toBe('pending');
    expect(JSON.stringify(snapshot.signals)).toContain('proveedor sin respuesta');

    await svc(AiBatchService).submit();
    await svc(AiBatchService).poll();
    const after = await h.prisma.aiWeeklySnapshot.findUniqueOrThrow({
      where: { id: snapshot.id },
    });
    expect(after.status).toBe('completed');
    const api = await h
      .http()
      .get(`${h.api}/estates/${A.estateId}/ai/intelligence`)
      .set(h.auth(A.token));
    expect(api.status).toBe(200);
    expect(api.body.latest).toMatchObject({ summary: 'Semana tranquila.' });
  });

  it('CONTABILIDAD (facturas): subir un PDF → job → Batch → extracción disponible en la API', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% factura de prueba sin texto extraíble\n%%EOF\n');
    const up = await h
      .http()
      .post(`${h.api}/estates/${A.estateId}/ai/invoices/documents`)
      .set(h.auth(A.token))
      .attach('file', pdf, { filename: 'factura.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    await svc(AiWorkerService).work();
    const doc = await h.prisma.aiInvoiceDocument.findUniqueOrThrow({
      where: { id: up.body.id },
    });
    expect(doc.status).toBe('batched');
    await svc(AiBatchService).submit();
    await svc(AiBatchService).poll();
    const listed = await h
      .http()
      .get(`${h.api}/estates/${A.estateId}/ai/invoices/documents`)
      .set(h.auth(A.token));
    expect(listed.status).toBe(200);
    const row = listed.body.data.find((d: any) => d.id === up.body.id);
    expect(JSON.stringify(row)).toContain('F-2026-001');
    expect(row.status).toBe('needs_review');
  });

  it('CONTABILIDAD (conciliación): el job de la cuenta bancaria se procesa y los endpoints responden', async () => {
    const ledgerEstate = await createLedgerEstate(h.prisma, A.administratorId, {
      estate: { name: 'Smoke conciliación' },
    });
    const bank = await h.prisma.bankAccount.findFirstOrThrow({
      where: { estateId: ledgerEstate },
    });
    await svc(AiQueueService).enqueue(ledgerEstate, 'accounting', bank.id);
    await svc(AiWorkerService).work();
    const job = await h.prisma.aiJob.findFirstOrThrow({
      where: { estateId: ledgerEstate, kind: 'accounting' },
    });
    expect([job.status, job.lastError]).toEqual(['completed', null]);
    const token = h.sign('B', A.userId, A.administratorId, [A.estateId, ledgerEstate]);
    for (const path of ['reconciliation', 'jobs', 'intelligence']) {
      const res = await h
        .http()
        .get(`${h.api}/estates/${ledgerEstate}/ai/${path}`)
        .set(h.auth(token));
      expect([path, res.status]).toEqual([path, 200]);
    }
  });
});
