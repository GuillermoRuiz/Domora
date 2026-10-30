import { Component, Input, OnInit, Output, EventEmitter, signal, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { AccountingEstate, EstateSepaBilling, RemesaCandidate, SepaScheme } from '../../../core/models';
import { EstatesService } from '../../../core/estates.service';
import { ReceiptsService } from '../../../core/receipts.service';
import { SepaService } from '../../../core/sepa.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
@Component({
  selector: 'app-nueva-remesa',
  standalone: true,
  imports: [FormsModule, IconComponent, BtnComponent, BadgeComponent, AvatarComponent, SelectDropdownDirective],
  templateUrl: './nueva-remesa.component.html',
  styleUrl: './nueva-remesa.component.scss',
})
export class NuevaRemesaComponent implements OnInit {
  private estates = inject(EstatesService);
  private receipts = inject(ReceiptsService);
  private sepa = inject(SepaService);
  @Input() estate!: AccountingEstate;
  @Output() closed = new EventEmitter<{ generated: boolean }>();

  /** CID/IBAN (enmascarado) del acreedor SEPA — no viven en AccountingEstate. */
  private sepaBilling = signal<EstateSepaBilling | null>(null);
  periods = signal<{ key: string; label: string }[]>([]);

  step = signal(1);
  generated = signal(false);
  generating = signal(false);
  generateError = signal<string | null>(null);
  remesaRef = signal<string | null>(null);

  /**
   * Antes era un objeto plano `cfg` mutado directamente y bindeado con
   * `[(ngModel)]` — con un <select> cuyas <option> se pueblan de forma
   * asíncrona (`periods` llega después de un await), Angular dispara un
   * ngModelChange espurio que pisaba `cfg.period` con `undefined` apenas
   * el <select> terminaba de renderizar sus opciones. Resultado: el
   * dropdown mostraba el periodo correcto en pantalla, pero `cfg.period`
   * quedaba vacío y el POST a /remesas fallaba con "periodKey inválido"
   * — NUNCA se pudo generar una remesa real para una finca con un solo
   * periodo (bug encontrado auditando de punta a punta, no solo mirando
   * el código). Signals con `[ngModel]`/`(ngModelChange)` explícito no
   * tienen ese problema: no hay binding bidireccional que el propio
   * <select> pueda pisar por su cuenta.
   */
  cfgPeriod = signal('');
  cfgChargeDate = signal('');
  cfgScheme = signal<SepaScheme>('CORE');
  cfgConcept = signal('');

  allCandidates = signal<RemesaCandidate[]>([]);
  eligibleIds = signal<string[]>([]);

  async ngOnInit(): Promise<void> {
    try {
      const [sepaBilling, periods] = await Promise.all([
        this.estates.getEstateSepaBilling(this.estate.id),
        this.receipts.listAccountingPeriods(this.estate.id),
      ]);
      this.sepaBilling.set(sepaBilling);
      this.periods.set(periods);
      const current = periods[0];
      if (current) {
        this.cfgPeriod.set(current.key);
        await this.loadCandidates(current.key);
      }
    } catch (error) {
      console.error('Error cargando datos de remesa', error);
    }
  }

  async onPeriodChange(): Promise<void> {
    await this.loadCandidates(this.cfgPeriod());
  }

  private async loadCandidates(periodKey: string): Promise<void> {
    const candidates = await this.sepa.listRemesaCandidates(this.estate.id, periodKey);
    this.allCandidates.set(candidates);
    this.eligibleIds.set(candidates.filter(c => c.mandate).map(c => c.id));
  }

  eligible = computed(() => this.allCandidates().filter(c => c.mandate));
  noMandate = computed(() => this.allCandidates().filter(c => !c.mandate));

  chosen = computed(() =>
    this.allCandidates().filter(c => this.eligibleIds().includes(c.id))
  );

  totalAmount = computed(() =>
    this.chosen().reduce((s, c) => s + c.amount, 0)
  );

  firstCount = computed(() => this.chosen().filter(c => c.seq === 'FRST').length);
  rcurCount  = computed(() => this.chosen().filter(c => c.seq === 'RCUR').length);

  steps = [
    { n: 1, label: 'Configuración' },
    { n: 2, label: 'Recibos' },
    { n: 3, label: 'Confirmar' },
  ];

  /**
   * IBAN receptor enmascarado (p. ej. "ES91 ···· 1332") — leído de la
   * COMUNIDAD (acreedor SEPA), no de la gestora. Nunca en claro: el
   * backend solo descifra para generar el pain.008, no para mostrarlo.
   */
  get estateIban(): string {
    return this.sepaBilling()?.creditorIbanMasked ?? '—';
  }

  /**
   * Creditor Identifier real de la comunidad. Antes se generaba mal con
   * 'ES76ZZZ' + CIF_de_la_gestora — el 76 no era check válido y el CIF
   * de la gestora no es el acreedor SEPA de las cuotas.
   *
   * Ahora se lee de `Estate.creditorId` (vía /sepa-billing) firmado con
   * el banco de cobro y se valida en la UI antes de generar la remesa.
   */
  get creditorId(): string {
    return this.sepaBilling()?.creditorId ?? '';
  }

  get creditorIdIsValid(): boolean {
    const cid = this.creditorId;
    return !!cid && this.estates.isValidSpanishCreditorId(cid);
  }

  get schemeLabel(): string {
    // pain.008.001.02 es la versión vigente para SDD Core y B2B en España
    // (Cuaderno 19.14 AEB). Migración a 001.08 pendiente cuando el banco
    // emisor lo notifique.
    return this.cfgScheme() === 'CORE'
      ? 'CORE (pain.008.001.02)'
      : 'B2B (pain.008.001.02)';
  }

  /**
   * Comprueba el plazo de presentación exigido por SEPA:
   *   - CORE: mínimo D-1 día hábil.
   *   - B2B:  mínimo D-1 + confirmación del deudor con su banco.
   *
   * `chargeDate` debe ser al menos 1 día natural posterior a hoy.
   * Simplificamos días naturales por brevedad (real: días hábiles).
   */
  get chargeDateIsValid(): boolean {
    if (!this.cfgChargeDate()) return false;
    // `YYYY-MM-DD` se interpreta en hora local (con `new Date('YYYY-MM-DD')` sería UTC y, según la hora y la zona, "mañana" cuenta como hoy).
    const [year, month, day] = this.cfgChargeDate().split('-').map(Number);
    const charge = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.round((charge.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays >= 1;
  }

  /** El botón "Generar" solo se habilita si todos los pre-requisitos SEPA se cumplen. */
  get canGenerate(): boolean {
    return this.creditorIdIsValid && this.chargeDateIsValid && this.chosen().length > 0;
  }

  get formattedChargeDate(): string {
    if (!this.cfgChargeDate()) return '—';
    const [y, m, d] = this.cfgChargeDate().split('-');
    return `${d}/${m}/${y}`;
  }

  isSelected(id: string): boolean {
    return this.eligibleIds().includes(id);
  }

  toggle(id: string): void {
    const current = this.eligibleIds();
    this.eligibleIds.set(
      current.includes(id) ? current.filter(x => x !== id) : [...current, id]
    );
  }

  selectAll(): void {
    this.eligibleIds.set(this.eligible().map(c => c.id));
  }

  selectNone(): void {
    this.eligibleIds.set([]);
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  next(): void {
    if (this.step() < 3) this.step.update(s => s + 1);
  }

  back(): void {
    if (this.step() > 1) this.step.update(s => s - 1);
  }

  /**
   * El backend genera el pain.008 server-side con los datos reales
   * (mandatos/IBANs descifrados). Los recibos deseleccionados en el paso
   * 2 (`eligible` menos `eligibleIds`) se envían como `excludeReceiptIds`
   * para que el backend los excluya de la remesa.
   */
  excludedIds = computed(() =>
    this.eligible().map(c => c.id).filter(id => !this.eligibleIds().includes(id))
  );

  async generate(): Promise<void> {
    this.generating.set(true);
    this.generateError.set(null);
    try {
      const remesa = await this.sepa.createRemesa(this.estate.id, {
        periodKey: this.cfgPeriod(),
        chargeDate: this.cfgChargeDate(),
        scheme: this.cfgScheme(),
        concept: this.cfgConcept(),
        excludeReceiptIds: this.excludedIds(),
      });
      this.remesaRef.set(remesa.id);
      this.generated.set(true);
      this.step.set(4); // success screen
    } catch (error) {
      console.error('Error generando la remesa', error);
      this.generateError.set('No se pudo generar la remesa. Revisa los recibos pendientes y el CID de la finca.');
    } finally {
      this.generating.set(false);
    }
  }

  close(): void {
    this.closed.emit({ generated: this.generated() });
  }

  /**
   * Descarga el XML pain.008 ya generado y persistido por el backend en
   * `create()` — nunca se regenera en el cliente (mismo XML que se
   * presentó al banco).
   */
  async downloadXml(): Promise<void> {
    const remesaId = this.remesaRef();
    if (!remesaId) return;
    const xml = await this.sepa.getRemesaFile(remesaId);
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sepa-${this.cfgScheme()}-${this.cfgPeriod()}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
