import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { PropertyAccessService } from '../../estate-access/property-access.service';
import { AuditService } from '../../gdpr/audit.service';
import { CryptoService } from '../../sepa/crypto.service';
import { MandatesService } from '../../sepa/mandates.service';
import { SepaPain008Service } from '../../sepa/sepa-pain008.service';
import { RemesasService } from '../../sepa/remesas.service';
import { JournalService } from '../journal/journal.service';
import { ReceiptPostingService } from '../posting/receipt-posting.service';
import { CollectionPostingService } from '../posting/collection-posting.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import { SupplierPostingService } from '../posting/supplier-posting.service';
import { TaxSettlementPostingService } from '../posting/tax-settlement-posting.service';
import { PayrollPostingService } from '../posting/payroll-posting.service';
import { LedgerQueryService } from '../ledger-query.service';
import { InvariantsService } from '../invariants.service';
import { AccountingService } from '../../accounting/accounting.service';
import { SupplierInvoicesService } from '../../suppliers/supplier-invoices.service';
import { TaxReportsService } from '../tax/tax-reports.service';
import { TaxSettlementsService } from '../tax/tax-settlements.service';
import { PayrollService } from '../payroll/payroll.service';
import { LatePaymentInterestPoliciesService } from '../interest/late-interest-policies.service';
import { LateInterestService } from '../interest/late-interest.service';
import { OpeningBalancesService } from '../opening/opening-balances.service';
import { YearCloseService } from '../closing/year-close.service';
import { FiscalYearsService } from '../../fiscal-years/fiscal-years.service';
import { BudgetService } from '../budget/budget.service';
import { LedgerReportsService } from '../reports/ledger-reports.service';
import { ReserveFundPostingService } from '../posting/reserve-fund-posting.service';
import { DebtorsService } from '../../debtors/debtors.service';
import { DebtorBalancesExcelService } from '../../debtors/debtor-balances-excel.service';
import { toCents } from '../money';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  createOwnerUser,
  purgeAdministrator,
  roleA,
  type AdministratorFixture,
} from '../../testing/db-fixtures';
import { createPrismaClient } from '../../prisma/create-prisma-client';

/**
 * Escenario de año completo (fase 13, doc/contabilidad/roadmap-partida-doble.md):
 * un ejercicio entero de una finca de verdad, cruzando todos los módulos que
 * se construyeron entre las fases 1 y 12. Los importes están elegidos para
 * que el cálculo salga limpio y quede documentado como tabla más abajo, no
 * porque sean realistas.
 *
 * No es un test unitario: es la prueba de que TODO encaja junto, en el
 * mismo orden en que pasaría en producción. Cada bloque grande corre las
 * invariantes (`invariants.checkAll`) antes de seguir — si algo se
 * descuadra a mitad de año, el test falla ahí, no al final con un número
 * final que no cuadra y ninguna pista de por qué.
 */
jest.setTimeout(180_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const estateAccess = new EstateAccessService();
const propertyAccess = new PropertyAccessService(db, estateAccess);
const audit = new AuditService(db);
function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}
const cryptoService = new CryptoService(
  configWith({ SEPA_ENC_KEY: 'c'.repeat(64) }),
);
const mandatesService = new MandatesService(
  db,
  estateAccess,
  cryptoService,
  audit,
);
const pain008 = new SepaPain008Service();

const journal = new JournalService();
const receiptPosting = new ReceiptPostingService(journal);
const collectionPosting = new CollectionPostingService(journal, receiptPosting);
const supplierPosting = new SupplierPostingService(journal);

const ledgerQuery = new LedgerQueryService(db);
const invariants = new InvariantsService(db, ledgerQuery);
const fiscalYears = new FiscalYearsService(db, estateAccess);
const budget = new BudgetService(db, estateAccess, fiscalYears, ledgerQuery);

const remesas = new RemesasService(
  db,
  estateAccess,
  cryptoService,
  mandatesService,
  pain008,
  audit,
  collectionPosting,
);
const accounting = new AccountingService(
  db,
  estateAccess,
  undefined as never,
  receiptPosting,
  collectionPosting,
  { notify: async () => {} } as unknown as NotificationsService,
);
const supplierInvoices = new SupplierInvoicesService(
  db,
  estateAccess,
  supplierPosting,
);
const taxReports = new TaxReportsService(db, estateAccess);
const taxSettlements = new TaxSettlementsService(
  db,
  estateAccess,
  new TaxSettlementPostingService(journal),
);
const payroll = new PayrollService(
  db,
  estateAccess,
  new PayrollPostingService(journal),
);
const interestPolicies = new LatePaymentInterestPoliciesService(
  db,
  estateAccess,
);
const lateInterest = new LateInterestService(db, estateAccess, receiptPosting);
const openingBalances = new OpeningBalancesService(db, estateAccess, journal);
const yearClose = new YearCloseService(db, estateAccess, journal, ledgerQuery);
const reserveFundPosting = new ReserveFundPostingService(journal);
const ledgerReports = new LedgerReportsService(
  db,
  estateAccess,
  ledgerQuery,
  budget,
  propertyAccess,
);
const debtors = new DebtorsService(
  db,
  estateAccess,
  audit,
  new DebtorBalancesExcelService(),
  collectionPosting,
  propertyAccess,
);

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
const MONTHS = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
];

let admin: AdministratorFixture;
let user: ReturnType<typeof roleA>;
let estateId: string;
const extraUserIds: string[] = [];

interface Props {
  p1: string; // cuota 100 — devolución de marzo, recobrada en efectivo en abril
  p2: string; // cuota 100 — anticipo de apertura
  p3: string; // cuota 150 — devolución de mayo, nunca recobrada; acumula intereses
  p4: string; // cuota 150 — deuda de apertura de dos años (2022 y 2024)
}
let props: Props;
const remesaIds: Record<string, string> = {};

/**
 * ── Tabla de importes (calculados una sola vez, no en cada `it`) ─────────
 *
 * Cuotas:      4 propiedades × 100/100/150/150 = 500,00 €/mes → reserva
 *              10% (50,00 €/mes) + ingreso neto 450,00 €/mes.
 *              12 meses: reserva 600,00 €, ingreso neto 5.400,00 €.
 * Derrama:     300,00 € × 4 propiedades = 1.200,00 € (junio, sin reparto de
 *              reserva — regla propia de `cuota_ordinaria`, no de `derrama`).
 * Apertura:    banco 2.000,00 €; deuda P4 (2022: 100,00 € + 2024: 150,00 €);
 *              anticipo P2 50,00 €; factura proveedor pendiente 200,00 €.
 *              Diferencia (2.000,00 €) a remanente (120), no a reserva.
 * Facturas:    Ascensores Norte   2.600 + 21% IVA = 3.146,00 € (347 incluido)
 *              Arquitectura Sol   1.000 + 21% IVA = 1.210,00 €, IRPF 15% (150,00 €)
 *              Jardinería Verde     250 + 21% IVA =   302,50 € (347 excluido, bajo umbral)
 *              Ingeniería Fachadas  800 + 21% IVA =   968,00 €, IRPF 15% (120,00 €)
 *              Reparaciones Integr. 500 + 21% IVA =   605,00 € (pagada solo la mitad)
 *              Total gasto 6xx: 3.146 + 1.210 + 302,50 + 968 + 605 = 6.231,50 €
 * Nómina:      bruto 1.500,00 € + SS empresa 480,00 € = gasto 1.980,00 €
 *              (SS trabajador 97,50 € e IRPF 150,00 € se retienen del bruto,
 *              no son gasto aparte).
 * Reserva:     uso de 2.000,00 € en noviembre (117 → 746), sin servicio
 *              dedicado (ver el comentario en el bloque de reserva).
 *
 * Gasto total 2026 (6xx): 6.231,50 + 1.980,00 = 8.211,50 €
 * Ingreso total 2026 (7xx): 5.400,00 (cuotas) + 1.200,00 (derrama)
 *                           + 2.000,00 (reserva aplicada) = 8.600,00 €
 * Resultado antes de intereses: 8.600,00 − 8.211,50 = 388,50 € (positivo,
 * a propósito: el cierre en modo B necesita beneficio para poder dotar).
 */
const EXPECTED_RESULT_BEFORE_INTEREST = 388.5;

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora escenario completo',
  });
  user = roleA(admin.userId);
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId, extraUserIds);
  await prisma.$disconnect();
});

async function account(code: string): Promise<string> {
  return (
    await prisma.chartAccount.findFirstOrThrow({ where: { estateId, code } })
  ).id;
}

async function bank(): Promise<{ id: string; chartAccountId: string }> {
  return prisma.bankAccount.findFirstOrThrow({
    where: { estateId, isDefault: true },
  });
}

async function balanceOf(code: string): Promise<number> {
  const agg = await prisma.journalLine.aggregate({
    where: { estateId, account: { code: { startsWith: code } } },
    _sum: { debit: true, credit: true },
  });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
}

async function assertNoErrors(): Promise<void> {
  const issues = await invariants.checkAll(estateId);
  const errors = issues.filter((i) => i.severity === 'error');
  expect(errors).toEqual([]);
}

async function makeMandate(
  propertyId: string,
  plainIban: string,
): Promise<void> {
  const titularUserId = await createOwnerUser(prisma, {
    fullName: `Titular ${plainIban.slice(-4)}`,
  });
  extraUserIds.push(titularUserId);
  await prisma.mandate.create({
    data: {
      umr: `UMR-ESC-${randomUUID().slice(0, 12)}`,
      creditorEstateId: estateId,
      propertyId,
      titularUserId,
      scheme: 'CORE',
      paymentType: 'recurrent',
      debtorIban: cryptoService.encrypt(plainIban),
      signedAt: D('2025-01-01'),
      status: 'active',
    },
  });
}

describe('Escenario de año completo (fase 13)', () => {
  it('crea la finca, sus 4 propiedades, sus mandatos SEPA y la reserva en modo A+B', async () => {
    estateId = await createLedgerEstate(prisma, admin.administratorId, {
      cutoverDate: D('2026-01-01'),
      estate: {
        name: 'Comunidad Escenario Completo',
        creditorId: 'ES90000B98765432',
        creditorIban: cryptoService.encrypt('ES9121000418450200051332'),
        creditorBic: 'CAIXESBBXXX',
      },
    });
    props = {
      p1: await createProperty(prisma, estateId, {
        staircase: '1',
        floor: '1',
        door: 'A',
        quotaMonthly: '100.00',
      }),
      p2: await createProperty(prisma, estateId, {
        staircase: '1',
        floor: '1',
        door: 'B',
        quotaMonthly: '100.00',
      }),
      p3: await createProperty(prisma, estateId, {
        staircase: '1',
        floor: '2',
        door: 'A',
        quotaMonthly: '150.00',
      }),
      p4: await createProperty(prisma, estateId, {
        staircase: '1',
        floor: '2',
        door: 'B',
        quotaMonthly: '150.00',
      }),
    };
    await makeMandate(props.p1, 'ES7620770024003102575766');
    await makeMandate(props.p2, 'ES9121000418450200051332');
    await makeMandate(props.p3, 'ES6621000418401234567891');
    await makeMandate(props.p4, 'ES1000491500051234567892');

    // Reserva modo 'both': A (10% de cada cuota) todo el año + B (complemento
    // al mínimo legal) al cierre — así el escenario ejercita las dos a la vez.
    await prisma.accountingSettings.update({
      where: { estateId },
      data: {
        defaultReserveMode: 'both',
        defaultReserveSharePct: '10.00',
        defaultReserveAllocationRule: 'top_up_to_legal_minimum',
      },
    });

    // Presupuesto ordinario del ejercicio: fija el mínimo legal del 9.1.f
    // LPH (10% de 6.000 € = 600 €) para que la dotación al cierre tenga
    // algo concreto que perseguir.
    await prisma.budgetItem.create({
      data: {
        estateId,
        accountId: await account('622'),
        category: 'Ordinario',
        fiscalYear: 2026,
        budgeted: '6000.00',
      },
    });
  });

  it('apertura: banco, deuda de dos años en P4, anticipo en P2 y una factura de proveedor pendiente', async () => {
    const supplierId = (
      await prisma.supplier.create({
        data: {
          name: 'Limpieza Mensual SL',
          category: 'Limpieza',
          estateId,
          administratorId: admin.administratorId,
        },
      })
    ).id;
    const defaultBank = await bank();

    await openingBalances.saveDraft(
      estateId,
      {
        bankBalances: [{ bankAccountId: defaultBank.id, balance: 2000 }],
        propertyDebts: [
          {
            propertyId: props.p4,
            originYear: 2022,
            concept: 'Cuotas 2022 pendientes',
            amount: 100,
            dueDate: '2022-12-31',
          },
          {
            propertyId: props.p4,
            originYear: 2024,
            concept: 'Cuotas 2024 pendientes',
            amount: 150,
            dueDate: '2024-12-31',
          },
        ],
        propertyAdvances: [
          {
            propertyId: props.p2,
            concept: 'Anticipo del propietario',
            amount: 50,
          },
        ],
        supplierInvoices: [
          {
            supplierId,
            number: 'F-2025-088',
            concept: 'Limpieza diciembre 2025',
            issueDate: '2025-12-28',
            amount: 200,
          },
        ],
        otherBalances: [],
      },
      user,
    );
    const validated = await openingBalances.validate(estateId, user);
    expect(validated.difference).toBe(2000);

    await openingBalances.post(estateId, { differenceRole: 'retained' }, user);

    // 250 de deuda de apertura (P4) menos 50 del anticipo de P2 (saldo acreedor): 200.
    expect(await balanceOf('430')).toBe(200);
    expect(await balanceOf('400')).toBe(-200);
    await assertNoErrors();
  });

  it.each(MONTHS)(
    'mes %s: emite las 4 cuotas, las remesa y las cobra',
    async (mm) => {
      const periodKey = `2026-${mm}`;
      await accounting.generateReceipts(estateId, { periodKey }, user);
      const remesa = await remesas.create(
        estateId,
        {
          periodKey,
          chargeDate: `2026-${mm}-15`,
          scheme: 'CORE',
          concept: `Cuota ${periodKey}`,
        },
        user,
      );
      await remesas.collect(remesa.id, { date: `2026-${mm}-15` }, user);
      remesaIds[periodKey] = remesa.id;

      await assertNoErrors();
    },
  );

  it('la remesa de enero es solo la cuota del mes — la deuda de apertura NO se dominicilia sola', async () => {
    const remesa = await prisma.remesaHistoryItem.findUniqueOrThrow({
      where: { id: remesaIds['2026-01'] },
      include: { lines: true },
    });
    // Los recibos `saldo_anterior` nacen con `includeInRemesa: false` y en
    // su propio periodo histórico (`${originYear}-12`), no en el de la
    // apertura — a propósito: la deuda de años atrás no se cuela sola en
    // el primer adeudo SEPA normal del propietario.
    expect(remesa.lines.length).toBe(4);
    const p4Lines = remesa.lines.filter((l) => l.propertyId === props.p4);
    expect(p4Lines).toHaveLength(1);
  });

  it('devolución de marzo (P1), recobrada en efectivo en abril', async () => {
    const marchLine = await prisma.remesaLine.findFirstOrThrow({
      where: { remesaId: remesaIds['2026-03'], propertyId: props.p1 },
    });
    await prisma.$transaction((tx) =>
      collectionPosting.returnRemesaLine(tx, marchLine.id, {
        date: D('2026-03-20'),
        returnCode: 'MS02',
        returnReason: 'Sin mandato válido',
        source: 'manual',
        userId: user.id,
      }),
    );
    await assertNoErrors();

    await prisma.$transaction((tx) =>
      collectionPosting.collect(tx, {
        estateId,
        propertyId: props.p1,
        date: D('2026-04-10'),
        amount: toCents(100),
        method: 'Efectivo',
        receiptIds: [marchLine.receiptId],
        createdByUserId: user.id,
      }),
    );
    expect(await balanceOf('430')).toBeLessThanOrEqual(250); // P4 sigue debiendo; P1 ya no
    await assertNoErrors();
  });

  it('devolución de mayo (P3), nunca recobrada — queda pendiente para los intereses', async () => {
    const mayLine = await prisma.remesaLine.findFirstOrThrow({
      where: { remesaId: remesaIds['2026-05'], propertyId: props.p3 },
    });
    await prisma.$transaction((tx) =>
      collectionPosting.returnRemesaLine(tx, mayLine.id, {
        date: D('2026-05-20'),
        returnCode: 'AC04',
        returnReason: 'Cuenta cancelada',
        source: 'manual',
        userId: user.id,
      }),
    );
    await assertNoErrors();
  });

  it('derrama de junio: 300 € por propiedad, cobrada por transferencia (sin reparto de reserva)', async () => {
    const reserveBefore = await balanceOf('117');
    for (const propertyId of Object.values(props) as string[]) {
      const receipt = await accounting.createManualReceipt(
        estateId,
        {
          propertyId,
          periodKey: '2026-06',
          concept: 'Derrama — fondo de obras de cubierta',
          kind: 'derrama',
          amount: 300,
          dueDate: '2026-06-30',
          method: 'Transferencia',
          includeInRemesa: false,
        },
        user,
      );
      await prisma.$transaction((tx) =>
        collectionPosting.collect(tx, {
          estateId,
          propertyId,
          date: D('2026-06-25'),
          amount: toCents(300),
          method: 'Transferencia',
          receiptIds: [receipt.id],
          createdByUserId: user.id,
        }),
      );
    }
    // La derrama va entera a la 701 (income_extraordinary): la reserva no se mueve.
    expect(await balanceOf('117')).toBe(reserveBefore);
    expect(await balanceOf('701')).toBe(-1200);
    await assertNoErrors();
  });

  it('6 facturas de proveedor: paga la de apertura, registra las 5 del año (2 con IRPF, 1 pagada solo a medias)', async () => {
    const opening = await prisma.supplierInvoice.findFirstOrThrow({
      where: { estateId, number: 'F-2025-088' },
    });
    await supplierInvoices.pay(
      estateId,
      {
        supplierId: opening.supplierId,
        date: '2026-01-15',
        amount: 200,
        method: 'Transferencia',
        invoiceIds: [opening.id],
      },
      user,
    );

    async function invoiceAndPay(opts: {
      name: string;
      number: string;
      concept: string;
      issueDate: string;
      payDate: string;
      base: number;
      withholdingRatePct?: number;
      withholdingKey?: 'G_profesional';
      payAmount?: number;
    }) {
      const supplierId = (
        await prisma.supplier.create({
          data: {
            name: opts.name,
            category: 'Servicios',
            estateId,
            administratorId: admin.administratorId,
          },
        })
      ).id;
      const invoice = await supplierInvoices.create(
        estateId,
        supplierId,
        {
          number: opts.number,
          concept: opts.concept,
          issueDate: opts.issueDate,
          vatRatePct: 21,
          withholdingRatePct: opts.withholdingRatePct ?? 0,
          withholdingKey: opts.withholdingKey,
          lines: [{ accountId: await account('622'), baseAmount: opts.base }],
        },
        user,
      );
      await supplierInvoices.pay(
        estateId,
        {
          supplierId,
          date: opts.payDate,
          amount: opts.payAmount ?? Number(invoice.payable),
          method: 'Transferencia',
          invoiceIds: [invoice.id],
        },
        user,
      );
      return { supplierId, invoice };
    }

    await invoiceAndPay({
      name: 'Ascensores Norte SA',
      number: 'F-0001',
      concept: 'Mantenimiento ascensor Q1',
      issueDate: '2026-02-05',
      payDate: '2026-02-10',
      base: 2600,
    });
    await invoiceAndPay({
      name: 'Arquitectura Sol SLP',
      number: 'F-0002',
      concept: 'Informe técnico de fachada',
      issueDate: '2026-04-01',
      payDate: '2026-04-05',
      base: 1000,
      withholdingRatePct: 15,
      withholdingKey: 'G_profesional',
    });
    await invoiceAndPay({
      name: 'Jardinería Verde SL',
      number: 'F-0003',
      concept: 'Mantenimiento de jardines — verano',
      issueDate: '2026-06-15',
      payDate: '2026-06-20',
      base: 250,
    });
    await invoiceAndPay({
      name: 'Ingeniería Fachadas SLP',
      number: 'F-0004',
      concept: 'Estudio estructural de fachada norte',
      issueDate: '2026-09-05',
      payDate: '2026-09-12',
      base: 800,
      withholdingRatePct: 15,
      withholdingKey: 'G_profesional',
    });
    const reparaciones = await invoiceAndPay({
      name: 'Reparaciones Integrales SA',
      number: 'F-0005',
      concept: 'Reparación de tejado',
      issueDate: '2026-10-01',
      payDate: '2026-10-10',
      base: 500,
      payAmount: 302.5,
    });
    const reparacionesInvoice = await prisma.supplierInvoice.findUniqueOrThrow({
      where: { id: reparaciones.invoice.id },
    });
    expect(reparacionesInvoice.status).toBe('Parcial');
    expect(reparacionesInvoice.outstanding.toNumber()).toBe(302.5);

    expect(await balanceOf('622')).toBe(6231.5);
    await assertNoErrors();
  });

  it('una nómina: portero registrado y pagado en marzo', async () => {
    const staffMemberId = (
      await prisma.staffMember.create({
        data: {
          estateId,
          administratorId: admin.administratorId,
          fullName: 'Portero Titular',
          position: 'Conserje',
          contractType: 'Indefinido',
          startDate: D('2020-01-01'),
          status: 'Activo',
        },
      })
    ).id;
    const record = await payroll.create(
      estateId,
      {
        staffMemberId,
        period: '2026-03',
        kind: 'mensual',
        accrualDate: '2026-03-31',
        grossSalary: 1500,
        employeeSs: 97.5,
        employerSs: 480,
        irpfWithholding: 150,
      },
      user,
    );
    await payroll.pay(
      record.id,
      { date: '2026-03-31', method: 'Transferencia' },
      user,
    );

    expect(await balanceOf('640')).toBe(1500);
    expect(await balanceOf('642')).toBe(480);
    await assertNoErrors();
  });

  it('modelos 111 trimestrales: Q1 (nómina), Q2 (Arquitectura Sol) y Q3 (Ingeniería Fachadas) pagados; Q4 sin retenciones', async () => {
    const q1 = await taxReports.model111(estateId, 2026, 1, user);
    expect(q1.boxes['28']).toBe(150); // IRPF de la nómina de marzo
    await taxSettlements.create(
      estateId,
      { kind: 'modelo111', period: '2026-T1', date: '2026-04-15', amount: 150 },
      user,
    );

    const q2 = await taxReports.model111(estateId, 2026, 2, user);
    expect(q2.boxes['28']).toBe(150); // IRPF de Arquitectura Sol
    await taxSettlements.create(
      estateId,
      { kind: 'modelo111', period: '2026-T2', date: '2026-07-15', amount: 150 },
      user,
    );

    const q3 = await taxReports.model111(estateId, 2026, 3, user);
    expect(q3.boxes['28']).toBe(120); // IRPF de Ingeniería Fachadas
    await taxSettlements.create(
      estateId,
      { kind: 'modelo111', period: '2026-T3', date: '2026-10-15', amount: 120 },
      user,
    );

    const q4 = await taxReports.model111(estateId, 2026, 4, user);
    expect(q4.boxes['28']).toBe(0);

    await assertNoErrors();
  });

  it('190 y 347 anuales: los dos profesionales con retención, y Ascensores Norte sobre el umbral del 347', async () => {
    const m190 = await taxReports.model190(estateId, 2026, user);
    const withholdings190 = m190.rows.reduce((s, r) => s + r.withholdings, 0);
    expect(withholdings190).toBe(420); // 150 (nómina) + 150 (Arquitectura) + 120 (Ingeniería)

    const m347 = await taxReports.model347(estateId, 2026, user);
    const included = m347.purchases.map((p) => p.name);
    expect(included).toContain('Ascensores Norte SA'); // 3.146 € > 3.005,06 €
    expect(included).not.toContain('Jardinería Verde SL'); // 302,50 € < umbral
    const excludedNames = m347.excluded.map((e) => e.name);
    expect(excludedNames).toEqual(
      expect.arrayContaining([
        'Arquitectura Sol SLP',
        'Ingeniería Fachadas SLP',
      ]), // excluidos por retención: van en el 190
    );
  });

  it('intereses de demora sobre la cuota de mayo de P3 (devuelta y nunca recobrada)', async () => {
    await interestPolicies.create(
      estateId,
      {
        annualRatePct: 3,
        graceDays: 0,
        validFrom: '2026-01-01',
        meetingReference: 'Acta junta ordinaria 2026-01-10',
      },
      user,
    );
    const mayLine = await prisma.remesaLine.findFirstOrThrow({
      where: { remesaId: remesaIds['2026-05'], propertyId: props.p3 },
    });
    const accrued = await lateInterest.accrue(
      estateId,
      mayLine.receiptId,
      '2026-12-01',
      user,
    );
    expect(accrued.interestReceiptId).toBeTruthy();

    const interestReceipt = await prisma.accountingReceipt.findUniqueOrThrow({
      where: { id: accrued.interestReceiptId },
    });
    expect(interestReceipt.kind).toBe('intereses_demora');
    expect(interestReceipt.propertyId).toBe(props.p3);
    expect(interestReceipt.amount.toNumber()).toBeGreaterThan(0);

    await assertNoErrors();
  });

  it('uso del fondo de reserva: 2.000 € en noviembre (117 → 746)', async () => {
    const reserveBefore = await balanceOf('117');
    await prisma.$transaction((tx) =>
      reserveFundPosting.apply(tx, {
        estateId,
        date: D('2026-11-15'),
        amount: toCents(2000),
        reason: 'reparacion',
        concept: 'Impermeabilización de cubierta',
        meetingReference: 'Acta junta extraordinaria 2026-11-05, punto 2',
        userId: user.id,
      }),
    );
    // 117 es de naturaleza ACREEDORA: liberar reserva la DEBITA, así que su
    // saldo (debe − haber) SUBE en 2.000 aunque el fondo real baje 2.000 €.
    expect(await balanceOf('117')).toBe(reserveBefore + 2000);
    expect(await balanceOf('746')).toBe(-2000);
    await assertNoErrors();
  });

  it('balance de situación a 31/12: activo = pasivo + patrimonio neto, al céntimo', async () => {
    const sheet = await ledgerReports.balanceSheet(
      estateId,
      '2026-12-31',
      user,
    );
    expect(sheet.balanced).toBe(true);
    const total =
      sheet.asset.total - (sheet.liability.total + sheet.equity.total);
    expect(Math.abs(total)).toBeLessThan(0.01);
  });

  it('certificado de deuda de P4: separa la franja del art. 9.1.e (2024) de los ejercicios anteriores (2022)', async () => {
    const cert = await debtors.debtCertificate(props.p4, user);
    expect(cert.article91e.cutoffYear).toBe(2023);
    const article91eYears = cert.article91e.receipts.map((r) => r.originYear);
    const priorYears = cert.priorYears.receipts.map((r) => r.originYear);
    expect(article91eYears).toContain(2024);
    expect(priorYears).toContain(2022);
    expect(cert.article91e.principal.toNumber()).toBeGreaterThanOrEqual(150);
    expect(cert.priorYears.principal.toNumber()).toBeGreaterThanOrEqual(100);
  });

  it('resultado del ejercicio antes de cerrar: 388,50 € (con margen para los intereses acumulados)', async () => {
    const figures = await ledgerQuery.estateFigures(estateId, 2026);
    const result = figures.income.toNumber() - figures.expenses.toNumber();
    // Los intereses de demora suman un poco más de ingreso (769) — el
    // resultado real es igual o mayor que la tabla de arriba, nunca menor.
    expect(result).toBeGreaterThanOrEqual(EXPECTED_RESULT_BEFORE_INTEREST);
  });

  it('cierre del ejercicio 2026 con complemento en modo B, y apertura de 2027', async () => {
    const preconditions = await yearClose.preconditions(estateId, 2026, user);
    expect(preconditions.blockers).toEqual([]);

    await yearClose.close(estateId, 2026, user);

    const fy2026 = await prisma.fiscalYear.findUniqueOrThrow({
      where: { estateId_year: { estateId, year: 2026 } },
    });
    expect(fy2026.status).toBe('Cerrado');
    const fy2027 = await prisma.fiscalYear.findUnique({
      where: { estateId_year: { estateId, year: 2027 } },
    });
    expect(fy2027).not.toBeNull();
    expect(fy2027!.status).toBe('Abierto');

    // Beneficio agotado por la dotación (el complemento pedía 2.000 € para
    // llegar al mínimo legal — 600 € — pero el resultado solo daba para una
    // parte): el 129 queda en 0 tras el cierre, no en negativo ni con sobra.
    expect(await balanceOf('129')).toBeCloseTo(0, 2);

    // El endpoint de integridad ve la finca YA cerrada: sigue sin errores
    // duros, y avisa (no bloquea) de que la reserva sigue por debajo del
    // mínimo legal — la dotación no alcanzó, a propósito.
    const issues = await invariants.checkAll(estateId);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(issues).toContainEqual(
      expect.objectContaining({
        check: 'reserve_minimum',
        severity: 'warning',
      }),
    );
  });
});
