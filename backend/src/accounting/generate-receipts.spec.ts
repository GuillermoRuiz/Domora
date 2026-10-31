import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { AccountingService } from './accounting.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { JournalService } from '../ledger/journal/journal.service';
import { ReceiptPostingService } from '../ledger/posting/receipt-posting.service';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import type { NotificationsService } from '../notifications/notifications.service';
import {
  createAdministrator,
  createLedgerEstate,
  createOwnerUser,
  createProperty,
  purgeAdministrator,
  type AdministratorFixture,
} from '../testing/db-fixtures';
import { createPrismaClient } from '../prisma/create-prisma-client';

/**
 * Integración contra la base de datos real: lo que importa de
 * `generateReceipts` —resolución del titular con prioridad
 * membresía > propietario externo > etiqueta de unidad, idempotencia bajo
 * reejecución, y numeración que no colisiona con recibos manuales ya
 * existentes en el periodo— es exactamente el tipo de lógica que un mock
 * no verifica: hace falta el JOIN real contra memberships/externalOwners.
 *
 * Los snapshots (`ownerNameSnapshot`, `ownerTaxIdSnapshot`,
 * `ibanSnapshot`...) se congelan al generar y nunca se recalculan: si esta
 * resolución falla en producción, el dato erróneo queda grabado en un
 * documento legal para siempre, no es un bug que "se corrige en el próximo
 * despliegue".
 */
const prisma = createPrismaClient();
const estateAccess = new EstateAccessService();
/** generateReceipts() SÍ llama a notify() por cada recibo nuevo — stub en vez de `undefined as never`. */
const notify = jest.fn().mockResolvedValue(undefined);
const notificationsStub = { notify } as unknown as NotificationsService;
const service = new AccountingService(
  prisma as unknown as PrismaService,
  estateAccess,
  undefined as never, // StorageService: no lo toca ni generateReceipts ni updateReceipt
  receiptPostingFor(),
  collectionsFor(),
  notificationsStub,
);

/** Servicios de contabilización reales, construidos a mano (sin Nest). */
function receiptPostingFor() {
  return new ReceiptPostingService(new JournalService());
}
function collectionsFor() {
  const journal = new JournalService();
  return new CollectionPostingService(
    journal,
    new ReceiptPostingService(journal),
  );
}

/** Bypassa el scoping por finca — no es lo que se prueba aquí. */
const ROLE_A: AuthenticatedUser = {
  id: '',
  role: 'A',
  estateIds: [],
  administratorId: null,
};

/**
 * Cada test usa su propio periodo: los recibos emitidos no se pueden
 * borrar (son documentos con asiento), así que no hay limpieza entre tests;
 * la gestora entera se purga al final.
 */
let periodCounter = 0;
function freshPeriod(): string {
  const n = periodCounter++;
  return `${2099 - Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`;
}

let admin: AdministratorFixture;
let estateId: string;
let ownerUserId: string;
let tenantUserId: string;
let propWithMembershipId: string;
let propWithExternalOwnerId: string;
let propWithNeitherId: string;
let propZeroQuotaId: string;

beforeAll(async () => {
  admin = await createAdministrator(prisma, {
    name: 'Gestora de prueba (recibos)',
  });
  ROLE_A.id = admin.userId;
  estateId = await createLedgerEstate(prisma, admin.administratorId, {
    cutoverDate: new Date(Date.UTC(2090, 0, 1)),
    estate: { name: 'Finca de prueba — generación de recibos' },
  });

  ownerUserId = await createOwnerUser(prisma, {
    fullName: 'Titular Con Cuenta',
  });
  await prisma.user.update({
    where: { id: ownerUserId },
    data: { taxId: '11111111H', taxIdCountry: 'ES' },
  });

  propWithMembershipId = await createProperty(prisma, estateId, {
    staircase: '1',
    floor: '2',
    door: 'A',
    quotaMonthly: '100.00',
  });
  await prisma.propertyMembership.create({
    data: {
      propertyId: propWithMembershipId,
      userId: ownerUserId,
      roleType: 'Propietario',
      status: 'linked',
      isPrimaryContact: true,
      linkedAt: new Date(),
    },
  });

  propWithExternalOwnerId = await createProperty(prisma, estateId, {
    staircase: '1',
    floor: '3',
    door: 'B',
    quotaMonthly: '80.00',
  });
  await prisma.externalOwner.create({
    data: {
      propertyId: propWithExternalOwnerId,
      fullName: 'Titular Sin Cuenta',
      taxId: '22222222J',
      taxIdCountry: 'ES',
      createdByUserId: admin.userId,
    },
  });

  propWithNeitherId = await createProperty(prisma, estateId, {
    status: 'Vacio',
    staircase: '1',
    floor: '4',
    door: 'C',
    quotaMonthly: '50.00',
  });
  propZeroQuotaId = await createProperty(prisma, estateId, {
    type: 'Trastero',
    staircase: '0',
    floor: '0',
    door: 'T1',
    quotaMonthly: '0',
  });
});

afterAll(async () => {
  await purgeAdministrator(
    prisma,
    admin.administratorId,
    [ownerUserId, tenantUserId].filter(Boolean),
  );
  await prisma.$disconnect();
});

describe('generateReceipts', () => {
  it('genera un recibo por propiedad con cuota > 0, y ninguno para cuota = 0', async () => {
    notify.mockClear();
    const PERIOD_KEY = freshPeriod();
    const result = await service.generateReceipts(
      estateId,
      { periodKey: PERIOD_KEY },
      ROLE_A,
    );
    expect(result.created).toBe(3);
    expect(result.skipped).toBe(0);

    const receipts = await prisma.accountingReceipt.findMany({
      where: { period: { estateId, periodKey: PERIOD_KEY } },
    });
    expect(receipts).toHaveLength(3);
    expect(receipts.some((r) => r.propertyId === propZeroQuotaId)).toBe(false);

    // Aviso (ID 22, notifyReceipts): solo la propiedad con titular CON cuenta
    // en plataforma (propWithMembershipId) puede avisarse — el titular externo
    // (sin cuenta) y la propiedad sin titular no tienen a quién avisar.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: [ownerUserId],
        category: 'receipt',
        propertyId: propWithMembershipId,
      }),
    );
  });

  it('resuelve el titular con prioridad: membresía > propietario externo > etiqueta de unidad', async () => {
    const PERIOD_KEY = freshPeriod();
    await service.generateReceipts(estateId, { periodKey: PERIOD_KEY }, ROLE_A);
    const receipts = await prisma.accountingReceipt.findMany({
      where: { period: { estateId, periodKey: PERIOD_KEY } },
    });

    const forMembership = receipts.find(
      (r) => r.propertyId === propWithMembershipId,
    )!;
    expect(forMembership.ownerUserId).toBe(ownerUserId);
    expect(forMembership.ownerNameSnapshot).toBe('Titular Con Cuenta');
    expect(forMembership.ownerTaxIdSnapshot).toBe('11111111H');

    const forExternal = receipts.find(
      (r) => r.propertyId === propWithExternalOwnerId,
    )!;
    expect(forExternal.ownerUserId).toBeNull();
    expect(forExternal.ownerNameSnapshot).toBe('Titular Sin Cuenta');
    expect(forExternal.ownerTaxIdSnapshot).toBe('22222222J');

    const forNeither = receipts.find(
      (r) => r.propertyId === propWithNeitherId,
    )!;
    expect(forNeither.ownerUserId).toBeNull();
    // Sin membresía ni propietario externo: cae a la etiqueta de unidad
    // (staircase-floor-door, no hay `ref`).
    expect(forNeither.ownerNameSnapshot).toBe('1-4-C');
    expect(forNeither.ownerTaxIdSnapshot).toBeNull();
  });

  it('es idempotente: reejecutar el mismo periodo no duplica recibos', async () => {
    const PERIOD_KEY = freshPeriod();
    const first = await service.generateReceipts(
      estateId,
      { periodKey: PERIOD_KEY },
      ROLE_A,
    );
    expect(first.created).toBe(3);

    const second = await service.generateReceipts(
      estateId,
      { periodKey: PERIOD_KEY },
      ROLE_A,
    );
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(3);

    const receipts = await prisma.accountingReceipt.findMany({
      where: { period: { estateId, periodKey: PERIOD_KEY } },
    });
    expect(receipts).toHaveLength(3);
  });

  it('la numeración masiva continúa después de un recibo manual ya existente, sin colisionar', async () => {
    const PERIOD_KEY = freshPeriod();
    // Recibo manual en el mismo periodo, sobre una propiedad sin cuota (no
    // interfiere con las 3 que sí se facturan en masa).
    const manual = await service.createManualReceipt(
      estateId,
      {
        propertyId: propZeroQuotaId,
        periodKey: PERIOD_KEY,
        concept: 'Derrama puntual',
        kind: 'derrama',
        amount: 25,
        dueDate: `${PERIOD_KEY}-15`,
        method: 'Transferencia',
      },
      ROLE_A,
    );
    const prefix = PERIOD_KEY.replace('-', '/');
    expect(manual.no).toBe(`${prefix}-M001`);

    const result = await service.generateReceipts(
      estateId,
      { periodKey: PERIOD_KEY },
      ROLE_A,
    );
    expect(result.created).toBe(3);

    const bulkReceipts = await prisma.accountingReceipt.findMany({
      where: { period: { estateId, periodKey: PERIOD_KEY }, manual: false },
      orderBy: { no: 'asc' },
    });
    // seq arranca en existing.length (1, por el manual) → el primero es 002,
    // no 001. Y el formato (guion simple) nunca colisiona con el "-M" manual.
    expect(bulkReceipts.map((r) => r.no)).toEqual([
      `${prefix}-002`,
      `${prefix}-003`,
      `${prefix}-004`,
    ]);
    expect(bulkReceipts.every((r) => !r.no.includes('M'))).toBe(true);
  });

  it('el vencimiento es el día 5 del mes del periodo', async () => {
    const PERIOD_KEY = freshPeriod();
    await service.generateReceipts(estateId, { periodKey: PERIOD_KEY }, ROLE_A);
    const receipts = await prisma.accountingReceipt.findMany({
      where: { period: { estateId, periodKey: PERIOD_KEY } },
    });
    for (const r of receipts) {
      expect(r.dueDate?.toISOString().slice(0, 10)).toBe(`${PERIOD_KEY}-05`);
    }
  });

  it('rechaza un periodo con mes inválido', async () => {
    await expect(
      service.generateReceipts(estateId, { periodKey: '2099-13' }, ROLE_A),
    ).rejects.toThrow(/inválido/);
  });

  /**
   * Regresión: el titular del recibo es el Propietario (el deudor de la
   * cuota), nunca un inquilino vinculado a la misma unidad. Antes se
   * tomaba `memberships[0]` sin filtrar rol, así que un inquilino invitado
   * desplazaba al propietario importado — y el snapshot erróneo quedaba
   * grabado para siempre en el recibo.
   */
  describe('con inquilinos vinculados a la unidad', () => {
    beforeAll(async () => {
      const tenant = await prisma.user.create({
        data: {
          email: `tenant-recibos-${Date.now()}@test.local`,
          passwordHash: 'x',
          fullName: 'Inquilino Vinculado',
          role: 'C',
          taxId: '33333333P',
          taxIdCountry: 'ES',
        },
      });
      tenantUserId = tenant.id;
      await prisma.propertyMembership.createMany({
        data: [
          // Unidad con propietario importado (sin cuenta) + inquilino con cuenta.
          {
            propertyId: propWithExternalOwnerId,
            userId: tenantUserId,
            roleType: 'Inquilino',
            status: 'linked',
            isPrimaryContact: false,
            linkedAt: new Date(),
          },
          // Peor caso: el inquilino figura como contacto principal y el orderBy lo pondría primero.
          {
            propertyId: propWithMembershipId,
            userId: tenantUserId,
            roleType: 'Inquilino',
            status: 'linked',
            isPrimaryContact: true,
            linkedAt: new Date(0),
          },
        ],
      });
    });

    afterAll(async () => {
      await prisma.propertyMembership.deleteMany({
        where: { userId: tenantUserId },
      });
    });

    it('un inquilino vinculado no desplaza al propietario importado como titular', async () => {
      const PERIOD_KEY = freshPeriod();
      await service.generateReceipts(
        estateId,
        { periodKey: PERIOD_KEY },
        ROLE_A,
      );
      const receipt = await prisma.accountingReceipt.findFirstOrThrow({
        where: {
          period: { estateId, periodKey: PERIOD_KEY },
          propertyId: propWithExternalOwnerId,
        },
      });
      expect(receipt.ownerUserId).toBeNull();
      expect(receipt.ownerNameSnapshot).toBe('Titular Sin Cuenta');
      expect(receipt.ownerTaxIdSnapshot).toBe('22222222J');
    });

    it('aunque el inquilino sea contacto principal, el titular sigue siendo el propietario', async () => {
      const PERIOD_KEY = freshPeriod();
      await service.generateReceipts(
        estateId,
        { periodKey: PERIOD_KEY },
        ROLE_A,
      );
      const receipt = await prisma.accountingReceipt.findFirstOrThrow({
        where: {
          period: { estateId, periodKey: PERIOD_KEY },
          propertyId: propWithMembershipId,
        },
      });
      expect(receipt.ownerUserId).toBe(ownerUserId);
      expect(receipt.ownerNameSnapshot).toBe('Titular Con Cuenta');
    });

    it('el recibo manual aplica la misma regla', async () => {
      const PERIOD_KEY = freshPeriod();
      const manual = await service.createManualReceipt(
        estateId,
        {
          propertyId: propWithExternalOwnerId,
          periodKey: PERIOD_KEY,
          concept: 'Derrama puntual',
          kind: 'derrama',
          amount: 25,
          dueDate: `${PERIOD_KEY}-15`,
          method: 'Transferencia',
        },
        ROLE_A,
      );
      expect(manual.ownerUserId).toBeNull();
      expect(manual.ownerNameSnapshot).toBe('Titular Sin Cuenta');
    });
  });
});

describe('updateReceipt', () => {
  it('al marcar Devuelto sin método explícito, usa Devolucion y actualiza la fecha', async () => {
    const PERIOD_KEY = freshPeriod();
    await service.generateReceipts(estateId, { periodKey: PERIOD_KEY }, ROLE_A);
    const receipt = await prisma.accountingReceipt.findFirstOrThrow({
      where: { period: { estateId, periodKey: PERIOD_KEY } },
    });
    const before = receipt.date;

    const updated = await service.updateReceipt(
      receipt.id,
      {
        status: 'Devuelto',
        returnCode: 'MD01',
        returnReason: 'Cuenta cancelada',
      },
      ROLE_A,
    );

    expect(updated.status).toBe('Devuelto');
    expect(updated.method).toBe('Devolucion');
    expect(updated.returnCode).toBe('MD01');
    expect(updated.date.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('respeta un método explícito en vez de forzar Devolucion', async () => {
    const PERIOD_KEY = freshPeriod();
    await service.generateReceipts(estateId, { periodKey: PERIOD_KEY }, ROLE_A);
    const receipt = await prisma.accountingReceipt.findFirstOrThrow({
      where: { period: { estateId, periodKey: PERIOD_KEY } },
    });

    const updated = await service.updateReceipt(
      receipt.id,
      { method: 'Transferencia' },
      ROLE_A,
    );
    expect(updated.method).toBe('Transferencia');
    expect(updated.status).toBe('Pendiente'); // sin status en el DTO, no cambia
  });
});
