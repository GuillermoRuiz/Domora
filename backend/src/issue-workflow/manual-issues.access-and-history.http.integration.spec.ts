/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  startIssueHarness,
  type IssueHarness,
  type Owner,
  type Tenant,
} from '../testing/manual-issues-harness';

/**
 * Incidencias 100 % manuales · permisos y aislamiento entre gestoras y comunidades, flujo del propietario, recorrido
 * (journey) y lectura de incidencias ANTIGUAS que conservan eventos y tareas de la automatización retirada.
 */
jest.setTimeout(240_000);

let h: IssueHarness;
let A: Tenant;
let B: Tenant;
let ownerA: Owner;
let ownerB: Owner;

const get = (path: string, token: string) =>
  h.http().get(`${h.api}${path}`).set(h.auth(token));

beforeAll(async () => {
  h = await startIssueHarness();
  A = await h.tenant('Manual acceso A');
  B = await h.tenant('Manual acceso B');
  ownerA = await h.owner(A, 'Propietaria A');
  ownerB = await h.owner(B, 'Propietario B');
});
afterAll(async () => {
  await h.close();
});

describe('permisos y aislamiento', () => {
  it('otra gestora no lee, no lista, no cambia la vía ni el estado de una incidencia ajena', async () => {
    const id = await h.issue(A);
    expect((await get(`/issues/${id}`, B.token)).status).toBe(403);
    expect((await get(`/issues/${id}/journey`, B.token)).status).toBe(403);
    expect((await get(`/issues/${id}/situation`, B.token)).status).toBe(403);
    expect((await get(`/estates/${A.estateId}/issues`, B.token)).status).toBe(
      403,
    );
    expect((await h.route(B, id, 'direct_management')).status).toBe(403);
    expect((await h.status(B, id, 'Cerrada')).status).toBe(403);
    const interact = await h.interact(B, id, {
      channel: 'phone',
      direction: 'outbound',
      party: 'other',
      partyLabel: 'x',
      summary: 'intrusión',
      nextStep: 'none',
      legacyNoNextStep: true,
    });
    expect(interact.status).toBe(403);
    const row = await h.prisma.issue.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('Abierta');
    expect(row.resolutionRoute).toBeNull();
  });

  it('un proveedor de otra gestora no puede usarse en una espera o una visita', async () => {
    const id = await h.issue(A);
    const foreign = await h.supplier(B, { name: 'Proveedor de B' });
    const res = await h.interact(A, id, {
      channel: 'phone',
      direction: 'outbound',
      party: 'provider',
      supplierId: foreign,
      summary: 'Aviso',
      nextStep: 'wait',
      effects: [
        { type: 'start_wait', kind: 'provider_reply', supplierId: foreign },
      ],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await h.prisma.issueWait.count({ where: { issueId: id } })).toBe(0);
  });

  it('el propietario no gestiona: ni estado, ni vía, ni interacciones, ni hitos', async () => {
    const id = await h.ownerIssue(ownerA, A);
    const put = (p: string, body: object) =>
      h.http().put(`${h.api}${p}`).set(h.auth(ownerA.token)).send(body);
    const post = (p: string, body: object) =>
      h.http().post(`${h.api}${p}`).set(h.auth(ownerA.token)).send(body);
    expect(
      (
        await h
          .http()
          .patch(`${h.api}/issues/${id}/status`)
          .set(h.auth(ownerA.token))
          .send({ status: 'Cerrada' })
      ).status,
    ).toBe(403);
    expect(
      (await put(`/issues/${id}/resolution-route`, { route: null })).status,
    ).toBe(403);
    expect(
      (await post(`/issues/${id}/interactions`, { channel: 'phone' })).status,
    ).toBe(403);
    expect(
      (await post(`/issues/${id}/journey/milestones`, { label: 'x' })).status,
    ).toBe(403);
  });

  it('el propietario de otra comunidad no ve la incidencia', async () => {
    const id = await h.ownerIssue(ownerA, A);
    expect((await get(`/me/issues/${id}`, ownerB.token)).status).toBe(404);
    const list = await get('/me/issues', ownerB.token);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(id);
  });
});

describe('flujo del propietario', () => {
  it('avisa, ve su incidencia, responde, la retira y la reabre; la gestión sigue viendo el estado', async () => {
    const id = await h.ownerIssue(ownerA, A);
    const own = await get(`/me/issues/${id}`, ownerA.token);
    expect(own.status).toBe(200);
    // El propietario nunca recibe la maquinaria interna.
    expect(JSON.stringify(own.body)).not.toMatch(
      /resolutionRoute|route_decided|task_opened|wait_started|s3Key/,
    );
    const reply = await h
      .http()
      .post(`${h.api}/me/issues/${id}/replies`)
      .set(h.auth(ownerA.token))
      .send({ text: 'Sigue goteando' });
    expect(reply.status).toBe(201);
    const withdraw = await h
      .http()
      .post(`${h.api}/me/issues/${id}/withdraw`)
      .set(h.auth(ownerA.token))
      .send({});
    expect(withdraw.body.status).toBe('Retirada');

    // La gestión resuelve otra incidencia y quien avisó la reabre dentro del plazo.
    const other = await h.ownerIssue(ownerA, A);
    expect((await h.status(A, other, 'Resuelta')).status).toBe(200);
    const reopen = await h
      .http()
      .post(`${h.api}/me/issues/${other}/reopen`)
      .set(h.auth(ownerA.token))
      .send({});
    expect(reopen.body.status).toBe('Abierta');
    expect(
      (await h.prisma.issue.findUniqueOrThrow({ where: { id: other } })).status,
    ).toBe('Abierta');
  });

  it('retirar una incidencia con un siniestro abierto está bloqueado', async () => {
    const id = await h.ownerIssue(ownerA, A);
    const insurer = await h.supplier(A, {
      name: 'Aseguradora',
      category: 'Seguros',
    });
    await h.interact(A, id, {
      channel: 'phone',
      direction: 'outbound',
      party: 'insurer',
      supplierId: insurer,
      summary: 'Parte',
      nextStep: 'wait',
      effects: [
        { type: 'open_claim', insurerSupplierId: insurer },
        { type: 'start_wait', kind: 'insurer_reply', supplierId: insurer },
      ],
    });
    const res = await h
      .http()
      .post(`${h.api}/me/issues/${id}/withdraw`)
      .set(h.auth(ownerA.token))
      .send({});
    expect(res.status).toBe(409);
    expect(
      (await h.prisma.issue.findUniqueOrThrow({ where: { id } })).status,
    ).not.toBe('Retirada');
  });
});

describe('recorrido, situación y pelota', () => {
  it('los hitos propios se crean, se marcan, se mueven y se borran; los fijos no se tocan', async () => {
    const id = await h.issue(A);
    const add = await h
      .http()
      .post(`${h.api}/issues/${id}/journey/milestones`)
      .set(h.auth(A.token))
      .send({ label: 'Pedir presupuesto' });
    expect(add.status).toBe(201);
    const journey = await get(`/issues/${id}/journey`, A.token);
    const custom = journey.body.steps.find((s: any) => s.custom);
    expect(custom).toBeDefined();
    expect(custom.label).toBe('Pedir presupuesto');
    const ref = custom.id as string;
    const done = await h
      .http()
      .patch(`${h.api}/issues/${id}/journey/milestones/${ref}`)
      .set(h.auth(A.token))
      .send({ done: true });
    expect(done.status).toBe(200);
    const fixed = await h
      .http()
      .delete(`${h.api}/issues/${id}/journey/milestones/created`)
      .set(h.auth(A.token));
    expect(fixed.status).toBeGreaterThanOrEqual(400);
    const del = await h
      .http()
      .delete(`${h.api}/issues/${id}/journey/milestones/${ref}`)
      .set(h.auth(A.token));
    expect(del.status).toBeLessThan(300);
    const after = await get(`/issues/${id}/journey`, A.token);
    expect(after.body.steps.some((s: any) => s.custom)).toBe(false);
    expect(after.body.steps.some((s: any) => s.key === 'created')).toBe(true);
  });

  it('la pelota cambia de manos con cada paso manual: nadie → tercero → administración → nadie al resolver', async () => {
    const id = await h.issue(A);
    const provider = await h.supplier(A, { name: 'Cerrajería' });
    expect(
      (await get(`/issues/${id}/situation`, A.token)).body.ballInCourt.primary,
    ).toBe('nobody');
    await h.route(A, id, 'community_provider');
    const ball = async () =>
      (await get(`/issues/${id}/situation`, A.token)).body.ballInCourt.primary;
    expect(await ball()).toBe('administration');
    await h.interact(A, id, {
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
    expect(await ball()).toBe('provider');
    expect((await h.status(A, id, 'Resuelta')).status).toBe(200);
    expect((await get(`/issues/${id}/situation`, A.token)).body.situation).toBe(
      'completed',
    );
  });

  it('el resumen de la finca cuenta solo los cuatro grupos de trabajo', async () => {
    await h.issue(A);
    const summary = await get(
      `/estates/${A.estateId}/issues/situation-summary`,
      A.token,
    );
    expect(summary.status).toBe(200);
    expect(Object.keys(summary.body.filters).sort()).toEqual(
      ['attention', 'resolved', 'waiting'].sort(),
    );
  });
});

describe('incidencias antiguas con restos de la automatización retirada', () => {
  /** Eventos que escribía el pipeline eliminado: sus tipos ya no están en el catálogo. */
  const LEGACY_KINDS = [
    'classified',
    'duplicate_suggested',
    'duplicate_linked',
    'duplicate_rejected',
    'provider_selected',
    'provider_responded',
    'provider_reply_interpreted',
    'route_suggested',
    'email_sending',
    'email_sent',
    'message_approved',
    'message_discarded',
    'appointment_confirmed',
    'report_merged',
  ];

  async function legacyIssue(): Promise<string> {
    const id = await h.ownerIssue(ownerA, A);
    for (const kind of LEGACY_KINDS)
      await h.prisma.issueTimelineEntry.create({
        data: {
          issueId: id,
          date: new Date(),
          role: 'Sistema',
          text: `Evento antiguo ${kind}`,
          kind,
          actorKind: 'ai',
          internal: true,
          refType: 'ai_message',
          refId: '00000000-0000-4000-8000-000000000001',
          meta: {
            decision: { effectiveMode: 'propose', steps: [{ stage: 'guard' }] },
          },
        },
      });
    // Tarea de automatización cancelada por la migración y espera de mensaje cerrada como «superseded».
    await h.prisma.agendaTask.create({
      data: {
        administratorId: A.administratorId,
        estateId: A.estateId,
        issueId: id,
        title: 'Aprobar el envío (antigua)',
        startAt: new Date(),
        endAt: new Date(),
        status: 'CANCELADA',
        cancelledAt: new Date(),
        outcome: 'superseded',
        kind: 'approve_provider_message',
        payload: { messageId: '00000000-0000-4000-8000-000000000001' },
        createdByKind: 'ai',
        source: 'issue',
        sourceRef: `legacy:${id}`,
      },
    });
    await h.prisma.issueWait.create({
      data: {
        issueId: id,
        party: 'provider',
        kind: 'provider_reply',
        refType: 'ai_message',
        refId: '00000000-0000-4000-8000-000000000001',
        partyLabel: 'Proveedor antiguo',
        startedAt: new Date(),
        dueAt: new Date(),
        endedAt: new Date(),
        endReason: 'superseded',
      },
    });
    return id;
  }

  it('la gestión lee el detalle, el recorrido, la situación y los listados sin errores', async () => {
    const id = await legacyIssue();
    const detail = await get(`/issues/${id}`, A.token);
    expect(detail.status).toBe(200);
    const kinds = detail.body.timeline.map((e: any) => e.kind);
    for (const kind of LEGACY_KINDS) expect(kinds).toContain(kind);
    expect(JSON.stringify(detail.body)).not.toMatch(/undefined|NaN/);
    for (const path of [
      `/issues/${id}/journey`,
      `/issues/${id}/situation`,
      `/estates/${A.estateId}/issues`,
      `/estates/${A.estateId}/issues/situations`,
      `/estates/${A.estateId}/issues/situation-summary`,
      `/agenda/tasks`,
    ]) {
      const res = await get(path, A.token);
      expect([path, res.status]).toEqual([path, 200]);
    }
  });

  it('el propietario nunca ve esos eventos: siguen siendo internos', async () => {
    const id = await legacyIssue();
    const res = await get(`/me/issues/${id}`, ownerA.token);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('Evento antiguo');
    expect(text).not.toMatch(/effectiveMode|"steps"/);
  });

  it('un evento antiguo guardado SIN marcar como interno tampoco llega al propietario (lista blanca al leer)', async () => {
    const id = await h.ownerIssue(ownerA, A);
    await h.prisma.issueTimelineEntry.create({
      data: {
        issueId: id,
        date: new Date(),
        role: 'Sistema',
        text: 'Clasificación antigua sin marcar',
        kind: 'classified',
        actorKind: 'ai',
        internal: false,
      },
    });
    const res = await get(`/me/issues/${id}`, ownerA.token);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('Clasificación antigua');
  });

  it('seguir gestionando una incidencia antigua funciona (vía, interacción, resolver)', async () => {
    const id = await legacyIssue();
    expect((await h.route(A, id, 'direct_management')).status).toBe(200);
    expect(
      (
        await h.interact(A, id, {
          channel: 'phone',
          direction: 'outbound',
          party: 'owner',
          partyLabel: 'Propietaria',
          summary: 'Hablamos',
          nextStep: 'none',
          legacyNoNextStep: true,
        })
      ).status,
    ).toBe(201);
    expect((await h.status(A, id, 'Resuelta')).status).toBe(200);
  });
});
