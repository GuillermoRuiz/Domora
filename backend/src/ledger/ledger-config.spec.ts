import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EstateAccessService } from '../estate-access/estate-access.service';
import type { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../sepa/crypto.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  createAdministrator,
  createLedgerEstate,
  purgeAdministrator,
  roleB,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { ChartAccountsService } from './chart/chart-accounts.service';
import { BankAccountsService } from './banks/bank-accounts.service';
import { CreateBankAccountDto } from './banks/bank-accounts.dto';
import { AccountingSettingsService } from './settings/accounting-settings.service';
import { JournalService } from './journal/journal.service';
import { runPosting } from './journal/journal-db-errors';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Plan de cuentas, cuentas bancarias y fecha de corte, contra Postgres real.
 */
jest.setTimeout(60_000);

const prisma = createPrismaClient();
const db = prisma as unknown as PrismaService;
const access = new EstateAccessService();
const crypto = new CryptoService({
  get: (key: string) => (key === 'SEPA_ENC_KEY' ? 'c'.repeat(64) : undefined),
} as unknown as ConfigService);
const chart = new ChartAccountsService(db, access);
const banks = new BankAccountsService(db, access, crypto);
const settings = new AccountingSettingsService(db, access);
const journal = new JournalService();

const D = (iso: string) => new Date(`${iso}T00:00:00Z`);
let admin: AdministratorFixture;

async function freshEstate(
  cutover = '2026-01-01',
): Promise<{ estateId: string; user: AuthenticatedUser }> {
  const estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: D(cutover),
  });
  return { estateId, user: roleB(admin, [estateId]) };
}

function postFee(estateId: string, date: string, bankAccountId?: string) {
  return runPosting(prisma, (tx) =>
    journal.post(tx, {
      estateId,
      date: D(date),
      sourceType: 'manual',
      concept: 'Comisión',
      lines: [
        { account: { role: 'bank_fees' }, debit: 300 },
        {
          account: bankAccountId ? { bankAccountId } : { role: 'bank' },
          credit: 300,
        },
      ],
    }),
  );
}

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (configuración contable)',
  });
});

afterAll(async () => {
  await purgeAdministrator(prisma, admin.administratorId);
  await prisma.$disconnect();
});

describe('Plan de cuentas', () => {
  it('lista la plantilla con su etiqueta y rechaza a quien no tiene acceso a la finca', async () => {
    const { estateId, user } = await freshEstate();
    const accounts = await chart.list(estateId, user);
    expect(accounts.find((a) => a.code === '430')?.label).toBe(
      '430 · Propietarios',
    );
    await expect(chart.list(estateId, roleB(admin, []))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('una subcuenta hereda naturaleza y exigencias del padre', async () => {
    const { estateId, user } = await freshEstate();
    const accounts = await chart.list(estateId, user);
    const owners = accounts.find((a) => a.code === '430')!;
    const sub = await chart.create(
      estateId,
      { code: '4300001', name: 'Propietarios bajos', parentId: owners.id },
      user,
    );
    expect(sub.nature).toBe('asset');
    expect(sub.requiresProperty).toBe(true);
    expect(sub.level).toBe(2);
    expect(sub.system).toBe(false);

    const expenses = accounts.find((a) => a.code === '622')!;
    const lift = await chart.create(
      estateId,
      { code: '6220001', name: 'Ascensor', parentId: expenses.id },
      user,
    );
    expect(lift.nature).toBe('expense');
    expect(lift.allowsCostCentre).toBe(true);
  });

  it('rechaza códigos que no empiezan por el del padre y códigos repetidos', async () => {
    const { estateId, user } = await freshEstate();
    const accounts = await chart.list(estateId, user);
    const expenses = accounts.find((a) => a.code === '622')!;
    await expect(
      chart.create(
        estateId,
        { code: '6230001', name: 'Mal colgada', parentId: expenses.id },
        user,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
    await expect(
      chart.create(estateId, { code: '622', name: 'Repetida' }, user),
    ).rejects.toThrow(ConflictException);
  });

  it('las cuentas que usa la contabilidad automática no se archivan ni se borran', async () => {
    const { estateId, user } = await freshEstate();
    const owners = (await chart.list(estateId, user)).find(
      (a) => a.code === '430',
    )!;
    await expect(
      chart.update(estateId, owners.id, { archived: true }, user),
    ).rejects.toThrow(ForbiddenException);
    await expect(chart.remove(estateId, owners.id, user)).rejects.toThrow(
      ForbiddenException,
    );
    // Renombrar sí se puede.
    const renamed = await chart.update(
      estateId,
      owners.id,
      { name: 'Comuneros' },
      user,
    );
    expect(renamed.label).toBe('430 · Comuneros');
  });

  it('una cuenta propia con apuntes no se borra (409) pero sí se archiva, y archivada no admite apuntes', async () => {
    const { estateId, user } = await freshEstate();
    const other = (await chart.list(estateId, user)).find(
      (a) => a.code === '629',
    )!;
    const own = await chart.create(
      estateId,
      { code: '6290001', name: 'Conserjería', parentId: other.id },
      user,
    );
    await runPosting(prisma, (tx) =>
      journal.post(tx, {
        estateId,
        date: D('2026-02-01'),
        sourceType: 'manual',
        concept: 'Conserjería febrero',
        lines: [
          { account: { accountId: own.id }, debit: 1000 },
          { account: { role: 'bank' }, credit: 1000 },
        ],
      }),
    );
    await expect(chart.remove(estateId, own.id, user)).rejects.toThrow(
      ConflictException,
    );
    await chart.update(estateId, own.id, { archived: true }, user);
    const error = await runPosting(prisma, (tx) =>
      journal.post(tx, {
        estateId,
        date: D('2026-02-02'),
        sourceType: 'manual',
        concept: 'Otro apunte',
        lines: [
          { account: { accountId: own.id }, debit: 100 },
          { account: { role: 'bank' }, credit: 100 },
        ],
      }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as Error).message).toMatch(/archivada/);
  });
});

describe('Cuentas bancarias', () => {
  it('el IBAN se valida con su dígito de control', async () => {
    const bad = plainToInstance(CreateBankAccountDto, {
      alias: 'X',
      iban: 'ES91 2100 0418 4502 0005 1333',
    });
    expect(await validate(bad)).not.toHaveLength(0);
    const good = plainToInstance(CreateBankAccountDto, {
      alias: 'X',
      iban: 'es91 2100 0418 4502 0005 1332',
    });
    expect(await validate(good)).toHaveLength(0);
    expect(good.iban).toBe('ES9121000418450200051332');
  });

  it('guarda el IBAN cifrado, solo lo devuelve enmascarado y numera la subcuenta', async () => {
    const { estateId, user } = await freshEstate();
    const list = await banks.create(
      estateId,
      {
        alias: 'Caixa obras',
        iban: 'ES9121000418450200051332',
        bic: 'caixesbbxxx',
        isReserveAccount: true,
      },
      user,
    );
    const created = list.find((b) => b.alias === 'Caixa obras')!;
    expect(created.accountCode).toBe('5720002');
    expect(created.ibanMasked).toBe('ES91 ···· 1332');
    expect(created.bic).toBe('CAIXESBBXXX');
    expect(created.isDefault).toBe(false);
    expect(created.isReserveAccount).toBe(true);

    const row = await prisma.bankAccount.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(row.ibanEnc).toMatch(/^enc:v1:/);
    expect(row.ibanEnc).not.toContain('2100');
  });

  it('cambiar la predeterminada deja una sola y el alias renombra la subcuenta', async () => {
    const { estateId, user } = await freshEstate();
    const list = await banks.create(estateId, { alias: 'Sabadell' }, user);
    const second = list.find((b) => b.alias === 'Sabadell')!;
    const after = await banks.update(
      estateId,
      second.id,
      { isDefault: true, alias: 'Sabadell principal' },
      user,
    );
    expect(after.filter((b) => b.isDefault).map((b) => b.id)).toEqual([
      second.id,
    ]);
    const sub = await prisma.chartAccount.findFirstOrThrow({
      where: { estateId, code: second.accountCode },
    });
    expect(sub.shortName).toBe('Sabadell principal');
  });

  it('no se cierra la predeterminada ni una cuenta con saldo; con saldo cero sí', async () => {
    const { estateId, user } = await freshEstate();
    const list = await banks.create(estateId, { alias: 'Secundaria' }, user);
    const main = list.find((b) => b.isDefault)!;
    const secondary = list.find((b) => b.alias === 'Secundaria')!;

    await expect(
      banks.update(estateId, main.id, { closed: true }, user),
    ).rejects.toThrow(/cuenta por defecto/);

    await postFee(estateId, '2026-03-01', secondary.id);
    await expect(
      banks.update(estateId, secondary.id, { closed: true }, user),
    ).rejects.toThrow(/tiene saldo \(-3\.00 €\)/);

    // Se deja a cero con un traspaso desde la principal.
    await runPosting(prisma, (tx) =>
      journal.post(tx, {
        estateId,
        date: D('2026-03-02'),
        sourceType: 'treasury',
        concept: 'Traspaso',
        lines: [
          { account: { bankAccountId: secondary.id }, debit: 300 },
          { account: { bankAccountId: main.id }, credit: 300 },
        ],
      }),
    );
    const closed = await banks.update(
      estateId,
      secondary.id,
      { closed: true },
      user,
    );
    expect(closed.find((b) => b.id === secondary.id)!.closedAt).not.toBeNull();

    // Una cuenta cerrada no admite apuntes.
    await expect(postFee(estateId, '2026-03-03', secondary.id)).rejects.toThrow(
      /cerrada/,
    );
  });
});

describe('Fecha de inicio contable', () => {
  it('se puede adelantar libremente mientras no haya asientos', async () => {
    const { estateId, user } = await freshEstate('2026-06-01');
    const view = await settings.update(
      estateId,
      { cutoverDate: '2026-01-01' },
      user,
    );
    expect(view.cutoverDate).toBe('2026-01-01');
    expect(view.cutoverEditable).toBe(true);
  });

  it('noPriorBalancesConfirmedAt es null salvo que se haya confirmado (fase 9)', async () => {
    const { estateId, user } = await freshEstate('2026-01-01');
    expect(
      (await settings.get(estateId, user)).noPriorBalancesConfirmedAt,
    ).toBeNull();

    await prisma.accountingSettings.update({
      where: { estateId },
      data: { noPriorBalancesConfirmedAt: new Date('2026-02-01T10:00:00Z') },
    });
    expect(
      (await settings.get(estateId, user)).noPriorBalancesConfirmedAt,
    ).toBe('2026-02-01T10:00:00.000Z');
  });

  it('no puede quedar posterior a un asiento ya contabilizado, pero sí anterior', async () => {
    const { estateId, user } = await freshEstate('2026-01-01');
    await postFee(estateId, '2026-02-10');
    await expect(
      settings.update(estateId, { cutoverDate: '2026-03-01' }, user),
    ).rejects.toThrow(/asientos desde el 2026-02-10/);
    const earlier = await settings.update(
      estateId,
      { cutoverDate: '2025-12-01' },
      user,
    );
    expect(earlier.cutoverDate).toBe('2025-12-01');
    expect(earlier.firstEntryDate).toBe('2026-02-10');
  });

  it('con asiento de apertura ya no se mueve', async () => {
    const { estateId, user } = await freshEstate('2026-01-01');
    await runPosting(prisma, (tx) =>
      journal.post(tx, {
        estateId,
        date: D('2026-01-01'),
        entryType: 'opening',
        sourceType: 'opening_balance',
        concept: 'Apertura',
        lines: [
          { account: { role: 'bank' }, debit: 150000 },
          { account: { role: 'reserve_fund' }, credit: 150000 },
        ],
      }),
    );
    const view = await settings.get(estateId, user);
    expect(view.hasOpeningEntry).toBe(true);
    expect(view.cutoverEditable).toBe(false);
    await expect(
      settings.update(estateId, { cutoverDate: '2025-01-01' }, user),
    ).rejects.toThrow(/asiento de apertura/);
  });
});
