import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { CryptoService } from './crypto.service';
import { MandatesService } from './mandates.service';
import { AuditService } from '../gdpr/audit.service';
import { SepaPain008Service } from './sepa-pain008.service';
import { RemesasService } from './remesas.service';
import { JournalService } from '../ledger/journal/journal.service';
import { ReceiptPostingService } from '../ledger/posting/receipt-posting.service';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createOwnerUser,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleA,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra la base de datos real: `RemesasService.create` decide
 * DINERO REAL que sale de las cuentas de los propietarios. Lo que importa
 * aquí —qué recibos entran y cuáles no, que la exclusión de mandatos no
 * activos se aplique DESPUÉS de refrescar su ciclo de vida, que una
 * modificación pendiente se consuma exactamente una vez— es justo lo que un
 * mock no puede demostrar: hace falta el JOIN real entre recibos, mandatos
 * y sus modificaciones.
 *
 * Cada test trabaja en SU propia finca (`freshEstate`): una remesa recoge
 * todos los recibos pendientes de la finca, así que compartirla haría que
 * los datos de un test se colaran en otro. La gestora entera se purga al
 * final.
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();
function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}
const cryptoService = new CryptoService(
  configWith({ SEPA_ENC_KEY: 'b'.repeat(64) }),
);
const audit = new AuditService(prisma as unknown as PrismaService);
const mandatesService = new MandatesService(
  prisma as unknown as PrismaService,
  estateAccess,
  cryptoService,
  audit,
);
const pain008 = new SepaPain008Service();
const collections = new CollectionPostingService(new JournalService(), new ReceiptPostingService(new JournalService()));
const service = new RemesasService(
  prisma as unknown as PrismaService,
  estateAccess,
  cryptoService,
  mandatesService,
  pain008,
  audit,
  collections,
);

/** CID matemáticamente válido, calculado a mano — ver sepa-pain008.service.spec.ts. */
const VALID_CID = 'ES90000B98765432';
const PERIOD_KEY = '2099-05';

function monthsAgo(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

let admin: AdministratorFixture;
let user: AuthenticatedUser;
const titularUserIds: string[] = [];

interface Ctx {
  estateId: string;
  periodId: string;
}

/** Finca acreedora SEPA válida con el periodo de mayo de 2099. */
async function freshEstate(): Promise<Ctx> {
  const estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: new Date(Date.UTC(2099, 0, 1)),
    estate: {
      name: 'Finca de prueba — remesas SEPA',
      creditorId: VALID_CID,
      creditorIban: cryptoService.encrypt('ES9121000418450200051332'),
      creditorBic: 'CAIXESBBXXX',
    },
  });
  const period = await prisma.accountingPeriod.create({
    data: { estateId, periodKey: PERIOD_KEY, label: 'Mayo 2099', monthAbbrev: 'MAY' },
  });
  return { estateId, periodId: period.id };
}

async function makeTitular(name: string) {
  const id = await createOwnerUser(prisma, { fullName: name });
  titularUserIds.push(id);
  return id;
}

function makeProperty(ctx: Ctx, quotaMonthly: string) {
  return createProperty(prisma, ctx.estateId, { quotaMonthly });
}

async function makeMandate(
  ctx: Ctx,
  opts: {
    propertyId: string;
    titularUserId: string;
    plainIban: string;
    paymentType?: 'recurrent' | 'oneOff';
    status?: 'active' | 'revoked' | 'expired' | 'dormant';
    signedAt?: Date;
    firstUseAt?: Date | null;
    lastUseAt?: Date | null;
  },
) {
  return prisma.mandate.create({
    data: {
      umr: `UMR-TEST-${Math.random().toString(36).slice(2, 10)}`,
      creditorEstateId: ctx.estateId,
      propertyId: opts.propertyId,
      titularUserId: opts.titularUserId,
      scheme: 'CORE',
      paymentType: opts.paymentType ?? 'recurrent',
      debtorIban: cryptoService.encrypt(opts.plainIban),
      signedAt: opts.signedAt ?? new Date('2024-01-01'),
      firstUseAt: opts.firstUseAt ?? null,
      lastUseAt: opts.lastUseAt ?? null,
      status: opts.status ?? 'active',
    },
  });
}

/** Emitido por la vía contable (con su asiento), como en producción. */
function makeReceipt(
  ctx: Ctx,
  opts: {
    propertyId: string;
    amount: string;
    status?: 'Pendiente' | 'Pagada' | 'Devuelto';
    includeInRemesa?: boolean;
    mandateId?: string | null;
  },
) {
  return issueTestReceipt(prisma, { estateId: ctx.estateId, periodKey: PERIOD_KEY, ...opts });
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (remesas)',
  });
  user = roleA(admin.userId);
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId, titularUserIds);
  await prisma.$disconnect();
});

describe('RemesasService.create — selección de candidatos', () => {
  it('incluye recibos Pendiente+includeInRemesa con mandato activo, y calcula bien el total', async () => {
    const ctx = await freshEstate();
    const titular = await makeTitular('Titular A');
    const prop = await makeProperty(ctx, '100.00');
    await makeMandate(ctx, {
      propertyId: prop,
      titularUserId: titular,
      plainIban: 'ES7620770024003102575766',
    });
    await makeReceipt(ctx, { propertyId: prop, amount: '100.00' });

    const remesa = await service.create(
      ctx.estateId,
      {
        periodKey: PERIOD_KEY,
        chargeDate: '2099-05-10',
        scheme: 'CORE',
        concept: 'Cuota mayo',
      },
      user,
    );

    expect(remesa.linesCount).toBe(1);
    expect(remesa.totalAmount.toString()).toBe('100');
    expect(remesa.status).toBe('Presentada');
  });

  it('guarda el MsgId, el banco de abono y un EndToEndId único por línea (los citan las devoluciones)', async () => {
    const ctx = await freshEstate();
    const titular = await makeTitular('Titular E2E');
    for (const iban of ['ES7620770024003102575766', 'ES9121000418450200051332']) {
      const prop = await makeProperty(ctx, '50.00');
      await makeMandate(ctx, { propertyId: prop, titularUserId: titular, plainIban: iban });
      await makeReceipt(ctx, { propertyId: prop, amount: '50.00' });
    }
    const remesa = await service.create(
      ctx.estateId,
      { periodKey: PERIOD_KEY, chargeDate: '2099-05-10', scheme: 'CORE', concept: 'Cuota mayo' },
      user,
    );
    const stored = await prisma.remesaHistoryItem.findUniqueOrThrow({ where: { id: remesa.id }, include: { lines: true } });
    const bank = await prisma.bankAccount.findFirstOrThrow({ where: { estateId: ctx.estateId, isDefault: true } });
    expect(stored.messageId).toBeTruthy();
    expect(stored.bankAccountId).toBe(bank.id);
    const e2e = stored.lines.map((l) => l.endToEndId);
    expect(new Set(e2e).size).toBe(2);
    for (const id of e2e) {
      expect(id!.length).toBeLessThanOrEqual(35);
      expect(stored.xmlContent).toContain(`<EndToEndId>${id}</EndToEndId>`);
    }
  });

  it('un recibo a medio cobrar entra por lo pendiente; uno ya en una remesa enviada no entra hasta anularla', async () => {
    const ctx = await freshEstate();
    const titular = await makeTitular('Titular Parcial');
    const prop = await makeProperty(ctx, '100.00');
    await makeMandate(ctx, { propertyId: prop, titularUserId: titular, plainIban: 'ES7620770024003102575766' });
    const receipt = await makeReceipt(ctx, { propertyId: prop, amount: '100.00' });
    await prisma.$transaction((tx) =>
      collections.collect(tx, {
        estateId: ctx.estateId,
        propertyId: prop,
        date: receipt.accrualDate,
        amount: 4000,
        method: 'Transferencia',
        receiptIds: [receipt.id],
      }),
    );
    const dto = { periodKey: PERIOD_KEY, chargeDate: '2099-05-10', scheme: 'CORE' as const, concept: 'Cuota mayo' };
    const first = await service.create(ctx.estateId, dto, user);
    expect(first.totalAmount.toString()).toBe('60');

    await expect(service.create(ctx.estateId, dto, user)).rejects.toThrow(/No hay recibos pendientes/);
    await service.cancel(first.id, user);
    const again = await service.create(ctx.estateId, dto, user);
    expect(again.linesCount).toBe(1);
  });

  it('excluye un recibo cuyo único mandato está revocado (no activo)', async () => {
    const ctx = await freshEstate();
    const titular = await makeTitular('Titular Revocado');
    const prop = await makeProperty(ctx, '100.00');
    await makeMandate(ctx, {
      propertyId: prop,
      titularUserId: titular,
      plainIban: 'ES7620770024003102575766',
      status: 'revoked',
    });
    await makeReceipt(ctx, { propertyId: prop, amount: '100.00' });

    await expect(
      service.create(
        ctx.estateId,
        {
          periodKey: PERIOD_KEY,
          chargeDate: '2099-05-10',
          scheme: 'CORE',
          concept: 'Cuota mayo',
        },
        user,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('excluye un recibo sin ningún mandato para la propiedad', async () => {
    const ctx = await freshEstate();
    const prop = await makeProperty(ctx, '100.00');
    await makeReceipt(ctx, { propertyId: prop, amount: '100.00' });

    await expect(
      service.create(
        ctx.estateId,
        {
          periodKey: PERIOD_KEY,
          chargeDate: '2099-05-10',
          scheme: 'CORE',
          concept: 'Cuota mayo',
        },
        user,
      ),
    ).rejects.toThrow(/No hay recibos pendientes/);
  });

  it('respeta excludeReceiptIds aunque el recibo tenga mandato activo', async () => {
    const ctx = await freshEstate();
    const titularKept = await makeTitular('Titular Incluido');
    const propKept = await makeProperty(ctx, '60.00');
    await makeMandate(ctx, {
      propertyId: propKept,
      titularUserId: titularKept,
      plainIban: 'ES7620770024003102575766',
    });
    const receiptKept = await makeReceipt(ctx, {
      propertyId: propKept,
      amount: '60.00',
    });

    const titularExcluded = await makeTitular('Titular Excluido');
    const propExcluded = await makeProperty(ctx, '40.00');
    await makeMandate(ctx, {
      propertyId: propExcluded,
      titularUserId: titularExcluded,
      plainIban: 'ES9000012345678910',
    });
    const receiptExcluded = await makeReceipt(ctx, {
      propertyId: propExcluded,
      amount: '40.00',
    });

    const remesa = await service.create(
      ctx.estateId,
      {
        periodKey: PERIOD_KEY,
        chargeDate: '2099-05-10',
        scheme: 'CORE',
        concept: 'Cuota mayo',
        excludeReceiptIds: [receiptExcluded.id],
      },
      user,
    );

    expect(remesa.linesCount).toBe(1);
    const lines = await prisma.remesaLine.findMany({
      where: { remesaId: remesa.id },
    });
    expect(lines.map((l) => l.receiptId)).toEqual([receiptKept.id]);
  });

  it('no incluye recibos ya Pagada ni los que tienen includeInRemesa=false', async () => {
    const ctx = await freshEstate();
    const titular = await makeTitular('Titular Mixto');
    const propPaid = await makeProperty(ctx, '30.00');
    await makeMandate(ctx, {
      propertyId: propPaid,
      titularUserId: titular,
      plainIban: 'ES7620770024003102575766',
    });
    await makeReceipt(ctx, {
      propertyId: propPaid,
      amount: '30.00',
      status: 'Pagada',
    });

    const propNotIncluded = await makeProperty(ctx, '35.00');
    await makeMandate(ctx, {
      propertyId: propNotIncluded,
      titularUserId: titular,
      plainIban: 'ES9000012345678910',
    });
    await makeReceipt(ctx, {
      propertyId: propNotIncluded,
      amount: '35.00',
      includeInRemesa: false,
    });

    await expect(
      service.create(
        ctx.estateId,
        {
          periodKey: PERIOD_KEY,
          chargeDate: '2099-05-10',
          scheme: 'CORE',
          concept: 'Cuota mayo',
        },
        user,
      ),
    ).rejects.toThrow(/No hay recibos pendientes/);
  });
});

describe('RemesasService.create — secuencia FRST/RCUR y estado del mandato', () => {
  it('un mandato sin uso previo genera línea FRST y fija firstUseAt/lastUseAt', async () => {
    const ctx = await freshEstate();
    const titular = await makeTitular('Titular Primer Uso');
    const prop = await makeProperty(ctx, '50.00');
    const mandate = await makeMandate(ctx, {
      propertyId: prop,
      titularUserId: titular,
      plainIban: 'ES7620770024003102575766',
      firstUseAt: null,
    });
    await makeReceipt(ctx, { propertyId: prop, amount: '50.00' });

    const remesa = await service.create(
      ctx.estateId,
      {
        periodKey: PERIOD_KEY,
        chargeDate: '2099-05-10',
        scheme: 'CORE',
        concept: 'Cuota mayo',
      },
      user,
    );

    const line = await prisma.remesaLine.findFirstOrThrow({
      where: { remesaId: remesa.id },
    });
    expect(line.mandateSeq).toBe('FRST');

    const updated = await prisma.mandate.findUniqueOrThrow({
      where: { id: mandate.id },
    });
    expect(updated.firstUseAt).not.toBeNull();
    expect(updated.lastUseAt).not.toBeNull();
  });

  it('un mandato ya usado antes genera línea RCUR y conserva su firstUseAt original', async () => {
    const ctx = await freshEstate();
    const titular = await makeTitular('Titular Recurrente');
    const prop = await makeProperty(ctx, '50.00');
    const originalFirstUse = new Date('2025-01-05');
    const mandate = await makeMandate(ctx, {
      propertyId: prop,
      titularUserId: titular,
      plainIban: 'ES7620770024003102575766',
      firstUseAt: originalFirstUse,
    });
    await makeReceipt(ctx, { propertyId: prop, amount: '50.00' });

    const remesa = await service.create(
      ctx.estateId,
      {
        periodKey: PERIOD_KEY,
        chargeDate: '2099-05-10',
        scheme: 'CORE',
        concept: 'Cuota mayo',
      },
      user,
    );

    const line = await prisma.remesaLine.findFirstOrThrow({
      where: { remesaId: remesa.id },
    });
    expect(line.mandateSeq).toBe('RCUR');

    const updated = await prisma.mandate.findUniqueOrThrow({
      where: { id: mandate.id },
    });
    // firstUseAt NO se reescribe una vez fijado — es la marca de "primer
    // cargo" en la vida del mandato, no del cargo más reciente.
    expect(updated.firstUseAt!.toISOString().slice(0, 10)).toBe('2025-01-05');
  });

  it('excluye un mandato que la propia refresca de ciclo de vida caduca antes de generar (regla de 36 meses)', async () => {
    // No usa el aislamiento de "año 2099": esta regla se calcula contra la
    // fecha REAL del sistema (`new Date()` dentro de refreshLifecycleForEstate),
    // así que hay que firmar el mandato de verdad hace ≥36 meses.
    const ctx = await freshEstate();
    const titular = await makeTitular('Titular Caducado');
    const prop = await makeProperty(ctx, '50.00');
    const mandate = await makeMandate(ctx, {
      propertyId: prop,
      titularUserId: titular,
      plainIban: 'ES7620770024003102575766',
      signedAt: monthsAgo(40),
      firstUseAt: null,
    });
    await makeReceipt(ctx, { propertyId: prop, amount: '50.00' });

    await expect(
      service.create(
        ctx.estateId,
        {
          periodKey: PERIOD_KEY,
          chargeDate: '2099-05-10',
          scheme: 'CORE',
          concept: 'Cuota mayo',
        },
        user,
      ),
    ).rejects.toThrow(/No hay recibos pendientes/);

    const updated = await prisma.mandate.findUniqueOrThrow({
      where: { id: mandate.id },
    });
    expect(updated.status).toBe('expired');
  });
});

describe('RemesasService.create — modificaciones pendientes y privacidad', () => {
  it('consume una modificación pendiente (la marca resuelta) y la refleja en el XML', async () => {
    const ctx = await freshEstate();
    const titular = await makeTitular('Titular Con Modificación');
    const prop = await makeProperty(ctx, '70.00');
    const mandate = await makeMandate(ctx, {
      propertyId: prop,
      titularUserId: titular,
      plainIban: 'ES7620770024003102575766',
      firstUseAt: new Date('2025-01-01'),
    });
    const oldPlainIban = 'ES9000012345678910';
    const amendment = await prisma.mandateAmendment.create({
      data: {
        mandateId: mandate.id,
        field: 'debtor_iban',
        oldValue: cryptoService.encrypt(oldPlainIban),
        newValue: cryptoService.encrypt('ES7620770024003102575766'),
        changedAt: new Date(),
        changedByUserId: admin.userId,
        pendingInFirstNextRemesa: true,
      },
    });
    await makeReceipt(ctx, { propertyId: prop, amount: '70.00' });

    const remesa = await service.create(
      ctx.estateId,
      {
        periodKey: PERIOD_KEY,
        chargeDate: '2099-05-10',
        scheme: 'CORE',
        concept: 'Cuota mayo',
      },
      user,
    );

    const stored = await prisma.remesaHistoryItem.findUniqueOrThrow({
      where: { id: remesa.id },
    });
    expect(stored.xmlContent).toContain('<AmdmntInd>true</AmdmntInd>');
    // El IBAN original va DESCIFRADO y sin espacios en el XML, tal y como
    // lo exige el esquema — ver el fix en sepa-pain008.service.ts.
    expect(stored.xmlContent).toContain(`<IBAN>${oldPlainIban}</IBAN>`);

    const updatedAmendment = await prisma.mandateAmendment.findUniqueOrThrow({
      where: { id: amendment.id },
    });
    expect(updatedAmendment.pendingInFirstNextRemesa).toBe(false);
  });

  it('el IBAN queda enmascarado en la línea persistida — nunca en claro', async () => {
    const ctx = await freshEstate();
    const titular = await makeTitular('Titular Privacidad');
    const prop = await makeProperty(ctx, '45.00');
    const plainIban = 'ES7620770024003102575766';
    await makeMandate(ctx, {
      propertyId: prop,
      titularUserId: titular,
      plainIban,
    });
    await makeReceipt(ctx, { propertyId: prop, amount: '45.00' });

    const remesa = await service.create(
      ctx.estateId,
      {
        periodKey: PERIOD_KEY,
        chargeDate: '2099-05-10',
        scheme: 'CORE',
        concept: 'Cuota mayo',
      },
      user,
    );

    const line = await prisma.remesaLine.findFirstOrThrow({
      where: { remesaId: remesa.id },
    });
    expect(line.iban).not.toBe(plainIban);
    expect(line.iban).not.toContain(plainIban.slice(4, -4));
    expect(line.ibanSnapshot).toMatch(/····/);
  });
});
