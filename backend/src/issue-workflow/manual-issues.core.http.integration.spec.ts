/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  startIssueHarness,
  type IssueHarness,
  type Owner,
  type Tenant,
} from '../testing/manual-issues-harness';

/**
 * Incidencias 100 % manuales · núcleo: alta, edición, estados y la garantía de que NADA de esto crea trabajo de IA.
 * Aplicación completa y PostgreSQL real (sin cola, sin proveedor de modelo).
 */
jest.setTimeout(180_000);

let h: IssueHarness;
let A: Tenant;
let ownerA: Owner;

beforeAll(async () => {
  h = await startIssueHarness();
  A = await h.tenant('Manual núcleo A');
  ownerA = await h.owner(A);
});
afterAll(async () => {
  await h.close();
});

describe('crear y actualizar una incidencia es manual', () => {
  it('la gestión crea una incidencia: queda Abierta, sin vía y sin ningún artefacto de automatización', async () => {
    const jobsBefore = await h.prisma.aiJob.count({
      where: { estateId: A.estateId },
    });
    const id = await h.issue(A);
    const row = await h.prisma.issue.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('Abierta');
    expect(row.resolutionRoute).toBeNull();
    expect(
      await h.prisma.aiJob.count({ where: { estateId: A.estateId } }),
    ).toBe(jobsBefore);
    expect(await h.automationArtifacts(A.estateId)).toEqual([]);
  });

  it('el propietario avisa: la incidencia se crea sin vía, sin trabajo de IA y la gestión ve que falta decidir', async () => {
    const id = await h.ownerIssue(ownerA, A);
    expect(
      await h.prisma.aiJob.count({ where: { estateId: A.estateId } }),
    ).toBe(0);
    expect(await h.automationArtifacts(A.estateId)).toEqual([]);
    const journey = await h
      .http()
      .get(`${h.api}/issues/${id}/journey`)
      .set(h.auth(A.token));
    expect(journey.body).toMatchObject({
      route: null,
      status: 'needs_attention',
    });
    expect(journey.body.steps.map((x: any) => x.key)).toEqual([
      'created',
      'define_next_step',
    ]);
  });

  it('actualizar (estado, vía, interacción, nota) no crea jobs de IA ni tareas de automatización', async () => {
    const id = await h.issue(A);
    expect((await h.status(A, id, 'EnReparacion')).status).toBe(200);
    expect((await h.route(A, id, 'direct_management')).status).toBe(200);
    const note = await h.interact(A, id, {
      channel: 'phone',
      direction: 'outbound',
      party: 'owner',
      summary: 'Llamada al propietario',
      nextStep: 'none',
      legacyNoNextStep: true,
    });
    expect([200, 201]).toContain(note.status);
    expect(
      await h.prisma.aiJob.count({ where: { estateId: A.estateId } }),
    ).toBe(0);
    expect(await h.automationArtifacts(A.estateId)).toEqual([]);
  });

  it('el detalle y el listado se leen con normalidad', async () => {
    const id = await h.issue(A);
    const detail = await h
      .http()
      .get(`${h.api}/issues/${id}`)
      .set(h.auth(A.token));
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(id);
    const list = await h
      .http()
      .get(`${h.api}/estates/${A.estateId}/issues`)
      .set(h.auth(A.token));
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: any) => i.id)).toContain(id);
    const situation = await h
      .http()
      .get(`${h.api}/issues/${id}/situation`)
      .set(h.auth(A.token));
    expect(situation.status).toBe(200);
  });
});
