import type { INestApplicationContext } from '@nestjs/common';
import { AccountingService } from '../../../src/accounting/accounting.service';
import { DebtorsService } from '../../../src/debtors/debtors.service';
import { RemesasService } from '../../../src/sepa/remesas.service';
import { SuppliersService } from '../../../src/suppliers/suppliers.service';
import { SupplierInvoicesService } from '../../../src/suppliers/supplier-invoices.service';

/**
 * Servicios REALES que usa F2, resueltos del contexto Nest (`strict: false`
 * porque `SupplierInvoicesService` no está exportado por `SuppliersModule`).
 * Mismo criterio que F1 (`f1-services.ts`): una sola resolución por ejecución.
 */
export interface F2Services {
  accounting: AccountingService;
  remesas: RemesasService;
  suppliers: SuppliersService;
  supplierInvoices: SupplierInvoicesService;
  debtors: DebtorsService;
}

export function resolveF2Services(app: INestApplicationContext): F2Services {
  const get = <T>(token: new (...args: never[]) => T): T =>
    app.get(token, { strict: false });
  return {
    accounting: get(AccountingService),
    remesas: get(RemesasService),
    suppliers: get(SuppliersService),
    supplierInvoices: get(SupplierInvoicesService),
    debtors: get(DebtorsService),
  };
}
