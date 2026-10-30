/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '../prisma/create-prisma-client';
import {
  createAdministrator,
  createEstate,
  purgeAdministrator,
  type AdministratorFixture,
} from '../testing/db-fixtures';

/**
 * Una incidencia es SIEMPRE de la comunidad · LA BASE DE DATOS (PostgreSQL real). `issues.estate_id` es obligatorio y la única
 * referencia de finca: no hay incidencias de vivienda (ni `scope` ni `property_id`).
 *  - sin finca no hay incidencia, y una finca con incidencias no se borra;
 *  - la guarda de inquilino de la IA compara con `issues.estate_id`: el análisis solo cuelga de una incidencia de SU finca.
 */
jest.setTimeout(120_000);

const main = createPrismaClient();
let admin: AdministratorFixture;
let estateA: string;
let estateB: string;
const created: string[] = [];

beforeAll(async () => {
  admin = await createAdministrator(main, { name: 'Gestora incidencias' });
  estateA = await createEstate(main, admin.administratorId, {
    name: 'Finca A incidencias',
  });
  estateB = await createEstate(main, admin.administratorId, {
    name: 'Finca B incidencias',
  });
});
afterAll(async () => {
  await main.issue.deleteMany({ where: { id: { in: created } } });
  await main.issue.deleteMany({
    where: { estateId: { in: [estateA, estateB] } },
  });
  await purgeAdministrator(main, admin.administratorId);
  await main.$disconnect();
});

const base = () => ({
  ref: `#INC-T-${randomUUID().slice(0, 12)}`,
  type: 'Averia' as const,
  title: 'Ascensor averiado',
  description: 'El ascensor no funciona',
  status: 'Abierta' as const,
  priority: 'Normal' as const,
  source: 'Comunidad' as const,
  date: new Date(),
});
async function newIssue(data: Record<string, unknown>) {
  const issue = await main.issue.create({
    data: { ...base(), ...data } as never,
  });
  created.push(issue.id);
  return issue;
}
const reason = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (error) {
    return String((error as Error).message);
  }
};
const columns = async () =>
  (
    await main.$queryRaw<{ column_name: string; is_nullable: string }[]>`
      SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'issues'`
  ).reduce<Record<string, string>>(
    (acc, c) => ({ ...acc, [c.column_name]: c.is_nullable }),
    {},
  );

describe('la forma de una incidencia', () => {
  it('la finca es obligatoria y no hay propiedad ni ámbito', async () => {
    const cols = await columns();
    expect(cols['estate_id']).toBe('NO');
    expect(cols).not.toHaveProperty('property_id');
    expect(cols).not.toHaveProperty('scope');
  });

  it('con finca se crea; sin ella es imposible', async () => {
    const ok = await newIssue({ estateId: estateA });
    expect(ok.estateId).toBe(estateA);
    expect(
      await reason(main.issue.create({ data: { ...base() } as never })),
    ).not.toBeNull();
  });

  it('ya no existen ni el tipo IssueScope ni los disparadores de propiedad', async () => {
    const types = await main.$queryRaw<{ typname: string }[]>`
      SELECT typname FROM pg_type WHERE typname = 'IssueScope'`;
    expect(types).toHaveLength(0);
    const triggers = await main.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgname IN ('issues_scope_guard', 'properties_sync_issue_estate') AND NOT tgisinternal`;
    expect(triggers).toHaveLength(0);
  });
});

describe('integridad referencial', () => {
  it('una finca con incidencias no se borra (RESTRICT)', async () => {
    const estate = await createEstate(main, admin.administratorId, {
      name: 'Finca con incidencia',
    });
    const issue = await newIssue({ estateId: estate });
    expect(
      await reason(main.estate.delete({ where: { id: estate } })),
    ).not.toBeNull();
    await main.issue.delete({ where: { id: issue.id } });
    await main.estate.delete({ where: { id: estate } });
  });

  it('el índice (finca, estado) existe', async () => {
    const rows = await main.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'issues' AND indexname = 'issues_estate_id_status_idx'`;
    expect(rows).toHaveLength(1);
  });
});
