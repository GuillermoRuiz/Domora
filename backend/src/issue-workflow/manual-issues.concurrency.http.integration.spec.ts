/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  startIssueHarness,
  type IssueHarness,
  type Tenant,
} from '../testing/manual-issues-harness';

/**
 * Incidencias 100 % manuales · concurrencia relevante: dos personas actuando a la vez sobre la misma incidencia nunca dejan
 * un estado imposible. La aplicación completa y PostgreSQL real; las peticiones salen en paralelo.
 */
jest.setTimeout(240_000);

let h: IssueHarness;
let A: Tenant;
let provider: string;
let insurer: string;

const interaction = (extra: Record<string, unknown>) => ({
  channel: 'phone',
  direction: 'outbound',
  summary: 'Llamada',
  ...extra,
});
const openClaim = {
  party: 'insurer',
  nextStep: 'wait',
  effects: [] as unknown[],
};

beforeAll(async () => {
  h = await startIssueHarness();
  A = await h.tenant('Manual concurrencia A');
  provider = await h.supplier(A, { name: 'Fontanería Levante' });
  insurer = await h.supplier(A, {
    name: 'Aseguradora Sol',
    category: 'Seguros',
  });
  openClaim.effects = [
    { type: 'open_claim', insurerSupplierId: insurer },
    { type: 'start_wait', kind: 'insurer_reply', supplierId: insurer },
  ];
});
afterAll(async () => {
  await h.close();
});

describe('concurrencia', () => {
  it('dos cambios de vía simultáneos terminan en UNA vía y sin esperas activas de la rama perdedora', async () => {
    const id = await h.issue(A);
    await h.route(A, id, 'community_provider');
    const wait = await h.interact(
      A,
      id,
      interaction({
        party: 'provider',
        supplierId: provider,
        nextStep: 'wait',
        effects: [
          { type: 'start_wait', kind: 'provider_reply', supplierId: provider },
        ],
      }),
    );
    const waitId = wait.body.effects[0].ref as string;
    const results = await Promise.all([
      h.route(A, id, 'direct_management'),
      h.route(A, id, 'community_insurance'),
    ]);
    expect(results.map((r) => r.status).every((s) => s < 500)).toBe(true);
    const row = await h.prisma.issue.findUniqueOrThrow({ where: { id } });
    expect(['direct_management', 'community_insurance']).toContain(
      row.resolutionRoute,
    );
    // Ninguna de las dos vías es la del proveedor: su espera ya no puede seguir activa.
    expect(
      (await h.prisma.issueWait.findUniqueOrThrow({ where: { id: waitId } }))
        .endedAt,
    ).not.toBeNull();
  });

  it('cerrar y abrir un siniestro a la vez nunca deja una incidencia Cerrada con siniestro vivo', async () => {
    const id = await h.issue(A);
    const [closed, claimed] = await Promise.all([
      h.status(A, id, 'Cerrada'),
      h.interact(A, id, interaction(openClaim)),
    ]);
    expect(closed.status).toBeLessThan(500);
    expect(claimed.status).toBeLessThan(500);
    const status = (await h.prisma.issue.findUniqueOrThrow({ where: { id } }))
      .status;
    const live = await h.prisma.insuranceClaim.count({
      where: { issueId: id, closedAt: null },
    });
    expect(status === 'Cerrada' && live > 0).toBe(false);
  });

  it('dos resultados contradictorios de la misma visita: uno gana y el otro recibe 409', async () => {
    const id = await h.issue(A);
    await h.interact(
      A,
      id,
      interaction({
        party: 'provider',
        supplierId: provider,
        nextStep: 'visit',
        effects: [
          {
            type: 'schedule_visit',
            supplierId: provider,
            scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
            purpose: 'Revisar',
          },
        ],
      }),
    );
    const visitId = (
      await h.http().get(`${h.api}/issues/${id}/visits`).set(h.auth(A.token))
    ).body[0].id as string;
    const send = (outcome: string) =>
      h
        .http()
        .patch(`${h.api}/issues/${id}/visits/${visitId}`)
        .set(h.auth(A.token))
        .send({ outcome });
    const results = await Promise.all([send('completed'), send('cancelled')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const row = await h.prisma.supplierVisit.findUniqueOrThrow({
      where: { id: visitId },
    });
    expect(['realizada', 'cancelada']).toContain(row.status);
    expect(Boolean(row.completedAt) !== Boolean(row.cancelledAt)).toBe(true);
  });

  it('terminar la misma espera dos veces a la vez la cierra una sola vez', async () => {
    const id = await h.issue(A);
    const wait = await h.interact(
      A,
      id,
      interaction({
        party: 'provider',
        supplierId: provider,
        nextStep: 'wait',
        effects: [
          { type: 'start_wait', kind: 'provider_reply', supplierId: provider },
        ],
      }),
    );
    const waitId = wait.body.effects[0].ref as string;
    const end = () =>
      h.interact(A, id, {
        channel: 'phone',
        direction: 'inbound',
        party: 'provider',
        supplierId: provider,
        summary: 'Responde',
        nextStep: 'task',
        effects: [
          { type: 'end_wait', waitId, reason: 'fulfilled' },
          {
            type: 'open_follow_up',
            note: 'Revisar la respuesta',
            milestone: 'created',
          },
        ],
      });
    const results = await Promise.all([end(), end()]);
    expect(results.every((r) => r.status < 500)).toBe(true);
    const row = await h.prisma.issueWait.findUniqueOrThrow({
      where: { id: waitId },
    });
    expect(row.endReason).toBe('fulfilled');
  });

  const numberOf = (ref: string) => Number(/^#INC-\d{4}-(\d+)$/.exec(ref)![1]);

  it('altas simultáneas (gestión y propietario) reciben referencias distintas y consecutivas, sin jobs de IA', async () => {
    const owner = await h.owner(A, 'Propietaria concurrencia');
    const ids = await Promise.all([
      ...Array.from({ length: 8 }, () => h.issue(A)),
      ...Array.from({ length: 4 }, () => h.ownerIssue(owner, A)),
    ]);
    const rows = await h.prisma.issue.findMany({ where: { id: { in: ids } } });
    const refs = rows.map((r) => r.ref);
    expect(new Set(refs).size).toBe(12);
    for (const ref of refs) expect(ref).toMatch(/^#INC-\d{4}-\d{3,}$/);
    const nums = refs.map(numberOf).sort((x, y) => x - y);
    // Cada alta consume exactamente un número del contador: sin huecos ni repetidos dentro del lote.
    expect(nums[nums.length - 1] - nums[0]).toBe(11);
    expect(await h.automationArtifacts(A.estateId)).toEqual([]);
  });

  it('borrar una incidencia (lógica por la API o física) no libera su referencia: la siguiente es mayor', async () => {
    const first = await h.issue(A);
    const second = await h.issue(A);
    const refs = async (id: string) =>
      (await h.prisma.issue.findUniqueOrThrow({ where: { id } })).ref;
    const secondRef = await refs(second);
    expect(
      (await h.http().delete(`${h.api}/issues/${first}`).set(h.auth(A.token)))
        .status,
    ).toBeLessThan(300);
    await h.prisma.issue.deleteMany({ where: { id: second } }); // borrado físico del último
    const next = await h.issue(A);
    expect(numberOf(await refs(next))).toBeGreaterThan(numberOf(secondRef));
    const counter = await h.prisma.issueReferenceCounter.findUniqueOrThrow({
      where: { year: new Date().getFullYear() },
    });
    expect(counter.lastValue).toBeGreaterThanOrEqual(
      numberOf(await refs(next)),
    );
  });
});
