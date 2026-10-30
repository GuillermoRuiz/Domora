import { ConfirmDialogService } from '../../../shared/components/confirm-dialog/confirm-dialog.service';
import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { BadgeComponent } from '../../../shared/components/badge/badge.component';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { CreateJuntaModalComponent } from './create-junta-modal/create-junta-modal.component';
import { MeetingDetailComponent } from './meeting-detail/meeting-detail.component';
import { MeetingsService } from '../../../core/meetings.service';
import { Meeting, MeetingStatus, ParticipationHistoryEntry } from '../../../core/models';

/**
 * Pestaña de juntas de la finca, mismo patrón que `documentos-tab`/
 * `personal-tab`: recibe lo mínimo por `@Input` y se ocupa de su propia
 * carga y estado. La sala de espera/panel de anfitrión son rutas propias
 * fuera del shell (`/wait/:id`, `/beacon/:id` — ver plan, fase 3).
 */
@Component({
  selector: 'app-juntas-tab',
  standalone: true,
  imports: [BadgeComponent, BtnComponent, IconComponent, CreateJuntaModalComponent, MeetingDetailComponent],
  templateUrl: './juntas-tab.component.html',
  styleUrl: './juntas-tab.component.scss',
})
export class JuntasTabComponent implements OnInit {
  @Input({ required: true }) estateId!: string;

  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly meetingsSvc = inject(MeetingsService);
  private readonly router = inject(Router);

  meetings = signal<Meeting[]>([]);
  loading = signal(true);
  showCreateModal = signal(false);
  toastMessage = signal<string | null>(null);
  selectedMeetingId = signal<string | null>(null);

  // ── Histórico de participación (Fase 2.4) ───────────────────────────
  participationHistory = signal<ParticipationHistoryEntry[]>([]);

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  private async reload(): Promise<void> {
    this.loading.set(true);
    try {
      const [meetings, participationHistory] = await Promise.all([
        this.meetingsSvc.listMeetingsByEstate(this.estateId),
        this.meetingsSvc.getParticipationHistory(this.estateId),
      ]);
      this.meetings.set(meetings);
      this.participationHistory.set(participationHistory);
    } catch (error) {
      console.error('Error cargando las juntas', error);
    } finally {
      this.loading.set(false);
    }
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  openCreateModal(): void {
    this.showCreateModal.set(true);
  }

  onModalClosed(): void {
    this.showCreateModal.set(false);
  }

  async onMeetingCreated(): Promise<void> {
    this.showCreateModal.set(false);
    await this.reload();
    this.showToast('Junta creada correctamente');
  }

  statusVariant(status: MeetingStatus): 'green' | 'warning' | 'error' | 'default' {
    if (status === 'firmada') return 'green';
    if (status === 'celebrada') return 'warning';
    if (status === 'cancelada') return 'error';
    return 'default';
  }

  statusLabel(status: MeetingStatus): string {
    const map: Record<MeetingStatus, string> = {
      convocada: 'Convocada',
      celebrada: 'Celebrada',
      firmada: 'Firmada',
      cancelada: 'Cancelada',
    };
    return map[status];
  }

  dateLabel(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return `${day}-${month}-${date.getFullYear()} ${time}`;
  }

  closingMeetingId = signal<string | null>(null);

  /**
   * Cierre de la junta (celebrada / cancelada). Es definitivo — el backend
   * no permite reabrirla — de ahí la confirmación. Los conflictos que
   * devuelve (p. ej. "antes de su primera convocatoria") llevan mensaje
   * propio y se muestran tal cual.
   */
  async closeMeeting(meeting: Meeting, status: 'celebrada' | 'cancelada'): Promise<void> {
    const celebrada = status === 'celebrada';
    const confirmed = await this.confirmDialog.ask({
      title: celebrada ? 'Marcar como celebrada' : 'Cancelar junta',
      message: celebrada
        ? `La junta "${meeting.title}" pasará a celebrada. Ya no se podrá cambiar.`
        : `Se cancelará la junta "${meeting.title}". Ya no se podrá cambiar.`,
      confirmLabel: celebrada ? 'Marcar como celebrada' : 'Cancelar junta',
      cancelLabel: 'Volver',
      tone: celebrada ? 'primary' : 'danger',
    });
    if (!confirmed) return;

    this.closingMeetingId.set(meeting.id);
    try {
      const updated = await this.meetingsSvc.updateMeetingStatus(meeting.id, status);
      this.meetings.set(this.meetings().map((m) => (m.id === meeting.id ? { ...m, ...updated } : m)));
      this.showToast(status === 'celebrada' ? 'Junta marcada como celebrada' : 'Junta cancelada');
    } catch (error: any) {
      console.error('Error cerrando la junta', error);
      const msg = error?.error?.message;
      this.showToast(typeof msg === 'string' ? msg : 'No se pudo actualizar el estado de la junta');
    } finally {
      this.closingMeetingId.set(null);
    }
  }

  /** Aún no hay pantalla de detalle — abre directamente el panel de anfitrión si tiene videollamada. */
  openBeacon(meeting: Meeting): void {
    if (!meeting.includeJitsi) return;
    this.router.navigateByUrl(`/beacon/${meeting.id}`);
  }

  async downloadConvocatoria(meeting: Meeting): Promise<void> {
    try {
      const blob = await this.meetingsSvc.downloadMeetingConvocatoria(meeting.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `convocatoria-${meeting.title.replace(/\s+/g, '-')}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando la convocatoria', error);
      this.showToast('No se pudo descargar la convocatoria');
    }
  }
}
