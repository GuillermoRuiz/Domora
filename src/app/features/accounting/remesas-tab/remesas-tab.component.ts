import { PageActionDirective } from '../../../shared/components/page-action/page-action.directive';
import { Component, Input, OnInit, computed, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { NuevaRemesaComponent } from '../nueva-remesa/nueva-remesa.component';
import { ImportarDevolucionesComponent } from '../importar-devoluciones/importar-devoluciones.component';
import { AccountingEstate, RemesaHistoryItem, RemesaLine, SEPA_RETURN_CODES } from '../../../core/models';
import { SepaService } from '../../../core/sepa.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  'Cobrada':           { bg: 'var(--color-secondary-bg)', fg: 'var(--color-secondary)' },
  'Con devoluciones':  { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning)' },
  'Presentada':        { bg: 'var(--color-bg)', fg: 'var(--color-muted)' },
  'Borrador':          { bg: 'var(--color-bg)', fg: 'var(--color-light)' },
  'Anulada':           { bg: 'var(--color-bg)', fg: 'var(--color-light)' },
};

const LINE_STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  'Cobrado':   { bg: 'var(--color-secondary-bg)', fg: 'var(--color-secondary)' },
  'Pendiente': { bg: 'var(--color-bg)', fg: 'var(--color-muted)' },
  'Devuelto':  { bg: 'var(--color-error-bg)', fg: 'var(--color-error)' },
  'Rechazado': { bg: 'var(--color-error-bg)', fg: 'var(--color-error)' },
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

@Component({
  selector: 'app-remesas-tab',
  standalone: true,
  imports: [PageActionDirective, FormsModule, BtnComponent, IconComponent, AvatarComponent, NuevaRemesaComponent, ImportarDevolucionesComponent, SelectDropdownDirective],
  templateUrl: './remesas-tab.component.html',
  styleUrl: './remesas-tab.component.scss',
})
export class RemesasTabComponent implements OnInit {
  @Input() estate!: AccountingEstate;

  private data = inject(SepaService);

  history = signal<RemesaHistoryItem[]>([]);
  lines = signal<RemesaLine[]>([]);

  showWizard = signal(false);
  showReturnsImport = signal(false);
  selected = signal<RemesaHistoryItem | null>(null);
  toastMessage = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.history.set(await this.data.listRemesas(this.estate.id));
    } catch (error) {
      console.error('Error cargando remesas', error);
    }
  }

  remesasCount = computed(() => this.history().length);
  totalDomiciliado = computed(() => this.history().reduce((s, r) => s + r.amount, 0));
  returnRate = computed(() => {
    const totalCount = this.history().reduce((s, r) => s + r.count, 0);
    const totalReturned = this.history().reduce((s, r) => s + r.returned, 0);
    return totalCount ? Math.round((totalReturned / totalCount) * 1000) / 10 : 0;
  });

  statusStyle(status: string) {
    return STATUS_STYLE[status] || STATUS_STYLE['Borrador'];
  }

  lineStatusStyle(status: string) {
    return LINE_STATUS_STYLE[status] || LINE_STATUS_STYLE['Pendiente'];
  }

  async open(r: RemesaHistoryItem): Promise<void> {
    this.selected.set(r);
    this.lines.set([]);
    try {
      this.lines.set(await this.data.listRemesaLines(r.id));
    } catch (error) {
      console.error('Error cargando las líneas de la remesa', error);
    }
  }

  back(): void {
    this.selected.set(null);
  }

  async onWizardClosed(result: { generated: boolean }): Promise<void> {
    this.showWizard.set(false);
    if (result.generated) {
      this.history.set(await this.data.listRemesas(this.estate.id));
      this.showToast('Remesa generada correctamente');
    }
  }

  /** Tras importar devoluciones, las remesas y sus líneas cambian de estado. */
  async onReturnsImportClosed(result: { changed: boolean }): Promise<void> {
    this.showReturnsImport.set(false);
    if (!result.changed) return;
    await this.reloadSelected();
    this.showToast('Devoluciones del banco contabilizadas');
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  /** Mismo pain.008 ya presentado (`RemesaHistoryItem.xmlContent`), nunca regenerado — igual criterio que recibos-tab.downloadSepaFile(). */
  async downloadXml(): Promise<void> {
    const remesa = this.selected();
    if (!remesa) return;
    try {
      const xml = await this.data.getRemesaFile(remesa.id);
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `remesa-${remesa.id}.xml`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando el fichero SEPA', error);
      this.showToast('No se pudo descargar el fichero SEPA.');
    }
  }

  /** "Justificante" = el mismo XML presentado, abierto para ver en vez de forzar la descarga. */
  async viewJustificante(): Promise<void> {
    const remesa = this.selected();
    if (!remesa) return;
    try {
      const xml = await this.data.getRemesaFile(remesa.id);
      const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error('Error abriendo el justificante', error);
      this.showToast('No se pudo abrir el justificante.');
    }
  }

  // ── Cobro, anulación y devoluciones ───────────────────────────────────
  returnCodes = SEPA_RETURN_CODES;

  /** Solo una remesa enviada y sin cobrar se cobra o se anula. */
  canCollect = computed(() => this.selected()?.status === 'Presentada');

  /** Una línea se devuelve si se cobró, o se rechaza si la remesa aún no se ha cobrado. */
  canReturnLine(l: RemesaLine): boolean {
    if (l.status === 'Cobrado') return true;
    return l.status === 'Pendiente' && this.selected()?.status === 'Presentada';
  }

  collectOpen = signal(false);
  collectDate = signal(today());
  cancelOpen = signal(false);
  returningLine = signal<RemesaLine | null>(null);
  returnForm = { returnCode: 'AM04', returnReason: '', date: today(), feeAmount: '', rechargeFee: false };
  actionSaving = signal(false);
  actionError = signal<string | null>(null);

  openCollect(): void {
    this.collectDate.set(this.selected()?.charge || today());
    this.actionError.set(null);
    this.collectOpen.set(true);
  }

  async confirmCollect(): Promise<void> {
    const remesa = this.selected();
    if (!remesa) return;
    await this.runAction(async () => {
      await this.data.collectRemesa(remesa.id, this.collectDate());
      this.collectOpen.set(false);
      this.showToast('Remesa cobrada: recibos pagados y abono contabilizado');
    });
  }

  openCancelRemesa(): void {
    this.actionError.set(null);
    this.cancelOpen.set(true);
  }

  async confirmCancelRemesa(): Promise<void> {
    const remesa = this.selected();
    if (!remesa) return;
    await this.runAction(async () => {
      await this.data.cancelRemesa(remesa.id);
      this.cancelOpen.set(false);
      this.showToast('Remesa anulada: sus recibos pueden ir en otra remesa');
    });
  }

  openReturn(l: RemesaLine): void {
    this.returnForm = { returnCode: 'AM04', returnReason: '', date: today(), feeAmount: '', rechargeFee: false };
    this.actionError.set(null);
    this.returningLine.set(l);
  }

  /** Si la remesa no se ha cobrado todavía, no hay devolución sino rechazo: sin comisión. */
  returnIsRejection = computed(() => this.returningLine()?.status === 'Pendiente');

  async confirmReturn(): Promise<void> {
    const line = this.returningLine();
    if (!line) return;
    const rawFee = String(this.returnForm.feeAmount).trim();
    const fee = rawFee === '' ? 0 : parseFloat(rawFee.replace(',', '.'));
    if (!Number.isFinite(fee) || fee < 0) {
      this.actionError.set('La comisión no es un importe válido.');
      return;
    }
    const rejection = this.returnIsRejection();
    const label = this.returnCodes.find((c) => c.code === this.returnForm.returnCode)?.label;
    await this.runAction(async () => {
      await this.data.returnRemesaLine(line.id, {
        returnCode: this.returnForm.returnCode,
        returnReason: this.returnForm.returnReason.trim() || label,
        date: this.returnForm.date,
        ...(rejection || fee === 0 ? {} : { feeAmount: fee, rechargeFee: this.returnForm.rechargeFee }),
      });
      this.returningLine.set(null);
      this.showToast(rejection ? 'Línea rechazada' : 'Devolución registrada: el recibo vuelve a deber');
    });
  }

  /** Ejecuta la acción, recarga historial y líneas, y enseña el motivo si el backend la rechaza. */
  private async runAction(fn: () => Promise<void>): Promise<void> {
    this.actionSaving.set(true);
    this.actionError.set(null);
    try {
      await fn();
      await this.reloadSelected();
    } catch (error: any) {
      const msg = error?.error?.message;
      this.actionError.set(typeof msg === 'string' ? msg : 'No se pudo completar la operación.');
    } finally {
      this.actionSaving.set(false);
    }
  }

  private async reloadSelected(): Promise<void> {
    const id = this.selected()?.id;
    this.history.set(await this.data.listRemesas(this.estate.id));
    if (!id) return;
    this.selected.set(this.history().find((r) => r.id === id) ?? null);
    this.lines.set(await this.data.listRemesaLines(id));
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  fmtEur0(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
  }
}
