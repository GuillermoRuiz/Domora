import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import { Component, Input, OnDestroy, OnInit, Output, EventEmitter, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { BadgeComponent } from '../../../../shared/components/badge/badge.component';
import { ToggleComponent } from '../../../../shared/components/toggle/toggle.component';
import { RegisterDelegationModalComponent } from '../../../../shared/components/register-delegation-modal/register-delegation-modal.component';
import { MeetingsService } from '../../../../core/meetings.service';
import { PropertiesService } from '../../../../core/properties.service';
import { MeetingVoteDelegationsService } from '../../../../core/meeting-vote-delegations.service';
import { VoteSessionsService } from '../../../../core/vote-sessions.service';
import { MAJORITY_TYPE_OPTIONS, suggestMajorityType } from './majority-type-suggester.util';
import {
  Meeting, MeetingAttendee, MeetingVoteDelegation, QuorumResult, EligibleAttendee, OwnerProperty,
  VoteSession, VoteMajorityType,
} from '../../../../core/models';

import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
/** Refresco del quórum mientras la pantalla está abierta — mismo idioma de intervalo que MeetingPollingService, sin necesitar infraestructura nueva. */
const QUORUM_REFRESH_MS = 20_000;

/**
 * Detalle de una junta (Fase 1: quórum real). Vive dentro de `juntas-tab/`
 * — self-contained, mismo criterio que el resto de pestañas de
 * `estate-detail`. Tres secciones: quórum, pase de lista y delegaciones.
 */
@Component({
  selector: 'app-meeting-detail',
  standalone: true,
  imports: [FormsModule, IconComponent, BtnComponent, BadgeComponent, ToggleComponent, RegisterDelegationModalComponent, SelectDropdownDirective],
  templateUrl: './meeting-detail.component.html',
  styleUrl: './meeting-detail.component.scss',
})
export class MeetingDetailComponent implements OnInit, OnDestroy {
  @Input({ required: true }) meetingId!: string;
  @Input({ required: true }) estateId!: string;
  /** Oculta quórum, pase de lista y delegaciones: el detalle de la junta (Operaciones) los gestiona en su pestaña Participación. */
  @Input() votingOnly = false;
  @Output() closed = new EventEmitter<void>();

  private readonly meetingsSvc = inject(MeetingsService);
  private readonly propertiesSvc = inject(PropertiesService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly delegationsSvc = inject(MeetingVoteDelegationsService);
  private readonly voteSessionsSvc = inject(VoteSessionsService);

  loading = signal(true);
  meeting = signal<Meeting | null>(null);
  quorum = signal<QuorumResult | null>(null);
  attendance = signal<MeetingAttendee[]>([]);
  properties = signal<OwnerProperty[]>([]);
  delegations = signal<MeetingVoteDelegation[]>([]);
  toastMessage = signal<string | null>(null);

  // ── Votación real (Fase 2.1) ─────────────────────────────────────────
  voteSessions = signal<VoteSession[]>([]);
  /** Motivo del heurístico de sugerencia (ver majority-type-suggester.util.ts) — fijo mientras el selector está abierto, no se re-evalúa si la gestora cambia el tipo a mano. */
  majoritySuggestionReason = signal<string | null>(null);
  votingBusy = signal(false);
  readonly majorityTypeOptions = MAJORITY_TYPE_OPTIONS;

  // ── Pase de lista ──────────────────────────────────────────────────
  rollCallPropertyId = signal<string | null>(null);
  rollCallEligible = signal<EligibleAttendee[]>([]);
  rollCallSelectedUserId = signal<string | null>(null);
  rollCallBusy = signal(false);

  // ── Delegaciones ───────────────────────────────────────────────────
  showDelegationModal = signal(false);

  // ── Acta digital (Fase 2.2) ───────────────────────────────────────────
  presidenteEmail = signal('');
  secretarioEmail = signal('');
  actaBusy = signal(false);
  /** El acta ya se preparó para firma («Enviada a firma»): hasta entonces nadie puede firmar. */
  actaReadyForSignature = signal(false);

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  async ngOnInit(): Promise<void> {
    await this.reload();
    this.refreshTimer = setInterval(() => {
      if (this.meeting()?.status === 'convocada') void this.reloadQuorumAndAttendance();
    }, QUORUM_REFRESH_MS);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const [meeting, quorum, attendance, properties, delegations, voteSessions] = await Promise.all([
        this.meetingsSvc.findMeetingById(this.meetingId),
        this.meetingsSvc.getMeetingQuorum(this.meetingId),
        this.meetingsSvc.listMeetingAttendance(this.meetingId),
        this.propertiesSvc.listPropertiesByEstate(this.estateId),
        this.delegationsSvc.list(this.meetingId),
        this.voteSessionsSvc.list(this.meetingId),
      ]);
      this.meeting.set(meeting);
      this.quorum.set(quorum);
      this.attendance.set(attendance);
      this.properties.set(properties);
      this.delegations.set(delegations);
      this.voteSessions.set(voteSessions);
      if (meeting.status === 'celebrada') void this.loadActaReadiness();
    } catch (error) {
      console.error('Error cargando el detalle de la junta', error);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadActaReadiness(): Promise<void> {
    try {
      const state = await this.meetingsSvc.getActa(this.meetingId);
      this.actaReadyForSignature.set(state.version?.status === 'readyForSignature');
    } catch {
      this.actaReadyForSignature.set(false);
    }
  }

  async reloadQuorumAndAttendance(): Promise<void> {
    try {
      const [quorum, attendance, voteSessions] = await Promise.all([
        this.meetingsSvc.getMeetingQuorum(this.meetingId),
        this.meetingsSvc.listMeetingAttendance(this.meetingId),
        this.voteSessionsSvc.list(this.meetingId),
      ]);
      this.quorum.set(quorum);
      this.attendance.set(attendance);
      this.voteSessions.set(voteSessions);
    } catch (error) {
      console.error('Error refrescando el quórum', error);
    }
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  close(): void {
    this.closed.emit();
  }

  // ── Pase de lista ──────────────────────────────────────────────────

  attendeesFor(propertyId: string): MeetingAttendee[] {
    return this.attendance().filter((a) => a.propertyId === propertyId);
  }

  async startRollCall(propertyId: string): Promise<void> {
    this.rollCallPropertyId.set(propertyId);
    this.rollCallSelectedUserId.set(null);
    this.rollCallEligible.set([]);
    try {
      this.rollCallEligible.set(await this.meetingsSvc.listRollCallEligible(this.meetingId, propertyId));
    } catch (error) {
      console.error('Error cargando los elegibles del pase de lista', error);
    }
  }

  cancelRollCall(): void {
    this.rollCallPropertyId.set(null);
  }

  async confirmRollCall(): Promise<void> {
    const propertyId = this.rollCallPropertyId();
    const userId = this.rollCallSelectedUserId();
    if (!propertyId || !userId) return;
    this.rollCallBusy.set(true);
    try {
      await this.meetingsSvc.markRollCall(this.meetingId, propertyId, userId);
      this.rollCallPropertyId.set(null);
      await this.reloadQuorumAndAttendance();
      this.showToast('Asistencia marcada');
    } catch (error) {
      console.error('Error marcando la asistencia', error);
      this.showToast('No se pudo marcar la asistencia');
    } finally {
      this.rollCallBusy.set(false);
    }
  }

  async undoAttendance(attendanceId: string): Promise<void> {
    try {
      await this.meetingsSvc.undoRollCall(this.meetingId, attendanceId);
      await this.reloadQuorumAndAttendance();
      this.showToast('Asistencia deshecha');
    } catch (error) {
      console.error('Error deshaciendo la asistencia', error);
      this.showToast('No se pudo deshacer la asistencia');
    }
  }

  // ── Delegaciones ───────────────────────────────────────────────────

  activeDelegations(): MeetingVoteDelegation[] {
    return this.delegations().filter((d) => !d.revokedAt);
  }

  async onDelegationCreated(): Promise<void> {
    this.showDelegationModal.set(false);
    this.delegations.set(await this.delegationsSvc.list(this.meetingId));
    await this.reloadQuorumAndAttendance();
    this.showToast('Delegación registrada');
  }

  async revokeDelegation(delegation: MeetingVoteDelegation): Promise<void> {
    if (!(await this.confirmDialog.ask({ title: 'Revocar delegación', message: 'Se revocará esta delegación de voto.', confirmLabel: 'Revocar', tone: 'danger' }))) return;
    try {
      await this.delegationsSvc.revoke(this.meetingId, delegation.id);
      this.delegations.set(await this.delegationsSvc.list(this.meetingId));
      this.showToast('Delegación revocada');
    } catch (error) {
      console.error('Error revocando la delegación', error);
      this.showToast('No se pudo revocar la delegación');
    }
  }

  // ── Votación real (Fase 2.1) ─────────────────────────────────────────

  votableQuestions(): { agendaItemId: string; agendaTitle: string; questionIndex: number; questionTitle: string; options: string[]; type: string; majorityType?: VoteMajorityType }[] {
    const out: { agendaItemId: string; agendaTitle: string; questionIndex: number; questionTitle: string; options: string[]; type: string; majorityType?: VoteMajorityType }[] = [];
    for (const item of this.meeting()?.agenda ?? []) {
      if (!item.hasVote || !item.voteTemplate) continue;
      item.voteTemplate.questions.forEach((q, questionIndex) => {
        if (q.type === 'text') return; // sin semántica de aprobado/rechazado — no se puede votar
        out.push({ agendaItemId: item.id, agendaTitle: item.title, questionIndex, questionTitle: q.title, options: q.options ?? [], type: q.type, majorityType: q.majorityType });
      });
    }
    return out;
  }

  sessionFor(agendaItemId: string, questionIndex: number): VoteSession | undefined {
    return this.voteSessions().find((s) => s.agendaItemId === agendaItemId && s.questionIndex === questionIndex);
  }

  /** Solo editable antes de que exista ninguna sesión de voto (Fase 2.3) — el backend también lo rechaza si no. */
  async toggleRequire2fa(next: boolean): Promise<void> {
    if (this.voteSessions().length > 0) return;
    try {
      const updated = await this.meetingsSvc.updateRequire2fa(this.meetingId, next);
      this.meeting.set(updated);
    } catch (error) {
      console.error('Error actualizando el requisito de 2FA', error);
      this.showToast('No se pudo actualizar el requisito de 2FA');
    }
  }

  majorityTypeLabel(type: VoteMajorityType): string {
    return this.majorityTypeOptions.find((m) => m.value === type)?.label ?? type;
  }

  /**
   * Abre la votación con la mayoría definida al preparar la junta, sin volver a preguntarla.
   * Solo las juntas anteriores, cuya pregunta no la fijó, usan la sugerida a partir del texto del punto.
   */
  async startOpenVote(agendaItemId: string, questionIndex: number, agendaTitle: string, questionTitle: string, majorityType?: VoteMajorityType): Promise<void> {
    if (this.votingBusy()) return;
    this.votingBusy.set(true);
    try {
      await this.voteSessionsSvc.open(this.meetingId, {
        agendaItemId,
        questionIndex,
        majorityType: majorityType ?? suggestMajorityType(agendaTitle, questionTitle).type,
      });
      await this.reloadQuorumAndAttendance();
      this.showToast('Votación abierta');
    } catch (error) {
      console.error('Error abriendo la votación', error);
      this.showToast('No se pudo abrir la votación');
    } finally {
      this.votingBusy.set(false);
    }
  }

  async closeVoteSession(session: VoteSession): Promise<void> {
    if (!(await this.confirmDialog.ask({ title: 'Cerrar la votación', message: 'Se cerrará la votación y se calculará el resultado. No se puede deshacer.', confirmLabel: 'Cerrar votación', tone: 'danger' }))) return;
    this.votingBusy.set(true);
    try {
      await this.voteSessionsSvc.close(this.meetingId, session.id);
      await this.reloadQuorumAndAttendance();
      this.showToast('Votación cerrada');
    } catch (error) {
      console.error('Error cerrando la votación', error);
      this.showToast('No se pudo cerrar la votación');
    } finally {
      this.votingBusy.set(false);
    }
  }

  optionTallyFor(session: VoteSession, optionIndex: number): number {
    const tally = session.status === 'abierta' ? session.liveTally : session.resultSummary;
    return tally?.optionTally.find((t) => t.optionIndex === optionIndex)?.propertyCount ?? 0;
  }

  optionTallyTotal(session: VoteSession): number {
    const tally = session.status === 'abierta' ? session.liveTally : session.resultSummary;
    return tally?.optionTally.reduce((sum, t) => sum + t.propertyCount, 0) ?? 0;
  }

  optionTallyPercent(session: VoteSession, optionIndex: number): number {
    const total = this.optionTallyTotal(session);
    return total > 0 ? Math.round((this.optionTallyFor(session, optionIndex) / total) * 100) : 0;
  }

  // ── Acta digital (Fase 2.2) ───────────────────────────────────────────

  /** Días naturales restantes del plazo del art. 19 LPH (10 días desde la celebración) — negativo si ya venció. */
  actaDeadlineDaysLeft(): number | null {
    const celebratedAt = this.meeting()?.celebratedAt;
    if (!celebratedAt) return null;
    const deadline = new Date(celebratedAt).getTime() + 10 * 24 * 60 * 60 * 1000;
    return Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000));
  }

  /** Días naturales restantes del plazo de impugnación del art. 18 LPH (3 meses desde la distribución). */
  impugnacionDeadlineDaysLeft(): number | null {
    const distributedAt = this.meeting()?.actaDistributedAt;
    if (!distributedAt) return null;
    const deadline = new Date(distributedAt);
    deadline.setMonth(deadline.getMonth() + 3);
    return Math.ceil((deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  }

  async signActa(role: 'presidente' | 'secretario'): Promise<void> {
    const email = (role === 'presidente' ? this.presidenteEmail() : this.secretarioEmail()).trim();
    if (!email) return;
    this.actaBusy.set(true);
    try {
      const updated = await this.meetingsSvc.signActa(this.meetingId, role, email);
      this.meeting.set(updated);
      if (role === 'presidente') this.presidenteEmail.set('');
      else this.secretarioEmail.set('');
      this.showToast(updated.actaSignedAt ? 'Acta generada y firmada' : 'Firma registrada');
    } catch (error: any) {
      console.error('Error firmando el acta', error);
      const msg = error?.error?.message;
      this.showToast(typeof msg === 'string' ? msg : 'No se pudo registrar la firma');
    } finally {
      this.actaBusy.set(false);
    }
  }

  async downloadActa(): Promise<void> {
    try {
      const blob = await this.meetingsSvc.downloadActa(this.meetingId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `acta-${(this.meeting()?.title ?? 'junta').replace(/\s+/g, '-')}.${blob.type === 'application/pdf' ? 'pdf' : 'docx'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando el acta', error);
      this.showToast('No se pudo descargar el acta');
    }
  }

  async sendActaNotice(): Promise<void> {
    if (!(await this.confirmDialog.ask({ title: 'Enviar el acta', message: 'Se enviará el acta a todos los propietarios de la finca.', confirmLabel: 'Enviar acta' }))) return;
    this.actaBusy.set(true);
    try {
      const { sentCount } = await this.meetingsSvc.sendActaNotice(this.meetingId);
      this.meeting.set(await this.meetingsSvc.findMeetingById(this.meetingId));
      this.showToast(`Acta enviada a ${sentCount} propietario(s)`);
    } catch (error) {
      console.error('Error enviando el acta', error);
      this.showToast('No se pudo enviar el acta');
    } finally {
      this.actaBusy.set(false);
    }
  }
}
