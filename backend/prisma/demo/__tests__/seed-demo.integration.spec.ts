import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '../../../src/prisma/client';
import { isIBAN } from 'class-validator';
import { AuthService } from '../../../src/auth/auth.service';
import { EstateAccessService } from '../../../src/estate-access/estate-access.service';
import { AssetsService } from '../../../src/inspections/assets.service';
import { CryptoService } from '../../../src/sepa/crypto.service';
import { SepaPain008Service } from '../../../src/sepa/sepa-pain008.service';
import {
  createAdministrator,
  createLedgerEstate,
} from '../../../src/testing/db-fixtures';
import { JournalService } from '../../../src/ledger/journal/journal.service';
import { DemoSeedModule } from '../demo-seed.module';
import { DEMO_ACCOUNT_SPECS, DEMO_PASSWORD } from '../data/accounts';
import { ESTATE_SPECS } from '../data/estates';
import { DEMO_EMAIL_DOMAIN } from '../guard';
import { isValidCreditorId } from '../lib/creditor-id';
import { isValidIban } from '../lib/iban';
import { isValidCif, isValidSpanishTaxId } from '../lib/nif';
import { isValidParcelReference, isValidUnitReference } from '../lib/catastro';
import { F1_FIGURES } from '../phases/f1-figures';
import { F2_FIGURES } from '../phases/f2-figures';
import { INSTALLATION_FIGURES, INSTALLATIONS } from '../data/installations';
import { SUPPLIER_PANEL_FIGURES } from '../phases/f2-supplier-panel';
import { OWNER_PANEL_FIGURES } from '../phases/f3-owner-panel';
import { documentVisibleWhere } from '../../../src/documents/document-access.service';
import { GENERAL_DATA_FIGURES } from '../phases/f6-general-data';
import { PORTFOLIO } from '../data/portfolio';
import { CONTRACT_EXTRAS } from '../phases/f5-contracts';
import { expectedIncidentUnits, planCases } from '../phases/f4-portfolio';
import { createPrismaClient } from '../../../src/prisma/create-prisma-client';

/** F4 (cartera ampliada): unidades y solicitantes de adhesión que añade a los totales de F1. */
const PORTFOLIO_UNITS = PORTFOLIO.reduce((n, e) => n + e.floors * e.doors, 0);
const PORTFOLIO_REQUESTERS = PORTFOLIO.reduce((n, e) => n + e.adhesionAgoDays.length, 0);
import { PropertyOverviewService } from '../../../src/properties/property-overview.service';
import { PropertyAccessService } from '../../../src/estate-access/property-access.service';
import { StorageService } from '../../../src/files/storage.service';
import { SupplierOverviewService } from '../../../src/suppliers/supplier-overview.service';
import { SuppliersService } from '../../../src/suppliers/suppliers.service';
import {
  assertDbLooksDemo,
  DEMO_DB_MARKER,
  DemoGuardError,
  probeDatabase,
  type QueryFn,
} from '../guard';
import {
  createDefaultDeps,
  runSeedDemo,
  type SeedDemoDeps,
} from '../seed-demo';
import {
  clearStorageDir,
  resolveStorageDirToClear,
  StorageDirError,
  wipeDatabase,
} from '../wipe';

/**
 * T0.14 — integración del seed demo + wipe contra una BD POSTGRES LOCAL
 * AISLADA que el propio test crea y borra (`domora_demo_test`).
 *
 * Requiere `DEMO_TEST_ADMIN_URL` (una URL a la BD `postgres` de una instancia
 * LOCAL con permiso CREATE DATABASE). Sin ella la suite se salta: así
 * `npm test` en una máquina sin Postgres no falla (el CI la define en T0.15).
 * Rechaza cualquier host que no sea localhost/127.0.0.1/::1.
 *
 * Es la VERIFICACIÓN EMPÍRICA de T0.1 (TRUNCATE vs triggers BEFORE TRUNCATE)
 * y T0.6 (COMMENT ON DATABASE) que hasta ahora solo estaban inferidas leyendo
 * SQL.
 */
// El seed completo (10 fincas, cartera, contratos y documentos) tarda ~2 min y el test (d) lo ejecuta dos veces.
jest.setTimeout(900_000);

const ADMIN_URL = process.env['DEMO_TEST_ADMIN_URL'];
const TEST_DB = 'domora_demo_test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function assertLocal(url: string): URL {
  const u = new URL(url);
  if (!LOCAL_HOSTS.has(u.hostname)) {
    throw new Error(
      `Este test solo usa Postgres LOCAL; host rechazado: ${u.hostname}`,
    );
  }
  return u;
}

const describeIf = ADMIN_URL ? describe : describe.skip;
if (!ADMIN_URL) {
  console.warn(
    '[seed-demo.integration] DEMO_TEST_ADMIN_URL no definida: suite omitida.',
  );
}

function urlFor(adminUrl: string, db: string): string {
  const u = assertLocal(adminUrl);
  u.pathname = `/${db}`;
  return u.toString();
}

async function tableCounts(
  prisma: PrismaClient,
): Promise<Record<string, number>> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const out: Record<string, number> = {};
  for (const { tablename } of tables) {
    if (tablename === '_prisma_migrations') continue;
    const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM "${tablename}"`,
    );
    out[tablename] = Number(rows[0].n);
  }
  return out;
}

function nonEmpty(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

/**
 * Huella determinista de los datos de F1 (sin ids ni fechas ni hashes): dos
 * ejecuciones con la misma semilla/ancla deben producir EXACTAMENTE la misma.
 */
async function f1Fingerprint(prisma: PrismaClient): Promise<string> {
  const users = await prisma.user.findMany({
    orderBy: { email: 'asc' },
    select: {
      email: true,
      fullName: true,
      role: true,
      phone: true,
      taxId: true,
    },
  });
  const estates = await prisma.estate.findMany({
    orderBy: { name: 'asc' },
    select: {
      name: true,
      cif: true,
      creditorId: true,
      iban: true,
      cadastralReference: true,
      postalCode: true,
    },
  });
  const properties = await prisma.property.findMany({
    where: { estateId: { not: null } },
    orderBy: [{ estate: { name: 'asc' } }, { ref: 'asc' }],
    select: {
      ref: true,
      type: true,
      status: true,
      builtAreaM2: true,
      participationQuota: true,
      quotaMonthly: true,
      cadastralReference: true,
    },
  });
  const external = await prisma.externalOwner.findMany({
    orderBy: [{ fullName: 'asc' }, { property: { ref: 'asc' } }],
    select: { fullName: true, taxId: true, email: true },
  });
  const mandates = await prisma.mandate.count();
  return JSON.stringify({ users, estates, properties, external, mandates });
}

describeIf('seed-demo (integración, BD local aislada)', () => {
  let admin: PrismaClient;
  let prisma: PrismaClient;
  let testUrl: string;
  let storageRoot: string;
  let storageDir: string;
  const savedEnv = { ...process.env };

  const query: QueryFn = (sql) =>
    prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(sql);

  function demoEnv(overrides: Record<string, string | undefined> = {}) {
    return {
      ...process.env,
      DEMO_MODE: 'true',
      DATABASE_URL: testUrl,
      STORAGE_DIR: storageDir,
      ...overrides,
    } as NodeJS.ProcessEnv;
  }

  beforeAll(async () => {
    assertLocal(ADMIN_URL!);
    testUrl = urlFor(ADMIN_URL!, TEST_DB);
    admin = createPrismaClient(ADMIN_URL);
    // Solo borramos/creamos EXACTAMENTE la BD de este test.
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`,
    );
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB}"`);

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: path.resolve(__dirname, '..', '..', '..'),
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: 'pipe',
      shell: true,
    });

    prisma = createPrismaClient(testUrl);

    storageRoot = mkdtempSync(path.join(tmpdir(), 'domora-it-'));
    storageDir = path.join(storageRoot, 'storage-demo');
    mkdirSync(storageDir);

    // Entorno que el DemoSeedModule (Nest) y su PrismaService leen.
    process.env['DEMO_MODE'] = 'true';
    process.env['DATABASE_URL'] = testUrl;
    process.env['STORAGE_DIR'] = storageDir;
    process.env['CATASTRO_ENABLED'] = 'false';
  });

  afterAll(async () => {
    for (const k of [
      'DEMO_MODE',
      'DATABASE_URL',
      'STORAGE_DIR',
      'CATASTRO_ENABLED',
    ]) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await prisma?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`,
      );
      await admin.$disconnect();
    }
    if (storageRoot) rmSync(storageRoot, { recursive: true, force: true });
  });

  describe('(a) T0.1: triggers BEFORE TRUNCATE (verificación empírica)', () => {
    const IMMUTABLE_TABLES = [
      'journal_entries',
      'journal_lines',
      'receipt_lines',
      'supplier_invoice_lines',
    ];

    it('existen los 4 triggers BEFORE TRUNCATE con los nombres inferidos', async () => {
      const rows = await query(
        `SELECT c.relname AS tbl, t.tgname AS name
           FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE NOT t.tgisinternal AND (t.tgtype & 32) = 32 AND (t.tgtype & 2) = 2
          ORDER BY c.relname`,
      );
      console.log(
        '[T0.1 real] triggers BEFORE TRUNCATE:',
        JSON.stringify(rows),
      );
      const byTable = Object.fromEntries(
        rows.map((r) => [r['tbl'], r['name']]),
      );
      expect(byTable).toMatchObject({
        journal_entries: 'journal_entries_no_truncate',
        journal_lines: 'journal_lines_no_truncate',
        receipt_lines: 'receipt_lines_no_truncate',
        supplier_invoice_lines: 'supplier_invoice_lines_no_truncate',
      });
    });

    it.each(IMMUTABLE_TABLES)(
      'TRUNCATE ingenuo de %s FALLA; con set_config(domora.journal_purge) funciona',
      async (table) => {
        let naiveMessage = '';
        await expect(
          prisma.$transaction(async (tx) => {
            try {
              await tx.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
            } catch (e) {
              naiveMessage = e instanceof Error ? e.message : String(e);
              throw e;
            }
          }),
        ).rejects.toBeDefined();
        console.log(
          `[T0.1 real] TRUNCATE ingenuo ${table}: ${naiveMessage.split('\n').slice(-3).join(' | ')}`,
        );
        expect(naiveMessage).toMatch(/DM020/);

        // Con el GUC local a la tx pasa (se revierte lanzando un centinela).
        const sentinel = new Error('rollback-sentinel');
        await expect(
          prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT set_config('domora.journal_purge', 'on', true)`;
            await tx.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
            throw sentinel;
          }),
        ).rejects.toBe(sentinel);
      },
    );
  });

  describe('(e) guard: aborta sin borrar filas', () => {
    let before: Record<string, number>;

    beforeAll(async () => {
      // Datos reales, incluido un asiento en el diario (tabla inmutable).
      const fx = await createAdministrator(prisma, { name: 'Gestora no demo' });
      const estateId = await createLedgerEstate(prisma, fx.administratorId, {
        cutoverDate: new Date('2026-01-01T00:00:00Z'),
      });
      await prisma.$transaction((tx) =>
        new JournalService().post(tx, {
          estateId,
          date: new Date('2026-03-10T00:00:00Z'),
          sourceType: 'manual',
          concept: 'Comisión bancaria (fixture)',
          lines: [
            { account: { role: 'bank_fees' }, debit: 250 },
            { account: { role: 'bank' }, credit: 250 },
          ],
        }),
      );
      await prisma.$executeRawUnsafe(
        `COMMENT ON DATABASE "${TEST_DB}" IS NULL`,
      );
      before = await tableCounts(prisma);
      expect(before['journal_entries']).toBeGreaterThan(0);
      expect(before['users']).toBeGreaterThan(0);
    });

    /** Deps REALES ligadas a la BD de pruebas, con espías en wipe/seed. */
    function spiedDeps(env: NodeJS.ProcessEnv) {
      const real = createDefaultDeps(env);
      const wipe = jest.fn(real.wipe);
      const seed = jest.fn(real.seed);
      const markDatabase = jest.fn(real.markDatabase);
      const deps: SeedDemoDeps = {
        ...real,
        wipe,
        seed,
        markDatabase,
        // el pool de prisma lo cierra createDefaultDeps; aquí no hace falta
        disconnect: real.disconnect,
      };
      return { deps, wipe, seed, markDatabase };
    }

    it('apuntando a una BD llamada "domora" (sin demo) el guard aborta y no se borra nada', async () => {
      // El env dice "domora": el guard (capa 2) aborta antes de abrir ninguna
      // consulta. Las deps reales apuntan a la BD de pruebas pero nunca se usan.
      const badEnv = demoEnv({
        DATABASE_URL: urlFor(ADMIN_URL!, 'domora'),
      });
      const { deps, wipe, seed } = spiedDeps(demoEnv());
      const querySpy = jest.spyOn(deps, 'query');
      await expect(
        runSeedDemo(badEnv, ['--reset'], deps),
      ).rejects.toBeInstanceOf(DemoGuardError);
      expect(wipe).not.toHaveBeenCalled();
      expect(seed).not.toHaveBeenCalled();
      expect(querySpy).not.toHaveBeenCalled();
      expect(await tableCounts(prisma)).toEqual(before);
    });

    it('sin DEMO_MODE el guard aborta y no se borra nada', async () => {
      const { deps, wipe } = spiedDeps(demoEnv());
      await expect(
        runSeedDemo(demoEnv({ DEMO_MODE: undefined }), ['--reset'], deps),
      ).rejects.toBeInstanceOf(DemoGuardError);
      expect(wipe).not.toHaveBeenCalled();
      expect(await tableCounts(prisma)).toEqual(before);
    });

    it('capa 4: BD con datos, sin marcador ni usuarios demo => aborta sin borrar', async () => {
      const { deps, wipe } = spiedDeps(demoEnv());
      await expect(runSeedDemo(demoEnv(), ['--reset'], deps)).rejects.toThrow(
        /no es una BD demo/,
      );
      expect(wipe).not.toHaveBeenCalled();
      expect(await tableCounts(prisma)).toEqual(before);
    });

    it('sin --reset sobre BD con datos (pero ya marcada demo) aborta sin borrar', async () => {
      await prisma.$executeRawUnsafe(
        `DO $$ BEGIN EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), '${DEMO_DB_MARKER}'); END $$`,
      );
      const { deps, wipe, seed } = spiedDeps(demoEnv());
      await expect(runSeedDemo(demoEnv(), [], deps)).rejects.toThrow(
        /usa --reset/,
      );
      expect(wipe).not.toHaveBeenCalled();
      expect(seed).not.toHaveBeenCalled();
      expect(await tableCounts(prisma)).toEqual(before);
    });

    it('STORAGE_DIR no demo y no vacío aborta ANTES de tocar la BD', async () => {
      const foreign = path.join(storageRoot, 'uploads');
      mkdirSync(foreign);
      writeFileSync(path.join(foreign, 'importante.pdf'), 'x');
      const { deps, wipe } = spiedDeps(demoEnv({ STORAGE_DIR: foreign }));
      await expect(
        runSeedDemo(demoEnv({ STORAGE_DIR: foreign }), ['--reset'], deps),
      ).rejects.toBeInstanceOf(StorageDirError);
      expect(wipe).not.toHaveBeenCalled();
      expect(await tableCounts(prisma)).toEqual(before);
      expect(existsSync(path.join(foreign, 'importante.pdf'))).toBe(true);
    });
  });

  describe('(b)(c)(d) wipe, catálogo global, marcador e idempotencia', () => {
    let catalogBefore: number;

    it('(b) el wipe vacía todo salvo _prisma_migrations y el catálogo global de inspection_types', async () => {
      const [{ n }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM inspection_types WHERE estate_id IS NULL`;
      catalogBefore = Number(n);
      console.log(
        `[T0.1 real] inspection_types globales antes del wipe: ${catalogBefore}`,
      );
      expect(catalogBefore).toBeGreaterThan(0);
      const migrationsBefore = await query(
        `SELECT count(*)::int AS n FROM _prisma_migrations`,
      );

      const before = await tableCounts(prisma);
      expect(before['journal_entries']).toBeGreaterThan(0);

      const result = await wipeDatabase(prisma);
      console.log('[T0.1 real] wipe:', JSON.stringify(result));

      const after = await tableCounts(prisma);
      expect(nonEmpty(after)).toEqual({ inspection_types: catalogBefore });
      expect(result.restoredInspectionTypes).toBe(catalogBefore);
      expect(
        await query(`SELECT count(*)::int AS n FROM _prisma_migrations`),
      ).toEqual(migrationsBefore);
      // Solo quedan globales (ninguna fila con estate_id).
      const [{ n: scoped }] = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM inspection_types WHERE estate_id IS NOT NULL`;
      expect(Number(scoped)).toBe(0);
    });

    it('(c) COMMENT ON DATABASE se escribe, se lee con shobj_description y la capa 4 lo reconoce', async () => {
      await prisma.$executeRawUnsafe(
        `COMMENT ON DATABASE "${TEST_DB}" IS NULL`,
      );
      // Poblar con un user NO demo para que solo el marcador pueda salvar a la BD.
      await prisma.user.create({
        data: {
          email: 'alguien@example.com',
          passwordHash: 'x',
          fullName: 'No demo',
          role: 'C',
        },
      });
      const probeSin = await probeDatabase(query);
      expect(probeSin).toEqual({
        hasData: true,
        hasDemoUser: false,
        comment: null,
      });
      expect(() => assertDbLooksDemo(probeSin)).toThrow(DemoGuardError);

      await prisma.$executeRawUnsafe(
        `DO $$ BEGIN EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), '${DEMO_DB_MARKER}'); END $$`,
      );
      const rows = await query(
        `SELECT shobj_description(oid, 'pg_database') AS c FROM pg_database WHERE datname = current_database()`,
      );
      expect(rows[0]['c']).toBe(DEMO_DB_MARKER);
      const probeCon = await probeDatabase(query);
      expect(probeCon.comment).toBe(DEMO_DB_MARKER);
      expect(() => assertDbLooksDemo(probeCon)).not.toThrow();

      // El marcador sobrevive al wipe (no es dato de tabla).
      await wipeDatabase(prisma);
      const after = await query(
        `SELECT shobj_description(oid, 'pg_database') AS c FROM pg_database WHERE datname = current_database()`,
      );
      expect(after[0]['c']).toBe(DEMO_DB_MARKER);
      expect(nonEmpty(await tableCounts(prisma))).toEqual({
        inspection_types: catalogBefore,
      });
    });

    it('(d) seed --reset completo (guard + wipe + Nest + marcador) dos veces => mismos conteos, catálogo intacto', async () => {
      writeFileSync(path.join(storageDir, 'huérfano.pdf'), 'x');
      mkdirSync(path.join(storageDir, 'sub'));
      writeFileSync(path.join(storageDir, 'sub', 'otro.pdf'), 'x');

      const s1 = await runSeedDemo(demoEnv(), ['--reset']);
      expect(s1.storageEntriesRemoved).toBe(2);
      // Lo huérfano se borró; lo único que hay ahora es lo que sembró el propio seed (F3: los PDF de los documentos).
      expect(readdirSync(storageDir).sort()).toEqual(['documents', 'supplier-documents']);
      const run1 = await tableCounts(prisma);
      const fingerprint1 = await f1Fingerprint(prisma);
      const marker1 = await probeDatabase(query);

      const s2 = await runSeedDemo(demoEnv(), ['--reset']);
      expect(s2.wipe?.restoredInspectionTypes).toBe(catalogBefore);
      const run2 = await tableCounts(prisma);

      console.log(
        '[T0.14 real] conteos no vacíos tras el seed:',
        JSON.stringify(nonEmpty(run1)),
      );
      expect(run2).toEqual(run1);
      // Mismos datos (no solo mismos conteos): nombres, NIF, m², coeficientes…
      expect(await f1Fingerprint(prisma)).toBe(fingerprint1);
      expect(run1['inspection_types']).toBe(catalogBefore);
      expect(run1['administrators']).toBe(1);
      expect(run1['users']).toBe(60 + PORTFOLIO_UNITS + PORTFOLIO_REQUESTERS);
      expect(marker1.comment).toBe(DEMO_DB_MARKER);
      expect(marker1.hasDemoUser).toBe(true);
    });

    it('un seed sin --reset sobre la BD ya sembrada aborta', async () => {
      await expect(runSeedDemo(demoEnv(), [])).rejects.toThrow(/usa --reset/);
    });
  });

  describe('(f) F1: personas, fincas, propiedades y cuentas (sobre el seed de (d))', () => {
    let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
    let crypto: CryptoService;
    let auth: AuthService;
    let sepa: SepaPain008Service;

    beforeAll(async () => {
      app = await NestFactory.createApplicationContext(DemoSeedModule, {
        logger: false,
      });
      crypto = app.get(CryptoService, { strict: false });
      auth = app.get(AuthService, { strict: false });
      sepa = app.get(SepaPain008Service, { strict: false });
    });

    afterAll(async () => {
      await app?.close();
    });

    it('cifras exactas: 3 fincas de 40/15/6 = 61 unidades; 52 propietarios (50 con cuenta + 2 empresas)', async () => {
      expect(await prisma.estate.count()).toBe(F1_FIGURES.estates + PORTFOLIO.length);
      for (const spec of ESTATE_SPECS) {
        const estate = await prisma.estate.findFirstOrThrow({
          where: { name: spec.name },
        });
        expect(
          await prisma.property.count({ where: { estateId: estate.id } }),
        ).toBe(F1_FIGURES.unitsByEstate[spec.key]);
      }
      expect(
        await prisma.property.count({ where: { estateId: { not: null } } }),
      ).toBe(61 + PORTFOLIO_UNITS);
      const owners = await prisma.propertyMembership.findMany({
        where: { roleType: 'Propietario', status: 'linked', revokedAt: null },
        distinct: ['userId'],
      });
      expect(owners).toHaveLength(50 + PORTFOLIO_UNITS);
      expect(
        await prisma.externalOwner.count({ where: { promotedToUserId: null } }),
      ).toBe(2);
      expect(
        await prisma.propertyMembership.count({
          where: { roleType: 'Inquilino', status: 'linked' },
        }),
      ).toBe(5);
      expect(
        await prisma.adhesionRequest.count({ where: { status: 'pending' } }),
      ).toBe(3 + PORTFOLIO_REQUESTERS);
      expect(
        await prisma.propertyMembershipInvite.count({
          where: { usedAt: null, revokedAt: null },
        }),
      ).toBe(4);
      expect(await prisma.userRepresentation.count()).toBe(3);
      expect(await prisma.user.count({ where: { role: 'C' } })).toBe(58 + PORTFOLIO_UNITS + PORTFOLIO_REQUESTERS);
    });

    it('los coeficientes por m² suman EXACTAMENTE 100 por finca y las cuotas cuadran con el presupuesto', async () => {
      for (const spec of ESTATE_SPECS) {
        const estate = await prisma.estate.findFirstOrThrow({
          where: { name: spec.name },
        });
        const props = await prisma.property.findMany({
          where: { estateId: estate.id },
        });
        const hundredths = props.reduce(
          (a, p) => a + Math.round(Number(p.participationQuota) * 100),
          0,
        );
        expect(hundredths).toBe(10_000);
        // En BD también (suma decimal exacta, sin redondeo de float).
        const rows = await prisma.$queryRawUnsafe<Array<{ s: string }>>(
          `SELECT sum(participation_quota)::text AS s FROM properties WHERE estate_id = '${estate.id}'`,
        );
        expect(Number(rows[0]?.s)).toBe(100);
        const cents = props.reduce(
          (a, p) => a + Math.round(Number(p.quotaMonthly) * 100),
          0,
        );
        expect(cents).toBe(spec.monthlyBudgetCents);
        // Proporcionalidad: más m2 => coeficiente mayor o igual.
        const sorted = [...props].sort(
          (a, b) => Number(a.builtAreaM2) - Number(b.builtAreaM2),
        );
        for (let i = 1; i < sorted.length; i++) {
          // Tolerancia de 1 centesima: el resto mayor puede subir 0,01 a una
          // unidad y no a otra de m2 casi iguales.
          expect(Number(sorted[i]?.participationQuota)).toBeGreaterThanOrEqual(
            Number(sorted[i - 1]?.participationQuota) - 0.0101,
          );
        }
      }
    });

    it('NIF/NIE/CIF, creditorId e IBAN pasan validadores independientes; sin campos requeridos vacios', async () => {
      for (const u of await prisma.user.findMany({ where: { role: 'C' } })) {
        // Los titulares copian su NIF al canjear la invitacion; inquilinos y
        // solicitantes lo traen de alta. Todos deben tenerlo y ser valido.
        expect(u.taxId).toBeTruthy();
        expect(isValidSpanishTaxId(u.taxId as string)).toBe(true);
        expect(u.fullName).not.toMatch(/test|lorem|usuario \d|falsa/i);
      }
      for (const o of await prisma.externalOwner.findMany()) {
        expect(isValidSpanishTaxId(o.taxId as string)).toBe(true);
      }
      const admin = await prisma.administrator.findFirstOrThrow();
      expect(isValidCif(admin.cif)).toBe(true);
      const billing = await prisma.adminBilling.findUniqueOrThrow({
        where: { administratorId: admin.id },
      });
      expect(billing.address.length).toBeGreaterThan(10);
      expect(isIBAN(billing.iban as string)).toBe(true);
      expect(isValidIban(billing.iban as string)).toBe(true);

      for (const e of await prisma.estate.findMany()) {
        for (const field of [
          'name',
          'address',
          'streetNumber',
          'location',
          'province',
          'postalCode',
          'cadastralReference',
          'cif',
          'creditorId',
          'creditorIban',
          'creditorBic',
          'creditorPostalAddress',
          'iban',
          'color',
        ] as const) {
          expect([e.name, field, e[field] ? 'ok' : 'VACIO']).toEqual([
            e.name,
            field,
            'ok',
          ]);
        }
        expect((e.cif as string).startsWith('H')).toBe(true);
        expect(isValidCif(e.cif as string)).toBe(true);
        expect(isValidParcelReference(e.cadastralReference as string)).toBe(
          true,
        );
        expect(e.cadastralReference).toHaveLength(14);
        expect(isValidCreditorId(e.creditorId as string)).toBe(true);
        // Validador del propio backend (independiente de lib/creditor-id).
        expect(sepa.isValidSpanishCreditorId(e.creditorId as string)).toBe(
          true,
        );
        expect((e.creditorId as string).endsWith(e.cif as string)).toBe(true);
        const iban = crypto.decrypt(e.creditorIban as string);
        expect(isIBAN(iban)).toBe(true);
        expect(isValidIban(iban)).toBe(true);
        expect(iban).toBe(e.iban);
        // La cuenta bancaria por defecto lleva el mismo IBAN (cifrado).
        const bank = await prisma.bankAccount.findFirstOrThrow({
          where: { estateId: e.id, isDefault: true },
        });
        expect(crypto.decrypt(bank.ibanEnc as string)).toBe(iban);
        expect(bank.bic).toBe(e.creditorBic);
      }

      for (const p of await prisma.property.findMany({
        where: { estateId: { not: null } },
      })) {
        expect([p.id, p.ref ? 'ok' : 'sin ref']).toEqual([p.id, 'ok']);
        expect(p.viaName).toBeTruthy();
        expect(p.municipality).toBeTruthy();
        expect(p.province).toBeTruthy();
        expect(p.postalCode).toMatch(/^\d{5}$/);
        expect(isValidUnitReference(p.cadastralReference as string)).toBe(true);
        expect(p.cadastralReference).toHaveLength(20);
        expect(Number(p.builtAreaM2)).toBeGreaterThan(0);
        expect(Number(p.quotaMonthly)).toBeGreaterThan(0);
        expect(Number(p.participationQuota)).toBeGreaterThan(0);
      }
      for (const m of await prisma.mandate.findMany()) {
        const iban = crypto.decrypt(m.debtorIban);
        expect(isIBAN(iban)).toBe(true);
        expect(isValidIban(iban)).toBe(true);
        expect(m.debtorBic).toBeTruthy();
      }
    });

    it('relaciones y casos variados: ninguna unidad sin titular, varios pisos, copropiedad, empresa, representacion, inquilinos, adhesion e invitaciones', async () => {
      // Ninguna unidad de finca sin titular (la adhesion pendiente es OTRA propiedad, sin finca).
      expect(
        await prisma.property.count({
          where: {
            estateId: { not: null },
            memberships: {
              none: { roleType: 'Propietario', status: 'linked' },
            },
            externalOwners: { none: {} },
          },
        }),
      ).toBe(0);

      // Propietario con varios pisos: 1 con 4 unidades, 2 con 3, 6 con 2 (como titular principal).
      const primary = await prisma.propertyMembership.groupBy({
        by: ['userId'],
        where: {
          roleType: 'Propietario',
          status: 'linked',
          isPrimaryContact: true,
        },
        _count: { _all: true },
      });
      const histogram: Record<number, number> = {};
      for (const row of primary) {
        histogram[row._count._all] = (histogram[row._count._all] ?? 0) + 1;
      }
      expect(histogram).toEqual({ 1: 37 + PORTFOLIO_UNITS, 2: 6, 3: 2, 4: 1 });

      // Copropiedad: 4 unidades con dos titulares con cuenta.
      const perProperty = await prisma.propertyMembership.groupBy({
        by: ['propertyId'],
        where: { roleType: 'Propietario', status: 'linked' },
        _count: { _all: true },
      });
      expect(perProperty.filter((r) => r._count._all === 2)).toHaveLength(4);
      expect(perProperty.filter((r) => r._count._all > 2)).toHaveLength(0);
      // Cada unidad con titular con cuenta tiene exactamente UN contacto principal.
      expect(
        await prisma.propertyMembership.count({
          where: {
            roleType: 'Propietario',
            status: 'linked',
            isPrimaryContact: true,
          },
        }),
      ).toBe(59 + PORTFOLIO_UNITS);

      // Propietario externo (empresa) con CIF y, uno de ellos, invitacion pendiente.
      const companies = await prisma.externalOwner.findMany({
        where: { promotedToUserId: null },
        orderBy: { fullName: 'asc' },
      });
      expect(companies.map((c) => c.fullName)).toEqual([
        'Inmobiliaria Turia Gestión S.L.',
        'Promociones Levante Sur S.A.',
      ]);
      for (const c of companies)
        expect(isValidCif(c.taxId as string)).toBe(true);
      const pending = await prisma.propertyMembershipInvite.findMany({
        where: { usedAt: null, revokedAt: null },
      });
      expect(pending.filter((i) => i.externalOwnerId).length).toBe(1);
      expect(pending.map((i) => i.roleType).sort()).toEqual([
        'Inquilino',
        'Ocupante',
        'Propietario',
        'Representante',
      ]);
      for (const i of pending) {
        expect(i.inviteeEmail.endsWith(DEMO_EMAIL_DOMAIN)).toBe(true);
        expect(i.expiresAt.getTime()).toBeGreaterThan(Date.now());
      }

      // Representaciones de tres tipos, entre usuarios C.
      const reps = await prisma.userRepresentation.findMany();
      expect(reps.map((r) => r.type).sort()).toEqual([
        'apoderamiento_general',
        'herencia_yacente',
        'tutela',
      ]);
      for (const r of reps) {
        expect(r.representativeUserId).not.toBe(r.representedUserId);
        expect(r.active).toBe(true);
        expect(r.documentRef).toBeTruthy();
      }

      // Adhesion: propiedad propia SIN finca (aun no aprobada) + membresia pendiente.
      for (const a of await prisma.adhesionRequest.findMany({
        where: { status: 'pending' },
        include: { property: true },
      })) {
        expect(a.property?.estateId).toBeNull();
        const m = await prisma.propertyMembership.findFirstOrThrow({
          where: { propertyId: a.propertyId as string, userId: a.userId },
        });
        expect(m.status).toBe('pending');
      }
      // Ocupacion realista (no todo vacio ni todo ocupado).
      expect(
        await prisma.property.count({
          where: { estateId: { not: null }, status: 'Ocupado' },
        }),
      ).toBe(58);
      // Mandatos SEPA solo en las fincas con remesas (Colon 24 y Ponzano 45), ~88 %.
      const mandates = await prisma.mandate.findMany({
        include: { creditorEstate: true },
      });
      expect(mandates.length).toBeGreaterThanOrEqual(40);
      expect(mandates.length).toBeLessThanOrEqual(53);
      for (const m of mandates) {
        expect(m.creditorEstate.name).not.toContain('Cuba 18');
        expect(m.status).toBe('active');
      }
    });

    it('cuentas demo: superadmin/gestora/propietario/moroso/nuevo hacen login por AuthService con la contrasena publica', async () => {
      for (const account of DEMO_ACCOUNT_SPECS) {
        const result = await auth.login(account.email, DEMO_PASSWORD);
        expect(result.user.role).toBe(account.role);
        expect(result.user.fullName).toBe(account.fullName);
        expect(result.accessToken).toBeTruthy();
        if (account.role === 'B') expect(result.user.estateIds).toHaveLength(3 + PORTFOLIO.length);
      }
      await expect(
        auth.login(DEMO_ACCOUNT_SPECS[0]?.email as string, 'admin123'),
      ).rejects.toBeDefined();
      // Solo @demo.domora.app (ni rastro de las cuentas del seed minimo de CI).
      expect(
        await prisma.user.count({
          where: { NOT: { email: { endsWith: DEMO_EMAIL_DOMAIN } } },
        }),
      ).toBe(0);
    });

    it('vidas distintas: propietario@ (2 fincas, 3 unidades), moroso@ (1 unidad con mandato) y nuevo@ (se unio hace pocos dias)', async () => {
      const byEmail = async (local: string) =>
        prisma.user.findUniqueOrThrow({
          where: { email: `${local}${DEMO_EMAIL_DOMAIN}` },
        });
      const owned = async (userId: string) =>
        prisma.propertyMembership.findMany({
          where: { userId, roleType: 'Propietario', status: 'linked' },
          include: { property: true },
        });

      const propietario = await owned((await byEmail('propietario')).id);
      expect(propietario).toHaveLength(3);
      expect(new Set(propietario.map((m) => m.property.estateId)).size).toBe(2);
      expect(propietario.every((m) => m.isPrimaryContact)).toBe(true);

      const moroso = await byEmail('moroso');
      expect(await owned(moroso.id)).toHaveLength(1);
      expect(
        await prisma.mandate.count({ where: { titularUserId: moroso.id } }),
      ).toBe(1);

      const nuevo = await byEmail('nuevo');
      const nuevoUnits = await owned(nuevo.id);
      expect(nuevoUnits).toHaveLength(1);
      const days =
        (Date.now() - (nuevoUnits[0]?.linkedAt.getTime() as number)) /
        86_400_000;
      expect(days).toBeLessThan(6);
      expect(
        await prisma.propertyMembershipInvite.count({
          where: { createdByUserId: nuevo.id, usedAt: null },
        }),
      ).toBe(1);
    });

    it('fechas relativas al ancla: ninguna fecha de alta en el futuro', async () => {
      const now = new Date();
      for (const u of await prisma.user.findMany()) {
        expect(u.createdAt.getTime()).toBeLessThanOrEqual(now.getTime());
      }
      for (const m of await prisma.propertyMembership.findMany()) {
        expect(m.linkedAt.getTime()).toBeLessThanOrEqual(now.getTime());
      }
      for (const e of await prisma.estate.findMany()) {
        expect(e.createdAt.getTime()).toBeLessThan(now.getTime());
      }
    });
  });

  describe('(g) F2: contabilidad, SEPA y proveedores (sobre el seed de (d))', () => {
    it('periodos y recibos: 7 periodos por finca, recibos = unidades con cuota × 7', async () => {
      for (const spec of ESTATE_SPECS) {
        const estate = await prisma.estate.findFirstOrThrow({
          where: { name: spec.name },
        });
        expect(
          await prisma.accountingPeriod.count({ where: { estateId: estate.id } }),
        ).toBe(F2_FIGURES.periodsPerEstate);
        const unitsWithQuota = await prisma.property.count({
          where: { estateId: estate.id, deletedAt: null, quotaMonthly: { gt: 0 } },
        });
        expect(
          await prisma.accountingReceipt.count({ where: { estateId: estate.id } }),
        ).toBe(unitsWithQuota * F2_FIGURES.periodsPerEstate);
      }
    });

    it('remesas: 6 por finca con SEPA (val, mad), ninguna en la de cobro manual (valb)', async () => {
      for (const spec of ESTATE_SPECS) {
        const estate = await prisma.estate.findFirstOrThrow({
          where: { name: spec.name },
        });
        expect(
          await prisma.remesaHistoryItem.count({ where: { estateId: estate.id } }),
        ).toBe(spec.usesSepa ? F2_FIGURES.remesasPerSepaEstate : 0);
      }
    });

    it('proveedores y facturas: 3 proveedores y 8 facturas por finca (7 pagadas, 1 pendiente)', async () => {
      for (const spec of ESTATE_SPECS) {
        const estate = await prisma.estate.findFirstOrThrow({
          where: { name: spec.name },
        });
        // Solo los de F2 (con facturas): F2b añade proveedores de instalaciones sin facturas.
        expect(
          await prisma.supplier.count({
            where: { estateId: estate.id, invoices: { some: {} } },
          }),
        ).toBe(F2_FIGURES.suppliersPerEstate);
        expect(
          await prisma.supplierInvoice.count({ where: { estateId: estate.id } }),
        ).toBe(F2_FIGURES.supplierInvoicesPerEstate);
        expect(
          await prisma.supplierInvoice.count({
            where: { estateId: estate.id, status: 'Pagada' },
          }),
        ).toBe(F2_FIGURES.supplierInvoicesPaidPerEstate);
        expect(
          await prisma.supplierInvoice.count({
            where: { estateId: estate.id, status: 'Registrada' },
          }),
        ).toBe(F2_FIGURES.supplierInvoicesPendingPerEstate);
      }
    });

    it('caso moroso: 2 recibos devueltos (con línea de remesa devuelta) y deuda real pendiente', async () => {
      const moroso = await prisma.user.findUniqueOrThrow({
        where: { email: `moroso${DEMO_EMAIL_DOMAIN}` },
      });
      const membership = await prisma.propertyMembership.findFirstOrThrow({
        where: { userId: moroso.id, roleType: 'Propietario', status: 'linked' },
      });
      const propertyId = membership.propertyId;

      expect(
        await prisma.accountingReceipt.count({
          where: { propertyId, status: 'Devuelto' },
        }),
      ).toBe(F2_FIGURES.morosoReceiptsReturned);
      expect(
        await prisma.remesaLine.count({
          where: { propertyId, status: 'Devuelto' },
        }),
      ).toBe(F2_FIGURES.morosoReceiptsReturned);

      const outstanding = await prisma.accountingReceipt.aggregate({
        where: { propertyId },
        _sum: { outstanding: true },
      });
      expect(Number(outstanding._sum.outstanding ?? 0)).toBeGreaterThan(0);
    });
  });

  describe('(h) F2b: instalaciones (sobre el seed de (d))', () => {
    const estateOf = (name: string) => prisma.estate.findFirstOrThrow({ where: { name } });

    it('cifras exactas por finca: instalaciones, revisiones pendientes y realizadas, incidencias vinculadas', async () => {
      for (const spec of ESTATE_SPECS) {
        const estate = await estateOf(spec.name);
        expect(await prisma.asset.count({ where: { estateId: estate.id } })).toBe(INSTALLATION_FIGURES.assets[spec.key]);
        expect(
          await prisma.regulatoryInspection.count({ where: { estateId: estate.id, status: { in: ['planificada', 'citada', 'vencida'] } } }),
        ).toBe(INSTALLATION_FIGURES.pendingInspections[spec.key]);
        expect(
          await prisma.regulatoryInspection.count({ where: { estateId: estate.id, status: 'realizada' } }),
        ).toBe(INSTALLATION_FIGURES.doneInspections[spec.key]);
        expect(await prisma.issue.count({ where: { asset: { estateId: estate.id } } })).toBe(INSTALLATION_FIGURES.linkedIssues[spec.key]);
      }
    });

    it('Colón 24 cubre todos los estados: operativa, revisión próxima, vencida y en mantenimiento', async () => {
      const estate = await estateOf(ESTATE_SPECS.find((e) => e.key === 'val')!.name);
      const user = { id: 'seed-check', role: 'A', estateIds: [estate.id], administratorId: null } as never;
      const service = new AssetsService(prisma as never, new EstateAccessService());
      const { items, upcoming } = await service.listInstallations(estate.id, user);
      const by = (name: string) => items.find((i) => i.name === name)!;
      expect(by('Ascensor A').displayStatus).toBe('operativa');
      expect(by('Caldera de calefacción').displayStatus).toBe('revision_proxima');
      expect(by('Sistema contra incendios').displayStatus).toBe('revision_proxima');
      expect(by('Cubierta / tejado').displayStatus).toBe('revision_vencida');
      expect(by('Piscina').displayStatus).toBe('en_mantenimiento');
      expect(by('CCTV')).toMatchObject({ displayStatus: 'operativa', nextReviewDate: null, lastReviewDate: null });
      expect(by('Ascensor B').openIssues).toBe(1);
      expect(by('Cubierta / tejado').supplier).toBeNull(); // el ejemplo de elemento sin proveedor
      expect(by('Ascensor A').supplier?.name).toContain('Ascensores');
      expect(upcoming.some((u) => u.overdue)).toBe(true);
      // Vencida (cubierta) + las de los próximos 6 meses; las demás (ascensor B, a 240 días) quedan fuera del horizonte.
      expect(upcoming.map((u) => u.assetName)).toEqual(['Cubierta / tejado', 'Caldera de calefacción', 'Sistema contra incendios', 'Piscina', 'Grupo electrógeno', 'Ascensor A', 'Portal automático']);
    });

    it('todas las instalaciones del catálogo usan tipos de inspección que existen', async () => {
      const codes = new Set(Object.values(INSTALLATIONS).flatMap((list) => list.flatMap((a) => a.inspections.map((i) => i.typeCode))));
      const found = await prisma.inspectionType.findMany({ where: { estateId: null, code: { in: [...codes] } }, select: { code: true } });
      expect(found.map((f) => f.code).sort()).toEqual([...codes].sort());
    });
  });

  describe('(i) F2c: panel de Proveedores (sobre el seed de (d))', () => {
    const estateOf = (name: string) => prisma.estate.findFirstOrThrow({ where: { name } });

    it('cifras exactas por finca: contratos, visitas planificadas y realizadas, incidencias asignadas', async () => {
      for (const spec of ESTATE_SPECS) {
        const estate = await estateOf(spec.name);
        const where = { estateId: estate.id };
        expect(await prisma.supplierContract.count({ where })).toBe(SUPPLIER_PANEL_FIGURES.contracts[spec.key]);
        expect(await prisma.supplierVisit.count({ where: { ...where, status: 'planificada' } })).toBe(SUPPLIER_PANEL_FIGURES.plannedVisits[spec.key]);
        expect(await prisma.supplierVisit.count({ where: { ...where, status: 'realizada' } })).toBe(SUPPLIER_PANEL_FIGURES.doneVisits[spec.key]);
        expect(await prisma.issueProviderAssignment.count({ where: { supplier: where } })).toBe(SUPPLIER_PANEL_FIGURES.assignedIssues[spec.key]);
      }
    });

    it('Colón 24 muestra el panel completo: contratos vigentes, por vencer y vencidos, próximas visitas e incidencias', async () => {
      const estate = await estateOf(ESTATE_SPECS.find((e) => e.key === 'val')!.name);
      const user = { id: 'seed-check', role: 'A', estateIds: [estate.id], administratorId: null } as never;
      const access = new EstateAccessService();
      const overview = await new SupplierOverviewService(
        prisma as never,
        access,
        new SuppliersService(prisma as never, access, undefined as never),
      ).getOverview(estate.id, user);
      expect(overview.kpis.totalSuppliers).toBe(10);
      expect(overview.kpis.expiringContracts).toBeGreaterThan(0);
      expect(overview.kpis.activeContracts).toBeGreaterThan(overview.kpis.expiringContracts);
      expect(overview.kpis.openIssues).toBe(SUPPLIER_PANEL_FIGURES.assignedIssues.val);
      expect(new Set(overview.items.map((i) => i.displayStatus))).toEqual(new Set(['activo', 'renovar', 'vencido']));
      expect(overview.items.every((i) => i.contactName)).toBe(true);
      expect(overview.items.some((i) => i.nextVisit)).toBe(true);
      expect(overview.items.some((i) => !i.nextVisit)).toBe(true);
      expect(overview.recentInterventions).toHaveLength(10);
    });
  });

  describe('(j) F3: panel del propietario (sobre el seed de (d))', () => {
    const estateOf = (name: string) => prisma.estate.findFirstOrThrow({ where: { name } });

    it('cifras exactas por finca: zonas comunes, reservas del propietario, documentos, juntas', async () => {
      const owner = await prisma.user.findFirstOrThrow({ where: { email: 'propietario@demo.domora.app' } });
      const since = new Date(Date.now() - 30 * 86_400_000);
      for (const spec of ESTATE_SPECS) {
        const estate = await estateOf(spec.name);
        const where = { estateId: estate.id };
        expect(await prisma.amenity.count({ where })).toBe(OWNER_PANEL_FIGURES.amenities[spec.key]);
        expect(await prisma.booking.count({ where: { amenity: where, userId: owner.id, status: 'confirmed' } })).toBe(OWNER_PANEL_FIGURES.ownerBookings[spec.key]);
        // F6 adds the essential documents of the general-data tab on top of F3's.
        expect(await prisma.document.count({ where })).toBe(OWNER_PANEL_FIGURES.documents[spec.key] + GENERAL_DATA_FIGURES.documentsAddedByF6(spec.name, true));
        expect(await prisma.document.count({ where: { ...where, date: { gte: since } } })).toBe(OWNER_PANEL_FIGURES.recentDocuments[spec.key]);
        expect(await prisma.meeting.count({ where: { ...where, status: 'convocada' } })).toBe(OWNER_PANEL_FIGURES.convokedMeetings[spec.key]);
        expect(await prisma.meeting.count({ where: { ...where, status: 'celebrada' } })).toBe(OWNER_PANEL_FIGURES.celebratedMeetings[spec.key]);
      }
    });

    it('biblioteca: todo queda archivado en carpetas y el propietario ve lo que el demo abre, no el CIF ni el IBI', async () => {
      const estate = await estateOf(ESTATE_SPECS.find((e) => e.key === 'val')!.name);
      const owner = await prisma.user.findFirstOrThrow({ where: { email: 'propietario@demo.domora.app' } });
      const docs = await prisma.document.findMany({ where: { estateId: estate.id } });
      expect(docs.every((d) => d.folderId && d.mimeType === 'application/pdf' && d.sizeBytes)).toBe(true);
      const user = { id: owner.id, role: 'C', estateIds: [estate.id], administratorId: null } as never;
      const visible = await prisma.document.findMany({ where: { AND: [{ estateId: estate.id }, await documentVisibleWhere(prisma as never, user)] }, select: { title: true } });
      const titles = visible.map((d) => d.title);
      expect(titles).toEqual(expect.arrayContaining(['Estatutos de la comunidad', 'Presupuesto 2027', 'Escritura de constitución', 'Póliza de seguro']));
      expect(titles).not.toContain('CIF de la comunidad');
      expect(titles.some((t) => t.startsWith('IBI'))).toBe(false);
      const legal = await prisma.documentFolder.findFirstOrThrow({ where: { estateId: estate.id, systemKey: 'legal' } });
      expect(legal.visibility).toBe('OWNERS');
      // One grouped notice per owner for the documents opened to them, not one per document.
      const notices = await prisma.notification.count({ where: { userId: owner.id, category: 'document', estateId: estate.id } });
      expect(notices).toBeGreaterThan(0);
      expect(notices).toBeLessThanOrEqual(2);
    });

    it('los documentos tienen un PDF real guardado que se puede descargar', async () => {
      const estate = await estateOf(ESTATE_SPECS.find((e) => e.key === 'val')!.name);
      const docs = await prisma.document.findMany({ where: { estateId: estate.id } });
      expect(docs.every((d) => d.s3Key?.startsWith(`documents/${estate.id}/`))).toBe(true);
      const storage = new StorageService({ get: (key: string) => (key === 'STORAGE_DIR' ? process.env['STORAGE_DIR'] : undefined) } as never);
      const file = await storage.get(docs[0]!.s3Key!);
      expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('«Mi comunidad» de propietario@ en Colón 24: ficha de propiedad con recibo por pagar, próxima junta y documentos nuevos', async () => {
      const estate = await estateOf(ESTATE_SPECS.find((e) => e.key === 'val')!.name);
      const owner = await prisma.user.findFirstOrThrow({ where: { email: 'propietario@demo.domora.app' } });
      const membership = await prisma.propertyMembership.findFirstOrThrow({ where: { userId: owner.id, status: 'linked', property: { estateId: estate.id, ref: '3A' } } });
      const access = new EstateAccessService();
      const service = new PropertyOverviewService(prisma as never, new PropertyAccessService(prisma as never, access));
      const user = { id: owner.id, role: 'C', estateIds: [estate.id], administratorId: null } as never;
      const overview = await service.getOverview(membership.propertyId, user);
      expect(overview.nextReceipt).not.toBeNull();
      expect(overview.nextMeeting?.title).toBe('Junta ordinaria de propietarios');
      expect(overview.documents.newLast30Days).toBe(OWNER_PANEL_FIGURES.recentDocuments.val);
      const events = await service.getEvents(membership.propertyId, user);
      expect(new Set(events.map((e) => e.kind))).toEqual(new Set(['junta', 'reserva', 'revision']));
    });
  });

  describe('(k) F4: cartera ampliada (sobre el seed de (d))', () => {
    const estateOf = (name: string) => prisma.estate.findFirstOrThrow({ where: { name } });

    it('hay 10 fincas: las 3 de F1 y las 7 de la cartera (el login de la gestora lo cubre el bloque (f))', async () => {
      expect(await prisma.estate.count()).toBe(ESTATE_SPECS.length + PORTFOLIO.length);
    });

    it('cada finca cuadra con su perfil: unidades, incidencias, solicitudes, juntas, contratos e instalaciones', async () => {
      for (const spec of PORTFOLIO) {
        const estate = await estateOf(spec.name);
        const where = { estateId: estate.id };
        expect(await prisma.property.count({ where })).toBe(spec.floors * spec.doors);
        expect(await prisma.adhesionRequest.count({ where: { ...where, status: 'pending' } })).toBe(spec.adhesionAgoDays.length);
        expect(await prisma.meeting.count({ where: { ...where, status: 'convocada' } })).toBe(spec.meetings.upcoming.length);
        expect(await prisma.meeting.count({ where: { ...where, status: 'celebrada' } })).toBe(spec.meetings.past.length);
        expect(await prisma.supplierContract.count({ where })).toBe(spec.contracts.length + (CONTRACT_EXTRAS[spec.key] ?? 0));
        expect(await prisma.asset.count({ where })).toBe(spec.assets.length);
        // Dos facturas por proveedor (una pagada, una pendiente): da gasto al «Resumen económico».
        expect(await prisma.supplierInvoice.count({ where })).toBe(spec.contracts.length * 2);
        const open = spec.issues.filter((i) => ['Abierta', 'EnReparacion', 'PendienteProveedor'].includes(i.status)).length;
        expect(await prisma.issue.count({ where: { ...where, status: { in: ['Abierta', 'EnReparacion', 'PendienteProveedor'] } } })).toBe(open);
      }
    });

    it('perfiles de cobro distintos: Los Olivos al día; Mediterráneo con devueltos, impagos vencidos y derrama sin cobrar', async () => {
      const incidentUnits = async (name: string) => {
        const estate = await estateOf(name);
        const returned = await prisma.accountingReceipt.findMany({ where: { estateId: estate.id, status: 'Devuelto' }, distinct: ['propertyId'], select: { propertyId: true } });
        const overdue = await prisma.accountingReceipt.findMany({ where: { estateId: estate.id, status: 'Pendiente', dueDate: { lt: new Date() } }, distinct: ['propertyId'], select: { propertyId: true } });
        return new Set([...returned, ...overdue].map((r) => r.propertyId)).size;
      };
      const olivos = PORTFOLIO.find((e) => e.key === 'p1')!;
      const mediterraneo = PORTFOLIO.find((e) => e.key === 'p2')!;
      expect(await incidentUnits(olivos.name)).toBe(0);
      expect(await incidentUnits(mediterraneo.name)).toBe(expectedIncidentUnits(planCases(mediterraneo, mediterraneo.floors * mediterraneo.doors)));
      const derramas = await prisma.accountingReceipt.count({ where: { estateId: (await estateOf(mediterraneo.name)).id, kind: 'derrama', status: 'Pendiente' } });
      expect(derramas).toBe(mediterraneo.derrama!.unpaidUnits);
    });

    it('Castellana 14 es nueva: su historial de recibos es de pocos meses', async () => {
      const castellana = PORTFOLIO.find((e) => e.key === 'p6')!;
      const estate = await estateOf(castellana.name);
      const periods = await prisma.accountingPeriod.count({ where: { estateId: estate.id } });
      expect(periods).toBe(castellana.historyMonths + 1);
    });
  });

  describe('(l) F4: actividad reciente del gestor (sobre el seed de (d))', () => {
    it('lo más reciente es lo diseñado: dos comunicados, dos mensajes de bandeja y un proveedor actualizado', async () => {
      const gestora = await prisma.user.findFirstOrThrow({ where: { role: 'B' } });
      const latest = await prisma.activityLogEntry.findMany({
        where: { actorUserId: gestora.id },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: 5,
      });
      expect(latest.map((a) => a.subjectType).sort()).toEqual(['communication', 'communication', 'message', 'message', 'supplier']);
      // Los mensajes no llevan finca ni texto; el resto sí lleva finca.
      for (const a of latest) {
        expect(a.estateId === null).toBe(a.subjectType === 'message');
      }
      expect(latest.filter((a) => a.subjectType === 'message').every((a) => /^Mensaje enviado a /.test(a.summary))).toBe(true);
    });

    it('el resto de la actividad del gestor está repartida por el último mes, no en un solo minuto', async () => {
      const gestora = await prisma.user.findFirstOrThrow({ where: { role: 'B' } });
      const rows = await prisma.activityLogEntry.findMany({ where: { actorUserId: gestora.id }, select: { occurredAt: true } });
      const days = new Set(rows.map((r) => r.occurredAt.toISOString().slice(0, 10)));
      expect(days.size).toBeGreaterThan(10);
    });
  });

  describe('(m) F5: contratos con importe, estados, renovaciones y documentos (sobre el seed de (d))', () => {
    it('todos los contratos tienen importe y periodicidad; hay programado, cancelado, sin fin y puntual', async () => {
      expect(await prisma.supplierContract.count({ where: { OR: [{ costAmount: null }, { costFrequency: null }] } })).toBe(0);
      const today = new Date();
      expect(await prisma.supplierContract.count({ where: { cancelledAt: null, startDate: { gt: today } } })).toBeGreaterThanOrEqual(1);
      expect(await prisma.supplierContract.count({ where: { cancelledAt: { not: null } } })).toBe(1);
      expect(await prisma.supplierContract.count({ where: { endDate: null, cancelledAt: null } })).toBe(1);
      expect(await prisma.supplierContract.count({ where: { costFrequency: 'ONE_OFF' } })).toBe(1);
      // También hay vigentes, por vencer y vencidos entre los contratos con fecha de fin.
      const ends = (await prisma.supplierContract.findMany({ where: { cancelledAt: null, endDate: { not: null }, startDate: { lte: today } }, select: { endDate: true } })).map((c) => c.endDate!.getTime());
      expect(ends.some((e) => e < today.getTime() - 86_400_000)).toBe(true);
      expect(ends.some((e) => e >= today.getTime() && e <= today.getTime() + 30 * 86_400_000)).toBe(true);
      expect(ends.some((e) => e > today.getTime() + 90 * 86_400_000)).toBe(true);
    });

    it('las renovaciones son coherentes: pasadas, encadenadas y terminan en el vencimiento actual', async () => {
      const renewals = await prisma.supplierContractRenewal.findMany({ include: { contract: true }, orderBy: { renewedAt: 'asc' } });
      expect(renewals.length).toBeGreaterThanOrEqual(20);
      for (const r of renewals) {
        expect(r.renewedAt.getTime()).toBeLessThanOrEqual(Date.now());
        expect(r.newEndDate.getTime()).toBeGreaterThan(r.renewedAt.getTime());
        expect(r.newEndDate.getTime()).toBeLessThanOrEqual(r.contract.endDate!.getTime());
        expect(r.estateId).toBe(r.contract.estateId);
      }
      expect(new Set(renewals.map((r) => r.kind))).toEqual(new Set(['tacita', 'manual']));
    });

    it('los documentos de contrato tienen un PDF real guardado', async () => {
      const docs = await prisma.supplierDocument.findMany({ where: { documentType: 'Contrato' } });
      expect(docs.length).toBeGreaterThanOrEqual(10);
      const storage = new StorageService({ get: (key: string) => (key === 'STORAGE_DIR' ? process.env['STORAGE_DIR'] : undefined) } as never);
      const file = await storage.get(docs[0]!.s3Key);
      expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    });
  });

  describe('STORAGE_DIR: protección de ruta', () => {
    it('rechaza raíz, cwd y rutas no demo no vacías; acepta demo o vacío', async () => {
      await expect(
        resolveStorageDirToClear(path.parse(process.cwd()).root),
      ).rejects.toBeInstanceOf(StorageDirError);
      await expect(
        resolveStorageDirToClear(process.cwd()),
      ).rejects.toBeInstanceOf(StorageDirError);
      expect(await resolveStorageDirToClear(undefined)).toBeNull();
      expect(await resolveStorageDirToClear('   ')).toBeNull();

      const notDemo = path.join(storageRoot, 'datos');
      mkdirSync(notDemo);
      expect(await resolveStorageDirToClear(notDemo)).toBe(notDemo); // vacío: ok
      writeFileSync(path.join(notDemo, 'a.txt'), 'x');
      await expect(resolveStorageDirToClear(notDemo)).rejects.toBeInstanceOf(
        StorageDirError,
      );

      const demo = path.join(storageRoot, 'storage-demo');
      await clearStorageDir(demo); // el seed deja ahí los PDF de los documentos; partimos de un directorio vacío
      writeFileSync(path.join(demo, 'a.txt'), 'x');
      expect(await resolveStorageDirToClear(demo)).toBe(demo);
      expect(await clearStorageDir(demo)).toBe(1);
      expect(existsSync(demo)).toBe(true);
    });
  });
});
