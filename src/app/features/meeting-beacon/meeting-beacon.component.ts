import { Component, OnDestroy, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { BadgeComponent } from '../../shared/components/badge/badge.component';
import { JitsiEmbedComponent } from '../../shared/components/jitsi-embed/jitsi-embed.component';
import { AuthService } from '../../core/auth.service';
import { MeetingsService } from '../../core/meetings.service';
import { MeetingPollingService } from '../../core/meeting-polling.service';
import { Meeting, AttendanceOption, QuorumResult } from '../../core/models';

/** Mismo idioma de intervalo que `meeting-detail.component.ts` — sin necesitar infraestructura nueva. */
const QUORUM_REFRESH_MS = 20_000;

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * `value` viene de un `<input type="datetime-local">` sin indicador de zona
 * (p.ej. "2026-09-01T18:00") — `new Date()` YA lo interpreta como hora local
 * del navegador, así que `toISOString()` sobre ese Date basta. Restar aquí
 * también `getTimezoneOffset()` (como hace `toLocalInputValue`, que sí lo
 * necesita porque parte de un ISO en UTC) aplicaba el desplazamiento dos
 * veces y desplazaba la hora reprogramada por el offset local completo.
 */
function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString();
}

/**
 * Panel de anfitrión — puerto de `BeaconPage.tsx` (React). Ruta a pantalla
 * completa (`/beacon/:meetingId`, fuera del shell). Gestionar juntas es
 * Rol B/A (ver plan, decisión #4): si el usuario autenticado no tiene ese
 * rol, se le redirige — el backend ya rechazaría cualquier acción de todas
 * formas (`assertManager` en `MeetingsService`), esto es solo UX.
 */
@Component({
  selector: 'app-meeting-beacon',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, IconComponent, BtnComponent, BadgeComponent, JitsiEmbedComponent],
  providers: [MeetingPollingService],
  templateUrl: './meeting-beacon.component.html',
  styleUrl: './meeting-beacon.component.scss',
})
export class MeetingBeaconComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly meetings = inject(MeetingsService);
  private readonly auth = inject(AuthService);
  readonly polling = inject(MeetingPollingService);

  private meetingId = '';

  loading = signal(true);
  loadError = signal<string | null>(null);
  meeting = signal<Meeting | null>(null);
  chatText = signal('');
  newStart = signal('');
  savingReady = signal(false);
  savingSchedule = signal(false);
  enteredJitsi = signal(false);

  // ── Confirmación de asistencia (Fase 1: quórum real) ─────────────────
  // La gestora suele no ser titular de ninguna propiedad de la finca —
  // `attendanceOptions` quedará vacío en ese caso normal y no se muestra
  // nada; solo importa si además es propietaria o lleva una delegación.
  attendanceOptions = signal<AttendanceOption[]>([]);
  selectedPropertyIds = signal<string[]>([]);
  attendanceConfirmed = signal(false);

  // ── Quórum en vivo (Fase 2.0) ─────────────────────────────────────────
  quorum = signal<QuorumResult | null>(null);
  private quorumTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Precarga el input de reprogramación la primera vez que llega el estado.
    effect(() => {
      const startAt = this.polling.state()?.scheduledStartAt;
      if (startAt && !this.newStart()) {
        this.newStart.set(toLocalInputValue(startAt));
      }
    });
  }

  async ngOnInit(): Promise<void> {
    const role = this.auth.currentUser()?.role;
    if (role !== 'A' && role !== 'B') {
      await this.router.navigateByUrl('/b/estates');
      return;
    }

    this.meetingId = this.route.snapshot.paramMap.get('meetingId') ?? '';
    if (!this.meetingId) {
      this.loadError.set('Enlace de junta inválido.');
      this.loading.set(false);
      return;
    }
    try {
      const meeting = await this.meetings.findMeetingById(this.meetingId);
      this.meeting.set(meeting);
      if (meeting.status === 'cancelada') {
        this.loadError.set('Esta junta ha sido cancelada.');
        return;
      }
      if (meeting.status === 'celebrada' || meeting.status === 'firmada') {
        this.loadError.set('Esta junta ya se ha celebrado.');
        return;
      }
      if (!meeting.includeJitsi || !meeting.jitsiRoomName) {
        this.loadError.set('Esta junta no tiene videollamada activada.');
        return;
      }
      this.polling.connect(this.meetingId, { adminHeartbeat: true });
      void this.loadAttendanceOptions();
      void this.refreshQuorum();
      this.quorumTimer = setInterval(() => void this.refreshQuorum(), QUORUM_REFRESH_MS);
    } catch (error) {
      console.error('Error cargando la junta', error);
      this.loadError.set('No se pudo cargar esta junta.');
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.polling.disconnect();
    if (this.quorumTimer) clearInterval(this.quorumTimer);
  }

  private async refreshQuorum(): Promise<void> {
    try {
      this.quorum.set(await this.meetings.getMeetingQuorum(this.meetingId));
    } catch (error) {
      console.error('Error refrescando el quórum', error);
    }
  }

  async toggleReady(): Promise<void> {
    this.savingReady.set(true);
    try {
      const ready = !this.polling.state()?.adminReady;
      await this.polling.setAdminReady(ready);
    } catch (error) {
      console.error('Error cambiando el estado de la videollamada', error);
    } finally {
      this.savingReady.set(false);
    }
  }

  async redirectNow(): Promise<void> {
    try {
      await this.polling.redirectNow();
    } catch (error) {
      console.error('Error forzando la redirección', error);
    }
  }

  displayName(): string | undefined {
    return this.auth.currentUser()?.fullName;
  }

  enterJitsi(): void {
    this.enteredJitsi.set(true);
  }

  /** Ya no registra asistencia automáticamente — ver `confirmAttendance()`. */
  async onJitsiJoined(): Promise<void> {}

  private async loadAttendanceOptions(): Promise<void> {
    try {
      const options = await this.meetings.myAttendanceOptions(this.meetingId);
      this.attendanceOptions.set(options);
      if (options.length === 1) this.selectedPropertyIds.set([options[0].propertyId]);
    } catch (error) {
      console.error('Error cargando las propiedades disponibles', error);
    }
  }

  toggleAttendanceProperty(propertyId: string): void {
    const current = this.selectedPropertyIds();
    this.selectedPropertyIds.set(
      current.includes(propertyId) ? current.filter((id) => id !== propertyId) : [...current, propertyId],
    );
  }

  async confirmAttendance(): Promise<void> {
    if (this.selectedPropertyIds().length === 0) return;
    try {
      await this.polling.recordAttendance(this.selectedPropertyIds());
      this.attendanceConfirmed.set(true);
    } catch (error) {
      console.error('Error confirmando la asistencia', error);
    }
  }

  /** Alternativa por si el iframe embebido da problemas. */
  openJitsi(): void {
    const url = this.meeting()?.jitsiUrl;
    if (url) window.open(url, '_blank');
  }

  async updateSchedule(): Promise<void> {
    const value = this.newStart();
    if (!value) return;
    this.savingSchedule.set(true);
    try {
      await this.polling.reschedule(fromLocalInputValue(value));
    } catch (error) {
      console.error('Error reprogramando el inicio', error);
    } finally {
      this.savingSchedule.set(false);
    }
  }

  async sendMessage(): Promise<void> {
    const text = this.chatText().trim();
    if (!text) return;
    this.chatText.set('');
    try {
      await this.polling.sendChatMessage(text);
    } catch (error) {
      console.error('Error enviando el mensaje', error);
    }
  }
}
