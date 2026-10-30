/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  startIssueHarness,
  type IssueHarness,
  type Tenant,
} from '../testing/manual-issues-harness';
import { IssueWorkflowSweepService } from './issue-workflow-sweep.service';

/**
 * Incidencias 100 % manuales · flujos de dominio con la aplicación completa y PostgreSQL real: vías, esperas, visitas y
 * siniestros. Sustituye a las specs de integración retiradas con la automatización; cubre los invariantes, no cada caso.
 */
jest.setTimeout(240_000);

let h: IssueHarness;
let A: Tenant;
let provider: string;
let insurer: string;

const call = (
  channel: string,
  party: string,
  summary: string,
  extra: Record<string, unknown>,
) => ({ channel, direction: 'outbound', party, summary, ...extra });
const get = async (path: string, token = A.token) =>
  h.http().get(`${h.api}${path}`).set(h.auth(token));
const inTheFuture = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();
const startProviderWait = (id: string, dueInHours?: number) =>
  h.interact(
    A,
    id,
    call('phone', 'provider', 'Aviso al fontanero', {
      supplierId: provider,
      nextStep: 'wait',
      effects: [
        {
          type: 'start_wait',
          kind: 'provider_reply',
          supplierId: provider,
          ...(dueInHours ? { dueInHours } : {}),
        },
      ],
    }),
  );

beforeAll(async () => {
  h = await startIssueHarness();
  A = await h.tenant('Manual flujos A');
  provider = await h.supplier(A, { name: 'Fontanería Levante' });
  insurer = await h.supplier(A, {
    name: 'Aseguradora Sol',
    category: 'Seguros',
  });
});
afterAll(async () => {
  await h.close();
});

describe('vía de gestión', () => {
  it.each([
    'community_provider',
    'community_insurance',
    'owner_insurance',
    'direct_management',
  ])(
    'elegir «%s»: queda guardada, deja rastro y la gestión tiene trabajo humano',
    async (route) => {
      const id = await h.issue(A);
      const res = await h.route(A, id, route);
      expect(res.status).toBe(200);
      expect(
        (await h.prisma.issue.findUniqueOrThrow({ where: { id } }))
          .resolutionRoute,
      ).toBe(route);
      const events = await h.prisma.issueTimelineEntry.findMany({
        where: { issueId: id, kind: 'route_decided' },
      });
      expect(events).toHaveLength(1);
      expect(events[0].internal).toBe(true);
      const tasks = await h.prisma.agendaTask.findMany({
        where: { issueId: id },
      });
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.every((t) => t.kind === 'review_issue')).toBe(true);
      expect((await get(`/issues/${id}/journey`)).body.route).toBe(route);
    },
  );

  it('cambiar la vía retira las esperas de la anterior y no toca las del propietario', async () => {
    const id = await h.issue(A);
    await h.route(A, id, 'community_provider');
    const providerWait = (await startProviderWait(id)).body.effects[0]
      .ref as string;
    const ownerWait = await h.interact(
      A,
      id,
      call('phone', 'owner', 'Pido datos al propietario', {
        partyLabel: 'Propietaria',
        nextStep: 'wait',
        effects: [
          { type: 'start_wait', kind: 'owner_reply', partyLabel: 'Propietaria' },
        ],
      }),
    );
    expect(ownerWait.status).toBe(201);
    const ownerWaitId = ownerWait.body.effects[0].ref as string;

    expect((await h.route(A, id, 'direct_management')).status).toBe(200);
    const ended = await h.prisma.issueWait.findUniqueOrThrow({
      where: { id: providerWait },
    });
    expect(ended.endedAt).not.toBeNull();
    expect(ended.endReason).toBe('superseded');
    const kept = await h.prisma.issueWait.findUniqueOrThrow({
      where: { id: ownerWaitId },
    });
    expect(kept.endedAt).toBeNull();
  });

  it('quitar la vía («sin decidir») no cierra ninguna espera', async () => {
    const id = await h.issue(A);
    await h.route(A, id, 'community_provider');
    const waitId = (await startProviderWait(id)).body.effects[0].ref as string;
    expect((await h.route(A, id, null)).status).toBe(200);
    const row = await h.prisma.issueWait.findUniqueOrThrow({
      where: { id: waitId },
    });
    expect(row.endedAt).toBeNull();
  });

  it('una vía que no existe se rechaza y no cambia nada', async () => {
    const id = await h.issue(A);
    expect((await h.route(A, id, 'telepatia')).status).toBe(400);
    expect(
      (await h.prisma.issue.findUniqueOrThrow({ where: { id } }))
        .resolutionRoute,
    ).toBeNull();
  });
});

describe('esperas (IssueWait)', () => {
  it('abrir una espera pone la pelota en el tercero; terminarla la cierra y repetirlo no la reabre', async () => {
    const id = await h.issue(A);
    const waitId = (await startProviderWait(id, 48)).body.effects[0]
      .ref as string;
    const waiting = await get(`/issues/${id}/situation`);
    expect(waiting.body.situation).toBe('waiting_third_party');
    expect(waiting.body.ballInCourt.primary).toBe('provider');

    const end = {
      channel: 'phone',
      direction: 'inbound',
      party: 'provider',
      supplierId: provider,
      summary: 'Responde el fontanero',
      effects: [{ type: 'end_wait', waitId, reason: 'fulfilled' }],
    };
    // Terminar la espera sin dejar un siguiente paso se rechaza (la incidencia no puede quedarse sin nadie con la pelota)...
    const bare = await h.interact(A, id, { ...end, nextStep: 'none' });
    expect(bare.status).toBe(409);
    expect(bare.body.code).toBe('ISSUE_WITHOUT_NEXT_STEP');
    expect(
      (await h.prisma.issueWait.findUniqueOrThrow({ where: { id: waitId } }))
        .endedAt,
    ).toBeNull();
    // ...y con un seguimiento humano se acepta.
    const withStep = {
      ...end,
      nextStep: 'task',
      effects: [
        ...end.effects,
        { type: 'open_follow_up', note: 'Revisar el presupuesto', milestone: 'created' },
      ],
    };
    expect((await h.interact(A, id, withStep)).status).toBe(201);
    const row = await h.prisma.issueWait.findUniqueOrThrow({
      where: { id: waitId },
    });
    expect(row.endedAt).not.toBeNull();
    expect(row.endReason).toBe('fulfilled');
    const again = await h.interact(A, id, withStep);
    expect(again.status).toBeLessThan(500);
    expect(
      (await h.prisma.issueWait.findUniqueOrThrow({ where: { id: waitId } }))
        .endReason,
    ).toBe('fulfilled');
  });

  it('una espera vencida abre una tarea humana de seguimiento al barrer, nunca un job', async () => {
    const id = await h.issue(A);
    const waitId = (await startProviderWait(id)).body.effects[0].ref as string;
    // La API no deja crear una espera ya vencida: se envejece directamente (única escritura de estado de este archivo).
    await h.prisma.issueWait.update({
      where: { id: waitId },
      data: { dueAt: new Date(Date.now() - 3_600_000) },
    });
    await h.app
      .get(IssueWorkflowSweepService, { strict: false })
      .sweep(new Date());
    const tasks = await h.prisma.agendaTask.findMany({
      where: { issueId: id, kind: 'chase_provider' },
    });
    expect(tasks.length).toBeGreaterThan(0);
    expect(await h.prisma.aiJob.count({ where: { estateId: A.estateId } })).toBe(
      0,
    );
  });
});

describe('visitas', () => {
  const schedule = (id: string) =>
    h.interact(
      A,
      id,
      call('phone', 'provider', 'Cita', {
        supplierId: provider,
        nextStep: 'visit',
        effects: [
          {
            type: 'schedule_visit',
            supplierId: provider,
            scheduledAt: inTheFuture(1),
            purpose: 'Revisar la fuga',
          },
        ],
      }),
    );

  it('programar, reprogramar y registrar el resultado; el resultado no se puede cambiar después', async () => {
    const id = await h.issue(A);
    expect((await schedule(id)).status).toBe(201);
    const visits = (await get(`/issues/${id}/visits`)).body;
    expect(visits).toHaveLength(1);
    expect(visits[0].status).toBe('planificada');
    const visitId = visits[0].id as string;

    const moved = await h
      .http()
      .patch(`${h.api}/issues/${id}/visits/${visitId}/reschedule`)
      .set(h.auth(A.token))
      .send({ scheduledAt: inTheFuture(2) });
    expect(moved.status).toBe(200);

    const done = await h
      .http()
      .patch(`${h.api}/issues/${id}/visits/${visitId}`)
      .set(h.auth(A.token))
      .send({ outcome: 'completed' });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('realizada');
    const flip = await h
      .http()
      .patch(`${h.api}/issues/${id}/visits/${visitId}`)
      .set(h.auth(A.token))
      .send({ outcome: 'cancelled' });
    expect(flip.status).toBe(409);
    // Que la visita se haya hecho NO resuelve la incidencia: la gestión decide el siguiente paso.
    expect((await get(`/issues/${id}/situation`)).body.situation).toBe(
      'requires_attention',
    );
    expect(
      (await h.prisma.issue.findUniqueOrThrow({ where: { id } })).status,
    ).not.toBe('Resuelta');
  });

  it('cancelar una visita deja constancia', async () => {
    const id = await h.issue(A);
    await schedule(id);
    const visitId = (await get(`/issues/${id}/visits`)).body[0].id as string;
    const res = await h
      .http()
      .patch(`${h.api}/issues/${id}/visits/${visitId}`)
      .set(h.auth(A.token))
      .send({ outcome: 'cancelled', notes: 'No se presentó' });
    expect(res.status).toBe(200);
    const row = await h.prisma.supplierVisit.findUniqueOrThrow({
      where: { id: visitId },
    });
    expect(row.status).toBe('cancelada');
    expect(row.cancelledAt).not.toBeNull();
  });
});

describe('siniestros y cierre', () => {
  it('un siniestro abierto bloquea CERRAR (no resolver); cerrarlo lo permite; uno cerrado no se edita', async () => {
    const id = await h.issue(A);
    expect(
      (
        await h.interact(
          A,
          id,
          call('phone', 'insurer', 'Parte a la aseguradora', {
            supplierId: insurer,
            nextStep: 'wait',
            effects: [
              {
                type: 'open_claim',
                insurerSupplierId: insurer,
                reference: 'S-100',
              },
              { type: 'start_wait', kind: 'insurer_reply', supplierId: insurer },
            ],
          }),
        )
      ).status,
    ).toBe(201);
    const claims = (await get(`/issues/${id}/insurance-claims`)).body;
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ status: 'open', reference: 'S-100' });
    const claimId = claims[0].id as string;

    const blocked = await h.status(A, id, 'Cerrada');
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('ISSUE_HAS_OPEN_INSURANCE_CLAIM');
    expect((await h.status(A, id, 'Resuelta')).status).toBe(200);

    const closeClaim = await h
      .http()
      .patch(`${h.api}/issues/${id}/insurance-claims/${claimId}`)
      .set(h.auth(A.token))
      .send({ status: 'closed' });
    expect(closeClaim.status).toBe(200);
    // Cerrar el siniestro cancela la espera de la aseguradora.
    const waits = await h.prisma.issueWait.findMany({ where: { issueId: id } });
    expect(waits.every((w) => w.endedAt !== null)).toBe(true);

    const edit = await h
      .http()
      .patch(`${h.api}/issues/${id}/insurance-claims/${claimId}`)
      .set(h.auth(A.token))
      .send({ reference: 'OTRA' });
    expect(edit.status).toBe(409);
  });

  it('resolver, cerrar y reabrir siguen la matriz de transiciones', async () => {
    const id = await h.issue(A);
    expect((await h.status(A, id, 'Cerrada')).status).toBe(200);
    const jump = await h.status(A, id, 'PendienteProveedor');
    expect(jump.status).toBe(409);
    expect(jump.body.code).toBe('ISSUE_STATUS_TRANSITION_NOT_ALLOWED');
    expect((await h.status(A, id, 'Abierta')).status).toBe(200);
    expect(
      (await h.prisma.issue.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('Abierta');
  });
});
