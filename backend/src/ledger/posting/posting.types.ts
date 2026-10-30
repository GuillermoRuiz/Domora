import type {
  AccountRole,
  JournalEntryType,
  JournalSource,
} from '../../prisma/client';
import type { Cents } from '../money';

/**
 * Cuenta de una línea. Las reglas de contabilización usan casi siempre el
 * papel (`role`); `bankAccountId` elige una cuenta bancaria concreta (sin
 * él, `{ role: 'bank' }` es la cuenta bancaria por defecto de la finca), y
 * `accountId` es para asientos manuales o importados.
 */
export type AccountTarget =
  { role: AccountRole } | { bankAccountId: string } | { accountId: string };

export interface LineDraft {
  account: AccountTarget;
  /** Céntimos. Exactamente uno de los dos lados es positivo. */
  debit?: Cents;
  credit?: Cents;
  concept?: string;
  propertyId?: string;
  supplierId?: string;
  costCentreId?: string;
  receiptId?: string;
  supplierInvoiceId?: string;
}

export interface EntryDraft {
  estateId: string;
  /** Fecha contable. Solo cuenta el día (UTC). */
  date: Date;
  entryType?: JournalEntryType;
  sourceType: JournalSource;
  sourceId?: string;
  concept: string;
  reference?: string;
  reversesEntryId?: string;
  importBatchId?: string;
  createdByUserId?: string;
  lines: LineDraft[];
}

export interface PostedEntry {
  id: string;
  fiscalYear: number;
  number: number;
}
