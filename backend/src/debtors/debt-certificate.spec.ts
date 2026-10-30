import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PropertyAccessService } from '../estate-access/property-access.service';
import { AuditService } from '../gdpr/audit.service';
import { DebtorsService } from './debtors.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JournalService } from '../ledger/journal/journal.service';
import { ReceiptPostingService } from '../ledger/posting/receipt-posting.service';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import { LateInterestService } from '../ledger/interest/late-interest.service';
import { LatePaymentInterestPoliciesService } from '../ledger/interest/late-interest-policies.service';
import {
  createAdministrator,
  createLedgerEstate,
  createOwnerUser,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleA,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * `debtCertificate` es un documento legal (art. 9.1.e LPH): se exige para
 * poder transmitir una propiedad, y su campo `isDebtFree` tiene
 * consecuencias reales — certificarlo mal puede permitir vender ocultando
 * deuda, o bloquear indebidamente una venta legítima. Integración contra
 * Postgres real porque la agregación (lo pendiente de cada recibo + interés
 * del deudor + acuerdo de pago activo) es exactamente el tipo de cálculo
 * que un mock no verifica de verdad.
 *
 * Cada test trabaja sobre su propia propiedad; la gestora se purga al final.
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();
const audit = new AuditService(prisma as unknown as PrismaService);
const receiptPosting = new ReceiptPostingService(new JournalService());
const collectionPosting = new CollectionPostingService(
  new JournalService(),
  receiptPosting,
);
const propertyAccess = new PropertyAccessService(
  prisma as unknown as PrismaService,
  estateAccess,
);
const service = new DebtorsService(
  prisma as unknown as PrismaService,
  estateAccess,
  audit,
  undefined as never, // DebtorBalancesExcelService: debtCertificate no la toca
  collectionPosting,
  propertyAccess,
);
const interestPolicies = new LatePaymentInterestPoliciesService(
  prisma as unknown as PrismaService,
  estateAccess,
);
const lateInterest = new LateInterestService(
  prisma as unknown as PrismaService,
  estateAccess,
  receiptPosting,
);

let admin: AdministratorFixture;
let estateId: string;
let user: AuthenticatedUser;

function makeProperty() {
  return createProperty(prisma, estateId, { staircase: '2' });
}

function makeReceipt(opts: {
  propertyId: string;
  amount: string;
  status: 'Pendiente' | 'Pagada' | 'Devuelto';
  periodKey?: string;
  dueDate?: Date;
}) {
  return issueTestReceipt(prisma, {
    estateId,
    periodKey: opts.periodKey ?? '2099-06',
    ...opts,
  });
}

function makeDebtor(opts: {
  propertyId: string;
  amount: string;
  interest?: string;
}) {
  return prisma.debtor.create({
    data: {
      administratorId: admin.administratorId,
      estateId,
      propertyId: opts.propertyId,
      amount: opts.amount,
      interest: opts.interest ?? '0',
      monthsOverdue: 1,
      oldest: '2099-06',
      step: 'Aviso',
    },
  });
}

function makeAgreement(opts: {
  debtorId: string;
  status: 'active' | 'cancelled' | 'completed';
  totalAmount: string;
}) {
  return prisma.paymentAgreement.create({
    data: {
      debtorId: opts.debtorId,
      totalAmount: opts.totalAmount,
      installmentsCount: 3,
      firstDueDate: new Date('2099-07-01'),
      status: opts.status,
      signedAt: new Date(),
      createdByUserId: admin.userId,
    },
  });
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (deuda)',
  });
  estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: new Date(Date.UTC(2098, 0, 1)),
    estate: { name: 'Finca de prueba — certificado de deuda' },
  });
  user = roleA(admin.userId);
  // Una sola política para toda la finca (todos los tests comparten estateId).
  await interestPolicies.create(
    estateId,
    { annualRatePct: 3.65, validFrom: '2098-01-01' },
    user,
  );
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('DebtorsService.debtCertificate', () => {
  it('sin recibos pendientes ni deudor: certificado limpio', async () => {
    const prop = await makeProperty();
    const cert = await service.debtCertificate(prop, user);

    expect(cert.principal.toString()).toBe('0');
    expect(cert.interest.toString()).toBe('0');
    expect(cert.totalDebt.toString()).toBe('0');
    expect(cert.isDebtFree).toBe(true);
    expect(cert.activeAgreement).toBeNull();
    expect(cert.pendingReceipts).toHaveLength(0);
  });

  it('suma lo pendiente de los recibos Pendiente y Devuelto — nunca los Pagada', async () => {
    const prop = await makeProperty();
    await makeReceipt({
      propertyId: prop,
      amount: '100.00',
      status: 'Pendiente',
    });
    await makeReceipt({
      propertyId: prop,
      amount: '50.00',
      status: 'Devuelto',
    });
    await makeReceipt({ propertyId: prop, amount: '999.00', status: 'Pagada' });

    const cert = await service.debtCertificate(prop, user);

    expect(cert.principal.toString()).toBe('150');
    expect(cert.pendingReceipts).toHaveLength(2);
    expect(cert.isDebtFree).toBe(false);
  });

  it('un recibo anulado no es deuda', async () => {
    const prop = await makeProperty();
    const receipt = await makeReceipt({
      propertyId: prop,
      amount: '70.00',
      status: 'Pendiente',
    });
    await prisma.$transaction((tx) =>
      new ReceiptPostingService(new JournalService()).cancel(tx, receipt.id, {
        reason: 'Emitido por error',
        date: receipt.accrualDate,
      }),
    );

    const cert = await service.debtCertificate(prop, user);
    expect(cert.isDebtFree).toBe(true);
    expect(cert.pendingReceipts).toHaveLength(0);
  });

  it('lista los recibos por año de origen, el más antiguo primero (art. 9.1.e LPH)', async () => {
    const prop = await makeProperty();
    await makeReceipt({
      propertyId: prop,
      amount: '10.00',
      status: 'Pendiente',
      periodKey: '2099-02',
    });
    await makeReceipt({
      propertyId: prop,
      amount: '20.00',
      status: 'Pendiente',
      periodKey: '2098-11',
    });

    const cert = await service.debtCertificate(prop, user);
    expect(cert.pendingReceipts.map((r) => r.originYear)).toEqual([2098, 2099]);
    expect(cert.pendingReceipts[0].outstanding.toString()).toBe('20');
  });

  it('con interés liquidado pero SIN recibos de principal pendientes, no está libre de deuda (fase 10)', async () => {
    // Caso de trampa: si solo se mirase la deuda principal, una propiedad
    // que ya pagó su recibo pero todavía debe los intereses de demora
    // saldría erróneamente "libre de deuda".
    const prop = await makeProperty();
    const receipt = await makeReceipt({
      propertyId: prop,
      amount: '1000.00',
      status: 'Pendiente',
      dueDate: new Date('2099-06-10T00:00:00Z'),
    });
    // 1.000€ * 3,65% * 30/365 = 3,00€ exactos.
    await lateInterest.accrue(estateId, receipt.id, '2099-07-10', user);
    // Se paga el recibo original — solo queda pendiente el de intereses.
    await prisma.$transaction((tx) =>
      collectionPosting.collect(tx, {
        estateId,
        propertyId: prop,
        date: new Date('2099-07-10T00:00:00Z'),
        amount: 100_000,
        method: 'Transferencia',
        receiptIds: [receipt.id],
      }),
    );

    const cert = await service.debtCertificate(prop, user);

    expect(cert.principal.toString()).toBe('0');
    expect(cert.interest.toString()).toBe('3');
    expect(cert.totalDebt.toString()).toBe('3');
    expect(cert.isDebtFree).toBe(false);
    const interestRow = cert.pendingReceipts.find((r) => r.isInterest);
    expect(interestRow?.originYear).toBe(2099); // el año de la deuda que liquida, no el de emisión.
  });

  it('el total de deuda suma principal + intereses liquidados de verdad (fase 10)', async () => {
    const prop = await makeProperty();
    const receipt = await makeReceipt({
      propertyId: prop,
      amount: '200.00',
      status: 'Pendiente',
      dueDate: new Date('2099-06-10T00:00:00Z'),
    });
    // 200€ * 3,65% * 100/365 = 2,00€ exactos.
    await lateInterest.accrue(estateId, receipt.id, '2099-09-18', user);

    const cert = await service.debtCertificate(prop, user);

    expect(cert.principal.toString()).toBe('200');
    expect(cert.interest.toString()).toBe('2');
    expect(cert.totalDebt.toString()).toBe('202');
  });

  it('solo devuelve el acuerdo de pago ACTIVO, ignorando cancelados/completados', async () => {
    const prop = await makeProperty();
    const debtor = await makeDebtor({ propertyId: prop, amount: '300' });
    await makeAgreement({
      debtorId: debtor.id,
      status: 'cancelled',
      totalAmount: '300',
    });
    await makeAgreement({
      debtorId: debtor.id,
      status: 'completed',
      totalAmount: '300',
    });
    const active = await makeAgreement({
      debtorId: debtor.id,
      status: 'active',
      totalAmount: '300',
    });

    const cert = await service.debtCertificate(prop, user);

    expect(cert.activeAgreement).not.toBeNull();
    expect(cert.activeAgreement!.id).toBe(active.id);
    expect(cert.activeAgreement!.status).toBe('active');
  });

  it('propiedad inexistente lanza NotFoundException', async () => {
    await expect(
      service.debtCertificate('00000000-0000-0000-0000-000000000000', user),
    ).rejects.toThrow(NotFoundException);
  });

  it('deja rastro de auditoría del acceso (RGPD art. 32)', async () => {
    const prop = await makeProperty();
    await service.debtCertificate(prop, user);

    const log = await prisma.dataAccessLog.findFirst({
      where: {
        actorUserId: admin.userId,
        resource: 'debt_certificate',
        resourceId: prop,
      },
    });
    expect(log).not.toBeNull();
    expect(log!.action).toBe('issue');
  });
});

describe('DebtorsService.debtCertificate — art. 9.1.e: franja legal vs. ejercicios anteriores', () => {
  // El año en curso se calcula con la fecha real (Date.now()), como exige
  // el propio art. 9.1.e ("el año en curso") — así que los límites de la
  // franja se calculan aquí igual que en el servicio, nunca a mano, para
  // que el test siga siendo válido pase lo que pase con el reloj.
  const NOW_YEAR = new Date().getUTCFullYear();
  const CUTOFF_YEAR = NOW_YEAR - 3; // año en curso + 3 anteriores = [CUTOFF_YEAR, NOW_YEAR].

  let bucketEstateId: string;

  beforeAll(async () => {
    bucketEstateId = await createLedgerEstate(prisma, admin.administratorId, {
      cutoverDate: new Date(Date.UTC(CUTOFF_YEAR - 2, 0, 1)),
      estate: { name: 'Finca de prueba — franja 9.1.e' },
    });
    await interestPolicies.create(
      bucketEstateId,
      { annualRatePct: 3.65, validFrom: `${CUTOFF_YEAR - 2}-01-01` },
      user,
    );
  });

  it('separa la deuda dentro de la franja legal (límite inclusive) de la de antes, y ambas cuentan solo el principal', async () => {
    const prop = await createProperty(prisma, bucketEstateId, {
      staircase: '9',
    });
    await issueTestReceipt(prisma, {
      estateId: bucketEstateId,
      propertyId: prop,
      periodKey: `${CUTOFF_YEAR}-06`,
      amount: '100.00',
      status: 'Pendiente',
    });
    const olderReceipt = await issueTestReceipt(prisma, {
      estateId: bucketEstateId,
      propertyId: prop,
      periodKey: `${CUTOFF_YEAR - 1}-06`,
      amount: '50.00',
      status: 'Pendiente',
      dueDate: new Date(Date.UTC(CUTOFF_YEAR - 1, 5, 10)),
    });
    // Intereses sobre la deuda más antigua: también deben quedar fuera de
    // la franja legal, junto con su principal.
    await lateInterest.accrue(
      bucketEstateId,
      olderReceipt.id,
      `${CUTOFF_YEAR}-01-01`,
      user,
    );

    const cert = await service.debtCertificate(prop, user);

    expect(cert.article91e.currentYear).toBe(NOW_YEAR);
    expect(cert.article91e.cutoffYear).toBe(CUTOFF_YEAR);
    expect(cert.article91e.principal.toString()).toBe('100');
    expect(cert.article91e.interest.toString()).toBe('0');
    expect(cert.article91e.receipts.map((r) => r.originYear)).toEqual([
      CUTOFF_YEAR,
    ]);

    expect(cert.priorYears.principal.toString()).toBe('50');
    expect(cert.priorYears.interest.toNumber()).toBeGreaterThan(0);
    // Orden no garantizado entre el recibo de principal y el de intereses
    // (mismo originYear, distinto accrualDate real) — solo importa que
    // AMBOS quedaron fuera de la franja legal.
    expect(cert.priorYears.receipts).toHaveLength(2);
    expect(
      cert.priorYears.receipts.every((r) => r.originYear === CUTOFF_YEAR - 1),
    ).toBe(true);

    // El total general (sin desglosar por franja) sigue sumando todo, como antes.
    expect(cert.principal.toString()).toBe('150');
  });
});

describe('DebtorsService.debtCertificate — acceso del rol C (su propia propiedad, nunca la de un vecino)', () => {
  let cEstateId: string;
  let ownProperty: string;
  let neighborProperty: string;
  let ownerUserId: string;
  let ownerUser: AuthenticatedUser;

  beforeAll(async () => {
    cEstateId = await createLedgerEstate(prisma, admin.administratorId, {
      estate: { name: 'Finca de prueba — certificado rol C' },
    });
    ownProperty = await createProperty(prisma, cEstateId, { staircase: 'C1' });
    neighborProperty = await createProperty(prisma, cEstateId, {
      staircase: 'C2',
    });
    ownerUserId = await createOwnerUser(prisma);
    await prisma.propertyMembership.create({
      data: {
        propertyId: ownProperty,
        userId: ownerUserId,
        roleType: 'Propietario',
        status: 'linked',
        linkedAt: new Date(),
      },
    });
    ownerUser = {
      id: ownerUserId,
      role: 'C',
      estateIds: [cEstateId],
      administratorId: null,
    };
  });

  afterAll(async () => {
    await prisma.propertyMembership.deleteMany({
      where: { userId: ownerUserId },
    });
    await prisma.user.delete({ where: { id: ownerUserId } });
  });

  it('el propietario puede emitir el certificado de SU propiedad', async () => {
    await expect(
      service.debtCertificate(ownProperty, ownerUser),
    ).resolves.toMatchObject({ isDebtFree: true });
  });

  it('el propietario NO puede emitir el certificado de un vecino de la misma finca', async () => {
    await expect(
      service.debtCertificate(neighborProperty, ownerUser),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('la gestora (rol B) sigue pudiendo emitir el de cualquier propiedad de su finca', async () => {
    await expect(
      service.debtCertificate(neighborProperty, roleB(admin, [cEstateId])),
    ).resolves.toMatchObject({ isDebtFree: true });
  });
});
