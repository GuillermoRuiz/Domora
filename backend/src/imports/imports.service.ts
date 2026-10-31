import { natureForCode } from '../ledger/chart/chart-template';
import { ReceiptPostingService } from '../ledger/posting/receipt-posting.service';
import { CollectionPostingService } from '../ledger/posting/collection-posting.service';
import { receiptAccrualDate } from '../ledger/posting/rules/receipt.rules';
import { runPosting } from '../ledger/journal/journal-db-errors';
import { JournalService } from '../ledger/journal/journal.service';
import { accountingDay } from '../ledger/posting/draft-validation';
import { toCents } from '../ledger/money';
import { OpeningBalancesService } from '../ledger/opening/opening-balances.service';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ImportBatch,
  ImportSourcePlatform,
  Prisma,
  ReceiptKind,
  RemesaStatus,
} from '../prisma/client';
import { Prisma as PrismaNS } from '../prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { StorageService } from '../files/storage.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateImportBatchDto } from './dto/create-import-batch.dto';
import type { ValidateImportDto } from './dto/validate-import.dto';
import { parseSpreadsheet } from './parsers/spreadsheet-parser.util';
import {
  presetsFor,
  suggestMapping,
  type ColumnPreset,
  type ImportEntityType,
} from './presets/gesfincas-net.presets';
import {
  validatePropertyRow,
  type PropertyImportRow,
} from './validators/property-import.validator';
import {
  validateOwnerRow,
  type OwnerImportRow,
} from './validators/owner-import.validator';
import {
  validateMovementRow,
  type MovementImportRow,
} from './validators/movement-import.validator';
import {
  validateReceiptRow,
  type ReceiptImportRow,
} from './validators/receipt-import.validator';
import {
  validateRemesaRow,
  type RemesaLineImportRow,
} from './validators/remesa-import.validator';
import {
  validateOpeningBalanceRow,
  type OpeningBalanceImportRow,
} from './validators/opening-balance-import.validator';
import {
  validateSupplierInvoiceRow,
  type SupplierInvoiceImportRow,
} from './validators/supplier-invoice-import.validator';
import type { ValidatedRow } from './validators/parsing.util';

/** Filas por transacción durante el commit — evita timeouts/bloqueos largos en imports grandes. */
const COMMIT_CHUNK_SIZE = 500;

/** Mismo catálogo que `accounting.service.ts` (no exportado desde ahí) — se duplica acá, es un array literal estable de 12 posiciones. */
const MONTH_LABELS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

interface CommitResult {
  createdCount: number;
  skippedCount: number;
  skippedReasons: { rowNumber: number; reason: string }[];
}

export interface RollbackResult {
  removedProperties: number;
  removedOwners: number;
  /** Asientos importados que se han revertido con un contraasiento. */
  reversedEntries: number;
  removedReceipts: number;
  removedRemesas: number;
  removedRemesaLines: number;
}

/** Fichero multipart tal y como lo entrega multer (sin @types/multer) — mismo patrón que `files.controller.ts`. */
export interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Límite propio de este módulo, mayor que el compartido de `StorageService`
 * (10MB) — un export histórico completo de una gestora grande plausiblemente
 * lo supera. No se toca el límite compartido: lo usan otros 6
 * controllers/services que no necesitan ficheros tan grandes.
 */
export const IMPORTS_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

const VALIDATORS: Record<
  ImportEntityType,
  (
    mappedRow: Record<string, string>,
    rowNumber: number,
  ) => ValidatedRow<unknown>
> = {
  property: validatePropertyRow,
  owner: validateOwnerRow,
  movement: validateMovementRow,
  receipt: validateReceiptRow,
  remesa: validateRemesaRow,
  'opening-balance': validateOpeningBalanceRow,
  'supplier-invoice': validateSupplierInvoiceRow,
};

function mapRow(
  row: Record<string, string>,
  mapping: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [targetField, sourceColumn] of Object.entries(mapping)) {
    out[targetField] = row[sourceColumn] ?? '';
  }
  return out;
}

/** Tipo de recibo a partir del texto del programa de origen ("Cuota", "Derrama"…). */
export function receiptKindFromText(
  text: string | null | undefined,
): ReceiptKind {
  const t = (text ?? '').toLowerCase();
  if (t.includes('derrama')) return 'derrama';
  if (t.includes('reserva')) return 'fondo_reserva';
  if (t.includes('inter')) return 'intereses_demora';
  if (t.includes('devoluc') || t.includes('gasto')) return 'gastos_devolucion';
  if (t === '' || t.includes('cuota') || t.includes('ordinari'))
    return 'cuota_ordinaria';
  return 'otros';
}

@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly storage: StorageService,
    private readonly receiptPosting: ReceiptPostingService,
    private readonly collections: CollectionPostingService,
    private readonly journal: JournalService,
    private readonly openingBalances: OpeningBalancesService,
  ) {}

  private async assertBatchAccess(
    estateId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<ImportBatch> {
    this.estateAccess.assertAccess(estateId, user);
    const batch = await this.prisma.importBatch.findFirst({
      where: { id, estateId },
    });
    if (!batch) {
      throw new NotFoundException(`Importación ${id} no encontrada.`);
    }
    return batch;
  }

  async listBatches(
    estateId: string,
    user: AuthenticatedUser,
  ): Promise<ImportBatch[]> {
    this.estateAccess.assertAccess(estateId, user);
    return this.prisma.importBatch.findMany({
      where: { estateId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getBatch(
    estateId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<ImportBatch> {
    return this.assertBatchAccess(estateId, id, user);
  }

  getPresets(
    platform: ImportSourcePlatform,
    entityType: ImportEntityType,
    headers?: string[],
  ): { fields: ColumnPreset[]; suggestedMapping: Record<string, string> } {
    const fields = presetsFor(platform, entityType);
    return {
      fields,
      suggestedMapping: headers ? suggestMapping(headers, fields) : {},
    };
  }

  /** Crea el batch Y sube el fichero — todavía sin escrituras de dominio (esas llegan recién en `commit()`). */
  async createBatch(
    estateId: string,
    dto: CreateImportBatchDto,
    file: UploadedMulterFile,
    user: AuthenticatedUser,
  ): Promise<ImportBatch> {
    this.estateAccess.assertAccess(estateId, user);
    if (!file) {
      throw new BadRequestException(
        'No se recibió ningún fichero (campo "file").',
      );
    }
    if (!user.administratorId) {
      throw new ForbiddenException(
        'El usuario no pertenece a ninguna gestora.',
      );
    }
    this.storage.assertAllowed(
      file.mimetype,
      file.size,
      IMPORTS_MAX_FILE_BYTES,
    );

    const rawFileKey = await this.storage.put(
      `imports/${estateId}`,
      file.originalname,
      file.buffer,
    );

    return this.prisma.importBatch.create({
      data: {
        estateId,
        administratorId: user.administratorId,
        sourcePlatform: dto.sourcePlatform,
        scope: dto.scope,
        status: 'uploading',
        rawFileKey,
        createdByUserId: user.id,
      },
    });
  }

  /** Solo lectura del fichero ya subido — cabeceras + muestra. Sin escrituras de dominio. */
  async parse(
    estateId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<{
    headers: string[];
    sampleRows: Record<string, string>[];
    totalRows: number;
  }> {
    const batch = await this.assertBatchAccess(estateId, id, user);
    if (!batch.rawFileKey) {
      throw new BadRequestException(
        'Esta importación no tiene fichero asociado.',
      );
    }
    const buffer = await this.storage.get(batch.rawFileKey);
    const { headers, rows } = await parseSpreadsheet(buffer, batch.rawFileKey);

    await this.prisma.importBatch.update({
      where: { id },
      data: { status: 'validating' },
    });

    return { headers, sampleRows: rows.slice(0, 10), totalRows: rows.length };
  }

  /** Relee el fichero original y corre el validador del tipo de entidad — usado por `validate()` Y `commit()` (que revalida por seguridad antes de escribir). */
  private async parseAndValidate(
    batch: ImportBatch,
    entityType: ImportEntityType,
    mapping: Record<string, string>,
  ): Promise<ValidatedRow<unknown>[]> {
    if (!batch.rawFileKey) {
      throw new BadRequestException(
        'Esta importación no tiene fichero asociado.',
      );
    }
    const buffer = await this.storage.get(batch.rawFileKey);
    const { rows } = await parseSpreadsheet(buffer, batch.rawFileKey);
    const validator = VALIDATORS[entityType];
    return rows.map((row, i) => validator(mapRow(row, mapping), i + 2)); // fila 1 = cabeceras
  }

  /** Aplica el mapeo confirmado y valida TODAS las filas. Sin escrituras de dominio — solo persiste el resumen. */
  async validate(
    estateId: string,
    id: string,
    dto: ValidateImportDto,
    user: AuthenticatedUser,
  ): Promise<{ summary: Record<string, unknown> }> {
    const batch = await this.assertBatchAccess(estateId, id, user);
    const validated = await this.parseAndValidate(
      batch,
      dto.entityType,
      dto.mapping,
    );

    const errorRows = validated.filter((r) => !r.ok);
    const warningRows = validated.filter((r) => r.ok && r.warnings.length > 0);

    const summary = {
      entityType: dto.entityType,
      totalRows: validated.length,
      okRows: validated.length - errorRows.length,
      errorCount: errorRows.length,
      warningCount: warningRows.length,
      // Acotado: un fichero con miles de errores no debe inflar el resumen sin límite.
      errors: errorRows
        .slice(0, 200)
        .map((r) => ({ rowNumber: r.rowNumber, errors: r.errors })),
      warnings: warningRows
        .slice(0, 200)
        .map((r) => ({ rowNumber: r.rowNumber, warnings: r.warnings })),
    };

    await this.prisma.importBatch.update({
      where: { id },
      data: { status: 'ready', mapping: dto.mapping, summary },
    });

    return { summary };
  }

  /**
   * Escribe de verdad las filas OK del último mapeo validado. Revalida por
   * seguridad en vez de confiar ciegamente en el `summary` ya persistido
   * (pudo haber cambiado el fichero de origen entre `validate` y `commit`,
   * aunque sea el mismo `rawFileKey` — defensa en profundidad).
   *
   * Sub-fase B (histórico contable): NO se importan mandatos SEPA — decisión
   * de proyecto, `Mandate.titularUserId` es obligatorio (no hay `User` para
   * los propietarios importados en Fase 2, que quedan como `ExternalOwner`)
   * y además fabricar un mandato firmado desde un Excel es legalmente
   * dudoso. Los recibos domiciliados se importan igual, con el IBAN como
   * snapshot puro — sin `mandateId`.
   */
  async commit(
    estateId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<Record<string, unknown>> {
    const batch = await this.assertBatchAccess(estateId, id, user);
    if (batch.status !== 'ready') {
      throw new BadRequestException(
        'Esta importación no está lista para confirmarse — hay que validar el mapeo primero.',
      );
    }
    const mapping = batch.mapping as Record<string, string> | null;
    const priorSummary = batch.summary as {
      entityType?: ImportEntityType;
    } | null;
    const entityType = priorSummary?.entityType;
    if (!mapping || !entityType) {
      throw new BadRequestException(
        'Esta importación no tiene un mapeo validado.',
      );
    }

    const validated = await this.parseAndValidate(batch, entityType, mapping);
    const okRows = validated.filter((r) => r.ok);

    let committed: CommitResult;
    try {
      switch (entityType) {
        case 'property':
          committed = await this.commitProperties(
            estateId,
            id,
            okRows as ValidatedRow<PropertyImportRow>[],
          );
          break;
        case 'owner':
          committed = await this.commitOwners(
            estateId,
            id,
            okRows as ValidatedRow<OwnerImportRow>[],
            user,
          );
          break;
        case 'movement':
          committed = await this.commitMovements(
            estateId,
            id,
            okRows as ValidatedRow<MovementImportRow>[],
            user,
          );
          break;
        case 'receipt':
          committed = await this.commitReceipts(
            estateId,
            id,
            okRows as ValidatedRow<ReceiptImportRow>[],
          );
          break;
        case 'remesa':
          committed = await this.commitRemesas(
            estateId,
            id,
            okRows as ValidatedRow<RemesaLineImportRow>[],
            user,
          );
          break;
        case 'opening-balance':
          committed = await this.commitOpeningBalance(
            estateId,
            okRows as ValidatedRow<OpeningBalanceImportRow>[],
            user,
          );
          break;
        case 'supplier-invoice':
          committed = await this.commitSupplierInvoiceOpening(
            estateId,
            okRows as ValidatedRow<SupplierInvoiceImportRow>[],
            user,
          );
          break;
      }
    } catch (error) {
      await this.prisma.importBatch.update({
        where: { id },
        data: { status: 'failed' },
      });
      throw error;
    }

    const summary = { ...priorSummary, committed };
    await this.prisma.importBatch.update({
      where: { id },
      data: {
        status: 'completed',
        completedAt: new Date(),
        summary: summary as unknown as Prisma.InputJsonValue,
      },
    });

    return summary;
  }

  private async commitProperties(
    estateId: string,
    batchId: string,
    rows: ValidatedRow<PropertyImportRow>[],
  ): Promise<CommitResult> {
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId },
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${estateId} no encontrada.`);
    }
    const existing = await this.prisma.property.findMany({
      where: { estateId },
      select: { ref: true },
    });
    const usedRefs = new Set(
      existing.map((p) => p.ref).filter((r): r is string => !!r),
    );

    let createdCount = 0;
    const skippedReasons: { rowNumber: number; reason: string }[] = [];

    for (let i = 0; i < rows.length; i += COMMIT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + COMMIT_CHUNK_SIZE);
      await this.prisma.$transaction(async (tx) => {
        for (const row of chunk) {
          const data = row.data!;
          let ref = data.ref;
          if (ref && usedRefs.has(ref)) {
            skippedReasons.push({
              rowNumber: row.rowNumber,
              reason: `Ya existe una propiedad con la referencia "${ref}" en esta finca.`,
            });
            continue;
          }
          if (!ref) {
            ref = this.generatePropertyRef(usedRefs);
          }
          usedRefs.add(ref);

          const created = await tx.property.create({
            data: {
              estateId,
              administratorId: estate.administratorId,
              type: data.type,
              status: 'Vacio',
              ref,
              participationQuota: data.participationQuota ?? null,
              floor: data.floor,
              door: data.door,
              quotaMonthly: data.quotaMonthly ?? 0,
            },
          });
          await tx.importedRecord.create({
            data: {
              importBatchId: batchId,
              entityType: 'Property',
              entityId: created.id,
            },
          });
          createdCount++;
        }
      });
    }

    return {
      createdCount,
      skippedCount: skippedReasons.length,
      skippedReasons,
    };
  }

  /** `YYYY-MM-DD` — mismo formato que exige `SaveOpeningDraftDto` (`@IsISO8601`). */
  private isoDate(d: Date | null | undefined): string | undefined {
    return d ? d.toISOString().slice(0, 10) : undefined;
  }

  /**
   * El borrador de saldos iniciales (fase 9) se reemplaza entero en cada
   * `saveDraft` — no hay un "añadir fila". Por eso ambos commits de este
   * módulo leen el borrador actual, lo convierten de vuelta al formato del
   * DTO y le suman las filas nuevas antes de guardar una única vez.
   */
  private async currentOpeningDraft(estateId: string, user: AuthenticatedUser) {
    const current = await this.openingBalances.get(estateId, user);
    return {
      bankBalances: current.bankBalances.map((b) => ({
        bankAccountId: b.bankAccountId,
        balance: b.balance,
      })),
      propertyDebts: current.propertyDebts.map((d) => ({
        propertyId: d.propertyId,
        originYear: d.originYear,
        concept: d.concept,
        amount: d.amount,
        dueDate: this.isoDate(d.dueDate),
      })),
      propertyAdvances: current.propertyAdvances.map((a) => ({
        propertyId: a.propertyId,
        concept: a.concept,
        amount: a.amount,
      })),
      supplierInvoices: current.supplierInvoices.map((i) => ({
        supplierId: i.supplierId,
        number: i.number,
        concept: i.concept,
        issueDate: this.isoDate(i.issueDate)!,
        dueDate: this.isoDate(i.dueDate),
        amount: i.amount,
        payableRole: i.payableRole as 'suppliers_payable' | 'creditors_payable',
      })),
      otherBalances: current.otherBalances.map((o) => ({
        role: o.role,
        concept: o.concept,
        side: o.side,
        amount: o.amount,
      })),
    };
  }

  /**
   * Saldos iniciales (fase 9) — bancos, deudas, anticipos y otros saldos.
   * "Solo rellena el borrador": no contabiliza nada, la gestora revisa y
   * contabiliza después desde el asistente. Por eso no queda `ImportedRecord`
   * de estas filas — no tienen identidad propia frente al resto del
   * borrador, y deshacer el lote no tendría qué revertir (ver `rollback`).
   */
  private async commitOpeningBalance(
    estateId: string,
    rows: ValidatedRow<OpeningBalanceImportRow>[],
    user: AuthenticatedUser,
  ): Promise<CommitResult> {
    const skippedReasons: { rowNumber: number; reason: string }[] = [];
    const draft = await this.currentOpeningDraft(estateId, user);
    const [banks, properties] = await Promise.all([
      this.prisma.bankAccount.findMany({
        where: { estateId, closedAt: null },
        select: { id: true, alias: true },
      }),
      this.prisma.property.findMany({
        where: { estateId, deletedAt: null },
        select: { id: true, ref: true },
      }),
    ]);

    let createdCount = 0;
    for (const row of rows) {
      const data = row.data!;
      if (data.tipo === 'banco') {
        const bank = banks.find((b) => b.alias === data.ref);
        if (!bank) {
          skippedReasons.push({
            rowNumber: row.rowNumber,
            reason: `No existe ninguna cuenta bancaria con el alias "${data.ref}" en esta finca.`,
          });
          continue;
        }
        draft.bankBalances.push({
          bankAccountId: bank.id,
          balance: data.amount,
        });
      } else if (data.tipo === 'deuda' || data.tipo === 'anticipo') {
        const property = properties.find((p) => p.ref === data.ref);
        if (!property) {
          skippedReasons.push({
            rowNumber: row.rowNumber,
            reason: `No existe ninguna propiedad con la referencia "${data.ref}" en esta finca.`,
          });
          continue;
        }
        if (data.tipo === 'deuda') {
          draft.propertyDebts.push({
            propertyId: property.id,
            originYear: data.originYear!,
            concept: data.concept!,
            amount: data.amount,
            dueDate: this.isoDate(data.dueDate),
          });
        } else {
          draft.propertyAdvances.push({
            propertyId: property.id,
            concept: data.concept!,
            amount: data.amount,
          });
        }
      } else {
        draft.otherBalances.push({
          role: data.role!,
          concept: data.concept!,
          side: data.side!,
          amount: data.amount,
        });
      }
      createdCount++;
    }

    await this.openingBalances.saveDraft(estateId, draft, user);
    return {
      createdCount,
      skippedCount: skippedReasons.length,
      skippedReasons,
    };
  }

  /**
   * Facturas de proveedor pendientes al arrancar la contabilidad (fase 9) —
   * igual que `commitOpeningBalance`, solo rellena el borrador. El proveedor
   * tiene que existir ya (alta manual en `proveedores-tab`): no se
   * fabrica uno nuevo a partir del nombre de una fila.
   */
  private async commitSupplierInvoiceOpening(
    estateId: string,
    rows: ValidatedRow<SupplierInvoiceImportRow>[],
    user: AuthenticatedUser,
  ): Promise<CommitResult> {
    const skippedReasons: { rowNumber: number; reason: string }[] = [];
    const draft = await this.currentOpeningDraft(estateId, user);
    const suppliers = await this.prisma.supplier.findMany({
      where: { estateId },
      select: { id: true, name: true },
    });

    let createdCount = 0;
    for (const row of rows) {
      const data = row.data!;
      const supplierName = data.supplierName.trim().toLowerCase();
      const supplier = suppliers.find(
        (s) => s.name.trim().toLowerCase() === supplierName,
      );
      if (!supplier) {
        skippedReasons.push({
          rowNumber: row.rowNumber,
          reason: `No existe ningún proveedor llamado "${data.supplierName}" en esta finca — dalo de alta primero.`,
        });
        continue;
      }
      draft.supplierInvoices.push({
        supplierId: supplier.id,
        number: data.number,
        concept: data.concept,
        issueDate: this.isoDate(data.issueDate)!,
        dueDate: this.isoDate(data.dueDate),
        amount: data.amount,
        payableRole: 'suppliers_payable',
      });
      createdCount++;
    }

    await this.openingBalances.saveDraft(estateId, draft, user);
    return {
      createdCount,
      skippedCount: skippedReasons.length,
      skippedReasons,
    };
  }

  /** `AUTO-1`, `AUTO-2`, ... — determinista, evita colisión con lo ya usado en la finca o en este mismo lote. */
  private generatePropertyRef(usedRefs: Set<string>): string {
    let n = usedRefs.size + 1;
    let candidate = `AUTO-${n}`;
    while (usedRefs.has(candidate)) {
      n++;
      candidate = `AUTO-${n}`;
    }
    return candidate;
  }

  private async commitOwners(
    estateId: string,
    batchId: string,
    rows: ValidatedRow<OwnerImportRow>[],
    user: AuthenticatedUser,
  ): Promise<CommitResult> {
    let createdCount = 0;
    const skippedReasons: { rowNumber: number; reason: string }[] = [];

    for (let i = 0; i < rows.length; i += COMMIT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + COMMIT_CHUNK_SIZE);
      await this.prisma.$transaction(async (tx) => {
        for (const row of chunk) {
          const data = row.data!;
          const property = await tx.property.findFirst({
            where: { estateId, ref: data.propertyRef },
            select: { id: true },
          });
          if (!property) {
            skippedReasons.push({
              rowNumber: row.rowNumber,
              reason: `No existe ninguna propiedad con la referencia "${data.propertyRef}" en esta finca — importa primero las propiedades.`,
            });
            continue;
          }
          const created = await tx.externalOwner.create({
            data: {
              propertyId: property.id,
              fullName: data.fullName,
              taxId: data.taxId,
              email: data.email,
              phone: data.phone,
              postalAddress: data.postalAddress,
              createdByUserId: user.id,
            },
          });
          await tx.importedRecord.create({
            data: {
              importBatchId: batchId,
              entityType: 'ExternalOwner',
              entityId: created.id,
            },
          });
          createdCount++;
        }
      });
    }

    return {
      createdCount,
      skippedCount: skippedReasons.length,
      skippedReasons,
    };
  }

  /**
   * Movimientos de banco históricos (fase 8): cada fila es un asiento de
   * importación de dos líneas contra la cuenta bancaria principal. Un
   * ingreso carga el banco y abona la cuenta de la fila; un gasto o traspaso
   * carga la cuenta y abona el banco. Una fila que la contabilidad no admite
   * (anterior al inicio contable, cuenta de propietarios o proveedores…) se
   * salta con su motivo sin bloquear las demás.
   */
  private async commitMovements(
    estateId: string,
    batchId: string,
    rows: ValidatedRow<MovementImportRow>[],
    user: AuthenticatedUser,
  ): Promise<CommitResult> {
    const estate = await this.prisma.estate.findFirst({
      where: { id: estateId },
    });
    if (!estate) {
      throw new NotFoundException(`Finca ${estateId} no encontrada.`);
    }
    const sorted = [...rows].sort(
      (a, b) => a.data!.date.getTime() - b.data!.date.getTime(),
    );
    let createdCount = 0;
    const skippedReasons: { rowNumber: number; reason: string }[] = [];

    for (const row of sorted) {
      const data = row.data!;
      try {
        await runPosting(this.prisma, async (tx) => {
          let account = await tx.chartAccount.findFirst({
            where: { estateId, code: data.accountCode },
          });
          if (!account) {
            account = await tx.chartAccount.create({
              data: {
                estateId,
                administratorId: estate.administratorId,
                code: data.accountCode,
                name: data.accountName ?? data.accountCode,
                nature: natureForCode(data.accountCode),
                allowsCostCentre: /^[67]/.test(data.accountCode),
              },
            });
            await tx.importedRecord.create({
              data: {
                importBatchId: batchId,
                entityType: 'ChartAccount',
                entityId: account.id,
              },
            });
          }
          if (
            account.requiresProperty ||
            account.requiresSupplier ||
            account.systemRole === 'suspense'
          ) {
            throw new BadRequestException(
              `La cuenta ${account.code} solo se mueve con sus documentos (recibos, cobros, facturas o pagos).`,
            );
          }
          const bank = await tx.bankAccount.findFirst({
            where: { estateId, isDefault: true, closedAt: null },
            select: { id: true, chartAccountId: true },
          });
          if (bank?.chartAccountId === account.id) {
            throw new BadRequestException(
              'La cuenta de la fila es el propio banco de los movimientos.',
            );
          }
          const cents = Math.round(Math.abs(data.amount) * 100);
          if (cents === 0) throw new BadRequestException('El importe es cero.');
          const moneyIn = data.type === 'income';
          const entry = await this.journal.post(tx, {
            estateId,
            date: accountingDay(data.date),
            sourceType: 'import',
            concept: data.concept,
            reference: data.reference?.slice(0, 100),
            importBatchId: batchId,
            createdByUserId: user.id,
            lines: moneyIn
              ? [
                  {
                    account: bank
                      ? { bankAccountId: bank.id }
                      : { role: 'bank' },
                    debit: cents,
                  },
                  { account: { accountId: account.id }, credit: cents },
                ]
              : [
                  { account: { accountId: account.id }, debit: cents },
                  {
                    account: bank
                      ? { bankAccountId: bank.id }
                      : { role: 'bank' },
                    credit: cents,
                  },
                ],
          });
          await tx.importedRecord.create({
            data: {
              importBatchId: batchId,
              entityType: 'JournalEntry',
              entityId: entry.id,
            },
          });
        });
        createdCount++;
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        skippedReasons.push({
          rowNumber: row.rowNumber,
          reason: error.message,
        });
      }
    }

    return {
      createdCount,
      skippedCount: skippedReasons.length,
      skippedReasons,
    };
  }

  private async findOrCreatePeriod(
    tx: Prisma.TransactionClient,
    estateId: string,
    periodKey: string,
    batchId: string,
  ) {
    let period = await tx.accountingPeriod.findUnique({
      where: { estateId_periodKey: { estateId, periodKey } },
    });
    if (!period) {
      const [yearStr, monthStr] = periodKey.split('-');
      const monthIndex = Number(monthStr) - 1;
      period = await tx.accountingPeriod.create({
        data: {
          estateId,
          periodKey,
          label: `${MONTH_LABELS[monthIndex]} ${yearStr}`,
          monthAbbrev: MONTH_LABELS[monthIndex].slice(0, 3).toUpperCase(),
        },
      });
      await tx.importedRecord.create({
        data: {
          importBatchId: batchId,
          entityType: 'AccountingPeriod',
          entityId: period.id,
        },
      });
    }
    return period;
  }

  /**
   * Recibos históricos. Los snapshots (nombre/NIF/IBAN del titular) salen
   * SIEMPRE de la propia fila del origen, nunca de un lookup al propietario
   * actual — es el requisito de inmutabilidad legal del modelo
   * (`AccountingReceipt`, ver schema.prisma). `mandateId` queda siempre
   * `null` (no se importan mandatos, ver el comentario en `commit()`).
   */
  private async commitReceipts(
    estateId: string,
    batchId: string,
    rows: ValidatedRow<ReceiptImportRow>[],
  ): Promise<CommitResult> {
    let createdCount = 0;
    const skippedReasons: { rowNumber: number; reason: string }[] = [];

    const settings = await this.prisma.accountingSettings.findUnique({
      where: { estateId },
      select: { cutoverDate: true },
    });
    if (!settings) {
      throw new BadRequestException(
        'La finca no tiene fecha de inicio contable: configúrala en Contabilidad > Configuración antes de importar recibos.',
      );
    }
    const cutoverLabel = settings.cutoverDate.toISOString().slice(0, 10);

    for (let i = 0; i < rows.length; i += COMMIT_CHUNK_SIZE) {
      const chunk = rows.slice(i, i + COMMIT_CHUNK_SIZE);
      await runPosting(
        this.prisma,
        async (tx) => {
          for (const row of chunk) {
            const data = row.data!;

            // Un recibo de antes del inicio contable es deuda previa: entra
            // en los saldos iniciales (con su año), no como ingreso nuevo.
            const [y, m] = data.periodKey.split('-').map(Number);
            if (new Date(Date.UTC(y, m - 1, 1)) < settings.cutoverDate) {
              skippedReasons.push({
                rowNumber: row.rowNumber,
                reason: `El periodo ${data.periodKey} es anterior a la fecha de inicio contable (${cutoverLabel}): si sigue pendiente, cárgalo en los saldos iniciales.`,
              });
              continue;
            }

            const property = await tx.property.findFirst({
              where: { estateId, ref: data.propertyRef },
              select: { id: true },
            });
            if (!property) {
              skippedReasons.push({
                rowNumber: row.rowNumber,
                reason: `No existe ninguna propiedad con la referencia "${data.propertyRef}" en esta finca.`,
              });
              continue;
            }

            const period = await this.findOrCreatePeriod(
              tx,
              estateId,
              data.periodKey,
              batchId,
            );

            const existingReceipt = await tx.accountingReceipt.findUnique({
              where: { periodId_no: { periodId: period.id, no: data.no } },
            });
            if (existingReceipt) {
              skippedReasons.push({
                rowNumber: row.rowNumber,
                reason: `Ya existe el recibo "${data.no}" en el periodo ${data.periodKey}.`,
              });
              continue;
            }

            // Emisión con su asiento; los snapshots salen de la propia fila.
            const created = await this.receiptPosting.issue(tx, {
              estateId,
              periodId: period.id,
              periodKey: data.periodKey,
              propertyId: property.id,
              no: data.no,
              concept: data.concept,
              kind: receiptKindFromText(data.kind),
              amount: toCents(data.amount),
              dueDate: data.dueDate,
              method: data.method,
              manual: true,
              date: data.date,
              issuedAt: null, // Imported document: original emission instant is unknown.
              ownerNameSnapshot: data.ownerName,
              ownerTaxIdSnapshot: data.ownerTaxId,
              ownerTaxIdCountrySnapshot: data.ownerTaxIdCountry,
              ibanSnapshot: data.iban,
            });

            if (data.status === 'Pagada') {
              // Fecha de cobro desconocida en el origen: la de emisión, o la
              // del asiento de emisión si es posterior.
              const accrual = receiptAccrualDate(
                data.periodKey,
                settings.cutoverDate,
              );
              const paidOn =
                data.date && data.date > accrual ? data.date : accrual;
              const method =
                data.method === 'Pendiente' || data.method === 'Devolucion'
                  ? 'Transferencia'
                  : data.method;
              await this.collections.collect(tx, {
                estateId,
                propertyId: property.id,
                date: paidOn,
                amount: toCents(data.amount),
                method,
                receiptIds: [created.id],
              });
            } else if (data.status === 'Devuelto') {
              await this.receiptPosting.markReturned(tx, created.id, {
                returnCode: data.returnCode,
                returnReason: data.returnReason,
              });
            }

            await tx.importedRecord.create({
              data: {
                importBatchId: batchId,
                entityType: 'AccountingReceipt',
                entityId: created.id,
              },
            });
            createdCount++;
          }
        },
        { timeoutMs: 120_000 },
      );
    }

    return {
      createdCount,
      skippedCount: skippedReasons.length,
      skippedReasons,
    };
  }

  /**
   * Remesas ya presentadas — cada fila del origen es una LÍNEA que se
   * vincula a un recibo ya importado (por periodo+número). Las líneas se
   * agrupan por `remesaRef` en una cabecera `RemesaHistoryItem` por grupo.
   * `mandateId` de cada línea queda `null` (sin mandatos importados); el
   * IBAN de la línea se hereda del `ibanSnapshot` del propio recibo — una
   * línea cuyo recibo no tiene IBAN registrado se omite (el campo no es
   * opcional en `RemesaLine`, y no hay de dónde más sacarlo).
   */
  private async commitRemesas(
    estateId: string,
    batchId: string,
    rows: ValidatedRow<RemesaLineImportRow>[],
    user: AuthenticatedUser,
  ): Promise<CommitResult> {
    const skippedReasons: { rowNumber: number; reason: string }[] = [];
    let createdCount = 0; // cuenta LÍNEAS creadas, no cabeceras de remesa

    const groups = new Map<string, ValidatedRow<RemesaLineImportRow>[]>();
    for (const row of rows) {
      const key = row.data!.remesaRef;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    for (const [remesaRef, groupRows] of groups) {
      const resolved: {
        row: ValidatedRow<RemesaLineImportRow>;
        receipt: Prisma.AccountingReceiptGetPayload<Record<string, never>>;
      }[] = [];

      for (const row of groupRows) {
        const data = row.data!;
        const period = await this.prisma.accountingPeriod.findUnique({
          where: {
            estateId_periodKey: { estateId, periodKey: data.periodKey },
          },
        });
        const receipt = period
          ? await this.prisma.accountingReceipt.findUnique({
              where: {
                periodId_no: { periodId: period.id, no: data.receiptNo },
              },
            })
          : null;
        if (!receipt) {
          skippedReasons.push({
            rowNumber: row.rowNumber,
            reason: `No se encontró el recibo "${data.receiptNo}" del periodo ${data.periodKey} — importa primero los recibos.`,
          });
          continue;
        }
        if (!receipt.ibanSnapshot) {
          skippedReasons.push({
            rowNumber: row.rowNumber,
            reason: `El recibo "${data.receiptNo}" no tiene IBAN registrado — no se puede generar una línea de remesa sin IBAN.`,
          });
          continue;
        }
        resolved.push({ row, receipt });
      }

      if (resolved.length === 0) continue; // remesa entera sin líneas resolubles — no se crea cabecera

      const first = resolved[0].row.data!;
      const hasReturns = resolved.some(
        (l) => l.row.data!.status === 'Devuelto',
      );
      const allCollected = resolved.every(
        (l) => l.row.data!.status === 'Cobrado',
      );
      const status: RemesaStatus = hasReturns
        ? 'ConDevoluciones'
        : allCollected
          ? 'Cobrada'
          : first.presentedAt || first.chargeDate
            ? 'Presentada'
            : 'Borrador';
      const totalAmount = resolved.reduce(
        (sum, l) => sum.plus(l.row.data!.amount),
        new PrismaNS.Decimal(0),
      );
      const period = await this.prisma.accountingPeriod.findUnique({
        where: { estateId_periodKey: { estateId, periodKey: first.periodKey } },
      });

      await this.prisma.$transaction(async (tx) => {
        const remesa = await tx.remesaHistoryItem.create({
          data: {
            estateId,
            periodId: period?.id ?? null,
            scheme: first.scheme,
            concept: first.remesaConcept ?? remesaRef,
            status,
            linesCount: resolved.length,
            totalAmount,
            presentedAt: first.presentedAt,
            chargeDate: first.chargeDate,
            createdByUserId: user.id,
          },
        });
        await tx.importedRecord.create({
          data: {
            importBatchId: batchId,
            entityType: 'RemesaHistoryItem',
            entityId: remesa.id,
          },
        });

        for (const { row, receipt } of resolved) {
          const data = row.data!;
          const line = await tx.remesaLine.create({
            data: {
              remesaId: remesa.id,
              receiptId: receipt.id,
              propertyId: receipt.propertyId,
              ownerUserId: receipt.ownerUserId,
              mandateId: null,
              iban: receipt.ibanSnapshot!,
              mandateSeq: data.mandateSeq,
              amount: data.amount,
              status: data.status,
              returnCode: data.returnCode,
              returnReason: data.returnReason,
              ownerNameSnapshot: receipt.ownerNameSnapshot,
              ownerTaxIdSnapshot: receipt.ownerTaxIdSnapshot,
              ownerTaxIdCountrySnapshot: receipt.ownerTaxIdCountrySnapshot,
              ibanSnapshot: receipt.ibanSnapshot,
            },
          });
          await tx.importedRecord.create({
            data: {
              importBatchId: batchId,
              entityType: 'RemesaLine',
              entityId: line.id,
            },
          });
          createdCount++;
        }
      });
    }

    return {
      createdCount,
      skippedCount: skippedReasons.length,
      skippedReasons,
    };
  }

  /**
   * Deshace un batch ya confirmado — borra SOLO lo que este batch creó (vía
   * `ImportedRecord`), en orden inverso de dependencias. Bloquea el
   * deshacer ENTERO (sin borrado parcial) si detecta que algo no importado
   * ya depende de las filas importadas:
   *  - Propiedades con un propietario añadido después, no trackeado (por el
   *    `onDelete: Cascade` de `ExternalOwner.property` — borrar la
   *    propiedad se llevaría también propietarios legítimos).
   *  - Movimientos: si la finca tiene AL MENOS UN movimiento fuera de este
   *    batch (nuevo o de otro import), deshacer requeriría recalcular la
   *    cadena de saldo de los que quedan — no soportado, se bloquea entero.
   *  - El resto (recibos/remesas) se apoya en las FK reales: si algo las
   *    referencia, Postgres rechaza el borrado y se traduce a un mensaje
   *    claro en vez de una excepción cruda.
   *
   * `ChartAccount`/`AccountingPeriod` son recursos compartidos (find-or-
   * create) — su borrado es best-effort DESPUÉS de la transacción principal
   * (nunca dentro: un fallo a mitad de una transacción de Postgres la deja
   * abortada para cualquier sentencia posterior, así que un `catch` local
   * ahí no alcanza). Si siguen en uso, se dejan — no bloquean el resto.
   */
  async rollback(
    estateId: string,
    id: string,
    user: AuthenticatedUser,
  ): Promise<RollbackResult> {
    const batch = await this.assertBatchAccess(estateId, id, user);
    if (batch.status !== 'completed') {
      throw new BadRequestException(
        'Solo se puede deshacer una importación ya confirmada y completada.',
      );
    }
    const priorSummary = batch.summary as {
      entityType?: ImportEntityType;
    } | null;
    if (
      priorSummary?.entityType === 'opening-balance' ||
      priorSummary?.entityType === 'supplier-invoice'
    ) {
      throw new BadRequestException(
        'Esta importación solo añadió filas al borrador de saldos iniciales: editalas o borralas directamente desde el asistente, en vez de deshacer la importación.',
      );
    }

    const records = await this.prisma.importedRecord.findMany({
      where: { importBatchId: id },
    });
    const idsOf = (entityType: string) =>
      records.filter((r) => r.entityType === entityType).map((r) => r.entityId);

    const ownerIds = idsOf('ExternalOwner');
    const propertyIds = idsOf('Property');
    const entryIds = idsOf('JournalEntry');
    const receiptIds = idsOf('AccountingReceipt');
    const remesaLineIds = idsOf('RemesaLine');
    const remesaHeaderIds = idsOf('RemesaHistoryItem');
    const chartAccountIds = idsOf('ChartAccount');
    const periodIds = idsOf('AccountingPeriod');

    if (propertyIds.length > 0) {
      const otherOwners = await this.prisma.externalOwner.findMany({
        where: { propertyId: { in: propertyIds }, id: { notIn: ownerIds } },
        select: { id: true },
      });
      if (otherOwners.length > 0) {
        throw new BadRequestException(
          'No se puede deshacer: hay propietarios añadidos después de la importación en alguna de estas propiedades.',
        );
      }
    }

    if (ownerIds.length > 0) {
      const promoted = await this.prisma.externalOwner.count({
        where: { id: { in: ownerIds }, promotedToUserId: { not: null } },
      });
      if (promoted > 0) {
        throw new BadRequestException(
          'No se puede deshacer: algún propietario importado ya aceptó su invitación y tiene cuenta en Domora.',
        );
      }
    }

    // Solo cuentan los que se revierten ahora (uno ya revertido a mano se salta).
    let reversedEntries = 0;
    try {
      await runPosting(this.prisma, async (tx) => {
        if (remesaLineIds.length > 0) {
          await tx.remesaLine.deleteMany({
            where: { id: { in: remesaLineIds } },
          });
        }
        if (remesaHeaderIds.length > 0) {
          await tx.remesaHistoryItem.deleteMany({
            where: { id: { in: remesaHeaderIds } },
          });
        }
        // Los recibos no se borran (son documentos con asiento): se deshace su
        // cobro si lo tenían y se anulan con contraasiento.
        for (const receiptId of receiptIds) {
          const receipt = await tx.accountingReceipt.findUniqueOrThrow({
            where: { id: receiptId },
            select: { status: true, no: true },
          });
          if (receipt.status === 'Anulado') continue;
          for (const collection of await this.collections.activeCollectionsFor(
            tx,
            receiptId,
          )) {
            await this.collections.undo(tx, collection.id, {
              reason: 'Importación deshecha',
              userId: user.id,
            });
          }
          await this.receiptPosting.cancel(tx, receiptId, {
            reason: 'Importación deshecha',
            cancelledByUserId: user.id,
          });
        }
        // Los asientos importados no se borran: se revierten, en su fecha.
        for (const entryId of entryIds) {
          const entry = await tx.journalEntry.findUnique({
            where: { id: entryId },
            select: { date: true, reversedBy: { select: { id: true } } },
          });
          if (!entry || entry.reversedBy) continue;
          await this.journal.reverse(tx, entryId, {
            date: entry.date,
            concept: 'Importación deshecha',
            createdByUserId: user.id,
          });
          reversedEntries++;
        }
        if (ownerIds.length > 0) {
          // Invitaciones aún sin canjear de esos titulares (las canjeadas ya
          // se bloquearon arriba): sin el titular, el enlace no tiene sentido.
          await tx.propertyMembershipInvite.deleteMany({
            where: { externalOwnerId: { in: ownerIds }, usedAt: null },
          });
          await tx.externalOwner.deleteMany({
            where: { id: { in: ownerIds } },
          });
        }
        if (propertyIds.length > 0) {
          await tx.property.deleteMany({ where: { id: { in: propertyIds } } });
        }
        await tx.importedRecord.deleteMany({
          where: {
            importBatchId: id,
            entityType: { notIn: ['ChartAccount', 'AccountingPeriod'] },
          },
        });
        await tx.importBatch.update({
          where: { id },
          data: { status: 'rolled_back' },
        });
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException(
        'No se puede deshacer: hay datos que dependen de las filas importadas (recibos, remesas, conciliaciones...).',
      );
    }

    // Best-effort, fuera de la transacción principal (ya confirmada) — si
    // siguen en uso, se dejan tal cual, con su ImportedRecord también
    // intacto por si se puede reintentar más adelante.
    for (const chartAccountId of chartAccountIds) {
      try {
        await this.prisma.chartAccount.delete({
          where: { id: chartAccountId },
        });
        await this.prisma.importedRecord.deleteMany({
          where: {
            importBatchId: id,
            entityType: 'ChartAccount',
            entityId: chartAccountId,
          },
        });
      } catch {
        // Cuenta contable todavía en uso (otro movimiento, presupuesto...) — se deja.
      }
    }
    for (const periodId of periodIds) {
      try {
        await this.prisma.accountingPeriod.delete({ where: { id: periodId } });
        await this.prisma.importedRecord.deleteMany({
          where: {
            importBatchId: id,
            entityType: 'AccountingPeriod',
            entityId: periodId,
          },
        });
      } catch {
        // Periodo todavía en uso (otro recibo, remesa...) — se deja.
      }
    }

    return {
      removedProperties: propertyIds.length,
      removedOwners: ownerIds.length,
      reversedEntries,
      removedReceipts: receiptIds.length,
      removedRemesas: remesaHeaderIds.length,
      removedRemesaLines: remesaLineIds.length,
    };
  }
}
