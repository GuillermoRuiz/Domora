import { Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { JitsiEmbedComponent } from '../../shared/components/jitsi-embed/jitsi-embed.component';
import { AuthService } from '../../core/auth.service';
import { MeetingsService } from '../../core/meetings.service';
import { MeetingPollingService } from '../../core/meeting-polling.service';
import { Meeting, AttendanceOption } from '../../core/models';

/** Vivo = heartbeat del admin visto hace menos de esto. */
const ADMIN_ALIVE_WINDOW_MS = 30_000;

/**
 * Sala de espera del vecino — puerto de `WaitingRoomPage.tsx` (React).
 * Ruta a pantalla completa (`/wait/:meetingId`, fuera del shell con
 * sidebar — ver `app.routes.ts`, mismo patrón que `AdminInviteComponent`).
 *
 * El embed de Jitsi (`app-jitsi-embed`) vive detrás de un `@defer (when
 * hasEntered())` en la plantilla: el SDK de Jitsi no se pide hasta que se
 * cumple la condición de entrada, nunca en el bundle inicial de esta
 * pantalla. La asistencia se registra en el evento `videoConferenceJoined`
 * real de la API de Jitsi (`onJitsiJoined`), no solo cuando se nos permite
 * entrar — es más preciso que el original, que la registraba justo antes
 * de la redirección de página completa.
 */
@Component({
  selector: 'app-waiting-room',
  standalone: true,
  imports: [FormsModule, RouterLink, IconComponent, BtnComponent, JitsiEmbedComponent],
  providers: [MeetingPollingService],
  templateUrl: './waiting-room.component.html',
  styleUrl: './waiting-room.component.scss',
})
export class WaitingRoomComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly meetings = inject(MeetingsService);
  private readonly auth = inject(AuthService);
  readonly polling = inject(MeetingPollingService);

  private meetingId = '';
  private lastHandledRedirectAt: string | null = null;

  loading = signal(true);
  loadError = signal<string | null>(null);
  meeting = signal<Meeting | null>(null);
  countdown = signal('');
  hasEntered = signal(false);
  chatText = signal('');

  // ── Confirmación de asistencia (Fase 1: quórum real) ─────────────────
  // Nunca automática: el usuario elige explícitamente por cuál(es)
  // propiedad(es) está presente, entre las suyas y las que lleva por
  // delegación de voto — ver plan. No bloquea la entrada a la videollamada,
  // solo el cómputo de quórum queda pendiente hasta confirmar.
  attendanceOptions = signal<AttendanceOption[]>([]);
  selectedPropertyIds = signal<string[]>([]);
  attendanceConfirmed = signal(false);
  attendanceError = signal<string | null>(null);

  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  /** Único sitio donde vive esta condición de auto-entrada — más el disparador explícito "Redirigir ahora". */
  private readonly shouldAutoEnter = computed(() => {
    const state = this.polling.state();
    if (!state) return false;

    if (state.redirectRequestedAt && state.redirectRequestedAt !== this.lastHandledRedirectAt) {
      return true;
    }

    const adminAlive =
      !!state.adminLastSeenAt &&
      Date.now() - new Date(state.adminLastSeenAt).getTime() < ADMIN_ALIVE_WINDOW_MS;
    const timeOk = state.scheduledStartAt
      ? Date.now() >= new Date(state.scheduledStartAt).getTime()
      : true;
    return state.adminReady && adminAlive && timeOk;
  });

  constructor() {
    effect(() => {
      if (this.shouldAutoEnter() && !this.hasEntered()) {
        const state = this.polling.state();
        this.lastHandledRedirectAt = state?.redirectRequestedAt ?? this.lastHandledRedirectAt;
        void this.enterRoom();
      }
    });
  }

  async ngOnInit(): Promise<void> {
    this.meetingId = this.route.snapshot.paramMap.get('meetingId') ?? '';
    if (!this.meetingId) {
      this.loadError.set('Enlace de junta inválido.');
      this.loading.set(false);
      return;
    }
    try {
      const meeting = await this.meetings.findMeetingById(this.meetingId);
      this.meeting.set(meeting);
      // Una junta cerrada (celebrada/cancelada) ya no tiene sala a la que
      // entrar — sin esto un vecino con el enlace viejo se quedaba
      // esperando indefinidamente a una junta que ya no va a empezar.
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
      this.polling.connect(this.meetingId, { trackPresence: true });
      this.startCountdown();
      void this.loadAttendanceOptions();
    } catch (error) {
      console.error('Error cargando la junta', error);
      this.loadError.set('No se pudo cargar esta junta.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadAttendanceOptions(): Promise<void> {
    try {
      const options = await this.meetings.myAttendanceOptions(this.meetingId);
      this.attendanceOptions.set(options);
      // Preselecciona si solo hay una opción (fricción mínima), pero NUNCA
      // confirma sola — el clic en "Confirmar asistencia" sigue haciendo falta.
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
    this.attendanceError.set(null);
    try {
      await this.polling.recordAttendance(this.selectedPropertyIds());
      this.attendanceConfirmed.set(true);
    } catch (error) {
      console.error('Error confirmando la asistencia', error);
      this.attendanceError.set('No se pudo confirmar la asistencia. Intentalo de nuevo.');
    }
  }

  ngOnDestroy(): void {
    this.polling.disconnect();
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  }

  private effectiveStartAt(): string | null {
    return this.polling.state()?.scheduledStartAt ?? null;
  }

  private startCountdown(): void {
    const tick = () => {
      const startAt = this.effectiveStartAt();
      if (!startAt) {
        this.countdown.set('');
        return;
      }
      const remaining = Math.max(0, new Date(startAt).getTime() - Date.now());
      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      this.countdown.set(`${minutes}m ${String(seconds).padStart(2, '0')}s`);
    };
    tick();
    this.countdownTimer = setInterval(tick, 1000);
  }

  private async enterRoom(): Promise<void> {
    if (this.hasEntered()) return;
    this.hasEntered.set(true);
  }

  displayName(): string | undefined {
    return this.auth.currentUser()?.fullName;
  }

  /**
   * Se llama desde el evento `videoConferenceJoined` real de la API de
   * Jitsi. Ya NO registra asistencia automáticamente (ver plan de Fase 1:
   * la confirmación es siempre explícita, vía `confirmAttendance()`) — solo
   * queda como punto de extensión si en el futuro hace falta reaccionar a
   * la entrada real a la sala por otro motivo.
   */
  async onJitsiJoined(): Promise<void> {}

  /** Alternativa por si el iframe embebido da problemas (permisos de cámara/mic, navegador restrictivo). */
  openJitsi(): void {
    const url = this.meeting()?.jitsiUrl;
    if (url) window.open(url, '_blank');
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
