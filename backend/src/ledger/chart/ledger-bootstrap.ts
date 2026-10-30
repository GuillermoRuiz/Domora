import { Prisma } from '../../prisma/client';
import { COMMUNITY_CHART_TEMPLATE } from './chart-template';

/**
 * Deja lista la contabilidad de una finca: configuración con fecha de
 * corte, plan de cuentas de la plantilla y una cuenta bancaria por defecto.
 *
 * Todo es idempotente y seguro bajo concurrencia (ON CONFLICT), así que se
 * puede llamar al crear la finca, desde el seed o de forma perezosa desde el
 * resolvedor de cuentas para las fincas que existían antes del diario.
 */
type Db = Prisma.TransactionClient;

/** Primer día (UTC) del mes de la fecha dada. */
export function firstDayOfMonthUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export async function ensureAccountingSettings(
  db: Db,
  estateId: string,
  cutoverDate: Date = firstDayOfMonthUtc(new Date()),
): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "accounting_settings" ("estate_id", "cutover_date", "updated_at")
    VALUES (${estateId}::uuid, ${cutoverDate}::date, now())
    ON CONFLICT ("estate_id") DO NOTHING
  `;
}

/**
 * Inserta las cuentas de la plantilla que falten. Si la finca ya tenía una
 * cuenta con ese código (heredada del libro de caja) y sin apuntes en el
 * diario, la convierte en cuenta de sistema con el papel de la plantilla.
 */
export async function ensureChartTemplate(
  db: Db,
  estateId: string,
): Promise<void> {
  const rows = COMMUNITY_CHART_TEMPLATE.map(
    (a) => Prisma.sql`(
      ${a.code}::text,
      ${a.name}::text,
      ${a.shortName ?? null}::text,
      ${a.nature}::text,
      ${a.postable ?? true}::boolean,
      ${a.systemRole ?? null}::text,
      ${a.requiresProperty ?? false}::boolean,
      ${a.requiresSupplier ?? false}::boolean,
      ${a.nature === 'expense' || a.nature === 'income'}::boolean
    )`,
  );
  await db.$executeRaw`
    INSERT INTO "chart_accounts" (
      "id", "estate_id", "administrator_id", "code", "name", "short_name",
      "nature", "postable", "system", "system_role", "requires_property",
      "requires_supplier", "allows_cost_centre"
    )
    SELECT gen_random_uuid(), e."id", e."administrator_id", v.code, v.name, v.short_name,
           v.nature::"AccountNature", v.postable, true,
           v.role::"AccountRole", v.requires_property, v.requires_supplier, v.allows_cost_centre
      FROM "estates" e
     CROSS JOIN (VALUES ${Prisma.join(rows)}) AS v(
       code, name, short_name, nature, postable, role,
       requires_property, requires_supplier, allows_cost_centre
     )
     WHERE e."id" = ${estateId}::uuid
    ON CONFLICT ("estate_id", "code") DO UPDATE SET
      "system" = true,
      "system_role" = EXCLUDED."system_role",
      "nature" = EXCLUDED."nature",
      "postable" = EXCLUDED."postable",
      "requires_property" = EXCLUDED."requires_property",
      "requires_supplier" = EXCLUDED."requires_supplier",
      "allows_cost_centre" = EXCLUDED."allows_cost_centre",
      "archived_at" = NULL
    WHERE "chart_accounts"."system" = false
      AND NOT EXISTS (
        SELECT 1 FROM "journal_lines" jl WHERE jl."account_id" = "chart_accounts"."id"
      )
  `;
}

/**
 * Bloqueo de fila sobre la configuración contable de la finca, hasta el fin
 * de la transacción. Serializa las altas que calculan "el siguiente libre".
 * Crea la configuración si falta, para que siempre haya fila que bloquear.
 */
export async function lockEstateLedger(
  db: Db,
  estateId: string,
): Promise<void> {
  await ensureAccountingSettings(db, estateId);
  await db.$queryRaw`SELECT 1 FROM "accounting_settings" WHERE "estate_id" = ${estateId}::uuid FOR UPDATE`;
}

/** Siguiente código libre de subcuenta de 7 dígitos bajo `parentCode` (5720001, 5720002…). */
export async function nextSubaccountCode(
  db: Db,
  estateId: string,
  parentCode: string,
): Promise<string> {
  const width = 7;
  const siblings = await db.chartAccount.findMany({
    where: { estateId, code: { startsWith: parentCode } },
    select: { code: true },
  });
  const used = siblings
    .map((s) => s.code)
    .filter((c) => c.length === width)
    .map((c) => Number(c.slice(parentCode.length)))
    .filter((n) => Number.isInteger(n));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  const suffix = String(next).padStart(width - parentCode.length, '0');
  if (suffix.length > width - parentCode.length) {
    throw new RangeError(
      `No quedan subcuentas libres bajo la cuenta ${parentCode}.`,
    );
  }
  return `${parentCode}${suffix}`;
}

/**
 * Crea una cuenta bancaria con su subcuenta 572xxxx en la misma transacción.
 * El IBAN llega ya cifrado (sepa/crypto.service.ts), o no llega.
 */
export async function createBankAccountWithSubaccount(
  db: Db,
  estateId: string,
  opts: {
    alias: string;
    ibanEnc?: string | null;
    ibanLast4?: string | null;
    bic?: string | null;
    bankName?: string | null;
    isDefault?: boolean;
    isReserveAccount?: boolean;
    openedOn?: Date | null;
  },
): Promise<{ bankAccountId: string; chartAccountId: string }> {
  // Dos altas simultáneas calcularían el mismo código libre (y, en una finca sin plan, insertarían a la vez la plantilla): la
  // segunda espera aquí a que la primera confirme, así que el bloqueo va ANTES de asegurar el plan.
  await lockEstateLedger(db, estateId);
  await ensureChartTemplate(db, estateId);
  const parent = await db.chartAccount.findUniqueOrThrow({
    where: { estateId_code: { estateId, code: '572' } },
    select: { id: true, administratorId: true },
  });
  const code = await nextSubaccountCode(db, estateId, '572');
  const account = await db.chartAccount.create({
    data: {
      estateId,
      administratorId: parent.administratorId,
      code,
      name: `Banco — ${opts.alias}`.slice(0, 150),
      shortName: opts.alias.slice(0, 60),
      nature: 'asset',
      parentId: parent.id,
      systemRole: 'bank',
    },
    select: { id: true },
  });
  const bank = await db.bankAccount.create({
    data: {
      estateId,
      chartAccountId: account.id,
      alias: opts.alias,
      ibanEnc: opts.ibanEnc ?? null,
      ibanLast4: opts.ibanLast4 ?? null,
      bic: opts.bic ?? null,
      bankName: opts.bankName ?? null,
      isDefault: opts.isDefault ?? false,
      isReserveAccount: opts.isReserveAccount ?? false,
      openedOn: opts.openedOn ?? null,
    },
    select: { id: true },
  });
  return { bankAccountId: bank.id, chartAccountId: account.id };
}

/**
 * Garantiza que la finca tiene una cuenta bancaria por defecto. Usa el IBAN
 * de acreedor SEPA si ya está configurado (ya viene cifrado).
 */
export async function ensureDefaultBankAccount(
  db: Db,
  estateId: string,
): Promise<string> {
  const existing = await db.bankAccount.findFirst({
    where: { estateId, isDefault: true },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Serializa a quien llegue a la vez: la segunda transacción espera aquí y
  // luego encuentra la cuenta ya creada.
  await lockEstateLedger(db, estateId);
  const again = await db.bankAccount.findFirst({
    where: { estateId, isDefault: true },
    select: { id: true },
  });
  if (again) return again.id;

  const estate = await db.estate.findUniqueOrThrow({
    where: { id: estateId },
    select: { creditorIban: true, creditorBic: true },
  });
  const { bankAccountId } = await createBankAccountWithSubaccount(
    db,
    estateId,
    {
      alias: 'Cuenta principal',
      ibanEnc: estate.creditorIban,
      bic: estate.creditorBic,
      isDefault: true,
    },
  );
  return bankAccountId;
}

/** Arranque completo de la contabilidad de una finca. */
export async function bootstrapEstateLedger(
  db: Db,
  estateId: string,
  opts: { cutoverDate?: Date } = {},
): Promise<void> {
  await ensureAccountingSettings(db, estateId, opts.cutoverDate);
  await ensureChartTemplate(db, estateId);
  await ensureDefaultBankAccount(db, estateId);
}
