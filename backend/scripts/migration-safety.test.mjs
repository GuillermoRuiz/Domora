import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import pg from 'pg';

// Explicit opt-in: never fall back to the application's DATABASE_URL.
const adminUrl = new URL(process.env.MIGRATION_TEST_ADMIN_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname)
    || adminUrl.pathname !== '/postgres') {
  throw new Error('MIGRATION_TEST_ADMIN_URL must address a LOCAL /postgres maintenance database');
}
const admin = new pg.Client({ connectionString: adminUrl.href });
const prefix = `domora_migration_test_${randomUUID().replaceAll('-', '').slice(0, 24)}`;
const template = `${prefix}_base`;
// La base ANTES de la migración que liga las incidencias a la comunidad: sobre ella se ejercita esa migración.
const templateOld = `${prefix}_baseold`;
// La base ANTES de la migración que quita `issues.category`: sobre ella se ejercita esa migración.
const templatePre = `${prefix}_prechain`;
const created = new Set();
const migrations = new URL('../prisma/migrations/', import.meta.url);
const guardName = '20261015190000_restore_ai_tenant_guards';
const enumName = '20261015200000_align_notification_category_order';
const estateIssuesName = '20261101100000_issues_belong_to_estate';
const dropCategoryName = '20261101120000_issues_drop_category';
// Retira la automatización de incidencias (y sus tablas): los fixtures de las pruebas previas necesitan las tablas todavía.
const removeAutomationName = '20261106110000_remove_incident_automation';
const referenceCounterName = '20261106120000_issue_reference_counters';
const sql = async (name) => readFile(new URL(`${name}/migration.sql`, migrations), 'utf8');
const require = createRequire(import.meta.url);
require('ts-node').register({ transpileOnly: true, experimentalResolver: true });

async function createDatabase(name, base) {
  assert.match(name, /^domora_migration_test_[a-f0-9]+_(base|[a-z0-9]+)$/);
  assert.ok(name.length <= 63, 'PostgreSQL database identifiers must not be truncated');
  await admin.query(`CREATE DATABASE "${name}"${base ? ` TEMPLATE "${base}"` : ''}`);
  created.add(name);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  return { client, url: url.href };
}

async function isolated(label, run, from = template) {
  const db = await createDatabase(`${prefix}_${label}`, from);
  try { await run(db); }
  finally { await db.client.query('ROLLBACK'); await db.client.end(); }
}

before(async () => {
  await admin.connect();
  const entries = (await readdir(migrations)).filter((name) => /^\d{14}_/.test(name)).sort();
  const old = await createDatabase(templateOld);
  try {
    for (const entry of entries.filter((name) => name < estateIssuesName)) await old.client.query(await sql(entry));
  } finally { await old.client.end(); }
  const pre = await createDatabase(templatePre, templateOld);
  try {
    for (const entry of entries.filter((name) => name >= estateIssuesName && name < dropCategoryName)) await pre.client.query(await sql(entry));
  } finally { await pre.client.end(); }
  const base = await createDatabase(template, templatePre);
  try {
    for (const entry of entries.filter((name) => name >= dropCategoryName && name < removeAutomationName)) await base.client.query(await sql(entry));
  } finally { await base.client.end(); }
});

after(async () => {
  // Only databases created by THIS run; never reset or drop an existing DB.
  for (const name of [...created].reverse()) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
});

test('AI migration refuses an unknown function and preserves its definition', () => isolated('unknown', async ({ client }) => {
  await client.query(`CREATE OR REPLACE FUNCTION public.ai_check_tenant() RETURNS trigger
    LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';`);
  const before = (await client.query(`SELECT pg_get_functiondef('public.ai_check_tenant()'::regprocedure) AS definition`)).rows;
  await assert.rejects(client.query(await sql(guardName)), /Unrecognized public.ai_check_tenant/);
  await client.query('ROLLBACK');
  assert.deepEqual((await client.query(`SELECT pg_get_functiondef('public.ai_check_tenant()'::regprocedure) AS definition`)).rows, before);
}));

test('AI migration preserves known function/triggers and rejects a disabled guard', () => isolated('known', async ({ client }) => {
  for (const table of ['ai_policies', 'ai_incidents', 'ai_messages', 'ai_reconciliation_suggestions', 'ai_invoice_documents']) {
    await client.query(`DROP TRIGGER ${table}_tenant ON ${table}`);
  }
  await client.query('DROP FUNCTION public.ai_check_tenant()');
  await client.query(await readFile(new URL('./fixtures/legacy-ai-tenant-guard.sql', import.meta.url), 'utf8'));
  const definitions = () => client.query(`SELECT oid, pg_get_triggerdef(oid) AS definition FROM pg_trigger
    WHERE tgfoid='public.ai_check_tenant()'::regprocedure ORDER BY oid`);
  const before = (await definitions()).rows;
  const functionBefore = (await client.query(`SELECT oid, pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid='public.ai_check_tenant()'::regprocedure`)).rows;
  await client.query(await sql(guardName));
  assert.deepEqual((await definitions()).rows, before);
  assert.deepEqual((await client.query(`SELECT oid, pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid='public.ai_check_tenant()'::regprocedure`)).rows, functionBefore);
  await client.query('ALTER TABLE ai_messages DISABLE TRIGGER ai_messages_tenant');
  await assert.rejects(client.query(await sql(guardName)), /Unrecognized AI tenant trigger/);
  await client.query('ROLLBACK');
  await client.query('ALTER TABLE ai_messages ENABLE TRIGGER ai_messages_tenant');
  await client.query('ALTER FUNCTION public.ai_check_tenant() SECURITY DEFINER');
  await assert.rejects(client.query(await sql(guardName)), /Unrecognized public.ai_check_tenant/);
}));

// The twelve labels NotificationCategory had when `20261015200000_align_notification_category_order` was written. That
// migration validates exactly this set, so the test models the type as it was THEN: later migrations legitimately add
// labels (e.g. `document`) and must not make this historical check fail.
const canonical = ['adhesion', 'onboarding', 'issue', 'direct_message', 'inspection',
  'meeting', 'communication', 'ticket', 'booking', 'receipt', 'billing', 'task'];

/** Rebuilds NotificationCategory with exactly these labels (fixture construction, before any dependency or data). */
async function rebuildCategoryType(client, labels) {
  await client.query(`ALTER TYPE "NotificationCategory" RENAME TO "NotificationCategory_fixture_old";
    CREATE TYPE "NotificationCategory" AS ENUM (${labels.map((v) => `'${v}'`).join(',')});
    ALTER TABLE notifications ALTER COLUMN category TYPE "NotificationCategory" USING category::text::"NotificationCategory";
    ALTER TABLE user_notification_preferences ALTER COLUMN category TYPE "NotificationCategory" USING category::text::"NotificationCategory";
    DROP TYPE "NotificationCategory_fixture_old";`);
}

async function populatedCategories(client, legacy) {
  // Fixture construction only, BEFORE adding dependencies or data. The migration
  // under test must leave the resulting type OID, order, rows and dependencies alone.
  await rebuildCategoryType(client, legacy ? ['task', ...canonical.slice(0, -1)] : canonical);
  // Real user + every category in both production tables.
  const { PrismaClient } = require('../src/prisma/client.ts');
  const url = new URL(adminUrl); url.pathname = `/${client.database}`;
  const prisma = new PrismaClient({ adapter: new (require('@prisma/adapter-pg').PrismaPg)({ connectionString: url.href }) });
  try {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@test.local`, passwordHash: 'x', fullName: 'Migration fixture', role: 'C' } });
    // Raw SQL: these are the labels of the time, which the current Prisma client may no longer know (e.g. `ticket`).
    for (const category of canonical) {
      await client.query(`INSERT INTO notifications (id, user_id, category, title, link) VALUES (gen_random_uuid(), $1, $2::"NotificationCategory", $2, '/test')`, [user.id, category]);
      await client.query(`INSERT INTO user_notification_preferences (user_id, category, email_enabled) VALUES ($1, $2::"NotificationCategory", false)`, [user.id, category]);
    }
  } finally { await prisma.$disconnect(); }
  await client.query(`CREATE TABLE category_dependency_fixture (category "NotificationCategory" DEFAULT 'task', categories "NotificationCategory"[]);
    CREATE VIEW category_dependency_view AS SELECT category FROM notifications;
    CREATE FUNCTION category_dependency_function("NotificationCategory") RETURNS text LANGUAGE sql IMMUTABLE AS 'SELECT $1::text';
    INSERT INTO category_dependency_fixture(categories) VALUES (ARRAY['issue','task']::"NotificationCategory"[]);`);
}

async function categorySnapshot(client) {
  return (await client.query(`SELECT jsonb_build_object(
    'type', '"NotificationCategory"'::regtype::oid,
    'labels', (SELECT jsonb_agg(enumlabel ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid='"NotificationCategory"'::regtype),
    'notifications', (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM notifications n),
    'preferences', (SELECT jsonb_agg(to_jsonb(p) ORDER BY user_id, category::text) FROM user_notification_preferences p),
    'dependencies', (SELECT jsonb_agg(to_jsonb(d) ORDER BY classid,objid,objsubid) FROM pg_depend d WHERE refobjid='"NotificationCategory"'::regtype),
    'fixture', (SELECT jsonb_agg(to_jsonb(f)) FROM category_dependency_fixture f)
  ) AS snapshot`)).rows[0].snapshot;
}

for (const legacy of [false, true]) {
  test(`category validation preserves populated ${legacy ? 'legacy' : 'canonical'} enum and all dependencies`, () => isolated(legacy ? 'legacy' : 'canonical', async ({ client }) => {
    await populatedCategories(client, legacy);
    const before = await categorySnapshot(client);
    await client.query(await sql(enumName));
    assert.deepEqual(await categorySnapshot(client), before);
    assert.equal((await client.query(`SELECT category_dependency_function(category) FROM category_dependency_view`)).rowCount, 12);
  }));
}

test('category validation rejects unexpected labels without replacing the type', () => isolated('labels', async ({ client }) => {
  await rebuildCategoryType(client, canonical);
  await client.query(`ALTER TYPE "NotificationCategory" ADD VALUE 'unexpected'`);
  const before = (await client.query(`SELECT '"NotificationCategory"'::regtype::oid AS oid`)).rows;
  await assert.rejects(client.query(await sql(enumName)), /Unexpected NotificationCategory labels/);
  await client.query('ROLLBACK');
  assert.deepEqual((await client.query(`SELECT '"NotificationCategory"'::regtype::oid AS oid`)).rows, before);
}));

test('all five AI tables accept own-tenant inserts/updates and reject foreign references with 23514', () => isolated('tenants', async ({ client, url }) => {
  const { PrismaClient } = require('../src/prisma/client.ts');
  const { createAdministrator, createLedgerEstate, createProperty, createSupplier } = require('../src/testing/db-fixtures.ts');
  const { SupplierPostingService } = require('../src/ledger/posting/supplier-posting.service.ts');
  const { JournalService } = require('../src/ledger/journal/journal.service.ts');
  const prisma = new PrismaClient({ adapter: new (require('@prisma/adapter-pg').PrismaPg)({ connectionString: url }) });
  try {
    const adminFixture = await createAdministrator(prisma);
    const posting = new SupplierPostingService(new JournalService());
    const date = new Date('2026-03-01T00:00:00Z');
    async function tenant() {
      const estateId = await createLedgerEstate(prisma, adminFixture.administratorId, { cutoverDate: new Date('2026-01-01T00:00:00Z') });
      const propertyId = await createProperty(prisma, estateId);
      const supplierId = await createSupplier(prisma, estateId, adminFixture.administratorId);
      const issue = await prisma.issue.create({ data: { estateId, ref: randomUUID().slice(0, 20), type: 'Otro', title: 'Fixture', description: 'Fixture', status: 'Abierta', priority: 'Normal', source: 'Comunidad', date } });
      const account = await prisma.chartAccount.findFirstOrThrow({ where: { estateId, code: '628' } });
      const invoice = await prisma.$transaction((tx) => posting.registerInvoice(tx, { estateId, supplierId, number: randomUUID(), concept: 'Fixture', issueDate: date, vatRatePct: 0, withholdingRatePct: 0, lines: [{ accountId: account.id, base: 10000 }] }));
      await prisma.$transaction((tx) => posting.pay(tx, { estateId, supplierId, date, amount: 5000, method: 'Transferencia', invoiceIds: [invoice.id] }));
      const bank = await prisma.bankAccount.findFirstOrThrow({ where: { estateId } });
      const line = await prisma.journalLine.findFirstOrThrow({ where: { estateId, accountId: bank.chartAccountId } });
      const entry = await prisma.bankExtractEntry.create({ data: { estateId, bankAccountId: bank.id, date, concept: 'Fixture', amount: '-50' } });
      return { estateId, supplierId, issueId: issue.id, bankId: bank.id, entryId: entry.id, lineId: line.id, invoiceId: invoice.id };
    }
    const own = await tenant(); const foreign = await tenant();
    const fixtures = [
      ['ai_policies', { id: randomUUID(), estate_id: own.estateId, supplier_id: own.supplierId, updated_by_user_id: adminFixture.userId, updated_at: date }, ['supplier_id']],
      ['ai_incidents', { issue_id: own.issueId, estate_id: own.estateId, supplier_id: own.supplierId, updated_at: date }, ['supplier_id', 'issue_id', 'canonical_issue_id']],
      ['ai_messages', { id: randomUUID(), estate_id: own.estateId, issue_id: own.issueId, supplier_id: own.supplierId, direction: 'outbound', dedupe_key: randomUUID(), address: 'fixture@test.local', subject: 'Fixture', body: 'Fixture' }, ['supplier_id', 'issue_id']],
      ['ai_invoice_documents', { id: randomUUID(), estate_id: own.estateId, invoice_id: own.invoiceId, file_name: 'fixture.pdf', mime_type: 'application/pdf', storage_key: 'fixture', file_hash: randomUUID(), uploaded_by_user_id: adminFixture.userId }, ['invoice_id']],
      ['ai_reconciliation_suggestions', { id: randomUUID(), estate_id: own.estateId, bank_account_id: own.bankId, candidate_key: randomUUID(), entry_ids: [own.entryId], line_ids: [own.lineId], invoice_ids: [own.invoiceId], evidence: '{}' }, ['bank_account_id', 'entry_ids', 'line_ids', 'invoice_ids']],
    ];
    const foreignValues = { supplier_id: foreign.supplierId, issue_id: foreign.issueId, canonical_issue_id: foreign.issueId, invoice_id: foreign.invoiceId, bank_account_id: foreign.bankId, entry_ids: [foreign.entryId], line_ids: [foreign.lineId], invoice_ids: [foreign.invoiceId] };
    async function insert(table, row) {
      const columns = Object.keys(row);
      return client.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
    }
    for (const [table, row, references] of fixtures) {
      // Each attempted invalid INSERT is rolled back; no uniqueness failures mask the tenant guard.
      for (const column of references) {
        await assert.rejects(insert(table, { ...row, [column]: foreignValues[column] }), (error) => error.code === '23514');
      }
      await insert(table, row);
      const key = table === 'ai_incidents' ? 'issue_id' : 'id';
      await client.query(`UPDATE ${table} SET estate_id=$1 WHERE ${key}=$2`, [own.estateId, row[key]]);
      for (const column of references) {
        await assert.rejects(client.query(`UPDATE ${table} SET ${column}=$1 WHERE ${key}=$2`, [foreignValues[column], row[key]]), (error) => error.code === '23514');
      }
      const actual = (await client.query(`SELECT estate_id FROM ${table} WHERE ${key}=$1`, [row[key]])).rows;
      assert.deepEqual(actual, [{ estate_id: own.estateId }]);
    }
  } finally { await prisma.$disconnect(); }
}));

// ── Las incidencias son SIEMPRE de la comunidad (20261101100000_issues_belong_to_estate) ──────────────────────────────────
// `templateOld` es el estado de `main` (con 20261028120000: `property_id`, `scope`, `reporter_user_id`) más las migraciones de incidencias
// propias; sobre él se ejercita la migración. `template` es la cadena completa desde una base vacía.

async function legacyIssues(url, client) {
  const { PrismaClient } = require('../src/prisma/client.ts');
  const { createAdministrator, createEstate, createProperty, createOwnerUser } = require('../src/testing/db-fixtures.ts');
  const prisma = new PrismaClient({ adapter: new (require('@prisma/adapter-pg').PrismaPg)({ connectionString: url }) });
  try {
    const admin = await createAdministrator(prisma);
    const estateId = await createEstate(prisma, admin.administratorId);
    const propertyId = await createProperty(prisma, estateId);
    const ownerId = await createOwnerUser(prisma);
    const otherOwnerId = await createOwnerUser(prisma);
    const insert = async (scope, reporter) => (await client.query(
      `INSERT INTO issues (id, ref, property_id, scope, reporter_user_id, type, title, description, status, priority, source, date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3::"IssueScope", $4, 'Otro', 'Legacy', 'Descripción', 'Abierta', 'Normal', 'Propietario', now(), now(), now()) RETURNING id`,
      [randomUUID().slice(0, 20), propertyId, scope, reporter])).rows[0].id;
    const report = (issueId, userId) => client.query(
      `INSERT INTO issue_reports (id, issue_id, channel, content, reporter_user_id, received_at) VALUES (gen_random_uuid(), $1, 'form', 'x', $2, now())`, [issueId, userId]);
    // Sin aviso previo: se crea uno con su autor.
    const bare = await insert('Privada', ownerId);
    // Con un aviso sin autor: se le asigna.
    const anonymous = await insert('Zona común', ownerId);
    await report(anonymous, null);
    // Con un aviso ya suyo: no se duplica.
    const already = await insert('Zona común', ownerId);
    await report(already, ownerId);
    // Con un aviso de otra persona: el suyo se añade al lado.
    const shared = await insert('Zona común', ownerId);
    await report(shared, otherOwnerId);
    // Sin autor (la creó la gestión): no se inventa ninguno.
    const managed = await insert('Zona común', null);
    return { estateId, ownerId, otherOwnerId, bare, anonymous, already, shared, managed };
  } finally { await prisma.$disconnect(); }
}

test('issues belong to the estate: estate_id comes from the property and reporter_user_id moves into issue_reports', () => isolated('estateissues', async ({ client, url }) => {
  const legacy = await legacyIssues(url, client);
  await client.query(await sql(estateIssuesName));
  const issues = (await client.query('SELECT id, estate_id FROM issues')).rows;
  assert.equal(issues.length, 5);
  assert.ok(issues.every((r) => r.estate_id === legacy.estateId));
  const reporters = async (id) => (await client.query('SELECT reporter_user_id FROM issue_reports WHERE issue_id = $1 ORDER BY reporter_user_id', [id])).rows.map((r) => r.reporter_user_id);
  assert.deepEqual(await reporters(legacy.bare), [legacy.ownerId]);
  assert.deepEqual(await reporters(legacy.anonymous), [legacy.ownerId]);
  assert.deepEqual(await reporters(legacy.already), [legacy.ownerId]);
  assert.deepEqual((await reporters(legacy.shared)).sort(), [legacy.ownerId, legacy.otherOwnerId].sort());
  assert.deepEqual(await reporters(legacy.managed), []);
}, templateOld));

test('issues belong to the estate: refuses an unknown ai_check_tenant() and leaves it untouched', () => isolated('estateunknown', async ({ client }) => {
  await client.query('ALTER FUNCTION public.ai_check_tenant() SECURITY DEFINER');
  const before = (await client.query(`SELECT pg_get_functiondef('public.ai_check_tenant()'::regprocedure) AS definition`)).rows;
  await assert.rejects(client.query(await sql(estateIssuesName)), /Unrecognized public.ai_check_tenant/);
  await client.query('ROLLBACK');
  assert.deepEqual((await client.query(`SELECT pg_get_functiondef('public.ai_check_tenant()'::regprocedure) AS definition`)).rows, before);
}, templateOld));

test('the full chain from an empty database ends with issues owned by the estate only', () => isolated('finalshape', async ({ client }) => {
  const columns = (await client.query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'issues'`)).rows;
  for (const gone of ['scope', 'property_id', 'reporter_user_id', 'category']) assert.ok(!columns.some((c) => c.column_name === gone), `issues.${gone}`);
  assert.equal(columns.find((c) => c.column_name === 'estate_id').is_nullable, 'NO');
  for (const kept of ['type', 'location', 'status_before_info_request', 'rating', 'rating_comment']) assert.ok(columns.some((c) => c.column_name === kept), `issues.${kept}`);
  assert.equal((await client.query(`SELECT 1 FROM pg_type WHERE typname = 'IssueScope'`)).rowCount, 0);
  assert.equal((await client.query(`SELECT 1 FROM pg_type WHERE typname = 'IssueCategory'`)).rowCount, 0);
  const timeline = (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'issue_timeline_entries' AND column_name = 'internal'`)).rows;
  assert.equal(timeline.length, 1);
  assert.equal((await client.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'issue_affected_users'`)).rowCount, 1);
  // La guarda de inquilino compara con `issues.estate_id`.
  const body = (await client.query(`SELECT prosrc FROM pg_proc WHERE oid = 'public.ai_check_tenant()'::regprocedure`)).rows[0].prosrc;
  assert.ok(!/JOIN properties/.test(body), 'la guarda ya no cruza issues con properties');
  assert.ok(/i\.estate_id=NEW\.estate_id/.test(body));
}));

// ── Una incidencia es siempre una incidencia (20261101120000_issues_drop_category) ────────────────────────────────────────

test('dropping issues.category keeps every issue, whatever category it had, and removes the IssueCategory type', () => isolated('dropcategory', async ({ client, url }) => {
  const { PrismaClient } = require('../src/prisma/client.ts');
  const { createAdministrator, createEstate } = require('../src/testing/db-fixtures.ts');
  const prisma = new PrismaClient({ adapter: new (require('@prisma/adapter-pg').PrismaPg)({ connectionString: url }) });
  let estateId;
  try {
    const admin = await createAdministrator(prisma);
    estateId = await createEstate(prisma, admin.administratorId);
  } finally { await prisma.$disconnect(); }
  const labels = ['Incidencia', 'Solicitud', 'Consulta', 'Sugerencia'];
  for (const label of labels) {
    await client.query(
      `INSERT INTO issues (id, ref, estate_id, category, type, title, description, status, priority, source, date, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3::"IssueCategory", 'Otro', $3, 'Descripción', 'Abierta', 'Normal', 'Propietario', now(), now(), now())`,
      [randomUUID().slice(0, 20), estateId, label]);
  }
  await client.query(await sql(dropCategoryName));
  assert.deepEqual((await client.query('SELECT title FROM issues ORDER BY title')).rows.map((r) => r.title), [...labels].sort());
  assert.equal((await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'issues' AND column_name = 'category'`)).rowCount, 0);
  assert.equal((await client.query(`SELECT 1 FROM pg_type WHERE typname = 'IssueCategory'`)).rowCount, 0);
}, templatePre));

// ── Incidencias 100 % manuales (20261106110000_remove_incident_automation) ─────────────────────────────────────────────

test('removing incident automation drops only its own tables and keeps the shared AI infrastructure', () => isolated('removeauto', async ({ client }) => {
  const tables = async () => new Set((await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)).rows.map((r) => r.table_name));
  const before = await tables();
  const removed = ['ai_incidents', 'ai_messages', 'automation_rules', 'ai_policies', 'administrator_features'];
  for (const t of removed) assert.ok(before.has(t), `${t} existe antes`);
  await client.query(await sql(removeAutomationName));
  const after = await tables();
  for (const t of removed) assert.ok(!after.has(t), `${t} ya no existe`);
  for (const t of ['ai_jobs', 'ai_requests', 'ai_audit', 'ai_batches', 'ai_invoice_documents', 'ai_reconciliation_suggestions', 'issue_waits', 'agenda_tasks']) assert.ok(after.has(t), `${t} se conserva`);
  assert.equal((await client.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_jobs' AND column_name = 'issue_id'`)).rowCount, 0);
}));

test('removing incident automation with data: legacy tasks/waits/jobs are retired, accounting and its FKs are untouched', () => isolated('removedata', async ({ client, url }) => {
  const { PrismaClient } = require('../src/prisma/client.ts');
  const { createAdministrator, createLedgerEstate, createSupplier } = require('../src/testing/db-fixtures.ts');
  const { SupplierPostingService } = require('../src/ledger/posting/supplier-posting.service.ts');
  const { JournalService } = require('../src/ledger/journal/journal.service.ts');
  const prisma = new PrismaClient({ adapter: new (require('@prisma/adapter-pg').PrismaPg)({ connectionString: url }) });
  const date = new Date('2026-03-01T00:00:00Z');
  const removedKinds = ['approve_provider_message', 'confirm_appointment', 'review_failed_delivery', 'review_provider_reply', 'review_duplicate'];
  let ids;
  try {
    const admin = await createAdministrator(prisma);
    const estateId = await createLedgerEstate(prisma, admin.administratorId, { cutoverDate: new Date('2026-01-01T00:00:00Z') });
    const supplierId = await createSupplier(prisma, estateId, admin.administratorId);
    const issue = await prisma.issue.create({ data: { estateId, ref: randomUUID().slice(0, 20), type: 'Otro', title: 'Fixture', description: 'Fixture', status: 'Abierta', priority: 'Normal', source: 'Comunidad', date } });
    const posting = new SupplierPostingService(new JournalService());
    const account = await prisma.chartAccount.findFirstOrThrow({ where: { estateId, code: '628' } });
    const invoice = await prisma.$transaction((tx) => posting.registerInvoice(tx, { estateId, supplierId, number: randomUUID(), concept: 'Fixture', issueDate: date, vatRatePct: 0, withholdingRatePct: 0, lines: [{ accountId: account.id, base: 10000 }] }));
    const bank = await prisma.bankAccount.findFirstOrThrow({ where: { estateId } });
    const entry = await prisma.bankExtractEntry.create({ data: { estateId, bankAccountId: bank.id, date, concept: 'Fixture', amount: '-50' } });
    await client.query('INSERT INTO ai_invoice_documents (id, estate_id, invoice_id, file_name, mime_type, storage_key, file_hash, uploaded_by_user_id) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)', [estateId, invoice.id, 'f.pdf', 'application/pdf', 'k', randomUUID(), admin.userId]);
    await client.query('INSERT INTO ai_reconciliation_suggestions (id, estate_id, bank_account_id, candidate_key, entry_ids, line_ids, invoice_ids, evidence) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)', [estateId, bank.id, randomUUID(), [entry.id], [], [invoice.id], '{}']);
    // Restos de la automatización: tareas abiertas de los tipos retirados (y una humana que NO debe tocarse), una espera ligada a un
    // mensaje, los jobs de incidencia y jobs compartidos (factura, semanal).
    for (const kind of removedKinds)
      await prisma.agendaTask.create({ data: { administratorId: admin.administratorId, estateId, issueId: issue.id, title: kind, startAt: date, endAt: date, status: 'PENDIENTE', kind, source: 'issue', sourceRef: kind + ':' + issue.id } });
    const human = await prisma.agendaTask.create({ data: { administratorId: admin.administratorId, estateId, issueId: issue.id, title: 'humana', startAt: date, endAt: date, status: 'PENDIENTE', kind: 'review_issue', source: 'issue', sourceRef: 'review:' + issue.id } });
    const wait = await prisma.issueWait.create({ data: { issueId: issue.id, party: 'provider', kind: 'provider_reply', refType: 'ai_message', refId: randomUUID(), startedAt: date, dueAt: date } });
    const ownWait = await prisma.issueWait.create({ data: { issueId: issue.id, party: 'owner', kind: 'owner_reply', partyLabel: 'Propietaria', startedAt: date } });
    for (const kind of ['incident', 'send', 'reply', 'issue_wait_due'])
      await client.query('INSERT INTO ai_jobs (id, estate_id, kind, entity_id, dedupe_key, issue_id) VALUES (gen_random_uuid(), $1, $2, $3, $4, $3)', [estateId, kind, issue.id, kind + ':' + randomUUID()]);
    await client.query('INSERT INTO ai_jobs (id, estate_id, kind, entity_id, dedupe_key) VALUES (gen_random_uuid(), $1, $2, $3, $4)', [estateId, 'invoice', randomUUID(), 'invoice:' + randomUUID()]);
    await client.query('INSERT INTO ai_jobs (id, estate_id, kind, entity_id, dedupe_key) VALUES (gen_random_uuid(), $1, $2, $1, $3)', [estateId, 'weekly', 'weekly:' + randomUUID()]);
    ids = { humanId: human.id, waitId: wait.id, ownWaitId: ownWait.id };
  } finally { await prisma.$disconnect(); }

  const count = async (table) => Number((await client.query('SELECT count(*) FROM ' + table)).rows[0].count);
  const shared = async () => ({ invoiceDocs: await count('ai_invoice_documents'), suggestions: await count('ai_reconciliation_suggestions'), journal: await count('journal_lines'), invoices: await count('supplier_invoices'), entries: await count('bank_extract_entries') });
  const fks = async () => (await client.query("SELECT conrelid::regclass::text AS t, conname FROM pg_constraint WHERE contype = 'f' AND conrelid::regclass::text IN ('ai_jobs','ai_requests','ai_audit','ai_invoice_documents','ai_reconciliation_suggestions','ai_weekly_snapshots','bank_extract_entries','journal_lines','supplier_invoices') AND conname <> 'ai_jobs_issue_fk' ORDER BY 1,2")).rows;
  const before = await shared();
  const fkBefore = await fks();

  await client.query(await sql(removeAutomationName));

  for (const kind of removedKinds) {
    const [row] = (await client.query('SELECT status, outcome, cancelled_at FROM agenda_tasks WHERE kind = $1', [kind])).rows;
    assert.deepEqual([row.status, row.outcome], ['CANCELADA', 'superseded'], kind);
    assert.ok(row.cancelled_at, kind);
  }
  assert.equal((await client.query("SELECT count(*)::int AS n FROM agenda_tasks WHERE kind = ANY($1) AND status IN ('PENDIENTE','EN_CURSO','EN_ESPERA')", [removedKinds])).rows[0].n, 0);
  assert.equal((await client.query('SELECT status FROM agenda_tasks WHERE id = $1', [ids.humanId])).rows[0].status, 'PENDIENTE', 'la tarea humana no se toca');
  const w = (await client.query('SELECT ended_at, end_reason FROM issue_waits WHERE id = $1', [ids.waitId])).rows[0];
  assert.ok(w.ended_at);
  assert.equal(w.end_reason, 'superseded');
  assert.equal((await client.query('SELECT ended_at FROM issue_waits WHERE id = $1', [ids.ownWaitId])).rows[0].ended_at, null, 'la espera del propietario sigue abierta');
  assert.deepEqual((await client.query('SELECT kind FROM ai_jobs ORDER BY kind')).rows.map((r) => r.kind), ['invoice', 'weekly']);
  assert.deepEqual(await shared(), before);
  assert.deepEqual(await fks(), fkBefore, 'las FKs de la IA compartida y de la contabilidad no cambian');
  assert.equal((await client.query("SELECT 1 FROM pg_proc WHERE proname = 'ai_check_tenant'")).rowCount, 1);
}));

// ── Contador atómico de referencias (20261106120000_issue_reference_counters) ──────────────────────────────────────────

test('issue reference counters start from the highest reference already used in each year', () => isolated('refcounter', async ({ client, url }) => {
  const { PrismaClient } = require('../src/prisma/client.ts');
  const { createAdministrator, createEstate } = require('../src/testing/db-fixtures.ts');
  const prisma = new PrismaClient({ adapter: new (require('@prisma/adapter-pg').PrismaPg)({ connectionString: url }) });
  try {
    const admin = await createAdministrator(prisma);
    const estateId = await createEstate(prisma, admin.administratorId);
    const date = new Date('2026-03-01T00:00:00Z');
    for (const ref of ['#INC-2026-005', '#INC-2026-012', '#INC-2026-009', '#INC-2025-300', 'REF-LIBRE', '#INC-2026-xx'])
      await prisma.issue.create({ data: { estateId, ref, type: 'Otro', title: 'Fixture', description: 'Fixture', status: 'Abierta', priority: 'Normal', source: 'Comunidad', date } });
  } finally { await prisma.$disconnect(); }
  await client.query(await sql(referenceCounterName));
  const rows = (await client.query('SELECT year, last_value FROM issue_reference_counters ORDER BY year')).rows;
  assert.deepEqual(rows, [{ year: 2025, last_value: 300 }, { year: 2026, last_value: 12 }]);
  // El UPSERT atómico del servicio: siguiente número y año nuevo.
  const next = async (year) => (await client.query('INSERT INTO issue_reference_counters (year, last_value) VALUES ($1, 1) ON CONFLICT (year) DO UPDATE SET last_value = issue_reference_counters.last_value + 1 RETURNING last_value', [year])).rows[0].last_value;
  assert.equal(await next(2026), 13);
  assert.equal(await next(2026), 14);
  assert.equal(await next(2027), 1);
}));
