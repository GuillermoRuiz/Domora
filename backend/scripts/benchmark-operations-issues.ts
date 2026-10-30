import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Prisma, PrismaClient } from '../src/prisma/client';
import { createPgAdapter } from '../src/prisma/create-prisma-client';
import { EstateAccessService } from '../src/estate-access/estate-access.service';
import { IssueSituationService } from '../src/issue-workflow/issue-situation.service';
import { IssueWorkflowConfig } from '../src/issue-workflow/issue-workflow.config';
import { OperationsService } from '../src/operations/operations.service';
import type { AuthenticatedUser } from '../src/auth/auth.types';

const TARGETS = [1_000, 5_000, 10_000, 25_000, 50_000] as const;
const INSERT_BATCH = 1_000;
const ROLLBACK = Symbol('benchmark rollback');

type Result = {
  issues: number;
  queries: number;
  classifyMs: number;
  loadFactsMs: number;
  mappingMs: number;
  totalMs: number;
  memoryMb: number;
  payloadBytes: number;
};

const prisma = new PrismaClient({
  adapter: createPgAdapter(),
  log: [{ emit: 'event', level: 'query' }],
});
let queryCount = 0;
prisma.$on('query', () => queryCount++);

async function createFixture(tx: Prisma.TransactionClient) {
  const administrator = await tx.administrator.create({
    data: {
      name: 'Benchmark Domora',
      cif: `BENCH-${randomUUID().slice(0, 8)}`,
      plan: 'BASE',
      tier: 'benchmark',
      usersMax: 1,
      status: 'Activa',
    },
    select: { id: true },
  });
  const estates = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      tx.estate.create({
        data: {
          administratorId: administrator.id,
          name: `Benchmark ${index + 1}`,
          type: 'Edificio',
          address: `Calle ${index + 1}`,
          location: 'Madrid',
        },
        select: { id: true },
      }),
    ),
  );
  return {
    administratorId: administrator.id,
    estateIds: estates.map((e) => e.id),
  };
}

async function addIssues(
  tx: Prisma.TransactionClient,
  administratorId: string,
  estateIds: string[],
  from: number,
  to: number,
) {
  const now = new Date();
  for (let start = from; start < to; start += INSERT_BATCH) {
    const end = Math.min(start + INSERT_BATCH, to);
    const rows = Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset;
      return {
        id: randomUUID(),
        ref: `BENCH-${String(index).padStart(6, '0')}`,
        estateId: estateIds[index % estateIds.length],
        type: index % 7 === 0 ? ('Fuga' as const) : ('Averia' as const),
        title: `Incidencia sintética ${index}`,
        description: `Primera línea ${index}\nDetalle no necesario en el listado`,
        status:
          index % 11 === 0
            ? ('Cerrada' as const)
            : index % 7 === 0
              ? ('EnReparacion' as const)
              : ('Abierta' as const),
        priority: index % 13 === 0 ? ('Urgente' as const) : ('Normal' as const),
        source: 'Comunidad' as const,
        date: new Date(Date.UTC(2026, 0, 1 + (index % 300))),
        createdAt: new Date(now.getTime() - (index % 720) * 3_600_000),
      };
    });
    await tx.issue.createMany({ data: rows });

    const active = rows.filter((row) => row.status !== 'Cerrada');
    await Promise.all([
      tx.issueTimelineEntry.createMany({
        data: active
          .filter((_, index) => index % 2 === 0)
          .map((issue) => ({
            id: randomUUID(),
            issueId: issue.id,
            date: now,
            role: 'Sistema' as const,
            text: 'Evento sintético',
            kind: 'note',
            actorKind: 'system' as const,
          })),
      }),
      tx.issueWait.createMany({
        data: active
          .filter((_, index) => index % 7 === 0)
          .map((issue) => ({
            id: randomUUID(),
            issueId: issue.id,
            party: 'provider' as const,
            partyLabel: 'Proveedor benchmark',
            kind: 'provider_reply',
            startedAt: now,
            dueAt: new Date(now.getTime() + 86_400_000),
          })),
      }),
      tx.agendaTask.createMany({
        data: active
          .filter((_, index) => index % 10 === 0)
          .map((issue) => ({
            id: randomUUID(),
            administratorId,
            estateId: issue.estateId,
            title: 'Revisar incidencia',
            type: 'INCIDENCIA' as const,
            priority: 'MEDIA' as const,
            status: 'PENDIENTE' as const,
            startAt: now,
            endAt: new Date(now.getTime() + 3_600_000),
            issueId: issue.id,
            kind: 'review_issue',
            createdByKind: 'system' as const,
          })),
      }),
      tx.aiJob.createMany({
        data: active
          .filter((_, index) => index % 11 === 0)
          .map((issue) => ({
            id: randomUUID(),
            estateId: issue.estateId,
            kind: 'analyze',
            entityId: issue.id,
            dedupeKey: `benchmark:${issue.id}`,
            status: 'pending',
            availableAt: now,
            issueId: issue.id,
          })),
      }),
      tx.supplierVisit.createMany({
        data: active
          .filter((_, index) => index % 20 === 0)
          .map((issue) => ({
            id: randomUUID(),
            visitorLabel: 'Técnico benchmark',
            estateId: issue.estateId,
            scheduledAt: new Date(now.getTime() + 172_800_000),
            purpose: 'Visita sintética',
            status: 'planificada' as const,
            issueId: issue.id,
          })),
      }),
    ]);
  }
}

async function measure(
  tx: Prisma.TransactionClient,
  fixture: { administratorId: string; estateIds: string[] },
): Promise<Result> {
  const situation = new IssueSituationService(
    tx as never,
    new EstateAccessService(),
    new IssueWorkflowConfig(),
  );
  const operations = new OperationsService(tx as never, situation);
  const user: AuthenticatedUser = {
    id: randomUUID(),
    role: 'B',
    estateIds: fixture.estateIds,
    administratorId: fixture.administratorId,
  };

  let classifyMs = 0;
  let loadFactsMs = 0;
  let mappingMs = 0;
  const originalClassify = situation.classify.bind(situation);
  const originalLoadFacts = situation.loadFacts.bind(situation);
  const originalMapping = situation.viewsFromClassified.bind(situation);
  situation.loadFacts = async (...args) => {
    const start = performance.now();
    try {
      return await originalLoadFacts(...args);
    } finally {
      loadFactsMs += performance.now() - start;
    }
  };
  situation.classify = async (...args) => {
    const start = performance.now();
    try {
      return await originalClassify(...args);
    } finally {
      classifyMs += performance.now() - start;
    }
  };
  situation.viewsFromClassified = async (...args) => {
    const start = performance.now();
    try {
      return await originalMapping(...args);
    } finally {
      mappingMs += performance.now() - start;
    }
  };

  global.gc?.();
  const memoryBefore = process.memoryUsage().heapUsed;
  queryCount = 0;
  const start = performance.now();
  const page = await operations.issues(user, { page: 1, pageSize: 12 });
  const totalMs = performance.now() - start;
  const memoryMb = (process.memoryUsage().heapUsed - memoryBefore) / 1_048_576;
  return {
    issues: page.summary.all,
    queries: queryCount,
    classifyMs,
    loadFactsMs,
    mappingMs,
    totalMs,
    memoryMb,
    payloadBytes: Buffer.byteLength(JSON.stringify(page)),
  };
}

async function printPlans(tx: Prisma.TransactionClient, estateIds: string[]) {
  const summarize = (rows: Array<{ 'QUERY PLAN': string }>) =>
    rows
      .map((row) => row['QUERY PLAN'])
      .filter((line) =>
        /(?:Scan|Sort|Limit|Planning Time|Execution Time|Buffers:|Rows Removed)/.test(
          line,
        ),
      )
      .join('\n');
  const issueIds = (
    await tx.issue.findMany({ take: 500, select: { id: true } })
  ).map((issue) => issue.id);
  const visits = await tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>(
    Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM supplier_visits
      WHERE issue_id IN (${Prisma.join(
        issueIds.map((id) => Prisma.sql`${id}::uuid`),
      )}) AND status = 'planificada'`,
  );
  const issues = await tx.$queryRaw<Array<{ 'QUERY PLAN': string }>>(
    Prisma.sql`EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM issues
      WHERE estate_id IN (${Prisma.join(
        estateIds.map((id) => Prisma.sql`${id}::uuid`),
      )}) AND status = 'Abierta'
      ORDER BY date DESC, id ASC LIMIT 12`,
  );
  console.log('\nPLAN supplier_visits(issue_id, status)');
  console.log(summarize(visits));
  console.log('\nPLAN issues(estate_id, status) + date');
  console.log(summarize(issues));
}

async function main() {
  const results: Result[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        const fixture = await createFixture(tx);
        let inserted = 0;
        for (const target of TARGETS) {
          await addIssues(
            tx,
            fixture.administratorId,
            fixture.estateIds,
            inserted,
            target,
          );
          inserted = target;
          if (target === TARGETS.at(-1))
            await printPlans(tx, fixture.estateIds);
          results.push(await measure(tx, fixture));
          console.log(JSON.stringify(results.at(-1)));
        }
        throw ROLLBACK;
      },
      { timeout: 30 * 60_000 },
    );
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  } finally {
    await prisma.$disconnect();
  }
  console.table(
    results.map((row) => ({
      Issues: row.issues,
      Queries: row.queries,
      classify: row.classifyMs.toFixed(1),
      loadFacts: row.loadFactsMs.toFixed(1),
      mapping: row.mappingMs.toFixed(1),
      total: row.totalMs.toFixed(1),
      memoryMb: row.memoryMb.toFixed(1),
      payloadKb: (row.payloadBytes / 1024).toFixed(1),
    })),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
