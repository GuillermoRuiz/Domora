import { Component, Input, computed, signal, inject, OnInit} from '@angular/core';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { AccountingEstate, Debtor, DebtorAction, GestionType, NeighbourBalance, PaymentAgreement, PaymentAgreementInstallment } from '../../../core/models';
import { DebtorsService } from '../../../core/debtors.service';
import { LateInterestService } from '../../../core/late-interest.service';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
type ViewMode = 'debt' | 'all';

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  'Sin gestionar':   { bg: 'var(--color-bg)', fg: 'var(--color-muted)' },
  'Aviso enviado':   { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning)' },
  'Sin respuesta':   { bg: 'var(--color-orange-bg)', fg: 'var(--color-orange)' },
  'En reclamación':  { bg: 'var(--color-error-bg)', fg: 'var(--color-error)' },
  'Acción judicial': { bg: 'var(--color-maroon-bg)', fg: 'var(--color-maroon)' },
};

const GESTION_TYPES: { type: GestionType; icon: string }[] = [
  { type: 'Llamada', icon: 'phone' },
  { type: 'Email', icon: 'mail' },
  { type: 'Carta amistosa', icon: 'send' },
  { type: 'Carta formal', icon: 'file-text' },
  { type: 'Burofax', icon: 'send' },
  { type: 'Acción judicial', icon: 'gavel' },
];

const RESULT_OPTIONS = ['Sin respuesta', 'Compromiso de pago', 'Pago parcial', 'Rechazo', 'No contesta', 'Otro'];

type BulkType = 'amistosa' | 'formal' | 'burofax';

interface InterestPreviewRow {
  debtorId: string;
  debtorName: string;
  propertyLabel: string;
  receipts: { receiptId: string; no: string; amount: number }[];
  total: number;
  error?: string;
}
type Channel = 'email' | 'certificado' | 'ambos';

const BULK_TYPE_INFO: Record<BulkType, { label: string; cost: number }> = {
  amistosa: { label: '1ª Carta amistosa', cost: 0 },
  formal: { label: '2ª Carta formal', cost: 0 },
  burofax: { label: 'Burofax certificado', cost: 28.5 },
};

@Component({
  selector: 'app-morosidad-tab',
  standalone: true,
  imports: [BtnComponent, IconComponent, AvatarComponent, SelectDropdownDirective],
  templateUrl: './morosidad-tab.component.html',
  styleUrl: './morosidad-tab.component.scss',
})
export class MorosidadTabComponent implements OnInit {
  @Input() estate!: AccountingEstate;

  private debtorsSvc = inject(DebtorsService);
  private lateInterestSvc = inject(LateInterestService);
  debtors = signal<Debtor[]>([]);

  // ── "Todos los vecinos" (saldo en vivo, no solo morosidad ya gestionada) ──
  viewMode = signal<ViewMode>('debt');
  balances = signal<NeighbourBalance[]>([]);
  balancesLoaded = false;
  balancesLoading = signal(false);
  exporting = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      // Antes pedía /debtors global (TODAS las fincas del gestor) sin usar
      // nunca el @Input estate — una gestora con varias fincas veía
      // deudores mezclados en la pestaña de una sola.
      this.debtors.set(await this.debtorsSvc.listDebtorsByEstate(this.estate.id));
    } catch (error) {
      console.error('Error cargando morosidad', error);
    }
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    if (mode === 'all' && !this.balancesLoaded) {
      void this.loadBalances();
    }
  }

  private async loadBalances(): Promise<void> {
    this.balancesLoading.set(true);
    try {
      this.balances.set(await this.debtorsSvc.listBalancesByEstate(this.estate.id));
      this.balancesLoaded = true;
    } catch (error) {
      console.error('Error cargando el saldo de los vecinos', error);
    } finally {
      this.balancesLoading.set(false);
    }
  }

  balanceStatusLabel(b: NeighbourBalance): string {
    return b.isUpToDate ? 'Al día' : (b.step ?? 'Sin gestionar');
  }

  async exportExcel(): Promise<void> {
    this.exporting.set(true);
    try {
      const blob = await this.debtorsSvc.downloadBalancesExcel(this.estate.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `saldo-vecinos-${this.estate.name.replace(/\s+/g, '-')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exportando el saldo a Excel', error);
      this.showToast('No se pudo generar el Excel');
    } finally {
      this.exporting.set(false);
    }
  }

  toastMessage = signal<string | null>(null);

  selected = signal<Set<string>>(new Set());

  totalDebt = computed(() => this.debtors().reduce((s, d) => s + d.amount, 0));
  totalInterest = computed(() => this.debtors().reduce((s, d) => s + d.interest, 0));
  inClaim = computed(() => this.debtors().filter(d => d.reminders.l2 || d.reminders.bf).length);
  maxMonths = computed(() => {
    const list = this.debtors();
    if (list.length === 0) return null;
    return list.reduce((m, d) => d.monthsOverdue > m.monthsOverdue ? d : m, list[0]);
  });

  selectedCount = computed(() => this.selected().size);
  allSelected = computed(() => this.debtors().length > 0 && this.selected().size === this.debtors().length);

  reminderLabels: { key: 'l1' | 'l2' | 'bf'; label: string; title: string }[] = [
    { key: 'l1', label: '1ª', title: '1ª carta' },
    { key: 'l2', label: '2ª', title: '2ª carta' },
    { key: 'bf', label: 'BF', title: 'Burofax' },
  ];

  // ── Drawer "Gestionar" ──────────────────────────────────────────────────
  drawerDebtor = signal<Debtor | null>(null);
  drawerTab = signal<'historial' | 'nueva' | 'acuerdo'>('historial');

  gestionTypes = GESTION_TYPES;
  resultOptions = RESULT_OPTIONS;

  newGestionType = signal<GestionType>('Llamada');
  newGestionDate = signal<string>(new Date().toISOString().slice(0, 10));
  newGestionNote = signal<string>('');
  newGestionResult = signal<string>(RESULT_OPTIONS[0]);
  newGestionNextAction = signal<string>('');

  acuerdoCuotas = signal<number>(3);
  acuerdoEntrada = signal<number>(0);
  acuerdoFirstDate = signal<string>(new Date().toISOString().slice(0, 10));

  /**
   * Vista previa del plan MIENTRAS el admin mueve los sliders — no se
   * persiste nada todavía. Se materializa en `PaymentAgreement` +
   * `PaymentAgreementInstallment` solo al pulsar "Confirmar acuerdo"
   * (ver `confirmAcuerdo()`).
   */
  acuerdoPlan = computed(() => {
    const debtor = this.drawerDebtor();
    if (!debtor) return [];
    const cuotas = this.acuerdoCuotas();
    const entradaPct = this.acuerdoEntrada();
    const total = debtor.amount + debtor.interest;
    const entrada = total * (entradaPct / 100);
    const remaining = total - entrada;
    const perCuota = remaining / cuotas;
    const startDate = new Date(this.acuerdoFirstDate());
    const rows: { n: number; date: string; amount: number }[] = [];
    if (entrada > 0) {
      rows.push({ n: 0, date: this.acuerdoFirstDate(), amount: entrada });
    }
    for (let i = 0; i < cuotas; i++) {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + i);
      rows.push({ n: i + 1, date: d.toISOString().slice(0, 10), amount: perCuota });
    }
    return rows;
  });

  /** Acuerdo ya persistido y activo para el deudor del drawer, si existe. */
  activeAgreement = signal<PaymentAgreement | null>(null);
  activeAgreementInstallments = signal<PaymentAgreementInstallment[]>([]);
  drawerActions = signal<DebtorAction[]>([]);

  private async reloadDrawerData(): Promise<void> {
    const d = this.drawerDebtor();
    if (!d) {
      this.activeAgreement.set(null);
      this.activeAgreementInstallments.set([]);
      this.drawerActions.set([]);
      return;
    }
    try {
      const agreement = await this.debtorsSvc.findActiveAgreementForDebtor(d.id);
      this.activeAgreement.set(agreement);
      this.activeAgreementInstallments.set(
        agreement ? await this.debtorsSvc.listInstallmentsForAgreement(agreement.id) : [],
      );
      this.drawerActions.set(await this.debtorsSvc.listActionsForDebtor(d.id));
    } catch (error) {
      console.error('Error cargando datos del deudor', error);
    }
  }

  openDrawer(d: Debtor): void {
    this.drawerDebtor.set(d);
    this.drawerTab.set('historial');
    this.newGestionType.set('Llamada');
    this.newGestionDate.set(new Date().toISOString().slice(0, 10));
    this.newGestionNote.set('');
    this.newGestionResult.set(RESULT_OPTIONS[0]);
    this.newGestionNextAction.set('');
    this.acuerdoCuotas.set(3);
    this.acuerdoEntrada.set(0);
    this.acuerdoFirstDate.set(new Date().toISOString().slice(0, 10));
    void this.reloadDrawerData();
  }

  closeDrawer(): void {
    this.drawerDebtor.set(null);
  }

  async saveGestion(): Promise<void> {
    const debtor = this.drawerDebtor();
    if (!debtor) return;
    // Insertar en la tabla `debtor_actions` (antes era el array embebido
    // `Debtor.history`).
    await this.debtorsSvc.addDebtorAction({
      debtorId: debtor.id,
      type: this.newGestionType(),
      date: this.newGestionDate(),
      note: this.newGestionNote(),
      result: this.newGestionResult(),
      author: 'Tú',
    });
    // Actualiza los campos derivados del propio deudor.
    this.debtors.update(list => list.map(d =>
      d.id === debtor.id ? { ...d, lastContact: this.newGestionDate(), step: 'Aviso enviado' } : d,
    ));
    const updated = this.debtors().find(d => d.id === debtor.id) ?? null;
    this.drawerDebtor.set(updated);
    await this.reloadDrawerData();
    this.drawerTab.set('historial');
    this.showToast(`Gestión registrada para ${debtor.name}`);
  }

  /** Histórico de gestiones del deudor abierto en el drawer (via tabla `debtor_actions`). */
  drawerDebtorActions(): DebtorAction[] {
    return this.drawerActions();
  }

  /**
   * Confirma el acuerdo de pago: antes este botón llamaba por error a
   * `saveGestion()` (guardaba una gestión genérica y descartaba el plan de
   * cuotas calculado). Ahora persiste el `PaymentAgreement` y genera todas
   * sus `PaymentAgreementInstallment` de una vez.
   */
  async confirmAcuerdo(): Promise<void> {
    const debtor = this.drawerDebtor();
    if (!debtor) return;
    const total = debtor.amount + debtor.interest;
    const entradaPct = this.acuerdoEntrada();
    const downPaymentAmount = Math.round(total * (entradaPct / 100) * 100) / 100;

    await this.debtorsSvc.createPaymentAgreement({
      debtorId: debtor.id,
      totalAmount: total,
      downPaymentAmount,
      installmentsCount: this.acuerdoCuotas(),
      firstDueDate: this.acuerdoFirstDate(),
    });
    await this.debtorsSvc.addDebtorAction({
      debtorId: debtor.id,
      type: 'Carta amistosa',
      date: new Date().toISOString().slice(0, 10),
      note: `Acuerdo de pago firmado: ${this.acuerdoCuotas()} cuotas desde ${this.fmtDate(this.acuerdoFirstDate())}.`,
      result: 'Compromiso de pago',
      author: 'Tú',
    });
    this.debtors.update(list => list.map(d =>
      d.id === debtor.id ? { ...d, step: 'Aviso enviado' } : d,
    ));
    this.drawerDebtor.set(this.debtors().find(d => d.id === debtor.id) ?? null);
    await this.reloadDrawerData();
    this.showToast(`Acuerdo de pago confirmado para ${debtor.name}`);
  }

  /**
   * Registra el pago de una cuota del acuerdo activo (hoy, por
   * transferencia): el backend lo contabiliza como un cobro imputado a los
   * recibos que cubre el acuerdo, del más antiguo al más nuevo.
   */
  async markInstallmentPaid(installmentId: string): Promise<void> {
    try {
      await this.debtorsSvc.markInstallmentPaid(installmentId);
      await this.reloadDrawerData();
      this.showToast('Cuota cobrada: se ha imputado a los recibos del acuerdo');
    } catch (error: any) {
      console.error('Error marcando la cuota', error);
      const msg = error?.error?.message;
      this.showToast(typeof msg === 'string' ? msg : 'No se pudo registrar el pago de la cuota');
    }
  }

  startLegalAction(): void {
    const debtor = this.drawerDebtor();
    if (!debtor) return;
    this.debtors.update(list => list.map(d => d.id === debtor.id ? { ...d, step: 'Acción judicial' } : d));
    this.showToast(`Acción judicial iniciada para ${debtor.name}`);
    this.closeDrawer();
  }

  // ── Selección múltiple ───────────────────────────────────────────────────
  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  toggleSelect(id: string): void {
    this.selected.update(set => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  toggleSelectAll(): void {
    if (this.allSelected()) {
      this.selected.set(new Set());
    } else {
      this.selected.set(new Set(this.debtors().map(d => d.id)));
    }
  }

  // ── Wizard "Enviar reclamación masiva" ──────────────────────────────────
  bulkWizardOpen = signal(false);
  bulkStep = signal(1);
  bulkSelected = signal<Set<string>>(new Set());
  bulkType = signal<BulkType>('amistosa');
  bulkChannel = signal<Channel>('email');
  bulkMessage = signal<string>('');
  bulkTypeInfo = BULK_TYPE_INFO;
  bulkTypeKeys: BulkType[] = ['amistosa', 'formal', 'burofax'];

  openBulkWizard(): void {
    this.bulkSelected.set(new Set(this.selected().size ? this.selected() : this.debtors().map(d => d.id)));
    this.bulkType.set('amistosa');
    this.bulkChannel.set('email');
    this.bulkMessage.set(this.defaultTemplate('amistosa'));
    this.bulkStep.set(1);
    this.bulkWizardOpen.set(true);
  }

  closeBulkWizard(): void {
    this.bulkWizardOpen.set(false);
  }

  bulkIsSelected(id: string): boolean {
    return this.bulkSelected().has(id);
  }

  bulkToggleSelect(id: string): void {
    this.bulkSelected.update(set => {
      const next = new Set(set);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  bulkAllSelected = computed(() => this.debtors().length > 0 && this.bulkSelected().size === this.debtors().length);

  bulkToggleSelectAll(): void {
    if (this.bulkAllSelected()) {
      this.bulkSelected.set(new Set());
    } else {
      this.bulkSelected.set(new Set(this.debtors().map(d => d.id)));
    }
  }

  bulkSelectedDebtors = computed(() => this.debtors().filter(d => this.bulkSelected().has(d.id)));

  bulkTotalCost = computed(() => {
    const info = this.bulkTypeInfo[this.bulkType()];
    return info.cost * this.bulkSelected().size;
  });

  selectBulkType(t: BulkType): void {
    this.bulkType.set(t);
    this.bulkMessage.set(this.defaultTemplate(t));
  }

  defaultTemplate(type: BulkType): string {
    if (type === 'amistosa') {
      return 'Estimado/a [Nombre],\n\nLe informamos de que su propiedad [Propiedad] presenta un saldo pendiente de [Importe]. Le rogamos regularice su situación a la mayor brevedad posible.\n\nUn saludo,\nLa Administración';
    }
    if (type === 'formal') {
      return 'Estimado/a [Nombre],\n\nPor la presente le comunicamos formalmente que la propiedad [Propiedad] mantiene una deuda de [Importe] con la comunidad, pendiente desde hace [Meses] meses.\n\nDe no recibir el pago en un plazo de 10 días, nos veremos obligados a iniciar las acciones legales correspondientes.\n\nLa Administración';
    }
    return 'Estimado/a [Nombre],\n\nMediante el presente burofax se le requiere el pago de [Importe] correspondiente a la propiedad [Propiedad], deuda pendiente desde hace [Meses] meses.\n\nDe no atender este requerimiento en un plazo de 10 días naturales, se iniciarán acciones judiciales sin más previo aviso.\n\nLa Administración';
  }

  bulkNext(): void {
    if (this.bulkStep() < 3) this.bulkStep.update(s => s + 1);
  }

  bulkBack(): void {
    if (this.bulkStep() > 1) this.bulkStep.update(s => s - 1);
  }

  bulkSend(): void {
    const count = this.bulkSelected().size;
    this.debtors.update(list => list.map(d => {
      if (!this.bulkSelected().has(d.id)) return d;
      const reminders = { ...d.reminders };
      if (this.bulkType() === 'amistosa') reminders.l1 = true;
      if (this.bulkType() === 'formal') reminders.l2 = true;
      if (this.bulkType() === 'burofax') reminders.bf = true;
      return { ...d, reminders, step: this.bulkType() === 'burofax' ? 'En reclamación' : d.step };
    }));
    this.showToast(`Reclamación enviada a ${count} propietario(s)`);
    this.bulkWizardOpen.set(false);
  }

  // ── Modal "Liquidar intereses" (fase 10 — bajo demanda, nunca con un cron) ──
  interestModalOpen = signal(false);
  interestAsOfDate = signal<string>(new Date().toISOString().slice(0, 10));
  interestCalculating = signal(false);
  interestAccruing = signal(false);
  interestCalculated = signal(false);
  interestRows = signal<InterestPreviewRow[]>([]);
  interestError = signal<string | null>(null);

  interestGrandTotal = computed(() => this.interestRows().reduce((s, r) => s + r.total, 0));
  interestReceiptCount = computed(() => this.interestRows().reduce((s, r) => s + r.receipts.length, 0));

  openInterestModal(): void {
    this.interestAsOfDate.set(new Date().toISOString().slice(0, 10));
    this.interestRows.set([]);
    this.interestCalculated.set(false);
    this.interestError.set(null);
    this.interestModalOpen.set(true);
  }

  closeInterestModal(): void {
    this.interestModalOpen.set(false);
  }

  /** Los deudores seleccionados, o todos si no hay ninguno marcado — mismo criterio que el wizard de reclamación masiva. */
  private interestTargetDebtors(): Debtor[] {
    const ids = this.selected().size ? this.selected() : new Set(this.debtors().map(d => d.id));
    return this.debtors().filter(d => ids.has(d.id) && d.propertyId);
  }

  /**
   * Un deudor puede tener varios recibos vencidos: se calcula el interés de
   * cada uno por separado (cada uno tiene su propia fecha de vencimiento) y
   * se suman. Los recibos que ya son de intereses, o que todavía no tienen
   * nada que liquidar (en carencia, o ya liquidados hasta esa fecha), se
   * omiten sin bloquear al resto.
   */
  async calculateInterest(): Promise<void> {
    this.interestCalculating.set(true);
    this.interestError.set(null);
    try {
      const estateId = this.estate.id;
      const asOfDate = this.interestAsOfDate();
      const rows: InterestPreviewRow[] = [];
      for (const debtor of this.interestTargetDebtors()) {
        const row: InterestPreviewRow = {
          debtorId: debtor.id,
          debtorName: debtor.name,
          propertyLabel: debtor.property,
          receipts: [],
          total: 0,
        };
        try {
          const cert = await this.debtorsSvc.getDebtCertificate(debtor.propertyId!);
          const candidates = cert.pendingReceipts.filter(r => !r.isInterest && r.dueDate);
          for (const r of candidates) {
            try {
              const preview = await this.lateInterestSvc.preview(estateId, r.id, asOfDate);
              if (preview.total > 0) {
                row.receipts.push({ receiptId: r.id, no: r.no, amount: preview.total });
                row.total += preview.total;
              }
            } catch {
              // Sin política configurada, o nada que liquidar todavía — se salta ese recibo.
            }
          }
        } catch (error) {
          console.error(`Error calculando intereses de ${debtor.name}`, error);
          row.error = 'No se pudo calcular';
        }
        if (row.receipts.length > 0 || row.error) rows.push(row);
      }
      this.interestRows.set(rows);
      this.interestCalculated.set(true);
    } catch (error) {
      console.error('Error calculando intereses de demora', error);
      this.interestError.set('No se pudo calcular los intereses.');
    } finally {
      this.interestCalculating.set(false);
    }
  }

  async confirmInterest(): Promise<void> {
    this.interestAccruing.set(true);
    this.interestError.set(null);
    try {
      const estateId = this.estate.id;
      const asOfDate = this.interestAsOfDate();
      let liquidated = 0;
      for (const row of this.interestRows()) {
        for (const r of row.receipts) {
          await this.lateInterestSvc.accrue(estateId, r.receiptId, asOfDate);
          liquidated++;
        }
      }
      this.interestModalOpen.set(false);
      this.showToast(`Intereses liquidados en ${liquidated} recibo${liquidated === 1 ? '' : 's'}`);
    } catch (error: any) {
      console.error('Error liquidando intereses de demora', error);
      const msg = error?.error?.message;
      this.interestError.set(typeof msg === 'string' ? msg : 'No se pudo liquidar los intereses.');
    } finally {
      this.interestAccruing.set(false);
    }
  }

  // ── Helpers comunes ──────────────────────────────────────────────────────
  statusStyle(status: string) {
    return STATUS_STYLE[status] || STATUS_STYLE['Sin gestionar'];
  }

  fmtEur(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }
  fmtEur0(n: number): string {
    return n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
  }
  fmtDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  manage(d: Debtor): void {
    this.openDrawer(d);
  }
}
