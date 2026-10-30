import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MeetingsService } from '../../../core/meetings.service';
import { PropertiesService } from '../../../core/properties.service';
import { MeetingVoteDelegationsService } from '../../../core/meeting-vote-delegations.service';
import { VoteSessionsService } from '../../../core/vote-sessions.service';
import type { OperationRow } from '../../../core/operations.service';
import type { Meeting, MeetingAttachment, VoteMajorityType } from '../../../core/models';
import {
  MAJORITY_TYPE_OPTIONS,
  suggestMajorityType,
} from '../../estate-detail/juntas-tab/meeting-detail/majority-type-suggester.util';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { MeetingDetailComponent } from '../../estate-detail/juntas-tab/meeting-detail/meeting-detail.component';
import { StatusPillComponent } from './status-pill.component';
import { MeetingSummaryTabComponent } from './tabs/summary-tab.component';
import { MeetingParticipationTabComponent } from './tabs/participation-tab.component';
import { MeetingAgendaTabComponent } from './tabs/agenda-tab.component';
import { MeetingActaTabComponent } from './tabs/acta-tab.component';
import { MeetingVotePointComponent } from './vote-point/vote-point.component';
import { MeetingCommentsModalComponent } from './comments-modal.component';
import {
  MeetingRepresentationModalComponent,
  type OwnerOption,
  type Representative,
} from './representation-modal.component';
import {
  actaSigners,
  actaStatus,
  agendaRows,
  formatShortDateTime,
  participationRows,
  participationStats,
  pointQuestions,
  type AgendaRow,
  type MeetingData,
  type ParticipationRow,
  type PointQuestion,
  type Tone,
} from './meeting-workspace.model';

export type MeetingTab = 'resumen' | 'participacion' | 'orden-del-dia' | 'acta';

const TABS: { id: MeetingTab; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'participacion', label: 'Participación' },
  { id: 'orden-del-dia', label: 'Orden del día' },
  { id: 'acta', label: 'Acta' },
];
const STATUS: Record<string, { label: string; tone: Tone }> = {
  convocada: { label: 'Convocada', tone: 'blue' },
  celebrada: { label: 'Celebrada', tone: 'yellow' },
  firmada: { label: 'Firmada', tone: 'green' },
  cancelada: { label: 'Cancelada', tone: 'muted' },
};
/** Refresco de quórum y votaciones mientras la junta sigue convocada. */
const REFRESH_MS = 20_000;
/** Refresco más rápido mientras se mira un punto con la votación abierta. */
const LIVE_VOTE_REFRESH_MS = 5_000;

/**
 * Detalle de una junta: cabecera común + 4 pestañas (Resumen, Participación,
 * Orden del día, Acta). La gestión en vivo (pase de lista, delegaciones,
 * apertura de votaciones y firma) sigue en `MeetingDetailComponent`, a la que
 * se entra desde «Revisar» en la pestaña Acta.
 */
@Component({
  selector: 'app-meeting-workspace',
  standalone: true,
  imports: [
    IconComponent,
    StatusPillComponent,
    MeetingDetailComponent,
    MeetingSummaryTabComponent,
    MeetingParticipationTabComponent,
    MeetingAgendaTabComponent,
    MeetingActaTabComponent,
    MeetingRepresentationModalComponent,
    MeetingVotePointComponent,
    MeetingCommentsModalComponent,
  ],
  templateUrl: './meeting-workspace.component.html',
  styleUrl: './meeting-workspace.component.scss',
})
export class MeetingWorkspaceComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) row!: OperationRow;
  /** El estado de la junta cambió: el listado debe refrescarse y puede mostrar un aviso. */
  @Output() changed = new EventEmitter<string>();
  /** La convocatoria o el acta no se pudieron descargar. */
  @Output() failed = new EventEmitter<string>();
  /** Editar la junta: la página abre el asistente en modo edición con la junta completa. */
  @Output() edit = new EventEmitter<Meeting>();
  /** Abrir el panel de anfitrión (videollamada). */
  @Output() openBeacon = new EventEmitter<void>();

  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly meetingsApi = inject(MeetingsService);
  private readonly propertiesApi = inject(PropertiesService);
  private readonly delegationsApi = inject(MeetingVoteDelegationsService);
  private readonly voteSessionsApi = inject(VoteSessionsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private loadVersion = 0;
  private destroyed = false;

  readonly tabs = TABS;
  readonly tab = signal<MeetingTab>('resumen');
  readonly managing = signal(false);
  /** Punto del orden del día abierto en su propia pantalla (su votación y el voto de cada propiedad). */
  private readonly votePointId = signal<string | null>(null);
  readonly votePoint = computed(() => {
    const meeting = this.meeting();
    const id = this.votePointId();
    const index = meeting && id ? meeting.agenda.findIndex((item) => item.id === id) : -1;
    return index < 0 ? null : { item: meeting!.agenda[index], number: index + 1 };
  });
  readonly menuOpen = signal(false);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly data = signal<MeetingData | null>(null);
  /** Propiedad cuya representación se está registrando o cambiando (modal abierto). */
  readonly representing = signal<ParticipationRow | null>(null);
  readonly representationError = signal('');
  /** Punto cuyos comentarios se están editando (modal abierto). */
  readonly commenting = signal<AgendaRow | null>(null);
  readonly commentsError = signal('');
  /** Propietarios de la comunidad que pueden ser representante; `null` hasta cargarlos. */
  readonly owners = signal<OwnerOption[] | null>(null);

  readonly meeting = computed(() => this.data()?.meeting ?? null);
  readonly status = computed(
    () => STATUS[this.meeting()?.status ?? this.row.status] ?? { label: this.row.statusLabel, tone: 'muted' as Tone },
  );
  /** Titular elegido a mano en propiedades con varios (`propertyId → userId`). */
  private readonly holderChoice = signal<Record<string, string>>({});
  readonly rows = computed(() => (this.data() ? participationRows(this.data()!, this.holderChoice()) : []));
  readonly stats = computed(() => participationStats(this.data()!, this.rows()));
  readonly agenda = computed(() => agendaRows(this.data()!));
  readonly acta = computed(() => actaStatus(this.meeting()!));
  readonly signers = computed(() => actaSigners(this.meeting()!));
  readonly convocada = computed(() => this.meeting()?.status === 'convocada');
  /** El backend no deja celebrar una junta antes de su primera convocatoria. */
  readonly celebrationHint = computed(() => {
    const meeting = this.meeting();
    if (!meeting || meeting.status !== 'convocada') return null;
    return new Date(meeting.scheduledAt1).getTime() > Date.now() ? `Disponible desde la 1ª convocatoria (${formatShortDateTime(meeting.scheduledAt1)}).` : null;
  });
  /** Con alguna votación abierta o cerrada la junta ya no se puede editar. */
  readonly hasVotes = computed(() => (this.data()?.voteSessions.length ?? 0) > 0);
  readonly impugnacionDaysLeft = computed(() => {
    const distributedAt = this.meeting()?.actaDistributedAt;
    if (!distributedAt) return null;
    const deadline = new Date(distributedAt);
    deadline.setMonth(deadline.getMonth() + 3);
    return Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
  });

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    let sinceLastRefresh = 0;
    this.refreshTimer = setInterval(() => {
      sinceLastRefresh += LIVE_VOTE_REFRESH_MS;
      if (!this.convocada() || this.managing()) return;
      if (this.watchingOpenVote() || sinceLastRefresh >= REFRESH_MS) {
        sinceLastRefresh = 0;
        void this.load(false);
      }
    }, LIVE_VOTE_REFRESH_MS);
  }

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['row'];
    if (!change) return;
    if (change.previousValue?.id !== change.currentValue?.id) {
      this.tab.set('resumen');
      this.managing.set(false);
      this.votePointId.set(null);
      this.menuOpen.set(false);
      this.data.set(null);
      this.representing.set(null);
      this.commenting.set(null);
      this.owners.set(null);
      void this.load(true);
    } else if (this.isStale()) {
      // El listado trae datos más nuevos que los cargados (p. ej. tras editar la junta).
      void this.load(false);
    }
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  /** ¿Se está mirando un punto cuya votación sigue abierta? */
  private watchingOpenVote(): boolean {
    const point = this.votePoint();
    if (!point) return false;
    return (this.data()?.voteSessions ?? []).some(
      (session) => session.agendaItemId === point.item.id && session.status === 'abierta',
    );
  }

  private isStale(): boolean {
    const loaded = this.data()?.meeting;
    return (
      !!loaded &&
      (loaded.title !== this.row.title ||
        loaded.status !== this.row.status ||
        loaded.scheduledAt1 !== this.row.date ||
        (loaded.location ?? '') !== this.row.location ||
        JSON.stringify(loaded.agenda) !== JSON.stringify(this.row.agenda))
    );
  }

  /** `initial` muestra el estado de carga; los refrescos periódicos son silenciosos. */
  async load(initial: boolean): Promise<void> {
    const version = ++this.loadVersion;
    if (initial) {
      this.loading.set(true);
      this.error.set('');
    }
    const id = this.row.id;
    try {
      const [meeting, quorum, attendance, properties, delegations, voteSessions, attachments, holders] = await Promise.all([
        this.meetingsApi.findMeetingById(id),
        this.meetingsApi.getMeetingQuorum(id),
        this.meetingsApi.listMeetingAttendance(id),
        this.propertiesApi.listPropertiesByEstate(this.row.estate.id),
        this.delegationsApi.list(id),
        this.voteSessionsApi.list(id),
        this.meetingsApi.listMeetingAttachments(id),
        // Solo adorna la participación con los nombres: si falla, se muestra como antes.
        this.meetingsApi.listRollCallHolders(id).catch(() => undefined),
      ]);
      if (this.destroyed || version !== this.loadVersion) return;
      this.data.set({ meeting, quorum, attendance, properties, delegations, voteSessions, attachments, holders });
      this.error.set('');
    } catch {
      if (this.destroyed || version !== this.loadVersion) return;
      if (initial || !this.data()) this.error.set('No se pudo cargar el detalle de la junta.');
    } finally {
      if (!this.destroyed && version === this.loadVersion) this.loading.set(false);
    }
  }

  // ── Navegación ───────────────────────────────────────────────────────────

  selectTab(tab: MeetingTab): void {
    this.tab.set(tab);
  }

  onTabKeydown(event: KeyboardEvent, index: number): void {
    const last = TABS.length - 1;
    const next =
      event.key === 'ArrowRight' ? (index + 1) % TABS.length
      : event.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : -1;
    if (next < 0) return;
    event.preventDefault();
    this.selectTab(TABS[next].id);
    this.host.nativeElement.querySelector<HTMLElement>(`#meeting-tab-${TABS[next].id}`)?.focus();
  }

  editMeeting(): void {
    this.menuOpen.set(false);
    const meeting = this.meeting();
    if (meeting?.status === 'convocada' && !this.hasVotes()) this.edit.emit(meeting);
  }

  /** Quita la marca de «tratado» de un punto sin votación (se puede volver a marcar, no pide confirmación). */
  async unmarkPointTreated(row: AgendaRow): Promise<void> {
    if (this.busy() || !this.convocada()) return;
    this.busy.set(true);
    try {
      await this.meetingsApi.clearAgendaItemTreated(this.row.id, row.id);
      await this.load(false);
      this.changed.emit('Marca de tratado quitada.');
    } catch (error: unknown) {
      this.failed.emit(this.errorMessage(error, 'No se pudo quitar la marca de tratado.'));
    } finally {
      this.busy.set(false);
    }
  }

  openComments(row: AgendaRow): void {
    this.commentsError.set('');
    this.commenting.set(row);
  }

  closeComments(): void {
    this.commenting.set(null);
  }

  /** Guarda los comentarios del punto (salen en el acta); un texto vacío los borra. */
  async saveComments(text: string): Promise<void> {
    const row = this.commenting();
    if (!row || this.busy()) return;
    this.busy.set(true);
    this.commentsError.set('');
    try {
      await this.meetingsApi.setAgendaItemComments(this.row.id, row.id, text);
      this.commenting.set(null);
      await this.load(false);
      this.changed.emit(text.trim() ? 'Comentarios guardados.' : 'Comentarios eliminados.');
    } catch (error: unknown) {
      this.commentsError.set(this.errorMessage(error, 'No se pudieron guardar los comentarios.'));
    } finally {
      this.busy.set(false);
    }
  }

  /** Da por tratado un punto sin votación, previa confirmación. */
  async markPointTreated(row: AgendaRow): Promise<void> {
    if (this.busy() || !this.convocada()) return;
    const confirmed = await this.confirmDialog.ask({
      title: 'Marcar punto como tratado',
      message: `Se registrará el punto "${row.title}" como tratado en la junta.`,
      confirmLabel: 'Marcar como tratado',
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await this.meetingsApi.markAgendaItemTreated(this.row.id, row.id);
      await this.load(false);
      this.changed.emit('Punto marcado como tratado.');
    } catch (error: unknown) {
      this.failed.emit(this.errorMessage(error, 'No se pudo marcar el punto como tratado.'));
    } finally {
      this.busy.set(false);
    }
  }

  openPoint(row: AgendaRow): void {
    this.votePointId.set(row.id);
  }

  /** Abre desde el orden del día la votación de cada pregunta votable del punto que aún no se haya votado. */
  async startPointVote(row: AgendaRow): Promise<void> {
    const item = this.data()?.meeting.agenda.find((candidate) => candidate.id === row.id);
    if (!item || this.busy() || !this.convocada()) return;
    const pending = pointQuestions(item, this.data()?.voteSessions ?? []).filter((question) => !question.session);
    if (!pending.length) return;
    const majorityOf = (question: PointQuestion) =>
      question.majorityType ?? suggestMajorityType(item.title, question.title).type;
    const confirmed = await this.confirmDialog.ask({
      title: 'Iniciar votación',
      message:
        pending.length === 1
          ? `Se abrirá la votación de «${pending[0].title}» con ${this.majorityLabel(majorityOf(pending[0])).toLowerCase()} y se avisará a los propietarios por correo.`
          : `Se abrirá la votación de las ${pending.length} preguntas del punto y se avisará a los propietarios por correo.`,
      confirmLabel: 'Iniciar votación',
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      for (const question of pending) {
        await this.voteSessionsApi.open(this.row.id, {
          agendaItemId: item.id,
          questionIndex: question.questionIndex,
          majorityType: majorityOf(question),
        });
      }
      await this.load(false);
      this.changed.emit('Votación abierta.');
    } catch (error: unknown) {
      await this.load(false);
      this.failed.emit(this.errorMessage(error, 'No se pudo abrir la votación.'));
    } finally {
      this.busy.set(false);
    }
  }

  private majorityLabel(type: VoteMajorityType): string {
    return MAJORITY_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
  }

  /** Cierra desde el orden del día las votaciones abiertas del punto (puede tener varias preguntas). */
  async closePointVote(row: AgendaRow): Promise<void> {
    if (this.busy()) return;
    const open = (this.data()?.voteSessions ?? []).filter(
      (session) => session.agendaItemId === row.id && session.status === 'abierta',
    );
    if (!open.length) return;
    const confirmed = await this.confirmDialog.ask({
      title: 'Cerrar la votación',
      message: 'Se cerrará la votación y se calculará el resultado. No se puede deshacer.',
      confirmLabel: 'Cerrar votación',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await Promise.all(open.map((session) => this.voteSessionsApi.close(this.row.id, session.id)));
      await this.load(false);
      this.changed.emit('Votación cerrada.');
    } catch (error: unknown) {
      this.failed.emit(this.errorMessage(error, 'No se pudo cerrar la votación.'));
    } finally {
      this.busy.set(false);
    }
  }

  closePoint(): void {
    this.votePointId.set(null);
  }

  /** Se abrió o cerró una votación desde el detalle del punto. */
  async onVoteChanged(message: string): Promise<void> {
    await this.load(false);
    this.changed.emit(message);
  }

  /** Se guardó una versión del acta: la junta vigente cambió (textos del acta y comentarios de los puntos). */
  async onActaSaved(message: string): Promise<void> {
    await this.load(false);
    this.changed.emit(message);
  }

  enterManagement(): void {
    this.menuOpen.set(false);
    this.managing.set(true);
  }

  leaveManagement(): void {
    this.managing.set(false);
    void this.load(false);
  }

  // ── Menú de acciones ─────────────────────────────────────────────────────

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  @HostListener('document:click', ['$event'])
  closeMenuOnOutsideClick(event: Event): void {
    if (this.menuOpen() && !(event.target as HTMLElement).closest('.actions-menu'))
      this.menuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  closeMenuOnEscape(): void {
    if (this.menuOpen()) {
      this.menuOpen.set(false);
      this.host.nativeElement.querySelector<HTMLElement>('.actions-menu__trigger')?.focus();
    }
  }

  // ── Acciones ─────────────────────────────────────────────────────────────

  async closeMeeting(status: 'celebrada' | 'cancelada'): Promise<void> {
    this.menuOpen.set(false);
    if (this.busy() || !this.convocada()) return;
    const celebrada = status === 'celebrada';
    if (celebrada && this.celebrationHint()) return;
    const confirmed = await this.confirmDialog.ask({
      title: celebrada ? 'Marcar como celebrada' : 'Cancelar junta',
      message: celebrada
        ? `La junta "${this.row.title}" pasará a celebrada. Ya no se podrá cambiar.`
        : `Se cancelará la junta "${this.row.title}". Ya no se podrá cambiar.`,
      confirmLabel: celebrada ? 'Marcar como celebrada' : 'Cancelar junta',
      cancelLabel: 'Volver',
      tone: celebrada ? 'primary' : 'danger',
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await this.meetingsApi.updateMeetingStatus(this.row.id, status);
      await this.load(false);
      this.changed.emit(status === 'celebrada' ? 'Junta marcada como celebrada.' : 'Junta cancelada.');
    } catch (error: unknown) {
      const message = (error as { error?: { message?: unknown } })?.error?.message;
      this.failed.emit(
        typeof message === 'string' ? message : 'No se pudo actualizar el estado de la junta.',
      );
    } finally {
      this.busy.set(false);
    }
  }

  /** PDF de la versión actual del acta (sale del modelo guardado de la versión). */
  async downloadActaPdf(versionId?: string): Promise<void> {
    try {
      this.saveBlob(await this.meetingsApi.downloadActaPdf(this.row.id, versionId), `acta-${this.row.title.replace(/\s+/g, '-')}.pdf`);
    } catch {
      this.failed.emit('No se pudo descargar el PDF del acta.');
    }
  }

  async downloadActa(): Promise<void> {
    try {
      const blob = await this.meetingsApi.downloadActa(this.row.id);
      // Un acta subida firmada puede ser un PDF: la extensión sigue al tipo del archivo.
      this.saveBlob(blob, `acta-${this.row.title.replace(/\s+/g, '-')}.${blob.type === 'application/pdf' ? 'pdf' : 'docx'}`);
    } catch {
      this.failed.emit('No se pudo descargar el acta.');
    }
  }

  /** El archivo que se subió como acta, con su nombre original. */
  async downloadActaUpload(fileName: string): Promise<void> {
    try {
      this.saveBlob(await this.meetingsApi.downloadActaUpload(this.row.id), fileName);
    } catch {
      this.failed.emit('No se pudo descargar el acta subida.');
    }
  }

  /** Sube los documentos elegidos uno a uno y recarga la lista; un fallo no impide subir el resto. */
  async attachFiles(files: File[]): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    const failed: string[] = [];
    let reason = '';
    for (const file of files) {
      try {
        await this.meetingsApi.uploadMeetingAttachment(this.row.id, file);
      } catch (error: unknown) {
        failed.push(file.name);
        const message = (error as { error?: { message?: unknown } })?.error?.message;
        if (typeof message === 'string') reason = message;
      }
    }
    await this.load(false);
    this.busy.set(false);
    if (failed.length)
      this.failed.emit(`No se pudo adjuntar: ${failed.join(', ')}.${reason ? ' ' + reason : ''}`);
    else
      this.changed.emit(files.length === 1 ? 'Documento adjuntado.' : `${files.length} documentos adjuntados.`);
  }

  async downloadAttachment(attachment: MeetingAttachment): Promise<void> {
    try {
      this.saveBlob(await this.meetingsApi.downloadMeetingAttachment(this.row.id, attachment.id), attachment.title);
    } catch {
      this.failed.emit('No se pudo descargar el documento.');
    }
  }

  async removeAttachment(attachment: MeetingAttachment): Promise<void> {
    if (this.busy()) return;
    const confirmed = await this.confirmDialog.ask({
      title: 'Eliminar documento',
      message: `Se eliminará "${attachment.title}" de la junta.`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      await this.meetingsApi.deleteMeetingAttachment(this.row.id, attachment.id);
      await this.load(false);
      this.changed.emit('Documento eliminado.');
    } catch {
      this.failed.emit('No se pudo eliminar el documento.');
    } finally {
      this.busy.set(false);
    }
  }

  // ── Participación: menú «⋯» de cada propietario ──────────────────────────

  /** Marca la propiedad como presente (el titular asiste); si estaba representada, retira al representante. */
  markPresent(row: ParticipationRow): Promise<void> {
    return this.runParticipation(`Propiedad ${row.unit} marcada como presente.`, async () => {
      // Antes de tocar nada: sin titular vinculado no hay a quién pasar lista.
      const holderId = row.holderUserId ?? (await this.holderOf(row));
      await this.dropRepresentation(row);
      await this.meetingsApi.markRollCall(this.row.id, row.propertyId, holderId);
    });
  }

  /**
   * Elige cuál de los titulares de la propiedad es quien asiste. Si aún no hay nadie presente solo
   * se recuerda la elección (se usará al marcarla como presente); si ya asistía otro titular, pasa a
   * asistir el elegido.
   */
  chooseHolder(row: ParticipationRow, userId: string): Promise<void> {
    this.holderChoice.update((choice) => ({ ...choice, [row.propertyId]: userId }));
    if (row.status !== 'presente' || row.holderUserId === userId) return Promise.resolve();
    const name = row.holders?.find((holder) => holder.userId === userId)?.name ?? 'el titular elegido';
    return this.runParticipation(`Propiedad ${row.unit}: asiste ${name}.`, async () => {
      const attendance = await this.meetingsApi.markRollCall(this.row.id, row.propertyId, userId);
      await this.undoAttendance(row.attendanceIds.filter((id) => id !== attendance.id));
    });
  }

  /** Marca la propiedad como ausente: deshace la asistencia y cualquier representación. */
  markAbsent(row: ParticipationRow): Promise<void> {
    return this.runParticipation(`Propiedad ${row.unit} marcada como ausente.`, async () => {
      if (row.delegationId) await this.delegationsApi.revoke(this.row.id, row.delegationId, 'Titular ausente');
      await this.undoAttendance(row.attendanceIds);
    });
  }

  removeRepresentation(row: ParticipationRow): Promise<void> {
    return this.runParticipation(`Representación de la propiedad ${row.unit} eliminada.`, () =>
      this.dropRepresentation(row),
    );
  }

  /** Abre el modal para registrar la representación (o cambiar el representante). */
  openRepresentation(row: ParticipationRow): void {
    this.representationError.set('');
    this.representing.set(row);
    if (this.owners() !== null) return;
    this.meetingsApi
      .listEstateOwnerEmails(this.row.estate.id)
      .then((owners) => this.owners.set(owners.filter((owner) => owner.isOwner !== false)))
      // Sin lista de propietarios solo se puede indicar a una persona externa.
      .catch(() => this.owners.set([]));
  }

  closeRepresentation(): void {
    this.representing.set(null);
  }

  async confirmRepresentation(representative: Representative): Promise<void> {
    const row = this.representing();
    if (!row || this.busy()) return;
    this.busy.set(true);
    this.representationError.set('');
    try {
      const delegatorUserId = await this.holderOf(row);
      await this.delegationsApi.create(this.row.id, {
        propertyId: row.propertyId,
        delegatorUserId,
        ...(representative.owner
          ? { representativeEmail: representative.owner.email }
          : {
              representativeName: representative.external!.name,
              representativeDni: representative.external!.dni,
            }),
      });
      // El representante anterior deja de asistir por esta propiedad.
      await this.undoAttendance(row.representativeAttendanceIds);
      this.representing.set(null);
      await this.load(false);
      this.changed.emit(
        row.status === 'representado'
          ? `Representante de la propiedad ${row.unit} cambiado.`
          : `Representación de la propiedad ${row.unit} registrada.`,
      );
    } catch (error: unknown) {
      this.representationError.set(this.errorMessage(error, 'No se pudo registrar la representación.'));
    } finally {
      this.busy.set(false);
    }
  }

  private async runParticipation(success: string, action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await action();
      this.changed.emit(success);
    } catch (error: unknown) {
      this.failed.emit(this.errorMessage(error, 'No se pudo actualizar la participación.'));
    } finally {
      await this.load(false);
      this.busy.set(false);
    }
  }

  /** Titular con voto de la propiedad: a quien se pasa lista y en cuyo nombre se delega. */
  private async holderOf(row: ParticipationRow): Promise<string> {
    const eligible = await this.meetingsApi.listRollCallEligible(this.row.id, row.propertyId);
    const holder = eligible.find((entry) => entry.kind === 'own');
    if (!holder) throw new Error(`La propiedad ${row.unit} no tiene ningún titular vinculado con derecho de voto.`);
    return holder.userId;
  }

  /** Revoca la delegación vigente y retira la asistencia que hubiera registrado el representante. */
  private async dropRepresentation(row: ParticipationRow): Promise<void> {
    if (!row.delegationId) return;
    await this.delegationsApi.revoke(this.row.id, row.delegationId, 'Representación retirada');
    await this.undoAttendance(row.representativeAttendanceIds);
  }

  private async undoAttendance(attendanceIds: string[]): Promise<void> {
    for (const id of attendanceIds) await this.meetingsApi.undoRollCall(this.row.id, id);
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message;
    const message = (error as { error?: { message?: unknown } })?.error?.message;
    return typeof message === 'string' ? message : fallback;
  }

  async sendActa(): Promise<void> {
    if (this.busy()) return;
    const confirmed = await this.confirmDialog.ask({
      title: 'Enviar el acta',
      message: 'Se enviará el acta a todos los propietarios de la finca.',
      confirmLabel: 'Enviar acta',
    });
    if (!confirmed) return;
    this.busy.set(true);
    try {
      const { sentCount } = await this.meetingsApi.sendActaNotice(this.row.id);
      await this.load(false);
      this.changed.emit(`Acta enviada a ${sentCount} propietario(s).`);
    } catch {
      this.failed.emit('No se pudo enviar el acta.');
    } finally {
      this.busy.set(false);
    }
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  address(): string {
    const estate = this.row.estate;
    return [[estate.address, estate.streetNumber].filter(Boolean).join(' '), estate.location]
      .filter(Boolean)
      .join(', ');
  }
}
