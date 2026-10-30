import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { ReportTableComponent, ReportSection } from '../../../shared/components/report-table/report-table.component';
import { ChartAccount, OwnerProperty, Supplier } from '../../../core/models';
import { AccountingService } from '../../../core/accounting.service';
import { PropertiesService } from '../../../core/properties.service';
import { SuppliersStaffService } from '../../../core/suppliers-staff.service';
import { GeneralLedgerReport, ReportsService } from '../../../core/reports.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
function propertyLabel(p: OwnerProperty): string {
  return p.ref || [p.staircase, p.floor, p.door].filter(Boolean).join('-') || p.id;
}

function apiMessage(error: any, fallback: string): string {
  const msg = error?.error?.message;
  if (Array.isArray(msg)) return msg.join(' ');
  return typeof msg === 'string' ? msg : fallback;
}

/**
 * Mayor de una cuenta contable (fase 12): movimientos ordenados por fecha,
 * con saldo corrido, filtrables por propiedad o proveedor. La cuenta 430
 * filtrada por propiedad es exactamente el mismo informe que el rol C ve
 * como "extracto de cuenta" — ver `PropertyLedgerController` en el backend.
 */
@Component({
  selector: 'app-mayor-tab',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, ReportTableComponent, SelectDropdownDirective],
  templateUrl: './mayor-tab.component.html',
  styleUrls: ['../cobros/cobros-modal.scss', '../nominas-tab/nominas-tab.component.scss', '../impuestos-tab/impuestos-tab.component.scss', './mayor-tab.component.scss'],
})
export class MayorTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private accounting = inject(AccountingService);
  private properties = inject(PropertiesService);
  private suppliers = inject(SuppliersStaffService);
  private reports = inject(ReportsService);

  accounts = signal<ChartAccount[]>([]);
  propertyList = signal<OwnerProperty[]>([]);
  supplierList = signal<Supplier[]>([]);
  propertyLabel = propertyLabel;

  accountCode = signal('');
  propertyId = signal('');
  supplierId = signal('');
  from = signal('');
  to = signal('');

  report = signal<GeneralLedgerReport | null>(null);
  loading = signal(false);
  loadError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const [accounts, properties, suppliers] = await Promise.all([
        this.accounting.listChartAccounts(this.estateId),
        this.properties.listPropertiesByEstate(this.estateId),
        this.suppliers.listSuppliers(this.estateId),
      ]);
      this.accounts.set(accounts.filter(a => a.postable !== false && !a.archivedAt));
      this.propertyList.set(properties);
      this.supplierList.set(suppliers);
    } catch (error) {
      console.error('Error cargando cuentas, propiedades y proveedores', error);
    }
  }

  async setAccountCode(code: string): Promise<void> {
    this.accountCode.set(code);
    await this.load();
  }

  async setPropertyId(propertyId: string): Promise<void> {
    this.propertyId.set(propertyId);
    await this.load();
  }

  async setSupplierId(supplierId: string): Promise<void> {
    this.supplierId.set(supplierId);
    await this.load();
  }

  async setFrom(from: string): Promise<void> {
    this.from.set(from);
    await this.load();
  }

  async setTo(to: string): Promise<void> {
    this.to.set(to);
    await this.load();
  }

  async load(): Promise<void> {
    if (!this.accountCode()) {
      this.report.set(null);
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.report.set(await this.reports.generalLedger(this.estateId, {
        accountCode: this.accountCode(),
        propertyId: this.propertyId() || undefined,
        supplierId: this.supplierId() || undefined,
        from: this.from() || undefined,
        to: this.to() || undefined,
      }));
    } catch (error) {
      this.loadError.set(apiMessage(error, 'No se pudo calcular el mayor.'));
    } finally {
      this.loading.set(false);
    }
  }

  get sections(): ReportSection[] {
    const r = this.report();
    if (!r) return [];
    return [{
      columns: [
        { key: 'date', header: 'Fecha' },
        { key: 'entryNumber', header: 'Asiento' },
        { key: 'concept', header: 'Concepto' },
        { key: 'debit', header: 'Debe', money: true },
        { key: 'credit', header: 'Haber', money: true },
        { key: 'balance', header: 'Saldo', money: true },
      ],
      rows: r.rows,
      totals: { concept: 'Saldo final', balance: r.closingBalance },
      empty: 'Sin movimientos en el periodo.',
    }];
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  async download(format: 'xlsx' | 'pdf'): Promise<void> {
    if (!this.accountCode()) return;
    try {
      const blob = await this.reports.download(this.estateId, 'general-ledger', format, {
        accountCode: this.accountCode(),
        propertyId: this.propertyId() || undefined,
        supplierId: this.supplierId() || undefined,
        from: this.from() || undefined,
        to: this.to() || undefined,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mayor-${this.accountCode()}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando el mayor', error);
    }
  }
}
