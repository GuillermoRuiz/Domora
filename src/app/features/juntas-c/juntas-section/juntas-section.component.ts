import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { RegisterDelegationModalComponent } from '../../../shared/components/register-delegation-modal/register-delegation-modal.component';
import { MeetingsService } from '../../../core/meetings.service';
import { MeetingVoteDelegationsService } from '../../../core/meeting-vote-delegations.service';
import { VoteSessionsService } from '../../../core/vote-sessions.service';
import { AuthService } from '../../../core/auth.service';
import { Meeting, MeetingVoteDelegation, VoteSession } from '../../../core/models';
import { JuntasDataCache } from '../juntas-data-cache';

interface VotableSession {
  session: VoteSession;
  questionTitle: string;
  options: string[];
  /** Color elegido para cada respuesta (`''` = sin color propio). */
  optionColors: string[];
  type: 'single_choice' | 'multiple_choice';
}

/** Acta pendiente de la firma del presidente, y quien está conectado es el presidente de la comunidad. */
interface SignatureRow {
  meeting: Meeting;
}

interface JuntaRow {
  meeting: Meeting;
  myDelegation: MeetingVoteDelegation | null;
  openVotes: VotableSession[];
  /** Art. 15.2 LPH: con deuda vencida no se puede votar. Solo lo ve quien tiene la deuda. */
  debtBlocked: boolean;
}

/**
 * Autoservicio de delegación de voto (art. 15.1 LPH) para el propio vecino
 * — misma pieza (`RegisterDelegationModalComponent`) que usa la gestora en
 * `meeting-detail`, aquí con propiedad y delegador bloqueados a uno mismo.
 * "¿Puedo delegar?" no se decide aquí: se reutiliza `eligible-delegators`
 * (ya construido para el selector de la gestora) para no duplicar la
 * regla de quién tiene voto sobre la propiedad.
 */
@Component({
  selector: 'app-juntas-section',
  standalone: true,
  imports: [FormsModule, IconComponent, BtnComponent, BadgeComponent, RegisterDelegationModalComponent],
  templateUrl: './juntas-section.component.html',
  styleUrl: './juntas-section.component.scss',
})
export class JuntasSectionComponent implements OnInit {
  @Input({ required: true }) estateId!: string;
  @Input({ required: true }) propertyId!: string;
  /** Junta a resaltar (enlace `?meeting=<id>` de un aviso). */
  @Input() highlightMeetingId: string | null = null;

  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly meetingsSvc = inject(MeetingsService);
  private readonly delegationsSvc = inject(MeetingVoteDelegationsService);
  private readonly voteSessionsSvc = inject(VoteSessionsService);
  readonly auth = inject(AuthService);
  /** Lecturas compartidas con los demás bloques de la página «Juntas» (si la hay). */
  private readonly cache = inject(JuntasDataCache, { optional: true });

  loading = signal(true);
  rows = signal<JuntaRow[]>([]);
  /** Actas que esperan la firma de quien está conectado (es el presidente y le toca firmar). */
  signatures = signal<SignatureRow[]>([]);
  signingMeetingId = signal<string | null>(null);
  toastMessage = signal<string | null>(null);

  delegationTargetMeetingId = signal<string | null>(null);

  // ── Votación real (Fase 2.1) — selección pendiente de enviar, por sesión ──
  pendingVote = signal<Record<string, number>>({});
  votingBusy = signal<string | null>(null);
  /** Solo se usa si la sesión tiene `require2fa` (Fase 2.3) — TOTP o código de respaldo. */
  totpCode = signal<Record<string, string>>({});

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const allMeetings = await (this.cache?.meetings(this.estateId) ?? this.meetingsSvc.listMeetingsByEstate(this.estateId));
      const meetings = allMeetings.filter((m) => m.status === 'convocada');
      const userId = this.auth.currentUser()?.id;
      void this.loadSignatures(allMeetings.filter((m) => m.status === 'celebrada' && !m.actaSignedByPresidenteUserId));

      const candidates = await Promise.all(meetings.map(async (meeting) => {
        const [delegations, eligible, voteSessions] = await Promise.all([
          this.cache?.delegations(meeting.id) ?? this.delegationsSvc.list(meeting.id),
          this.delegationsSvc.listEligibleDelegators(meeting.id, this.propertyId),
          this.cache?.voteSessions(meeting.id) ?? this.voteSessionsSvc.list(meeting.id),
        ]);
        const myDelegation = delegations.find(
          (d) => d.propertyId === this.propertyId && d.delegatorUserId === userId && !d.revokedAt,
        ) ?? null;
        const canDelegate = eligible.some((e) => e.userId === userId);
        const openVotes = this.resolveOpenVotes(meeting, voteSessions);
        const debtBlocked = openVotes.length > 0 && (await this.hasVotingDebt(meeting.id));
        return { meeting, myDelegation, canDelegate, openVotes, debtBlocked };
      }));

      this.rows.set(
        candidates
          .filter((c) => c.canDelegate || c.myDelegation || c.openVotes.length > 0)
          .map(({ meeting, myDelegation, openVotes, debtBlocked }) => ({ meeting, myDelegation, openVotes, debtBlocked })),
      );
    } catch (error) {
      console.error('Error cargando las juntas de la propiedad', error);
    } finally {
      this.loading.set(false);
    }
  }

  /** Juntas celebradas cuya acta espera la firma de quien está conectado, que solo ve «Firmar» si es el presidente. */
  private async loadSignatures(celebradas: Meeting[]): Promise<void> {
    const states = await Promise.all(
      celebradas.map(async (meeting) => {
        try {
          const signing = await (this.cache?.actaSigning(meeting.id) ?? this.meetingsSvc.getActaSigning(meeting.id));
          return signing.canSign.presidente ? { meeting } : null;
        } catch {
          return null;
        }
      }),
    );
    this.signatures.set(states.filter((row): row is SignatureRow => row !== null));
  }

  async signAsPresident(row: SignatureRow): Promise<void> {
    if (this.signingMeetingId()) return;
    const confirmed = await this.confirmDialog.ask({
      title: 'Firmar el acta',
      message: `Vas a firmar como presidente el acta de «${row.meeting.title}». La firma queda registrada y no se puede deshacer.`,
      confirmLabel: 'Firmar',
    });
    if (!confirmed) return;
    this.signingMeetingId.set(row.meeting.id);
    try {
      await this.meetingsSvc.signActaAsSelf(row.meeting.id, 'presidente');
      this.cache?.invalidate();
      this.signatures.update((rows) => rows.filter((entry) => entry.meeting.id !== row.meeting.id));
      this.showToast('Firma registrada');
    } catch (error) {
      console.error('Error firmando el acta', error);
      this.showToast('No se pudo registrar la firma');
    } finally {
      this.signingMeetingId.set(null);
    }
  }

  /** ¿Tiene esta propiedad una deuda vencida que le impide votar? Si no se puede saber, no se bloquea: el backend decide. */
  private async hasVotingDebt(meetingId: string): Promise<boolean> {
    try {
      return !(await this.voteSessionsSvc.votingRight(meetingId, this.propertyId)).canVote;
    } catch {
      return false;
    }
  }

  private resolveOpenVotes(meeting: Meeting, voteSessions: VoteSession[]): VotableSession[] {
    const out: VotableSession[] = [];
    for (const session of voteSessions) {
      if (session.status !== 'abierta') continue;
      const item = meeting.agenda.find((a) => a.id === session.agendaItemId);
      const question = item?.voteTemplate?.questions[session.questionIndex];
      if (!question || question.type === 'text') continue;
      out.push({ session, questionTitle: question.title, options: question.options ?? [], optionColors: question.optionColors ?? [], type: question.type });
    }
    return out;
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  dateLabel(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return `${day}-${month}-${date.getFullYear()} ${time}`;
  }

  openDelegationModal(meetingId: string): void {
    this.delegationTargetMeetingId.set(meetingId);
  }

  closeDelegationModal(): void {
    this.delegationTargetMeetingId.set(null);
  }

  async onDelegationCreated(): Promise<void> {
    this.delegationTargetMeetingId.set(null);
    this.cache?.invalidate();
    await this.load();
    this.showToast('Delegación registrada');
  }

  async revokeDelegation(row: JuntaRow): Promise<void> {
    if (!row.myDelegation) return;
    if (!(await this.confirmDialog.ask({ title: 'Revocar delegación', message: 'Se revocará tu delegación de voto para esta junta.', confirmLabel: 'Revocar', tone: 'danger' }))) return;
    try {
      await this.delegationsSvc.revoke(row.meeting.id, row.myDelegation.id);
      this.cache?.invalidate();
      await this.load();
      this.showToast('Delegación revocada');
    } catch (error) {
      console.error('Error revocando la delegación', error);
      this.showToast('No se pudo revocar la delegación');
    }
  }

  // ── Votación real (Fase 2.1) ─────────────────────────────────────────

  selectVoteOption(sessionId: string, optionIndex: number): void {
    this.pendingVote.update((current) => ({ ...current, [sessionId]: optionIndex }));
  }

  setTotpCode(sessionId: string, code: string): void {
    this.totpCode.update((current) => ({ ...current, [sessionId]: code }));
  }

  async castVote(meetingId: string, sessionId: string, require2fa: boolean): Promise<void> {
    const optionIndex = this.pendingVote()[sessionId];
    if (optionIndex == null) return;
    const totpCode = this.totpCode()[sessionId]?.trim();
    if (require2fa && !totpCode) return;
    this.votingBusy.set(sessionId);
    try {
      await this.voteSessionsSvc.castVote(meetingId, sessionId, { propertyId: this.propertyId, optionIndex, totpCode: require2fa ? totpCode : undefined });
      this.showToast('Voto registrado');
      this.cache?.invalidate();
      await this.load();
    } catch (error: any) {
      console.error('Error votando', error);
      this.showToast(error?.error?.code === 'DEBT_PENDING' ? 'Tienes una deuda pendiente: no puedes votar (art. 15.2 LPH)' : 'No se pudo registrar el voto');
    } finally {
      this.votingBusy.set(null);
    }
  }
}
