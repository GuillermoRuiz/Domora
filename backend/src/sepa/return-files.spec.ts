import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  createProperty,
  issueTestReceipt,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { JournalService } from '../ledger/journal/journal.service';
import { parseLedgerDbError } from '../ledger/journal/journal-db-errors';
import { ReceiptPostingService } from '../ledger/posting/receipt-posting.service';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import { InvariantsService } from '../ledger/invariants.service';
import { LedgerQueryService } from '../ledger/ledger-query.service';
import { ReturnFilesService } from './return-files.service';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Ficheros de devoluciones (fase 6) contra Postgres real: emparejamiento,
 * rechazo antes del cobro (pain.002), devolución después del cobro con
 * comisión (camt.054), idempotencia y las garantías de la base de datos.
 */
jest.setTimeout(90_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const journal = new JournalService();
const posting = new CollectionPostingService(
  journal,
  new ReceiptPostingService(journal),
);
const service = new ReturnFilesService(db, new EstateAccessService(), posting);
const invariants = new InvariantsService(db, new LedgerQueryService(db));

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;

interface Ctx {
  estateId: string;
  user: AuthenticatedUser;
}

interface Remesa {
  id: string;
  messageId: string;
  lines: {
    id: string;
    receiptId: string;
    endToEndId: string | null;
    amount: Prisma.Decimal;
  }[];
}

async function freshEstate(): Promise<Ctx> {
  const estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D('2026-01-01'),
  });
  return { estateId, user: roleB(admin, [estateId]) };
}

/** Remesa presentada con un recibo por importe; `withE2E: false` imita las remesas anteriores a la fase 5. */
async function remesaOf(
  ctx: Ctx,
  amounts: string[],
  opts: { withE2E?: boolean } = {},
): Promise<Remesa> {
  const receipts = [];
  for (const amount of amounts) {
    const propertyId = await createProperty(prisma, ctx.estateId, {
      quotaMonthly: amount,
    });
    receipts.push(
      await issueTestReceipt(prisma, {
        estateId: ctx.estateId,
        propertyId,
        periodKey: '2026-03',
        amount,
      }),
    );
  }
  const bank = await prisma.bankAccount.findFirstOrThrow({
    where: { estateId: ctx.estateId, isDefault: true },
  });
  const messageId = `REM-${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
  const remesa = await prisma.remesaHistoryItem.create({
    data: {
      estateId: ctx.estateId,
      scheme: 'CORE',
      concept: 'Cuotas marzo',
      status: 'Presentada',
      linesCount: receipts.length,
      totalAmount: receipts.reduce(
        (s, r) => s.plus(r.amount),
        new Prisma.Decimal(0),
      ),
      messageId,
      bankAccountId: bank.id,
      lines: {
        create: receipts.map((r, i) => ({
          receiptId: r.id,
          propertyId: r.propertyId,
          iban: 'ES91···1332',
          mandateSeq: 'RCUR',
          amount: r.amount,
          status: 'Pendiente',
          endToEndId:
            opts.withE2E === false
              ? null
              : `${messageId}-${String(i + 1).padStart(4, '0')}`,
        })),
      },
    },
    include: { lines: { orderBy: { endToEndId: 'asc' } } },
  });
  // Mismo orden que `amounts`.
  const lines = receipts.map((r) =>
    remesa.lines.find((l) => l.receiptId === r.id)!,
  );
  return { id: remesa.id, messageId, lines };
}

function file(xml: string, name = 'devoluciones.xml') {
  const buffer = Buffer.from(xml, 'utf8');
  return { originalname: name, buffer, size: buffer.length };
}

function pain002(
  originalMessageId: string,
  txs: { e2e: string; code: string; amount?: string }[],
  opts: { unique?: string } = {},
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.002.001.03"><CstmrPmtStsRpt>
  <GrpHdr><MsgId>STS-${opts.unique ?? Math.random().toString(36).slice(2, 10)}</MsgId><CreDtTm>2026-03-04T08:00:00</CreDtTm></GrpHdr>
  <OrgnlGrpInfAndSts><OrgnlMsgId>${originalMessageId}</OrgnlMsgId><OrgnlMsgNmId>pain.008.001.02</OrgnlMsgNmId><GrpSts>PART</GrpSts></OrgnlGrpInfAndSts>
  <OrgnlPmtInfAndSts><OrgnlPmtInfId>${originalMessageId}-RCUR-1</OrgnlPmtInfId><PmtInfSts>PART</PmtInfSts>
  ${txs
    .map(
      (
        t,
      ) => `<TxInfAndSts><OrgnlEndToEndId>${t.e2e}</OrgnlEndToEndId><TxSts>RJCT</TxSts>
    <StsRsnInf><Rsn><Cd>${t.code}</Cd></Rsn></StsRsnInf>
    <OrgnlTxRef>${t.amount ? `<Amt><InstdAmt Ccy="EUR">${t.amount}</InstdAmt></Amt>` : ''}<ReqdColltnDt>2026-03-05</ReqdColltnDt></OrgnlTxRef></TxInfAndSts>`,
    )
    .join('\n')}
  </OrgnlPmtInfAndSts>
</CstmrPmtStsRpt></Document>`;
}

function pain002Group(originalMessageId: string, code: string) {
  return `<Document><CstmrPmtStsRpt><GrpHdr><MsgId>STS-G-${Math.random().toString(36).slice(2, 8)}</MsgId><CreDtTm>2026-03-03T10:00:00</CreDtTm></GrpHdr>
  <OrgnlGrpInfAndSts><OrgnlMsgId>${originalMessageId}</OrgnlMsgId><GrpSts>RJCT</GrpSts><StsRsnInf><Rsn><Cd>${code}</Cd></Rsn></StsRsnInf></OrgnlGrpInfAndSts>
  </CstmrPmtStsRpt></Document>`;
}

function camt054(
  txs: {
    e2e: string;
    code: string;
    amount: string;
    fee?: string;
    date?: string;
  }[],
) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn>
  <GrpHdr><MsgId>CAMT-${Math.random().toString(36).slice(2, 10)}</MsgId><CreDtTm>2026-03-12T07:00:00</CreDtTm></GrpHdr>
  <Ntfctn><Id>N1</Id>
  ${txs
    .map(
      (
        t,
      ) => `<Ntry><Amt Ccy="EUR">${t.amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>${t.date ?? '2026-03-12'}</Dt></BookgDt>
    <NtryDtls><TxDtls><Refs><EndToEndId>${t.e2e}</EndToEndId></Refs><AmtDtls><TxAmt><Amt Ccy="EUR">${t.amount}</Amt></TxAmt></AmtDtls>
    ${t.fee ? `<Chrgs><Amt Ccy="EUR">${t.fee}</Amt></Chrgs>` : ''}<RtrInf><Rsn><Cd>${t.code}</Cd></Rsn></RtrInf></TxDtls></NtryDtls></Ntry>`,
    )
    .join('\n')}
  </Ntfctn>
</BkToCstmrDbtCdtNtfctn></Document>`;
}

async function balanceOf(estateId: string, code: string) {
  const agg = await prisma.journalLine.aggregate({
    where: { estateId, account: { code: { startsWith: code } } },
    _sum: { debit: true, credit: true },
  });
  return (agg._sum.debit ?? new Prisma.Decimal(0))
    .minus(agg._sum.credit ?? new Prisma.Decimal(0))
    .toFixed(2);
}

const lineStatus = async (id: string) =>
  (await prisma.remesaLine.findUniqueOrThrow({ where: { id } })).status;
const receiptOf = (id: string) =>
  prisma.accountingReceipt.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (ficheros de devolución)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('pain.002: rechazos antes del cobro', () => {
  it('empareja por EndToEndId, rechaza sin asiento y es idempotente', async () => {
    const ctx = await freshEstate();
    const remesa = await remesaOf(ctx, ['100.00', '150.00']);
    const xml = pain002(remesa.messageId, [
      { e2e: remesa.lines[0].endToEndId!, code: 'AC04', amount: '100.00' },
    ]);

    const preview = await service.upload(ctx.estateId, file(xml), ctx.user);
    expect(preview.duplicate).toBe(false);
    expect(preview.format).toBe('pain002');
    expect(preview.counts.matched).toBe(1);
    expect(preview.items[0].returnReason).toBe('Cuenta cancelada');
    expect(preview.items[0].remesaLine?.receipt.id).toBe(
      remesa.lines[0].receiptId,
    );
    // Subirlo no contabiliza nada.
    expect(await lineStatus(remesa.lines[0].id)).toBe('Pendiente');

    const entriesBefore = await prisma.journalEntry.count({
      where: { estateId: ctx.estateId },
    });
    const applied = await service.apply(preview.id, {}, ctx.user);
    expect(applied.summary).toEqual({
      applied: 1,
      alreadyReturned: 0,
      failed: 0,
    });
    expect(await lineStatus(remesa.lines[0].id)).toBe('Rechazado');
    expect(await lineStatus(remesa.lines[1].id)).toBe('Pendiente');
    const receipt = await receiptOf(remesa.lines[0].receiptId);
    expect(receipt.status).toBe('Devuelto');
    expect(receipt.returnCode).toBe('AC04');
    expect(
      await prisma.journalEntry.count({ where: { estateId: ctx.estateId } }),
    ).toBe(entriesBefore);

    // Aplicar otra vez no hace nada; subir el mismo fichero devuelve el mismo registro.
    const again = await service.apply(preview.id, {}, ctx.user);
    expect(again.summary).toEqual({
      applied: 0,
      alreadyReturned: 0,
      failed: 0,
    });
    const dup = await service.upload(
      ctx.estateId,
      file(xml, 'otra-vez.xml'),
      ctx.user,
    );
    expect(dup.duplicate).toBe(true);
    expect(dup.id).toBe(preview.id);
    expect(
      await prisma.returnFile.count({ where: { estateId: ctx.estateId } }),
    ).toBe(1);
  });

  it('el rechazo de la remesa entera rechaza todas sus líneas pendientes', async () => {
    const ctx = await freshEstate();
    const remesa = await remesaOf(ctx, ['100.00', '150.00', '80.00']);
    const preview = await service.upload(
      ctx.estateId,
      file(pain002Group(remesa.messageId, 'FF01')),
      ctx.user,
    );
    expect(preview.items).toHaveLength(3);
    expect(preview.counts.matched).toBe(3);
    await service.apply(preview.id, {}, ctx.user);
    for (const l of remesa.lines)
      expect(await lineStatus(l.id)).toBe('Rechazado');
  });
});

describe('camt.054: devoluciones después del cobro', () => {
  it('contabiliza la devolución y la comisión, y la repercute si la finca lo tiene configurado', async () => {
    const ctx = await freshEstate();
    await prisma.accountingSettings.update({
      where: { estateId: ctx.estateId },
      data: { returnFeeRecharge: true },
    });
    const remesa = await remesaOf(ctx, ['100.00', '150.00']);
    await prisma.$transaction((tx) =>
      posting.collectRemesa(tx, remesa.id, { date: D('2026-03-06') }),
    );
    expect(await balanceOf(ctx.estateId, '572')).toBe('250.00');

    const xml = camt054([
      {
        e2e: remesa.lines[0].endToEndId!,
        code: 'AM04',
        amount: '100.00',
        fee: '2.50',
      },
    ]);
    const preview = await service.upload(ctx.estateId, file(xml), ctx.user);
    expect(preview.format).toBe('camt054');
    expect(preview.items[0].feeAmount?.toFixed(2)).toBe('2.50');

    const applied = await service.apply(preview.id, {}, ctx.user);
    expect(applied.summary.applied).toBe(1);
    expect(await lineStatus(remesa.lines[0].id)).toBe('Devuelto');
    expect((await receiptOf(remesa.lines[0].receiptId)).status).toBe(
      'Devuelto',
    );
    expect((await receiptOf(remesa.lines[1].receiptId)).status).toBe('Pagada');
    expect(await balanceOf(ctx.estateId, '572')).toBe('147.50');
    expect(await balanceOf(ctx.estateId, '626')).toBe('2.50');
    const ret = await prisma.receiptReturn.findFirstOrThrow({
      where: { remesaLineId: remesa.lines[0].id },
    });
    expect(ret.source).toBe('camt054');
    expect(ret.feeRechargedReceiptId).not.toBeNull();
    expect(
      (
        await prisma.remesaHistoryItem.findUniqueOrThrow({
          where: { id: remesa.id },
        })
      ).status,
    ).toBe('ConDevoluciones');
    expect(await invariants.check(ctx.estateId)).toEqual([]);
  });

  it('una partida que la contabilidad rechaza queda fallida con el motivo, y las demás se aplican', async () => {
    const ctx = await freshEstate();
    const remesa = await remesaOf(ctx, ['100.00', '150.00']);
    await prisma.$transaction((tx) =>
      posting.collectRemesa(tx, remesa.id, { date: D('2026-03-06') }),
    );
    const xml = camt054([
      {
        e2e: remesa.lines[0].endToEndId!,
        code: 'MD06',
        amount: '100.00',
        date: '2025-12-20',
      },
      { e2e: remesa.lines[1].endToEndId!, code: 'MD06', amount: '150.00' },
    ]);
    const preview = await service.upload(ctx.estateId, file(xml), ctx.user);
    const applied = await service.apply(
      preview.id,
      { rechargeFee: false },
      ctx.user,
    );
    expect(applied.summary).toEqual({
      applied: 1,
      alreadyReturned: 0,
      failed: 1,
    });
    const failed = applied.items.find((i) => i.status === 'failed')!;
    expect(failed.error).toBeTruthy();
    expect(await lineStatus(remesa.lines[0].id)).toBe('Cobrado');
    expect(await lineStatus(remesa.lines[1].id)).toBe('Devuelto');
    expect(await invariants.check(ctx.estateId)).toEqual([]);
  });
});

describe('Emparejamiento', () => {
  it('sin EndToEndId guardado, empareja por la remesa y el número de recibo, o por importe único', async () => {
    const ctx = await freshEstate();
    const remesa = await remesaOf(ctx, ['100.00', '150.00'], {
      withE2E: false,
    });
    const receipt0 = await receiptOf(remesa.lines[0].receiptId);
    const xml = pain002(remesa.messageId, [
      { e2e: `${remesa.messageId}-${receipt0.no}`.slice(0, 35), code: 'AM04' },
      { e2e: 'DESCONOCIDO-1', code: 'AM04', amount: '150.00' },
    ]);
    const preview = await service.upload(ctx.estateId, file(xml), ctx.user);
    const lineIds = preview.items.map((i) => i.remesaLineId);
    expect(preview.counts.matched).toBe(2);
    expect(lineIds).toEqual([remesa.lines[0].id, remesa.lines[1].id]);
  });

  it('deja sin emparejar lo que no encuentra, lo que no cuadra de importe y la línea repetida', async () => {
    const ctx = await freshEstate();
    const remesa = await remesaOf(ctx, ['100.00']);
    const e2e = remesa.lines[0].endToEndId!;
    const xml = pain002('OTRA-REMESA', [
      { e2e: 'NO-EXISTE-0001', code: 'AM04' },
      { e2e, code: 'AM04', amount: '99.00' },
      { e2e, code: 'AM04', amount: '100.00' },
      { e2e, code: 'AM04', amount: '100.00' },
    ]);
    const preview = await service.upload(ctx.estateId, file(xml), ctx.user);
    expect(preview.items.map((i) => i.status)).toEqual([
      'unmatched',
      'unmatched',
      'matched',
      'unmatched',
    ]);
    expect(preview.items[0].error).toMatch(/No se encuentra/);
    expect(preview.items[1].error).toMatch(/no coincide/);
    expect(preview.items[3].error).toMatch(/dos veces/);
  });

  it('una línea ya devuelta a mano queda marcada como tal, al subir o al aplicar', async () => {
    const ctx = await freshEstate();
    const remesa = await remesaOf(ctx, ['100.00', '150.00']);
    await prisma.$transaction((tx) =>
      posting.returnRemesaLine(tx, remesa.lines[0].id, {
        date: D('2026-03-04'),
        returnCode: 'AM04',
      }),
    );
    const xml = pain002(remesa.messageId, [
      { e2e: remesa.lines[0].endToEndId!, code: 'AM04' },
      { e2e: remesa.lines[1].endToEndId!, code: 'AM04' },
    ]);
    const preview = await service.upload(ctx.estateId, file(xml), ctx.user);
    expect(preview.items.map((i) => i.status)).toEqual([
      'already_returned',
      'matched',
    ]);

    // Entre la revisión y la aplicación alguien la devuelve a mano.
    await prisma.$transaction((tx) =>
      posting.returnRemesaLine(tx, remesa.lines[1].id, {
        date: D('2026-03-04'),
        returnCode: 'AM04',
      }),
    );
    const applied = await service.apply(preview.id, {}, ctx.user);
    expect(applied.summary).toEqual({
      applied: 0,
      alreadyReturned: 1,
      failed: 0,
    });
  });

  it('las líneas de una remesa anulada no se devuelven', async () => {
    const ctx = await freshEstate();
    const remesa = await remesaOf(ctx, ['100.00']);
    await prisma.remesaHistoryItem.update({
      where: { id: remesa.id },
      data: { status: 'Anulada', cancelledAt: new Date() },
    });
    const preview = await service.upload(
      ctx.estateId,
      file(
        pain002(remesa.messageId, [
          { e2e: remesa.lines[0].endToEndId!, code: 'AM04' },
        ]),
      ),
      ctx.user,
    );
    expect(preview.items[0].status).toBe('unmatched');
    expect(preview.items[0].error).toMatch(/anulada/);
  });
});

describe('Validación y acceso', () => {
  it('rechaza lo que no es un fichero de devoluciones', async () => {
    const ctx = await freshEstate();
    await expect(
      service.upload(
        ctx.estateId,
        file('<Document><BkToCstmrStmt/></Document>'),
        ctx.user,
      ),
    ).rejects.toThrow(/camt\.053/);
    await expect(
      service.upload(ctx.estateId, undefined, ctx.user),
    ).rejects.toBeInstanceOf(BadRequestException);
    const onlyAccepted = pain002('X', []).replace(
      '<GrpSts>PART</GrpSts>',
      '<GrpSts>ACCP</GrpSts>',
    );
    await expect(
      service.upload(ctx.estateId, file(onlyAccepted), ctx.user),
    ).rejects.toThrow(/ninguna operación|no contiene devoluciones/);
  });

  it('otra gestora no ve ni aplica el fichero', async () => {
    const ctx = await freshEstate();
    const remesa = await remesaOf(ctx, ['100.00']);
    const preview = await service.upload(
      ctx.estateId,
      file(
        pain002(remesa.messageId, [
          { e2e: remesa.lines[0].endToEndId!, code: 'AM04' },
        ]),
      ),
      ctx.user,
    );
    const stranger = roleB(admin, []);
    await expect(service.detail(preview.id, stranger)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.apply(preview.id, {}, stranger),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.list(ctx.estateId, stranger)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(await lineStatus(remesa.lines[0].id)).toBe('Pendiente');
  });

  it('una partida aplicada no se puede desaplicar (DM042)', async () => {
    const ctx = await freshEstate();
    const remesa = await remesaOf(ctx, ['100.00']);
    const preview = await service.upload(
      ctx.estateId,
      file(
        pain002(remesa.messageId, [
          { e2e: remesa.lines[0].endToEndId!, code: 'AM04' },
        ]),
      ),
      ctx.user,
    );
    await service.apply(preview.id, {}, ctx.user);
    const item = await prisma.returnFileItem.findFirstOrThrow({
      where: { fileId: preview.id },
    });
    let error: unknown;
    try {
      await prisma.returnFileItem.update({
        where: { id: item.id },
        data: { status: 'matched', appliedAt: null },
      });
    } catch (e) {
      error = e;
    }
    expect(parseLedgerDbError(error)?.code).toBe('DM042');
  });
});
