import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { VoteSessionsService } from '../../../../core/vote-sessions.service';
import type { AgendaItem, VoteMajorityType, VoteResponseEntry, VoteSession } from '../../../../core/models';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import {
  MAJORITY_TYPE_OPTIONS,
  suggestMajorityType,
} from '../../../estate-detail/juntas-tab/meeting-detail/majority-type-suggester.util';
import { customOptionColor } from '../../../../shared/vote-option-colors';
import { MeetingCardComponent } from '../meeting-card.component';
import { StatusPillComponent } from '../status-pill.component';
import { MeetingVoteRegistrationModalComponent, type RegisteredChoice } from './vote-registration-modal.component';
import {
  formatDateTime,
  formatPercent,
  pointQuestions,
  voteRows,
  type ParticipationRow,
  type PointQuestion,
  type Tone,
  type VoteRow,
  type VoteState,
} from '../meeting-workspace.model';

const EUROS = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const STATE_LABEL: Record<VoteState, string> = {
  voted: 'Ha votado',
  pending: 'Sin votar',
  absent: 'Ausente',
};
const STATE_TONE: Record<VoteState, Tone> = { voted: 'green', pending: 'yellow', absent: 'muted' };
const OPTION_TONES: Tone[] = ['green', 'red', 'muted'];

/**
 * Detalle de UN punto del orden del día con votación: su resultado y, para cada
 * propiedad, qué votó y quién emitió el voto. Desde aquí se abre y se cierra la
 * votación de cada pregunta del punto.
 */
@Component({
  selector: 'app-meeting-vote-point',
  standalone: true,
  imports: [IconComponent, BtnComponent, MeetingCardComponent, StatusPillComponent, MeetingVoteRegistrationModalComponent],
  templateUrl: './vote-point.component.html',
  styleUrl: './vote-point.component.scss',
})
export class MeetingVotePointComponent implements OnChanges {
  @Input({ required: true }) meetingId!: string;
  @Input({ required: true }) item!: AgendaItem;
  /** Posición del punto en el orden del día (1 = primero). */
  @Input() number = 1;
  @Input() sessions: VoteSession[] = [];
  /** Participación de cada propiedad: de ahí salen presentes, ausentes y representados. */
  @Input() participation: ParticipationRow[] = [];
  /** Solo se puede abrir o cerrar una votación mientras la junta está convocada. */
  @Input() canManage = false;
  @Output() back = new EventEmitter<void>();
  /** Se abrió o cerró una votación: la junta debe recargarse. */
  @Output() changed = new EventEmitter<string>();
  @Output() failed = new EventEmitter<string>();

  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly api = inject(VoteSessionsService);
  private loadVersion = 0;

  readonly percent = formatPercent;
  readonly dateTime = formatDateTime;
  readonly stateLabel = STATE_LABEL;
  readonly stateTone = STATE_TONE;
  readonly questions = signal<PointQuestion[]>([]);
  /** Votos ya emitidos, por sesión; `null` = aún cargando, `'error'` = no se pudieron cargar. */
  readonly responses = signal<Record<string, VoteResponseEntry[] | 'error'>>({});
  readonly busy = signal(false);
  /** Voto que la gestora está registrando o cambiando (modal abierto). */
  readonly registering = signal<{ row: VoteRow; question: PointQuestion; overrideDebt: boolean } | null>(null);
  /** Deuda vencida por propiedad (art. 15.2 LPH): quien debe no puede votar salvo que la gestora lo anule. */
  readonly debts = signal<Record<string, number>>({});
  readonly registerError = signal('');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['item'] || changes['sessions']) {
      this.questions.set(pointQuestions(this.item, this.sessions));
      void this.loadResponses();
      void this.loadDebts();
    }
  }

  private async loadDebts(): Promise<void> {
    try {
      const debts = await this.api.listDebts(this.meetingId);
      this.debts.set(Object.fromEntries(debts.map((debt) => [debt.propertyId, debt.amount])));
    } catch {
      // Sin el dato no se bloquea nada en pantalla: el backend sigue rechazando el voto de quien debe.
      this.debts.set({});
    }
  }

  /** Deuda vencida de la propiedad de esa fila, o 0 si está al corriente. */
  debtOf(row: VoteRow): number {
    return this.debts()[row.propertyId] ?? 0;
  }

  private async loadResponses(): Promise<void> {
    const version = ++this.loadVersion;
    const sessions = this.questions().flatMap((question) => (question.session ? [question.session] : []));
    const entries = await Promise.all(
      sessions.map(async (session): Promise<[string, VoteResponseEntry[] | 'error']> => {
        try {
          return [session.id, await this.api.listResponses(this.meetingId, session.id)];
        } catch {
          return [session.id, 'error'];
        }
      }),
    );
    if (version === this.loadVersion) this.responses.set(Object.fromEntries(entries));
  }

  rowsFor(question: PointQuestion): VoteRow[] | 'error' | null {
    const session = question.session;
    if (!session) return null;
    const loaded = this.responses()[session.id];
    if (loaded === undefined) return null;
    return loaded === 'error' ? 'error' : voteRows(this.participation, loaded, question.options, question.type);
  }

  votedCount(rows: VoteRow[]): number {
    return rows.filter((row) => row.state === 'voted').length;
  }

  // ── Resultado ────────────────────────────────────────────────────────────

  tally(question: PointQuestion): { label: string; count: number; percent: number; tone: Tone; color: string | null }[] {
    const session = question.session;
    if (!session) return [];
    const result = session.status === 'abierta' ? session.liveTally : session.resultSummary;
    const counts = question.options.map(
      (_, index) => result?.optionTally.find((entry) => entry.optionIndex === index)?.propertyCount ?? 0,
    );
    const total = counts.reduce((sum, count) => sum + count, 0);
    return question.options.map((label, index) => ({
      label,
      count: counts[index],
      percent: total ? Math.round((counts[index] / total) * 100) : 0,
      tone: OPTION_TONES[index] ?? 'muted',
      color: customOptionColor(question, index),
    }));
  }

  majorityLabel(type: VoteMajorityType): string {
    return MAJORITY_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
  }

  /**
   * Mayoría con la que se abrirá la votación: la fijada al preparar la junta. Solo las
   * juntas anteriores, cuya pregunta no la fijó, usan la sugerida a partir del texto del punto.
   */
  majorityFor(question: PointQuestion): VoteMajorityType {
    return question.majorityType ?? suggestMajorityType(this.item.title, question.title).type;
  }

  majorityLegend(type: VoteMajorityType): string {
    return MAJORITY_TYPE_OPTIONS.find((option) => option.value === type)?.legend ?? '';
  }

  // ── Registrar el voto de un vecino ───────────────────────────────────────

  /** Solo con la votación abierta y para propiedades presentes o representadas, nunca ausentes. */
  canRegister(question: PointQuestion, row: VoteRow): boolean {
    return this.canManage && question.session?.status === 'abierta' && row.status !== 'ausente';
  }

  startRegister(question: PointQuestion, row: VoteRow, overrideDebt = false): void {
    this.registerError.set('');
    this.registering.set({ row, question, overrideDebt });
  }

  /**
   * «Deuda pendiente»: la propiedad no tiene derecho de voto (art. 15.2 LPH). Se informa del importe y de lo
   * que dice la ley; solo si la gestora lo confirma se abre el registro del voto, anulando la privación.
   */
  async showDebt(question: PointQuestion, row: VoteRow): Promise<void> {
    const owed = this.debtOf(row);
    const confirmed = await this.confirmDialog.ask({
      title: 'Deuda pendiente',
      message:
        `La propiedad ${row.unit} tiene una deuda vencida de ${EUROS.format(owed)} con la comunidad.\n\n` +
        'Art. 15.2 LPH: los propietarios que, al iniciarse la junta, no estén al corriente de las deudas vencidas con la comunidad ' +
        '(y no las hayan impugnado judicialmente ni consignado judicial o notarialmente) pueden participar en las deliberaciones, ' +
        'pero no tienen derecho de voto. La privación del voto debe constar expresamente en el acta.\n\n' +
        '¿Quieres registrar su voto igualmente? Solo debería hacerse si la deuda está impugnada o consignada. Quedará constancia de la anulación.',
      confirmLabel: 'Registrar voto igualmente',
      cancelLabel: 'No registrar',
      tone: 'danger',
    });
    if (confirmed) this.startRegister(question, row, true);
  }

  cancelRegister(): void {
    this.registering.set(null);
  }

  async confirmRegister(choice: RegisteredChoice): Promise<void> {
    const target = this.registering();
    const session = target?.question.session;
    if (!target || !session || this.busy()) return;
    this.busy.set(true);
    this.registerError.set('');
    try {
      await this.api.registerVote(this.meetingId, session.id, {
        propertyId: target.row.propertyId,
        ...choice,
        ...(target.overrideDebt ? { overrideDebt: true } : {}),
      });
      this.registering.set(null);
      this.changed.emit(`Voto de la propiedad ${target.row.unit} registrado.`);
    } catch (error: unknown) {
      this.registerError.set(this.errorMessage(error, 'No se pudo registrar el voto.'));
    } finally {
      this.busy.set(false);
    }
  }

  // ── Abrir y cerrar la votación ───────────────────────────────────────────

  /** Abre la votación con la mayoría ya definida en la junta (sin volver a preguntarla), tras confirmar. */
  /** Hay al menos una propiedad presente o representada que pueda votar. */
  hasParticipants(): boolean {
    return this.participation.some((row) => row.status !== 'ausente');
  }

  async start(question: PointQuestion): Promise<void> {
    if (this.busy() || !this.hasParticipants()) return;
    const majority = this.majorityFor(question);
    const confirmed = await this.confirmDialog.ask({
      title: 'Iniciar votación',
      message: `Se abrirá la votación de «${question.title}» con ${this.majorityLabel(majority).toLowerCase()} y se avisará a los propietarios por correo.`,
      confirmLabel: 'Iniciar votación',
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await this.api.open(this.meetingId, {
        agendaItemId: this.item.id,
        questionIndex: question.questionIndex,
        majorityType: majority,
      });
      this.changed.emit('Votación abierta.');
    } catch (error: unknown) {
      this.failed.emit(this.errorMessage(error, 'No se pudo abrir la votación.'));
    } finally {
      this.busy.set(false);
    }
  }

  async close(session: VoteSession): Promise<void> {
    if (this.busy()) return;
    const confirmed = await this.confirmDialog.ask({
      title: 'Cerrar la votación',
      message: 'Se cerrará la votación y se calculará el resultado. No se puede deshacer.',
      confirmLabel: 'Cerrar votación',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await this.api.close(this.meetingId, session.id);
      this.changed.emit('Votación cerrada.');
    } catch (error: unknown) {
      this.failed.emit(this.errorMessage(error, 'No se pudo cerrar la votación.'));
    } finally {
      this.busy.set(false);
    }
  }

  private errorMessage(error: unknown, fallback: string): string {
    const message = (error as { error?: { message?: unknown } })?.error?.message;
    return typeof message === 'string' ? message : fallback;
  }
}
