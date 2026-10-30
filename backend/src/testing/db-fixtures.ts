import { randomUUID } from 'node:crypto';
import {
  Prisma,
  PrismaClient,
  type PayMethod,
  type PlanTier,
  type ReceiptKind,
} from '../prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types';
import { bootstrapEstateLedger } from '../ledger/chart/ledger-bootstrap';
import { JournalService } from '../ledger/journal/journal.service';
import { ReceiptPostingService } from '../ledger/posting/receipt-posting.service';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';

/**
 * Fixtures compartidos para las specs de integración contra Postgres real.
 *
 * Antes cada spec copiaba sus propios `makeX` y su limpieza, con CIF fijos
 * ('TESTGR-SALDO', 'TESTGR-REMESAS'…) que chocan si dos ejecuciones
 * coinciden. Aquí:
 * - cada gestora de prueba lleva un CIF único (`uniqueCif`);
 * - cada spec trabaja en SU finca, y `purgeAdministrator` la borra entera
 *   en orden de dependencias, así que ningún test depende de otro.
 *
 * `purgeEstate` cubre contabilidad, SEPA, morosidad, proveedores,
 * importaciones y titularidad. Si una spec crea filas de otros módulos
 * (juntas, comunicaciones…) sigue siendo responsable de borrarlas antes.
 */

export type Db = PrismaClient;

/** CIF de prueba único: nunca choca con otra ejecución ni con datos reales. */
export function uniqueCif(tag = 'FX'): string {
  return `T${tag.slice(0, 4).toUpperCase()}${randomUUID().replace(/-/g, '').slice(0, 12)}`.slice(
    0,
    20,
  );
}

/** Email de prueba único en el dominio reservado `test.local`. */
export function uniqueEmail(tag = 'user'): string {
  return `${tag}-${randomUUID()}@test.local`;
}

export interface AdministratorFixture {
  administratorId: string;
  /** Usuario rol B de la gestora. */
  userId: string;
}

/**
 * Gestora de prueba (plan BASE = Start salvo `plan`). `incidentAi` se conserva temporalmente en la firma para que
 * las pruebas de dominio no relacionadas puedan migrarse sin cambiar sus datos de entrada; ya no produce efectos.
 */
export async function createAdministrator(
  db: Db,
  opts: { name?: string; incidentAi?: boolean | 'plan'; plan?: PlanTier } = {},
): Promise<AdministratorFixture> {
  const plan = opts.plan ?? 'BASE';
  const admin = await db.administrator.create({
    data: {
      name: opts.name ?? 'Gestora de prueba',
      cif: uniqueCif('ADM'),
      plan,
      tier: 'basic',
      usersMax: 5,
      status: 'Activa',
    },
  });
  const user = await db.user.create({
    data: {
      email: uniqueEmail('gestor'),
      passwordHash: 'x',
      fullName: 'Gestor de prueba',
      role: 'B',
      administratorId: admin.id,
    },
  });
  return { administratorId: admin.id, userId: user.id };
}

export async function createEstate(
  db: Db,
  administratorId: string,
  opts: Partial<Prisma.EstateUncheckedCreateInput> = {},
): Promise<string> {
  const estate = await db.estate.create({
    data: {
      name: 'Finca de prueba',
      type: 'Edificio',
      address: 'Calle Falsa 1',
      location: 'Madrid',
      ...opts,
      administratorId,
    },
  });
  return estate.id;
}

/**
 * Finca con la contabilidad lista (configuración, plan de cuentas de la
 * plantilla y banco por defecto), igual que la deja `EstatesService.create`.
 */
export async function createLedgerEstate(
  db: Db,
  administratorId: string,
  opts: {
    cutoverDate?: Date;
    estate?: Partial<Prisma.EstateUncheckedCreateInput>;
  } = {},
): Promise<string> {
  const estateId = await createEstate(db, administratorId, opts.estate);
  await db.$transaction((tx) =>
    bootstrapEstateLedger(tx, estateId, { cutoverDate: opts.cutoverDate }),
  );
  return estateId;
}

/** Periodo contable (AAAA-MM) de la finca, creado si falta. */
export async function ensurePeriod(
  db: Db,
  estateId: string,
  periodKey: string,
): Promise<string> {
  const period = await db.accountingPeriod.upsert({
    where: { estateId_periodKey: { estateId, periodKey } },
    update: {},
    create: {
      estateId,
      periodKey,
      label: periodKey,
      monthAbbrev: periodKey.slice(5),
    },
  });
  return period.id;
}

let receiptCounter = 0;

/**
 * Recibo emitido por la vía contable (con su asiento), como en producción:
 * la base de datos rechaza un recibo sin asiento de emisión. `status`
 * Pagada lo cobra por banco; Devuelto lo marca devuelto sin cobro previo.
 * La finca debe tener la contabilidad lista (`createLedgerEstate`) con una
 * fecha de corte anterior al periodo.
 */
export async function issueTestReceipt(
  db: Db,
  opts: {
    estateId: string;
    propertyId: string;
    periodKey: string;
    amount: string;
    status?: 'Pendiente' | 'Pagada' | 'Devuelto';
    kind?: ReceiptKind;
    includeInRemesa?: boolean;
    mandateId?: string | null;
    ownerUserId?: string | null;
    method?: PayMethod;
    dueDate?: Date;
  },
) {
  const journal = new JournalService();
  const posting = new ReceiptPostingService(journal);
  const collections = new CollectionPostingService(journal, posting);
  const periodId = await ensurePeriod(db, opts.estateId, opts.periodKey);
  receiptCounter += 1;
  return db.$transaction(async (tx) => {
    const receipt = await posting.issue(tx, {
      estateId: opts.estateId,
      periodId,
      periodKey: opts.periodKey,
      propertyId: opts.propertyId,
      no: `${opts.periodKey.replace('-', '/')}-T${receiptCounter}-${randomUUID().slice(0, 6)}`,
      concept: `Cuota de prueba · ${opts.periodKey}`,
      kind: opts.kind ?? 'cuota_ordinaria',
      amount: Math.round(Number(opts.amount) * 100),
      dueDate: opts.dueDate ?? null,
      method: opts.method ?? 'Domiciliacion',
      manual: false,
      includeInRemesa: opts.includeInRemesa ?? true,
      mandateId: opts.mandateId ?? null,
      ownerUserId: opts.ownerUserId ?? null,
      ownerNameSnapshot: 'Titular de prueba',
    });
    if (opts.status === 'Pagada') {
      // Cobrado el mismo día de su asiento de emisión: vale para cualquier fecha de corte.
      await collections.collect(tx, {
        estateId: opts.estateId,
        propertyId: opts.propertyId,
        date: receipt.accrualDate,
        amount: Math.round(Number(opts.amount) * 100),
        method: 'Transferencia',
        receiptIds: [receipt.id],
      });
      return tx.accountingReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
      });
    }
    if (opts.status === 'Devuelto') {
      return posting.markReturned(tx, receipt.id, { returnCode: 'MS02' });
    }
    return receipt;
  });
}

let propertyCounter = 0;

export async function createProperty(
  db: Db,
  estateId: string,
  opts: Partial<Prisma.PropertyUncheckedCreateInput> = {},
): Promise<string> {
  propertyCounter += 1;
  const property = await db.property.create({
    data: {
      type: 'Piso',
      status: 'Ocupado',
      staircase: '1',
      floor: String(propertyCounter),
      door: 'A',
      quotaMonthly: '100.00',
      ...opts,
      estateId,
    },
  });
  return property.id;
}

export async function createSupplier(
  db: Db,
  estateId: string,
  administratorId: string,
  opts: Partial<Prisma.SupplierUncheckedCreateInput> = {},
): Promise<string> {
  const supplier = await db.supplier.create({
    data: {
      name: 'Proveedor de prueba',
      category: 'Mantenimiento',
      ...opts,
      estateId,
      administratorId,
    },
  });
  return supplier.id;
}

/** Usuario rol C sin vínculos: el test decide a qué propiedad lo ata. */
export async function createOwnerUser(
  db: Db,
  opts: { fullName?: string; email?: string } = {},
): Promise<string> {
  const user = await db.user.create({
    data: {
      email: opts.email ?? uniqueEmail('propietario'),
      passwordHash: 'x',
      fullName: opts.fullName ?? 'Propietario de prueba',
      role: 'C',
    },
  });
  return user.id;
}

/** Vincula a un usuario (rol C) con una propiedad: es lo que le da acceso a sus incidencias (`PropertyAccessService`). */
export async function linkOwner(
  db: Db,
  propertyId: string,
  userId: string,
  roleType: 'Propietario' | 'Inquilino' = 'Propietario',
): Promise<void> {
  await db.propertyMembership.create({
    data: {
      propertyId,
      userId,
      roleType,
      status: 'linked',
      linkedAt: new Date(),
    },
  });
}

export function roleB(
  fx: AdministratorFixture,
  estateIds: string[],
): AuthenticatedUser {
  return {
    id: fx.userId,
    role: 'B',
    estateIds,
    administratorId: fx.administratorId,
  };
}

export function roleA(userId: string): AuthenticatedUser {
  return { id: userId, role: 'A', estateIds: [], administratorId: null };
}

/**
 * Borra una finca y todo lo que cuelga de ella, en orden de dependencias.
 * Cada bloque va en su propia sentencia: si una tabla no tiene filas de la
 * finca, el `deleteMany` simplemente no borra nada.
 */
export async function purgeEstate(db: Db, estateId: string): Promise<void> {
  const byEstateProperty = { property: { estateId } };

  // ── Morosidad ──────────────────────────────────────────────────────────
  await db.paymentAgreementInstallment.deleteMany({
    where: { agreement: { debtor: { estateId } } },
  });
  await db.paymentAgreement.deleteMany({ where: { debtor: { estateId } } });
  await db.debtorAction.deleteMany({ where: { debtor: { estateId } } });
  await db.debtor.deleteMany({ where: { estateId } });

  // ── Presupuestos (referencian el plan de cuentas) ─────────────────────
  await db.budgetItem.deleteMany({ where: { estateId } });
  await db.costCentreBudget.deleteMany({ where: { estateId } });

  // ── Diario, bancos, plan de cuentas y configuración contable ───────────
  // Solo se puede borrar a través de la función de la base de datos: los
  // asientos son inmutables y las cuentas de sistema no se borran.
  await db.$executeRaw`SELECT accounting_purge_estate(${estateId}::uuid)`;

  // ── SEPA: las remesas y sus líneas las borra la función de purga (las
  // citan los cobros); aquí quedan los mandatos ───────────────────────────
  await db.mandateAmendment.deleteMany({
    where: { mandate: { creditorEstateId: estateId } },
  });
  await db.mandate.deleteMany({ where: { creditorEstateId: estateId } });

  // ── Periodos, centros de coste, ejercicios (los recibos los borra la
  // función de purga: no se pueden borrar de otra forma) ────────────────
  await db.accountingPeriod.deleteMany({ where: { estateId } });
  await db.costCentre.deleteMany({ where: { estateId } });
  await db.fiscalYear.deleteMany({ where: { estateId } });

  // ── Proveedores ────────────────────────────────────────────────────────
  await db.supplierInvoice.deleteMany({ where: { supplier: { estateId } } });
  await db.supplier.deleteMany({ where: { estateId } });

  // ── Personal (las nóminas las borra la función de purga) ───────────────
  await db.staffDocument.deleteMany({ where: { staffMember: { estateId } } });
  await db.staffMember.deleteMany({ where: { estateId } });

  // ── Importaciones ──────────────────────────────────────────────────────
  await db.importBatch.deleteMany({ where: { estateId } });

  // ── Titularidad y propiedades ──────────────────────────────────────────
  await db.propertyMembershipInvite.deleteMany({ where: byEstateProperty });
  await db.externalOwner.deleteMany({ where: byEstateProperty });
  await db.propertyMembership.deleteMany({ where: byEstateProperty });
  await db.activityLogEntry.deleteMany({ where: { estateId } });
  // Incidencias de la finca (de vivienda y comunes): las comunes no cuelgan de ninguna propiedad.
  await db.issue.deleteMany({ where: { estateId } });
  await db.property.deleteMany({ where: { estateId } });

  await db.estate.delete({ where: { id: estateId } });
}

/**
 * Borra la gestora de prueba con todas sus fincas, sus usuarios rol B y los
 * usuarios adicionales que pase el test (propietarios, titulares…). Pensado
 * para `afterAll`.
 */
export async function purgeAdministrator(
  db: Db,
  administratorId: string,
  extraUserIds: string[] = [],
): Promise<void> {
  const estates = await db.estate.findMany({
    where: { administratorId },
    select: { id: true },
  });
  for (const { id } of estates) {
    await purgeEstate(db, id);
  }
  // La agenda referencia a sus autores con FK RESTRICT: sus tareas se borran antes que los usuarios.
  await db.agendaTask.deleteMany({ where: { administratorId } });
  const staff = await db.user.findMany({
    where: { administratorId },
    select: { id: true },
  });
  const userIds = [...staff.map((u) => u.id), ...extraUserIds];
  if (userIds.length) {
    await db.dataAccessLog.deleteMany({
      where: { actorUserId: { in: userIds } },
    });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
  await db.administrator.delete({ where: { id: administratorId } });
}
