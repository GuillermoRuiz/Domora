/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../app.module';
import type { AppRole } from '../auth/auth.types';
import {
  createAdministrator,
  createOwnerUser,
  purgeAdministrator,
  uniqueEmail,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { SepaCreditorConfig } from './sepa-creditor.config';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Billing data edited by the despacho itself and its SEPA mandate, through
 * HTTP with the COMPLETE application (global guards, ValidationPipe as in
 * main.ts) and real PostgreSQL (odd/tasks/role-a-panel.md S17).
 */
jest.setTimeout(120_000);

const prisma = createPrismaClient();
let app: INestApplication<App>;
let jwt: JwtService;
const API = '/api/v1';
const CREDITOR_ID = 'ES11ZZZB12345674';
const IBAN = 'ES9121000418450200051332';
const OTHER_IBAN = 'ES7921000813610123456789';

let X: AdministratorFixture;
let Y: AdministratorFixture;
let staffId: string;
let ownerId: string;
let tokenA: string;
let tokenB: string;
let tokenC: string;
let invoiceId: string;

function sign(role: AppRole, userId: string, administratorId: string | null): string {
  return jwt.sign({ sub: userId, role, estateIds: [], administratorId });
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const server = () => request(app.getHttpServer());

const baseBilling = {
  businessName: 'Fincas Prueba S.L.',
  cif: 'b-1234567.4',
  address: 'Calle Mayor 1, 28001 Madrid',
  email: 'facturas@fincasprueba.test',
};

async function freshReference(): Promise<string> {
  const res = await server().get(`${API}/admin-billing/me`).set(auth(tokenB)).expect(200);
  return res.body.sepa.mandateReference as string;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SepaCreditorConfig)
    .useValue({ creditorId: CREDITOR_ID, creditorName: 'Domora Pruebas S.L.', creditorAddress: 'Calle Domora 1, Madrid' })
    .compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  await app.listen(0);
  jwt = moduleRef.get(JwtService);

  X = await createAdministrator(prisma, { name: 'Facturación HTTP · Despacho X' });
  Y = await createAdministrator(prisma, { name: 'Facturación HTTP · Despacho Y' });
  await prisma.adminBilling.create({
    data: { administratorId: Y.administratorId, businessName: 'Y S.L.', cif: 'B12345674', address: 'Calle Y', email: 'y@test.local', paymentMethod: 'Transferencia' },
  });
  const staff = await prisma.user.create({
    data: { email: uniqueEmail('staff-billing'), passwordHash: 'x', fullName: 'Staff Domora', role: 'A' },
  });
  staffId = staff.id;
  ownerId = await createOwnerUser(prisma);
  tokenA = sign('A', staffId, null);
  tokenB = sign('B', X.userId, X.administratorId);
  tokenC = sign('C', ownerId, null);

  // An invoice already issued to X, with its frozen recipient snapshot.
  const invoice = await prisma.adminInvoice.create({
    data: {
      administratorId: X.administratorId,
      invoiceNo: `TST-${X.administratorId.slice(0, 18)}`,
      series: 'TST',
      fiscalYear: 2001,
      sequence: 1,
      issueDate: new Date('2001-01-15'),
      operationDate: new Date('2001-01-15'),
      concept: 'Suscripción',
      taxBase: 49,
      taxRate: 21,
      taxAmount: 10.29,
      total: 59.29,
      recipientName: 'Nombre antiguo S.L.',
      recipientTaxId: 'B00000000',
      recipientAddress: 'Dirección antigua',
      status: 'Pagada',
    },
  });
  invoiceId = invoice.id;
});

afterAll(async () => {
  await app?.close();
  for (const fx of [X, Y]) {
    if (fx) await purgeAdministrator(prisma, fx.administratorId);
  }
  await prisma.user.deleteMany({ where: { id: { in: [staffId, ownerId].filter(Boolean) } } });
  await prisma.$disconnect();
});

describe('role B billing data (own despacho only)', () => {
  it('starts empty and offers a fresh mandate reference and the mandate text with Domora creditor identifier', async () => {
    const res = await server().get(`${API}/admin-billing/me`).set(auth(tokenB)).expect(200);
    expect(res.body.billing).toBeNull();
    expect(res.body.mandate).toBeNull();
    expect(res.body.sepa.available).toBe(true);
    expect(res.body.sepa.creditorId).toBe(CREDITOR_ID);
    const code = X.administratorId.replace(/-/g, '').slice(0, 8).toUpperCase();
    expect(res.body.sepa.mandateReference).toMatch(new RegExp(`^DOM-${code}-[0-9]{8}-[0-9A-F]{6}$`));
    expect(res.body.sepa.mandateText).toContain(`Identificador del acreedor: ${CREDITOR_ID}`);
    expect(res.body.sepa.mandateText).toContain(res.body.sepa.mandateReference);
  });

  it('saves the data with the NIF normalised and logs the change in the despacho activity', async () => {
    const res = await server()
      .put(`${API}/admin-billing/me`)
      .set(auth(tokenB))
      .send({ ...baseBilling, paymentMethod: 'Transferencia' })
      .expect(200);
    expect(res.body.billing).toEqual({
      businessName: 'Fincas Prueba S.L.',
      cif: 'B12345674',
      address: 'Calle Mayor 1, 28001 Madrid',
      email: 'facturas@fincasprueba.test',
      paymentMethod: 'Transferencia',
      ibanMasked: null,
    });
    const row = await prisma.adminBilling.findUniqueOrThrow({ where: { administratorId: X.administratorId } });
    expect(row).toMatchObject({ cif: 'B12345674', paymentMethod: 'Transferencia', iban: null });
    const activity = await prisma.adminActivityItem.findMany({ where: { administratorId: X.administratorId, type: 'billing_change' } });
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({ title: 'Datos de facturación actualizados por el despacho', authorUserId: X.userId });
  });

  it('saving the same data again writes no new activity entry', async () => {
    await server().put(`${API}/admin-billing/me`).set(auth(tokenB)).send({ ...baseBilling, paymentMethod: 'Transferencia' }).expect(200);
    expect(await prisma.adminActivityItem.count({ where: { administratorId: X.administratorId, type: 'billing_change' } })).toBe(1);
  });

  it('rejects a NIF/CIF with a wrong check digit, in Spain Spanish, and changes nothing', async () => {
    const res = await server()
      .put(`${API}/admin-billing/me`)
      .set(auth(tokenB))
      .send({ ...baseBilling, cif: 'B12345678', paymentMethod: 'Transferencia' })
      .expect(400);
    expect(JSON.stringify(res.body.message)).toContain('El NIF/CIF no es válido: revisa la letra o el dígito de control.');
    expect((await prisma.adminBilling.findUniqueOrThrow({ where: { administratorId: X.administratorId } })).cif).toBe('B12345674');
  });

  it('rejects an IBAN with wrong check digits', async () => {
    const reference = await freshReference();
    const res = await server()
      .put(`${API}/admin-billing/me`)
      .set(auth(tokenB))
      .send({ ...baseBilling, paymentMethod: 'Domiciliacion', iban: 'ES9121000418450200051333', mandate: { accepted: true, reference, debtorName: 'Fincas Prueba S.L.' } })
      .expect(400);
    expect(JSON.stringify(res.body.message)).toContain('El IBAN no es válido (revisa los dígitos de control).');
  });

  it('cannot target another despacho: an administratorId in the body is refused and the other despacho stays untouched', async () => {
    await server()
      .put(`${API}/admin-billing/me`)
      .set(auth(tokenB))
      .send({ ...baseBilling, paymentMethod: 'Transferencia', administratorId: Y.administratorId })
      .expect(400);
    const y = await prisma.adminBilling.findUniqueOrThrow({ where: { administratorId: Y.administratorId } });
    expect(y).toMatchObject({ businessName: 'Y S.L.', address: 'Calle Y' });
  });

  it('is refused to roles A and C, and role B cannot read the role A mandate endpoint', async () => {
    await server().get(`${API}/admin-billing/me`).set(auth(tokenA)).expect(403);
    await server().put(`${API}/admin-billing/me`).set(auth(tokenA)).send({ ...baseBilling, paymentMethod: 'Transferencia' }).expect(403);
    await server().get(`${API}/admin-billing/me`).set(auth(tokenC)).expect(403);
    await server().put(`${API}/admin-billing/me`).set(auth(tokenC)).send({ ...baseBilling, paymentMethod: 'Transferencia' }).expect(403);
    await server().get(`${API}/admin-billing/${X.administratorId}/sepa-mandates`).set(auth(tokenB)).expect(403);
  });
});

describe('SEPA mandate', () => {
  it('domiciliación requires accepting the mandate', async () => {
    const res = await server()
      .put(`${API}/admin-billing/me`)
      .set(auth(tokenB))
      .send({ ...baseBilling, paymentMethod: 'Domiciliacion', iban: IBAN })
      .expect(400);
    expect(res.body.message).toBe('Para domiciliar los cobros tienes que aceptar la orden de domiciliación SEPA.');
    expect(await prisma.adminSepaMandate.count({ where: { administratorId: X.administratorId } })).toBe(0);
  });

  it('refuses a reference that belongs to another despacho', async () => {
    const res = await server()
      .put(`${API}/admin-billing/me`)
      .set(auth(tokenB))
      .send({ ...baseBilling, paymentMethod: 'Domiciliacion', iban: IBAN, mandate: { accepted: true, reference: 'DOM-00000000-20261027-ABCDEF', debtorName: 'Fincas Prueba S.L.' } })
      .expect(400);
    expect(res.body.message).toBe('La referencia del mandato no es válida. Recarga la página y vuelve a intentarlo.');
  });

  it('accepting it creates the active mandate with the IBAN encrypted, and the API only ever returns it masked', async () => {
    const reference = await freshReference();
    const res = await server()
      .put(`${API}/admin-billing/me`)
      .set(auth(tokenB))
      .send({ ...baseBilling, paymentMethod: 'Domiciliacion', iban: 'es91 2100 0418 4502 0005 1332', mandate: { accepted: true, reference, debtorName: 'Fincas Prueba S.L.' } })
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain(IBAN);
    expect(res.body.billing.ibanMasked).toBe('ES91 ···· 1332');
    expect(res.body.mandate).toMatchObject({ reference, debtorName: 'Fincas Prueba S.L.', ibanMasked: 'ES91 ···· 1332', status: 'active' });

    const mandate = await prisma.adminSepaMandate.findUniqueOrThrow({ where: { reference } });
    expect(mandate.debtorIban.startsWith('enc:v1:')).toBe(true);
    expect(mandate.debtorIban).not.toContain(IBAN);
    expect(mandate).toMatchObject({
      administratorId: X.administratorId,
      creditorId: CREDITOR_ID,
      debtorIbanMasked: 'ES91 ···· 1332',
      status: 'active',
      acceptedByUserId: X.userId,
      textVersion: 'sepa-core-es-v1',
    });
    expect(mandate.mandateText).toContain(`Referencia de la orden de domiciliación: ${reference}`);
    expect(mandate.mandateText).toContain(`Identificador del acreedor: ${CREDITOR_ID}`);
    expect(Date.now() - mandate.signedAt.getTime()).toBeLessThan(60_000);
    const billing = await prisma.adminBilling.findUniqueOrThrow({ where: { administratorId: X.administratorId } });
    expect(billing).toMatchObject({ paymentMethod: 'Domiciliacion', iban: IBAN });
    const titles = (await prisma.adminActivityItem.findMany({ where: { administratorId: X.administratorId, type: 'billing_change' } })).map((a) => a.title);
    expect(titles).toContain(`Mandato SEPA ${reference} firmado por el despacho`);

    const again = await server().get(`${API}/admin-billing/me`).set(auth(tokenB)).expect(200);
    expect(JSON.stringify(again.body)).not.toContain(IBAN);
    expect(again.body.mandate.reference).toBe(reference);
  });

  it('saving other fields keeps the active mandate without asking again', async () => {
    await server()
      .put(`${API}/admin-billing/me`)
      .set(auth(tokenB))
      .send({ ...baseBilling, email: 'otra@fincasprueba.test', paymentMethod: 'Domiciliacion' })
      .expect(200);
    expect(await prisma.adminSepaMandate.count({ where: { administratorId: X.administratorId, status: 'active' } })).toBe(1);
    expect((await prisma.adminBilling.findUniqueOrThrow({ where: { administratorId: X.administratorId } })).iban).toBe(IBAN);
  });

  it('a new IBAN needs a new mandate, and the previous one is revoked (only one active)', async () => {
    const before = await prisma.adminSepaMandate.findFirstOrThrow({ where: { administratorId: X.administratorId, status: 'active' } });
    await server()
      .put(`${API}/admin-billing/me`)
      .set(auth(tokenB))
      .send({ ...baseBilling, paymentMethod: 'Domiciliacion', iban: OTHER_IBAN })
      .expect(400);
    const reference = await freshReference();
    await server()
      .put(`${API}/admin-billing/me`)
      .set(auth(tokenB))
      .send({ ...baseBilling, paymentMethod: 'Domiciliacion', iban: OTHER_IBAN, mandate: { accepted: true, reference, debtorName: 'Fincas Prueba S.L.' } })
      .expect(200);
    const old = await prisma.adminSepaMandate.findUniqueOrThrow({ where: { id: before.id } });
    expect(old).toMatchObject({ status: 'revoked', revokedReason: 'Sustituido por un nuevo mandato' });
    expect(old.revokedAt).not.toBeNull();
    const active = await prisma.adminSepaMandate.findMany({ where: { administratorId: X.administratorId, status: 'active' } });
    expect(active.map((m) => m.reference)).toEqual([reference]);
  });

  it('role A sees the despacho mandates, masked', async () => {
    const res = await server().get(`${API}/admin-billing/${X.administratorId}/sepa-mandates`).set(auth(tokenA)).expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ status: 'active', ibanMasked: 'ES79 ···· 6789', creditorId: CREDITOR_ID });
    expect(res.body[1]).toMatchObject({ status: 'revoked' });
    expect(JSON.stringify(res.body)).not.toMatch(/enc:v1:|ES9121000418450200051332|ES7921000813610123456789/);
  });

  it('switching to transferencia revokes the mandate and clears the IBAN', async () => {
    await server().put(`${API}/admin-billing/me`).set(auth(tokenB)).send({ ...baseBilling, paymentMethod: 'Transferencia' }).expect(200);
    expect(await prisma.adminSepaMandate.count({ where: { administratorId: X.administratorId, status: 'active' } })).toBe(0);
    const revoked = await prisma.adminSepaMandate.findMany({ where: { administratorId: X.administratorId, revokedReason: 'Cambio de método de pago' } });
    expect(revoked).toHaveLength(1);
    expect((await prisma.adminBilling.findUniqueOrThrow({ where: { administratorId: X.administratorId } })).iban).toBeNull();
  });

  it('never changes an invoice already issued', async () => {
    const invoice = await prisma.adminInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    expect(invoice).toMatchObject({ recipientName: 'Nombre antiguo S.L.', recipientTaxId: 'B00000000', recipientAddress: 'Dirección antigua', status: 'Pagada' });
    expect(invoice.total.toString()).toBe('59.29');
  });
});

describe('existing role A billing endpoint', () => {
  it('PUT /admins/:id/billing keeps working for role A', async () => {
    await server()
      .put(`${API}/admins/${Y.administratorId}/billing`)
      .set(auth(tokenA))
      .send({ businessName: 'Y Nueva S.L.', cif: 'B12345674', address: 'Calle Y 2', email: 'y2@test.local', paymentMethod: 'Tarjeta' })
      .expect(200);
    expect(await prisma.adminBilling.findUniqueOrThrow({ where: { administratorId: Y.administratorId } })).toMatchObject({ businessName: 'Y Nueva S.L.', paymentMethod: 'Tarjeta' });
  });
});
