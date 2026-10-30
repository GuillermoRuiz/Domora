import { BadRequestException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { JournalService } from '../ledger/journal/journal.service';
import type { ReceiptPostingService } from '../ledger/posting/receipt-posting.service';
import type { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import type { OpeningBalancesService } from '../ledger/opening/opening-balances.service';
import type { ImportBatch } from '../prisma/client';
import { ImportsService, type UploadedMulterFile } from './imports.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import type { AppRole, AuthenticatedUser } from '../auth/auth.types';

/**
 * `EstateAccessService` es lógica pura (sin I/O) — se usa la instancia
 * real, como ya hace `resources.service.spec.ts`. Solo se mockean los
 * bordes de I/O reales: Prisma y `StorageService`.
 */

const ESTATE = 'estate-1';
const ADMIN = 'gestora-1';

function user(role: AppRole, estateIds: string[] = [ESTATE]): AuthenticatedUser {
  return { id: 'u1', role, estateIds, administratorId: ADMIN };
}

function makeBatch(overrides: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: 'batch-1',
    estateId: ESTATE,
    administratorId: ADMIN,
    sourcePlatform: 'GESFINCAS_NET',
    scope: 'current_state',
    status: 'uploading',
    rawFileKey: 'imports/estate-1/uuid-propietarios.csv',
    mapping: null,
    summary: null,
    createdByUserId: 'u1',
    createdAt: new Date('2026-08-01T10:00:00Z'),
    completedAt: null,
    ...overrides,
  } as ImportBatch;
}

function makeFile(overrides: Partial<UploadedMulterFile> = {}): UploadedMulterFile {
  return {
    originalname: 'propietarios.csv',
    mimetype: 'text/csv',
    size: 1024,
    buffer: Buffer.from('Nombre,Referencia\nMaría García,A-101\n', 'utf-8'),
    ...overrides,
  };
}

interface PrismaMock {
  importBatch: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  estate: { findFirst: jest.Mock };
  property: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
  externalOwner: {
    create: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    deleteMany: jest.Mock;
  };
  propertyMembershipInvite: { deleteMany: jest.Mock };
  importedRecord: {
    create: jest.Mock;
    findMany: jest.Mock;
    deleteMany: jest.Mock;
  };
  chartAccount: {
    findFirst: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  bankAccount: { findFirst: jest.Mock; findMany: jest.Mock };
  supplier: { findMany: jest.Mock };
  journalEntry: { findUnique: jest.Mock };
  accountingPeriod: {
    findUnique: jest.Mock;
    create: jest.Mock;
    delete: jest.Mock;
  };
  accountingReceipt: {
    findUnique: jest.Mock;
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
  accountingSettings: {
    findUnique: jest.Mock;
  };
  remesaHistoryItem: {
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
  remesaLine: {
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

describe('ImportsService', () => {
  let prisma: PrismaMock;
  let storage: {
    assertAllowed: jest.Mock;
    put: jest.Mock;
    get: jest.Mock;
  };
  let service: ImportsService;
  /** La contabilización real se prueba contra Postgres (ledger/receipts-posting.spec.ts). */
  let collections: { collect: jest.Mock; undo: jest.Mock; activeCollectionsFor: jest.Mock };
  let journal: { post: jest.Mock; reverse: jest.Mock };
  let openingBalances: { get: jest.Mock; saveDraft: jest.Mock };
  let receiptPosting: {
    issue: jest.Mock;
    collect: jest.Mock;
    markReturned: jest.Mock;
    undoCollection: jest.Mock;
    cancel: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      importBatch: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(makeBatch()),
      },
      estate: {
        findFirst: jest.fn().mockResolvedValue({ id: ESTATE, administratorId: ADMIN }),
      },
      property: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'prop-new', ...data })),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      externalOwner: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'owner-new', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      propertyMembershipInvite: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      importedRecord: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      chartAccount: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'account-new', ...data })),
        delete: jest.fn().mockResolvedValue({}),
      },
      bankAccount: {
        findFirst: jest.fn().mockResolvedValue({ id: 'bank-1', chartAccountId: 'acc-bank' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      supplier: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      journalEntry: {
        findUnique: jest.fn().mockResolvedValue({ date: new Date('2026-08-01T00:00:00Z'), reversedBy: null }),
      },
      accountingPeriod: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'period-new', ...data })),
        delete: jest.fn().mockResolvedValue({}),
      },
      accountingReceipt: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'receipt-new', ...data })),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      accountingSettings: {
        findUnique: jest.fn().mockResolvedValue({ cutoverDate: new Date('2026-01-01T00:00:00Z') }),
      },
      remesaHistoryItem: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'remesa-new', ...data })),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      remesaLine: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'line-new', ...data })),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn((cb: (tx: PrismaMock) => unknown) => cb(prisma)),
    };
    storage = {
      assertAllowed: jest.fn(),
      put: jest.fn().mockResolvedValue('imports/estate-1/uuid-propietarios.csv'),
      get: jest.fn().mockResolvedValue(Buffer.from('Nombre,Referencia\nMaría García,A-101\n', 'utf-8')),
    };
    collections = {
      collect: jest.fn().mockResolvedValue({ id: 'collection-new' }),
      undo: jest.fn().mockResolvedValue({}),
      activeCollectionsFor: jest.fn().mockResolvedValue([]),
    };
    receiptPosting = {
      issue: jest.fn().mockImplementation((_tx: unknown, input: Record<string, unknown>) =>
        Promise.resolve({ id: 'receipt-new', ...input }),
      ),
      collect: jest.fn().mockResolvedValue({}),
      markReturned: jest.fn().mockResolvedValue({}),
      undoCollection: jest.fn().mockResolvedValue({}),
      cancel: jest.fn().mockResolvedValue({}),
    };
    let entrySeq = 0;
    journal = {
      post: jest.fn().mockImplementation(() => Promise.resolve({ id: `entry-${++entrySeq}` })),
      reverse: jest.fn().mockResolvedValue({ id: 'reversal' }),
    };
    openingBalances = {
      get: jest.fn().mockResolvedValue({
        bankBalances: [],
        propertyDebts: [],
        propertyAdvances: [],
        supplierInvoices: [],
        otherBalances: [],
      }),
      saveDraft: jest.fn().mockResolvedValue({}),
    };
    service = new ImportsService(
      prisma as unknown as PrismaService,
      new EstateAccessService(),
      storage as unknown as StorageService,
      receiptPosting as unknown as ReceiptPostingService,
      collections as unknown as CollectionPostingService,
      journal as unknown as JournalService,
      openingBalances as unknown as OpeningBalancesService,
    );
  });

  describe('createBatch', () => {
    it('sube el fichero y crea el batch en estado "uploading"', async () => {
      prisma.importBatch.create.mockResolvedValue(makeBatch());

      const result = await service.createBatch(
        ESTATE,
        { sourcePlatform: 'GESFINCAS_NET', scope: 'current_state' },
        makeFile(),
        user('B'),
      );

      expect(storage.assertAllowed).toHaveBeenCalledWith('text/csv', 1024, expect.any(Number));
      expect(storage.put).toHaveBeenCalledWith('imports/estate-1', 'propietarios.csv', expect.any(Buffer));
      const [{ data }] = prisma.importBatch.create.mock.calls[0];
      expect(data.status).toBe('uploading');
      expect(data.administratorId).toBe(ADMIN);
      expect(data.createdByUserId).toBe('u1');
      expect(result).toEqual(makeBatch());
    });

    it('sin fichero: rechaza con BadRequestException, sin tocar storage ni Prisma', async () => {
      await expect(
        service.createBatch(
          ESTATE,
          { sourcePlatform: 'GESFINCAS_NET', scope: 'current_state' },
          undefined as unknown as UploadedMulterFile,
          user('B'),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
      expect(prisma.importBatch.create).not.toHaveBeenCalled();
    });

    it('usuario sin administratorId (no debería llegar rol B así, pero por defensa en profundidad): Forbidden', async () => {
      await expect(
        service.createBatch(
          ESTATE,
          { sourcePlatform: 'GESFINCAS_NET', scope: 'current_state' },
          makeFile(),
          { id: 'u2', role: 'B', estateIds: [ESTATE], administratorId: null },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('finca ajena: Forbidden antes de tocar storage', async () => {
      await expect(
        service.createBatch(
          ESTATE,
          { sourcePlatform: 'GESFINCAS_NET', scope: 'current_state' },
          makeFile(),
          user('B', ['otra-finca']),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('fichero rechazado por StorageService (tipo/tamaño): propaga el error sin crear el batch', async () => {
      storage.assertAllowed.mockImplementation(() => {
        throw new BadRequestException('Tipo de fichero no permitido: application/x-msdownload');
      });
      await expect(
        service.createBatch(
          ESTATE,
          { sourcePlatform: 'GESFINCAS_NET', scope: 'current_state' },
          makeFile({ mimetype: 'application/x-msdownload' }),
          user('B'),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.importBatch.create).not.toHaveBeenCalled();
    });
  });

  describe('parse', () => {
    it('lee el fichero ya subido, devuelve cabeceras + muestra, y pasa a "validating"', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch());

      const result = await service.parse(ESTATE, 'batch-1', user('B'));

      expect(result.headers).toEqual(['Nombre', 'Referencia']);
      expect(result.sampleRows).toEqual([{ Nombre: 'María García', Referencia: 'A-101' }]);
      expect(result.totalRows).toBe(1);
      expect(prisma.importBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { status: 'validating' },
      });
    });

    it('la muestra se acota a 10 filas aunque el fichero traiga más', async () => {
      const rows = Array.from({ length: 15 }, (_, i) => `Persona ${i},A-${i}`).join('\n');
      storage.get.mockResolvedValue(Buffer.from(`Nombre,Referencia\n${rows}\n`, 'utf-8'));
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch());

      const result = await service.parse(ESTATE, 'batch-1', user('B'));

      expect(result.totalRows).toBe(15);
      expect(result.sampleRows).toHaveLength(10);
    });

    it('batch inexistente: NotFoundException', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(null);
      await expect(service.parse(ESTATE, 'no-existe', user('B'))).rejects.toThrow(NotFoundException);
    });

    it('batch de otra finca (mismo id, distinta estateId en la búsqueda): NotFoundException, no 403 que confirme existencia', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(null); // findFirst ya filtra por estateId
      await expect(service.parse(ESTATE, 'batch-1', user('B'))).rejects.toThrow(NotFoundException);
    });

    it('batch sin rawFileKey: BadRequestException', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch({ rawFileKey: null }));
      await expect(service.parse(ESTATE, 'batch-1', user('B'))).rejects.toThrow(BadRequestException);
    });
  });

  describe('validate', () => {
    it('mapea, valida cada fila y persiste mapping + summary + status "ready"', async () => {
      storage.get.mockResolvedValue(
        Buffer.from('Nombre,Ref\nMaría García,A-101\nSin Nombre,\n', 'utf-8'),
      );
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch());

      const { summary } = await service.validate(
        ESTATE,
        'batch-1',
        { entityType: 'owner', mapping: { fullName: 'Nombre', propertyRef: 'Ref' } },
        user('B'),
      );

      expect(summary.totalRows).toBe(2);
      expect(summary.okRows).toBe(1);
      expect(summary.errorCount).toBe(1);

      const [{ data }] = prisma.importBatch.update.mock.calls[0];
      expect(data.status).toBe('ready');
      expect(data.mapping).toEqual({ fullName: 'Nombre', propertyRef: 'Ref' });
      expect(data.summary.entityType).toBe('owner');
    });

    it('entityType "property" corre el validador de propiedades, no el de propietarios', async () => {
      storage.get.mockResolvedValue(Buffer.from('Coef\n15\n', 'utf-8'));
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch());

      const { summary } = await service.validate(
        ESTATE,
        'batch-1',
        { entityType: 'property', mapping: { participationQuota: 'Coef' } },
        user('B'),
      );

      expect(summary.okRows).toBe(1); // válido para "property" — no exige propertyRef como "owner"
    });

    it('batch inexistente: NotFoundException', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(null);
      await expect(
        service.validate(ESTATE, 'no-existe', { entityType: 'owner', mapping: {} }, user('B')),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getPresets', () => {
    it('sin headers: devuelve los campos pero ninguna sugerencia', () => {
      const result = service.getPresets('GESFINCAS_NET', 'property');
      expect(result.fields.length).toBeGreaterThan(0);
      expect(result.suggestedMapping).toEqual({});
    });

    it('con headers reales: sugiere el mapeo emparejado', () => {
      const result = service.getPresets('GESFINCAS_NET', 'property', ['Coeficiente', 'Nº Finca']);
      expect(result.suggestedMapping.participationQuota).toBe('Coeficiente');
      expect(result.suggestedMapping.ref).toBe('Nº Finca');
    });
  });

  describe('commit — property', () => {
    const readyBatch = () =>
      makeBatch({
        status: 'ready',
        mapping: { ref: 'Ref', participationQuota: 'Coef' },
        summary: { entityType: 'property' },
      });

    it('crea una Property por fila válida y su ImportedRecord, y pasa a "completed"', async () => {
      storage.get.mockResolvedValue(Buffer.from('Ref,Coef\nA-101,2,5\n', 'utf-8'));
      prisma.importBatch.findFirst.mockResolvedValue(readyBatch());

      const summary = await service.commit(ESTATE, 'batch-1', user('B'));

      expect(prisma.property.create).toHaveBeenCalledTimes(1);
      const [{ data }] = prisma.property.create.mock.calls[0];
      expect(data).toMatchObject({ estateId: ESTATE, administratorId: ADMIN, ref: 'A-101', type: 'Piso', status: 'Vacio' });
      expect(prisma.importedRecord.create).toHaveBeenCalledWith({
        data: { importBatchId: 'batch-1', entityType: 'Property', entityId: 'prop-new' },
      });
      expect((summary as { committed: { createdCount: number } }).committed.createdCount).toBe(1);

      const [{ data: updateData }] = prisma.importBatch.update.mock.calls.at(-1)!;
      expect(updateData.status).toBe('completed');
      expect(updateData.completedAt).toBeInstanceOf(Date);
    });

    it('sin referencia en el origen: genera "AUTO-N" determinista', async () => {
      storage.get.mockResolvedValue(Buffer.from('Coef\n10\n', 'utf-8'));
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({ status: 'ready', mapping: { participationQuota: 'Coef' }, summary: { entityType: 'property' } }),
      );

      await service.commit(ESTATE, 'batch-1', user('B'));

      const [{ data }] = prisma.property.create.mock.calls[0];
      expect(data.ref).toBe('AUTO-1');
    });

    it('referencia que ya existe en la finca: se omite la fila, no se crea Property', async () => {
      prisma.property.findMany.mockResolvedValue([{ ref: 'A-101' }]);
      storage.get.mockResolvedValue(Buffer.from('Ref\nA-101\n', 'utf-8'));
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({ status: 'ready', mapping: { ref: 'Ref' }, summary: { entityType: 'property' } }),
      );

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { createdCount: number; skippedCount: number; skippedReasons: { reason: string }[] };
      };

      expect(prisma.property.create).not.toHaveBeenCalled();
      expect(summary.committed.skippedCount).toBe(1);
      expect(summary.committed.skippedReasons[0].reason).toContain('Ya existe una propiedad');
    });

    it('batch que no está en "ready": BadRequestException', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch({ status: 'uploading' }));
      await expect(service.commit(ESTATE, 'batch-1', user('B'))).rejects.toThrow(BadRequestException);
      expect(prisma.property.create).not.toHaveBeenCalled();
    });

    it('sin mapeo/summary validado: BadRequestException', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch({ status: 'ready', mapping: null, summary: null }));
      await expect(service.commit(ESTATE, 'batch-1', user('B'))).rejects.toThrow(BadRequestException);
    });

    it('un fallo real durante el commit deja el batch en "failed" y propaga el error', async () => {
      prisma.estate.findFirst.mockResolvedValue(null); // fuerza NotFoundException dentro de commitProperties
      storage.get.mockResolvedValue(Buffer.from('Ref\nA-101\n', 'utf-8'));
      prisma.importBatch.findFirst.mockResolvedValue(readyBatch());

      await expect(service.commit(ESTATE, 'batch-1', user('B'))).rejects.toThrow(NotFoundException);
      const [{ data }] = prisma.importBatch.update.mock.calls.at(-1)!;
      expect(data.status).toBe('failed');
    });
  });

  describe('commit — owner', () => {
    it('vincula por Ref a una Property existente y crea el ExternalOwner con createdByUserId', async () => {
      prisma.property.findFirst.mockResolvedValue({ id: 'prop-1' });
      storage.get.mockResolvedValue(Buffer.from('Nombre,Ref\nMaría García,A-101\n', 'utf-8'));
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: { fullName: 'Nombre', propertyRef: 'Ref' },
          summary: { entityType: 'owner' },
        }),
      );

      await service.commit(ESTATE, 'batch-1', user('B'));

      const [{ data }] = prisma.externalOwner.create.mock.calls[0];
      expect(data).toMatchObject({ propertyId: 'prop-1', fullName: 'María García', createdByUserId: 'u1' });
      expect(prisma.importedRecord.create).toHaveBeenCalledWith({
        data: { importBatchId: 'batch-1', entityType: 'ExternalOwner', entityId: 'owner-new' },
      });
    });

    it('referencia de propiedad inexistente: se omite la fila, no crea ExternalOwner', async () => {
      prisma.property.findFirst.mockResolvedValue(null);
      storage.get.mockResolvedValue(Buffer.from('Nombre,Ref\nMaría García,NO-EXISTE\n', 'utf-8'));
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: { fullName: 'Nombre', propertyRef: 'Ref' },
          summary: { entityType: 'owner' },
        }),
      );

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { createdCount: number; skippedReasons: { reason: string }[] };
      };

      expect(prisma.externalOwner.create).not.toHaveBeenCalled();
      expect(summary.committed.skippedReasons[0].reason).toContain('No existe ninguna propiedad');
    });
  });

  describe('commit — movement', () => {
    const readyMovementBatch = () =>
      makeBatch({
        status: 'ready',
        mapping: { date: 'Fecha', concept: 'Concepto', accountCode: 'Cuenta', type: 'Tipo', amount: 'Importe' },
        summary: { entityType: 'movement' },
      });

    type Draft = {
      date: Date;
      sourceType: string;
      importBatchId: string;
      lines: { account: Record<string, string>; debit?: number; credit?: number }[];
    };
    const drafts = (): Draft[] => (journal.post.mock.calls as [unknown, Draft][]).map(([, draft]) => draft);

    it('cada fila es un asiento de importación contra el banco principal, en orden cronológico', async () => {
      // A propósito fuera de orden en el fichero — 02/08 antes que 01/08 — para probar que se reordena por fecha.
      storage.get.mockResolvedValue(
        Buffer.from(
          'Fecha,Concepto,Cuenta,Tipo,Importe\n02/08/2026,Gasto limpieza,622,gasto,30\n01/08/2026,Cuota agosto,700,ingreso,100\n',
          'utf-8',
        ),
      );
      prisma.importBatch.findFirst.mockResolvedValue(readyMovementBatch());

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { createdCount: number };
      };

      expect(prisma.chartAccount.create).toHaveBeenCalledTimes(2);
      expect(journal.post).toHaveBeenCalledTimes(2);
      const [first, second] = drafts();
      // Ingreso: carga el banco y abona la cuenta de la fila.
      expect(first.date.toISOString().slice(0, 10)).toBe('2026-08-01');
      expect(first.sourceType).toBe('import');
      expect(first.importBatchId).toBe('batch-1');
      expect(first.lines).toEqual([
        { account: { bankAccountId: 'bank-1' }, debit: 10000 },
        { account: { accountId: 'account-new' }, credit: 10000 },
      ]);
      // Gasto: carga la cuenta y abona el banco.
      expect(second.date.toISOString().slice(0, 10)).toBe('2026-08-02');
      expect(second.lines).toEqual([
        { account: { accountId: 'account-new' }, debit: 3000 },
        { account: { bankAccountId: 'bank-1' }, credit: 3000 },
      ]);
      expect(prisma.importedRecord.create).toHaveBeenCalledWith({
        data: { importBatchId: 'batch-1', entityType: 'JournalEntry', entityId: 'entry-1' },
      });
      expect(summary.committed.createdCount).toBe(2);
    });

    it('reutiliza la cuenta contable si ya existe (no la vuelve a crear)', async () => {
      prisma.chartAccount.findFirst.mockResolvedValue({ id: 'account-existing', code: '700' });
      storage.get.mockResolvedValue(
        Buffer.from('Fecha,Concepto,Cuenta,Tipo,Importe\n01/08/2026,Cuota,700,ingreso,100\n', 'utf-8'),
      );
      prisma.importBatch.findFirst.mockResolvedValue(readyMovementBatch());

      await service.commit(ESTATE, 'batch-1', user('B'));

      expect(prisma.chartAccount.create).not.toHaveBeenCalled();
      expect(drafts()[0].lines[1].account).toEqual({ accountId: 'account-existing' });
    });

    it('salta con su motivo la fila contra una cuenta de propietarios (solo se mueve con recibos y cobros)', async () => {
      prisma.chartAccount.findFirst.mockResolvedValue({ id: 'acc-430', code: '430', requiresProperty: true });
      storage.get.mockResolvedValue(
        Buffer.from('Fecha,Concepto,Cuenta,Tipo,Importe\n01/08/2026,Cuota,430,ingreso,100\n', 'utf-8'),
      );
      prisma.importBatch.findFirst.mockResolvedValue(readyMovementBatch());

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { createdCount: number; skippedReasons: { reason: string }[] };
      };

      expect(journal.post).not.toHaveBeenCalled();
      expect(summary.committed.createdCount).toBe(0);
      expect(summary.committed.skippedReasons[0].reason).toContain('solo se mueve con sus documentos');
    });

    it('una fila que la contabilidad rechaza (p. ej. antes del inicio contable) no bloquea las demás', async () => {
      journal.post
        .mockRejectedValueOnce(new UnprocessableEntityException('La fecha es anterior al inicio de la contabilidad.'))
        .mockResolvedValueOnce({ id: 'entry-ok' });
      storage.get.mockResolvedValue(
        Buffer.from(
          'Fecha,Concepto,Cuenta,Tipo,Importe\n01/08/2025,Antigua,700,ingreso,100\n01/08/2026,Cuota,700,ingreso,100\n',
          'utf-8',
        ),
      );
      prisma.importBatch.findFirst.mockResolvedValue(readyMovementBatch());

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { createdCount: number; skippedReasons: { rowNumber: number; reason: string }[] };
      };

      expect(summary.committed.createdCount).toBe(1);
      expect(summary.committed.skippedReasons).toEqual([
        { rowNumber: expect.any(Number), reason: 'La fecha es anterior al inicio de la contabilidad.' },
      ]);
    });
  });

  describe('commit — receipt', () => {
    it('crea el recibo con snapshots tomados de la fila del origen, no del propietario actual', async () => {
      prisma.property.findFirst.mockResolvedValue({ id: 'prop-1' });
      storage.get.mockResolvedValue(
        Buffer.from(
          'No,Periodo,Ref,Nombre,NIF,IBAN,Concepto,Importe,Estado,Fecha,Metodo\n' +
            '2026/08-001,2026-08,A-101,Juan Histórico,11111111H,ES7620770024003102575766,Cuota agosto,120,Pagada,01/08/2026,Domiciliacion\n',
          'utf-8',
        ),
      );
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: {
            no: 'No', periodKey: 'Periodo', propertyRef: 'Ref', ownerName: 'Nombre', ownerTaxId: 'NIF',
            iban: 'IBAN', concept: 'Concepto', amount: 'Importe', status: 'Estado', date: 'Fecha', method: 'Metodo',
          },
          summary: { entityType: 'receipt' },
        }),
      );

      await service.commit(ESTATE, 'batch-1', user('B'));

      // Se emite por la vía contable (con su asiento), no con un create suelto.
      expect(prisma.accountingReceipt.create).not.toHaveBeenCalled();
      const [, input] = receiptPosting.issue.mock.calls[0];
      expect(input.ownerNameSnapshot).toBe('Juan Histórico');
      expect(input.ownerTaxIdSnapshot).toBe('11111111H');
      expect(input.ibanSnapshot).toBe('ES7620770024003102575766');
      expect(input.manual).toBe(true);
      expect(input.issuedAt).toBeNull();
      expect(input.no).toBe('2026/08-001');
      expect(input.kind).toBe('cuota_ordinaria');
      expect(input.amount).toBe(12000);
      expect(prisma.accountingPeriod.create).toHaveBeenCalledTimes(1);
      // Pagada en el origen: se contabiliza también el cobro.
      expect(collections.collect).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ method: 'Domiciliacion', amount: 12000, receiptIds: ['receipt-new'], propertyId: 'prop-1' }),
      );
    });

    it('un recibo de antes de la fecha de inicio contable se omite: es deuda previa, va a saldos iniciales', async () => {
      prisma.property.findFirst.mockResolvedValue({ id: 'prop-1' });
      storage.get.mockResolvedValue(
        Buffer.from(
          'No,Periodo,Ref,Concepto,Importe,Estado,Fecha,Metodo\n2025/11-001,2025-11,A-101,Cuota,120,Pendiente,01/11/2025,Transferencia\n',
          'utf-8',
        ),
      );
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: { no: 'No', periodKey: 'Periodo', propertyRef: 'Ref', concept: 'Concepto', amount: 'Importe', status: 'Estado', date: 'Fecha', method: 'Metodo' },
          summary: { entityType: 'receipt' },
        }),
      );

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { skippedReasons: { reason: string }[] };
      };

      expect(receiptPosting.issue).not.toHaveBeenCalled();
      expect(summary.committed.skippedReasons[0].reason).toContain('saldos iniciales');
    });

    it('recibo duplicado (mismo periodo+número): se omite, no rompe el lote', async () => {
      prisma.property.findFirst.mockResolvedValue({ id: 'prop-1' });
      prisma.accountingReceipt.findUnique.mockResolvedValue({ id: 'receipt-existing' });
      storage.get.mockResolvedValue(
        Buffer.from(
          'No,Periodo,Ref,Concepto,Importe,Estado,Fecha,Metodo\n2026/08-001,2026-08,A-101,Cuota,120,Pagada,01/08/2026,Transferencia\n',
          'utf-8',
        ),
      );
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: { no: 'No', periodKey: 'Periodo', propertyRef: 'Ref', concept: 'Concepto', amount: 'Importe', status: 'Estado', date: 'Fecha', method: 'Metodo' },
          summary: { entityType: 'receipt' },
        }),
      );

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { skippedReasons: { reason: string }[] };
      };

      expect(receiptPosting.issue).not.toHaveBeenCalled();
      expect(summary.committed.skippedReasons[0].reason).toContain('Ya existe el recibo');
    });
  });

  describe('commit — remesa', () => {
    it('agrupa líneas por remesaRef, hereda snapshots del recibo vinculado, y no crea mandato', async () => {
      prisma.accountingPeriod.findUnique.mockResolvedValue({ id: 'period-1', periodKey: '2026-08' });
      prisma.accountingReceipt.findUnique.mockResolvedValue({
        id: 'receipt-1', propertyId: 'prop-1', ownerUserId: null,
        ownerNameSnapshot: 'Juan Histórico', ownerTaxIdSnapshot: '11111111H', ownerTaxIdCountrySnapshot: 'ES',
        ibanSnapshot: 'ES7620770024003102575766',
      });
      storage.get.mockResolvedValue(
        Buffer.from(
          'Remesa,Periodo,Recibo,Importe,Estado\nREM-AGO-2026,2026-08,2026/08-001,120,Cobrado\n',
          'utf-8',
        ),
      );
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: { remesaRef: 'Remesa', periodKey: 'Periodo', receiptNo: 'Recibo', amount: 'Importe', status: 'Estado' },
          summary: { entityType: 'remesa' },
        }),
      );

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { createdCount: number };
      };

      expect(prisma.remesaHistoryItem.create).toHaveBeenCalledTimes(1);
      const [{ data: header }] = prisma.remesaHistoryItem.create.mock.calls[0];
      expect(header.status).toBe('Cobrada');
      expect(header.linesCount).toBe(1);
      expect(header.totalAmount.toString()).toBe('120');

      const [{ data: line }] = prisma.remesaLine.create.mock.calls[0];
      expect(line.mandateId).toBeNull();
      expect(line.iban).toBe('ES7620770024003102575766');
      expect(line.ownerNameSnapshot).toBe('Juan Histórico');
      expect(summary.committed.createdCount).toBe(1);
    });

    it('línea cuyo recibo no existe: se omite, no crea la cabecera si no queda ninguna línea resoluble', async () => {
      prisma.accountingPeriod.findUnique.mockResolvedValue(null);
      storage.get.mockResolvedValue(
        Buffer.from('Remesa,Periodo,Recibo,Importe,Estado\nREM-X,2026-08,NO-EXISTE,120,Cobrado\n', 'utf-8'),
      );
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: { remesaRef: 'Remesa', periodKey: 'Periodo', receiptNo: 'Recibo', amount: 'Importe', status: 'Estado' },
          summary: { entityType: 'remesa' },
        }),
      );

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { createdCount: number; skippedReasons: { reason: string }[] };
      };

      expect(prisma.remesaHistoryItem.create).not.toHaveBeenCalled();
      expect(summary.committed.skippedReasons[0].reason).toContain('No se encontró el recibo');
    });

    it('línea cuyo recibo no tiene IBAN: se omite (RemesaLine.iban es obligatorio)', async () => {
      prisma.accountingPeriod.findUnique.mockResolvedValue({ id: 'period-1' });
      prisma.accountingReceipt.findUnique.mockResolvedValue({
        id: 'receipt-1', propertyId: 'prop-1', ownerUserId: null, ibanSnapshot: null,
      });
      storage.get.mockResolvedValue(
        Buffer.from('Remesa,Periodo,Recibo,Importe,Estado\nREM-X,2026-08,2026/08-001,120,Cobrado\n', 'utf-8'),
      );
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: { remesaRef: 'Remesa', periodKey: 'Periodo', receiptNo: 'Recibo', amount: 'Importe', status: 'Estado' },
          summary: { entityType: 'remesa' },
        }),
      );

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { skippedReasons: { reason: string }[] };
      };

      expect(prisma.remesaLine.create).not.toHaveBeenCalled();
      expect(summary.committed.skippedReasons[0].reason).toContain('no tiene IBAN registrado');
    });
  });

  describe('commit — opening-balance', () => {
    it('solo rellena el borrador: junta banco, deuda, anticipo y otro con lo que ya había, y guarda una sola vez', async () => {
      openingBalances.get.mockResolvedValue({
        bankBalances: [],
        propertyDebts: [
          {
            propertyId: 'prop-existing',
            originYear: 2023,
            concept: 'Ya estaba',
            amount: 100,
            dueDate: null,
          },
        ],
        propertyAdvances: [],
        supplierInvoices: [],
        otherBalances: [],
      });
      prisma.bankAccount.findMany.mockResolvedValue([
        { id: 'bank-1', alias: 'Cuenta principal' },
      ]);
      prisma.property.findMany.mockResolvedValue([
        { id: 'prop-1', ref: 'A-101' },
      ]);
      storage.get.mockResolvedValue(
        Buffer.from(
          'Tipo,Referencia,Concepto,Importe,Año,Vencimiento,Cuenta,Lado\n' +
            'banco,Cuenta principal,,1000,,,,\n' +
            'deuda,A-101,Cuotas 2024,450,2024,31/12/2024,,\n' +
            'anticipo,A-101,Anticipo obras,80,,,,\n' +
            'otro,,Fondo de reserva,50,,,117,debe\n',
          'utf-8',
        ),
      );
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: {
            tipo: 'Tipo',
            ref: 'Referencia',
            concept: 'Concepto',
            amount: 'Importe',
            originYear: 'Año',
            dueDate: 'Vencimiento',
            role: 'Cuenta',
            side: 'Lado',
          },
          summary: { entityType: 'opening-balance' },
        }),
      );

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { createdCount: number };
      };

      expect(summary.committed.createdCount).toBe(4);
      expect(openingBalances.saveDraft).toHaveBeenCalledTimes(1);
      const [, draft] = openingBalances.saveDraft.mock.calls[0] as [
        string,
        Record<string, unknown[]>,
      ];
      expect(draft.bankBalances).toEqual([
        { bankAccountId: 'bank-1', balance: 1000 },
      ]);
      // Lo que ya había en el borrador se conserva junto a lo nuevo.
      expect(draft.propertyDebts).toEqual([
        {
          propertyId: 'prop-existing',
          originYear: 2023,
          concept: 'Ya estaba',
          amount: 100,
          dueDate: undefined,
        },
        {
          propertyId: 'prop-1',
          originYear: 2024,
          concept: 'Cuotas 2024',
          amount: 450,
          dueDate: '2024-12-31',
        },
      ]);
      expect(draft.propertyAdvances).toEqual([
        { propertyId: 'prop-1', concept: 'Anticipo obras', amount: 80 },
      ]);
      expect(draft.otherBalances).toEqual([
        {
          role: 'reserve_fund',
          concept: 'Fondo de reserva',
          side: 'debit',
          amount: 50,
        },
      ]);
    });

    it('alias de banco inexistente: se omite la fila con su motivo, no llega a guardar esa fila', async () => {
      prisma.bankAccount.findMany.mockResolvedValue([]);
      storage.get.mockResolvedValue(
        Buffer.from('Tipo,Referencia,Importe\nbanco,No Existe,500\n', 'utf-8'),
      );
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: { tipo: 'Tipo', ref: 'Referencia', amount: 'Importe' },
          summary: { entityType: 'opening-balance' },
        }),
      );

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: {
          createdCount: number;
          skippedReasons: { reason: string }[];
        };
      };

      expect(summary.committed.createdCount).toBe(0);
      expect(summary.committed.skippedReasons[0].reason).toContain(
        'No existe ninguna cuenta bancaria',
      );
      expect(openingBalances.saveDraft).toHaveBeenCalledTimes(1);
    });
  });

  describe('commit — supplier-invoice', () => {
    it('vincula por nombre (sin distinguir mayúsculas) a un proveedor existente y lo añade al borrador', async () => {
      openingBalances.get.mockResolvedValue({
        bankBalances: [],
        propertyDebts: [],
        propertyAdvances: [],
        supplierInvoices: [],
        otherBalances: [],
      });
      prisma.supplier.findMany.mockResolvedValue([
        { id: 'supplier-1', name: 'Ascensores García SL' },
      ]);
      storage.get.mockResolvedValue(
        Buffer.from(
          'Proveedor,Factura,Concepto,Fecha,Importe\nascensores garcía sl,F-91,Mantenimiento,15/11/2024,245.5\n',
          'utf-8',
        ),
      );
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: {
            supplierName: 'Proveedor',
            number: 'Factura',
            concept: 'Concepto',
            issueDate: 'Fecha',
            amount: 'Importe',
          },
          summary: { entityType: 'supplier-invoice' },
        }),
      );

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: { createdCount: number };
      };

      expect(summary.committed.createdCount).toBe(1);
      const [, draft] = openingBalances.saveDraft.mock.calls[0] as [
        string,
        { supplierInvoices: unknown[] },
      ];
      expect(draft.supplierInvoices).toEqual([
        {
          supplierId: 'supplier-1',
          number: 'F-91',
          concept: 'Mantenimiento',
          issueDate: '2024-11-15',
          dueDate: undefined,
          amount: 245.5,
          payableRole: 'suppliers_payable',
        },
      ]);
    });

    it('proveedor inexistente: se omite la fila con su motivo', async () => {
      prisma.supplier.findMany.mockResolvedValue([]);
      storage.get.mockResolvedValue(
        Buffer.from(
          'Proveedor,Factura,Concepto,Fecha,Importe\nNo Existe SL,F-1,x,15/11/2024,100\n',
          'utf-8',
        ),
      );
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'ready',
          mapping: {
            supplierName: 'Proveedor',
            number: 'Factura',
            concept: 'Concepto',
            issueDate: 'Fecha',
            amount: 'Importe',
          },
          summary: { entityType: 'supplier-invoice' },
        }),
      );

      const summary = (await service.commit(ESTATE, 'batch-1', user('B'))) as {
        committed: {
          createdCount: number;
          skippedReasons: { reason: string }[];
        };
      };

      expect(summary.committed.createdCount).toBe(0);
      expect(summary.committed.skippedReasons[0].reason).toContain(
        'No existe ningún proveedor',
      );
    });
  });

  describe('rollback', () => {
    function trackedRecords() {
      return [
        { id: 'r1', importBatchId: 'batch-1', entityType: 'Property', entityId: 'prop-1' },
        { id: 'r2', importBatchId: 'batch-1', entityType: 'ExternalOwner', entityId: 'owner-1' },
      ];
    }

    it('bloquea deshacer un batch de saldos iniciales: esas filas no dejan ImportedRecord que revertir', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(
        makeBatch({
          status: 'completed',
          summary: { entityType: 'opening-balance' },
        }),
      );

      await expect(
        service.rollback(ESTATE, 'batch-1', user('B')),
      ).rejects.toThrow('editalas o borralas directamente desde el asistente');
    });

    it('borra lo trackeado por ImportedRecord y pasa a "rolled_back"', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch({ status: 'completed' }));
      prisma.importedRecord.findMany.mockResolvedValue(trackedRecords());
      prisma.externalOwner.findMany.mockResolvedValue([]); // sin propietarios ajenos al batch

      const result = await service.rollback(ESTATE, 'batch-1', user('B'));

      expect(prisma.externalOwner.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['owner-1'] } } });
      expect(prisma.property.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['prop-1'] } } });
      expect(prisma.importedRecord.deleteMany).toHaveBeenCalledWith({
        where: { importBatchId: 'batch-1', entityType: { notIn: ['ChartAccount', 'AccountingPeriod'] } },
      });
      const [{ data }] = prisma.importBatch.update.mock.calls.at(-1)!;
      expect(data.status).toBe('rolled_back');
      expect(result).toEqual({
        removedProperties: 1,
        removedOwners: 1,
        reversedEntries: 0,
        removedReceipts: 0,
        removedRemesas: 0,
        removedRemesaLines: 0,
      });
    });

    it('borra antes las invitaciones sin canjear de esos titulares (la FK es Restrict)', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch({ status: 'completed' }));
      prisma.importedRecord.findMany.mockResolvedValue(trackedRecords());

      await service.rollback(ESTATE, 'batch-1', user('B'));

      expect(prisma.propertyMembershipInvite.deleteMany).toHaveBeenCalledWith({
        where: { externalOwnerId: { in: ['owner-1'] }, usedAt: null },
      });
      const inviteOrder = prisma.propertyMembershipInvite.deleteMany.mock.invocationCallOrder[0];
      const ownerOrder = prisma.externalOwner.deleteMany.mock.invocationCallOrder[0];
      expect(inviteOrder).toBeLessThan(ownerOrder);
    });

    it('bloquea el deshacer si algún titular importado ya aceptó su invitación y tiene cuenta', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch({ status: 'completed' }));
      prisma.importedRecord.findMany.mockResolvedValue(trackedRecords());
      prisma.externalOwner.count.mockResolvedValue(1);

      await expect(service.rollback(ESTATE, 'batch-1', user('B'))).rejects.toThrow('ya aceptó su invitación');
      expect(prisma.externalOwner.deleteMany).not.toHaveBeenCalled();
      expect(prisma.property.deleteMany).not.toHaveBeenCalled();
    });

    it('batch no "completed": BadRequestException, sin tocar nada', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch({ status: 'ready' }));
      await expect(service.rollback(ESTATE, 'batch-1', user('B'))).rejects.toThrow(BadRequestException);
      expect(prisma.property.deleteMany).not.toHaveBeenCalled();
    });

    it('bloquea el deshacer si una propiedad importada tiene un propietario añadido después (no trackeado)', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch({ status: 'completed' }));
      prisma.importedRecord.findMany.mockResolvedValue(trackedRecords());
      prisma.externalOwner.findMany.mockResolvedValue([{ id: 'owner-manual-2' }]); // añadido a mano después

      await expect(service.rollback(ESTATE, 'batch-1', user('B'))).rejects.toThrow(BadRequestException);
      expect(prisma.property.deleteMany).not.toHaveBeenCalled();
      expect(prisma.externalOwner.deleteMany).not.toHaveBeenCalled();
    });

    it('si el borrado falla por datos dependientes (FK), lo traduce a un BadRequestException claro', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch({ status: 'completed' }));
      prisma.importedRecord.findMany.mockResolvedValue(trackedRecords());
      prisma.externalOwner.findMany.mockResolvedValue([]);
      prisma.$transaction.mockRejectedValue(new Error('P2003: foreign key violation'));

      await expect(service.rollback(ESTATE, 'batch-1', user('B'))).rejects.toThrow(BadRequestException);
    });

    it('los asientos importados no se borran: se revierten en su fecha, saltando los ya revertidos', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch({ status: 'completed' }));
      prisma.importedRecord.findMany.mockResolvedValue([
        { id: 'r1', importBatchId: 'batch-1', entityType: 'JournalEntry', entityId: 'entry-a' },
        { id: 'r2', importBatchId: 'batch-1', entityType: 'JournalEntry', entityId: 'entry-b' },
      ]);
      prisma.journalEntry.findUnique
        .mockResolvedValueOnce({ date: new Date('2026-08-01T00:00:00Z'), reversedBy: null })
        .mockResolvedValueOnce({ date: new Date('2026-08-02T00:00:00Z'), reversedBy: { id: 'manual' } });

      const result = await service.rollback(ESTATE, 'batch-1', user('B'));

      expect(journal.reverse).toHaveBeenCalledTimes(1);
      expect(journal.reverse).toHaveBeenCalledWith(prisma, 'entry-a', {
        date: new Date('2026-08-01T00:00:00Z'),
        concept: 'Importación deshecha',
        createdByUserId: expect.any(String),
      });
      expect(result.reversedEntries).toBe(1);
    });

    it('ChartAccount/AccountingPeriod: borrado best-effort FUERA de la transacción principal — si sigue en uso, se deja sin romper el resto', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch({ status: 'completed' }));
      prisma.importedRecord.findMany.mockResolvedValue([
        { id: 'r1', importBatchId: 'batch-1', entityType: 'JournalEntry', entityId: 'entry-a' },
        { id: 'r2', importBatchId: 'batch-1', entityType: 'ChartAccount', entityId: 'acc-1' },
      ]);
      prisma.chartAccount.delete.mockRejectedValue(new Error('P2003: still referenced'));

      const result = await service.rollback(ESTATE, 'batch-1', user('B'));

      // La cuenta contable no pudo borrarse, pero el resto del rollback sí se completó.
      expect(prisma.chartAccount.delete).toHaveBeenCalledWith({ where: { id: 'acc-1' } });
      expect(result.reversedEntries).toBe(1);
      const [{ data }] = prisma.importBatch.update.mock.calls.at(-1)!;
      expect(data.status).toBe('rolled_back');
    });
  });

  describe('listBatches / getBatch', () => {
    it('listBatches respeta el scoping de finca', async () => {
      await expect(service.listBatches('otra-finca', user('B', [ESTATE]))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('getBatch delega en el mismo chequeo de acceso que parse/validate', async () => {
      prisma.importBatch.findFirst.mockResolvedValue(makeBatch());
      await expect(service.getBatch(ESTATE, 'batch-1', user('B'))).resolves.toEqual(makeBatch());
    });
  });
});
