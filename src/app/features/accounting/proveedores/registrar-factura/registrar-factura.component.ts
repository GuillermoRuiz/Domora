import type { InvoiceFields } from '../../../../core/ai.service';
import { Component, EventEmitter, Input, OnInit, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { ChartAccount, CostCentre, Supplier, WITHHOLDING_KEY_LABELS, WithholdingKey } from '../../../../core/models';
import { AccountingService } from '../../../../core/accounting.service';
import { CostCentresService } from '../../../../core/cost-centres.service';
import { SuppliersStaffService } from '../../../../core/suppliers-staff.service';

import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
/** Cuenta de gasto que se propone según la categoría del proveedor (se puede cambiar). */
const ACCOUNT_BY_CATEGORY: Record<string, string> = {
  Mantenimiento: '622',
  Reparaciones: '622',
  Suministros: '628',
  Seguros: '625',
  Administración: '623',
  Limpieza: '629',
  Otros: '629',
};

interface LineForm {
  accountId: string;
  costCentreId: string;
  description: string;
  base: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Acepta '1.234,56' y '1234.56'; en céntimos, o NaN. */
function toCents(value: string): number {
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  const n = Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
  if (!Number.isFinite(n)) return NaN;
  const cents = Math.round(n * 100);
  return Math.abs(cents - n * 100) > 1e-6 ? NaN : cents;
}

/** Porcentaje redondeado medio céntimo hacia arriba, igual que el backend. */
function percentOf(cents: number, pct: number): number {
  return Math.floor((cents * pct) / 100 + 0.5 + 1e-9);
}

/**
 * Registrar la factura de un proveedor. Queda contabilizada al guardarla:
 * cada línea carga su cuenta de gasto (con su parte del IVA, que la
 * comunidad no deduce) y el proveedor queda como acreedor de lo que se le
 * paga; la retención de IRPF va a Hacienda.
 */
@Component({
  selector: 'app-registrar-factura',
  standalone: true,
  imports: [FormsModule, BtnComponent, IconComponent, SelectDropdownDirective],
  templateUrl: './registrar-factura.component.html',
  styleUrls: ['../../cobros/cobros-modal.scss', './registrar-factura.component.scss'],
})
export class RegistrarFacturaComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Input() suppliers: Supplier[] = [];
  @Input() supplierId = '';
  @Input() initialExtraction: InvoiceFields | null = null;
  /** Origen de los datos precargados (fichero, proveedor detectado y avisos de la lectura). */
  @Input() extractionNote: { fileName: string; supplierLabel: string | null; warnings: string[] } | null = null;
  @Output() closed = new EventEmitter<{ saved: boolean; supplierId?: string; invoiceId?: string }>();

  private accounting = inject(AccountingService);
  private costCentresSvc = inject(CostCentresService);
  private suppliersSvc = inject(SuppliersStaffService);

  expenseAccounts = signal<ChartAccount[]>([]);
  costCentres = signal<CostCentre[]>([]);
  saving = signal(false);
  error = signal<string | null>(null);

  vatPresets = [21, 10, 4, 0];
  withholdingPresets = [0, 15, 7];
  withholdingKeys = Object.entries(WITHHOLDING_KEY_LABELS).map(([value, label]) => ({ value: value as WithholdingKey, label }));

  form = {
    supplierId: '',
    number: '',
    concept: '',
    issueDate: today(),
    receivedDate: '',
    dueDate: '',
    vatRatePct: '21',
    withholdingRatePct: '0',
    withholdingKey: 'G_profesional' as WithholdingKey,
    payableAccount: '400' as '400' | '410',
  };
  lines = signal<LineForm[]>([]);
  /** Cambia con cada edición del formulario para recalcular los totales. */
  private revision = signal(0);

  activeSuppliers = computed(() => this.suppliers.filter((s) => s.status !== 'Baja'));

  totals = computed(() => {
    this.revision();
    const bases = this.lines().map((l) => toCents(l.base));
    const vatPct = Number(this.form.vatRatePct.replace(',', '.'));
    const whPct = Number(this.form.withholdingRatePct.replace(',', '.'));
    if (bases.some((b) => !Number.isFinite(b) || b <= 0) || !Number.isFinite(vatPct) || !Number.isFinite(whPct)) {
      return null;
    }
    const base = bases.reduce((s, b) => s + b, 0);
    const vat = percentOf(base, vatPct);
    const withholding = percentOf(base, whPct);
    return { base: base / 100, vat: vat / 100, withholding: withholding / 100, total: (base + vat) / 100, payable: (base + vat - withholding) / 100 };
  });

  async ngOnInit(): Promise<void> {
    this.form.supplierId = this.supplierId;
    try {
      const [accounts, centres] = await Promise.all([
        this.accounting.listChartAccounts(this.estateId),
        this.costCentresSvc.listCostCentres(this.estateId),
      ]);
      this.expenseAccounts.set(
        accounts
          .filter((a) => a.code.startsWith('6') && a.postable !== false && !a.archivedAt)
          .sort((a, b) => a.code.localeCompare(b.code)),
      );
      this.costCentres.set(centres.filter((c) => c.status !== 'Archivado'));
    } catch (error) {
      console.error('Error cargando cuentas y centros de coste', error);
    }
    const proposal = this.initialExtraction;
    if (proposal) {
      this.form.number = proposal.invoice_number ?? '';
      this.form.concept = proposal.description ?? '';
      this.form.issueDate = proposal.invoice_date ?? '';
      this.form.dueDate = proposal.due_date ?? '';
      // Unknown rates stay blank until the administrator supplies them.
      const base = Number(proposal.net_amount);
      this.form.vatRatePct = proposal.vat_amount !== null && base > 0 ? String(Math.round((Number(proposal.vat_amount) * 10000) / base) / 100) : '';
      this.form.withholdingRatePct = proposal.withholding_amount !== null && base > 0 ? String(Math.round((Number(proposal.withholding_amount) * 10000) / base) / 100) : '';
      this.lines.set([{ ...this.emptyLine(), base: proposal.net_amount ?? '' }]);
      this.touch();
    } else {
      this.lines.set([this.emptyLine()]);
    }
  }

  onSupplierChange(id: string): void {
    this.form.supplierId = id;
    // Si las líneas aún no tienen cuenta elegida a mano, se propone la de la categoría.
    this.lines.set(this.lines().map((l) => (l.base || l.description ? l : { ...l, accountId: this.suggestedAccountId() })));
    this.touch();
  }

  addLine(): void {
    this.lines.set([...this.lines(), this.emptyLine()]);
    this.touch();
  }

  removeLine(index: number): void {
    this.lines.set(this.lines().filter((_, i) => i !== index));
    this.touch();
  }

  touch(): void {
    this.revision.update((v) => v + 1);
  }

  async save(): Promise<void> {
    const f = this.form;
    const totals = this.totals();
    if (!f.supplierId) return this.fail('Elige el proveedor.');
    if (!f.number.trim()) return this.fail('Indica el número de la factura.');
    if (!f.concept.trim()) return this.fail('Indica el concepto.');
    if (this.lines().some((l) => !l.accountId)) return this.fail('Elige la cuenta de gasto de cada línea.');
    if (!totals) return this.fail('Revisa las bases (mayores que cero, dos decimales) y los porcentajes.');
    if (totals.payable <= 0) return this.fail('La retención no puede ser igual o mayor que el total.');

    this.saving.set(true);
    this.error.set(null);
    try {
      if (!f.vatRatePct.trim() || !f.withholdingRatePct.trim()) {
        return this.fail('Completa los tipos de IVA y retención antes de registrar.');
      }
      const withholdingRatePct = Number(f.withholdingRatePct.replace(',', '.'));
      const createdInvoice = await this.suppliersSvc.createSupplierInvoice(this.estateId, f.supplierId, {
        number: f.number.trim(),
        concept: f.concept.trim(),
        issueDate: f.issueDate,
        ...(f.receivedDate ? { receivedDate: f.receivedDate } : {}),
        ...(f.dueDate ? { dueDate: f.dueDate } : {}),
        vatRatePct: Number(f.vatRatePct.replace(',', '.')),
        withholdingRatePct,
        ...(withholdingRatePct > 0 ? { withholdingKey: f.withholdingKey } : {}),
        payableAccount: f.payableAccount,
        lines: this.lines().map((l) => ({
          accountId: l.accountId,
          ...(l.costCentreId ? { costCentreId: l.costCentreId } : {}),
          ...(l.description.trim() ? { description: l.description.trim() } : {}),
          baseAmount: toCents(l.base) / 100,
        })),
      });
      this.closed.emit({ saved: true, supplierId: f.supplierId, invoiceId: createdInvoice.id });
    } catch (error: any) {
      const msg = error?.error?.message;
      this.error.set(Array.isArray(msg) ? msg.join(' ') : typeof msg === 'string' ? msg : 'No se pudo registrar la factura.');
    } finally {
      this.saving.set(false);
    }
  }

  close(): void {
    this.closed.emit({ saved: false });
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  private emptyLine(): LineForm {
    return { accountId: this.suggestedAccountId(), costCentreId: '', description: '', base: '' };
  }

  private suggestedAccountId(): string {
    const supplier = this.suppliers.find((s) => s.id === this.form.supplierId);
    const code = supplier ? ACCOUNT_BY_CATEGORY[supplier.category] : undefined;
    return this.expenseAccounts().find((a) => a.code === code)?.id ?? '';
  }

  private fail(message: string): void {
    this.error.set(message);
  }
}
