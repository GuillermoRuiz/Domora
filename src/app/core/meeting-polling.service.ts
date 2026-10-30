import { Injectable, inject, signal } from '@angular/core';
import { MeetingsService } from './meetings.service';
import { MeetingChatMessage, MeetingPresenceEntry, MeetingState } from './models';

const STATE_POLL_MS = 3000;
const PRESENCE_POLL_MS = 4000;
const CHAT_POLL_MS = 4000;
const PRESENCE_HEARTBEAT_MS = 10000;
const ADMIN_HEARTBEAT_MS = 15000;

/**
 * Sustituye el canal Realtime único de Supabase (presencia + broadcast +
 * chat) del original React por polling — decisión tomada porque NestJS no
 * tiene hoy ninguna infraestructura de tiempo real (ver plan de la
 * historia, decisión #3). Documentado como deuda técnica aceptada: un
 * WebSocket Gateway sustituyendo esto es la mejora natural de una fase 2.
 *
 * Con estado (temporizadores + meetingId actual): se declara SIN
 * `providedIn: 'root'` a propósito y se registra en `providers` de cada
 * componente sala (`WaitingRoomComponent`/`MeetingBeaconComponent`) para
 * que cada instancia de ruta tenga su propia conexión aislada.
 */
@Injectable()
export class MeetingPollingService {
  private readonly meetings = inject(MeetingsService);

  private currentMeetingId: string | null = null;
  private stateTimer: ReturnType<typeof setInterval> | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private chatTimer: ReturnType<typeof setInterval> | null = null;
  private presenceHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private adminHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // El polling no garantiza que las respuestas lleguen en el mismo orden en
  // que se pidieron (jitter de red). `pollState`, `sendAdminHeartbeat`,
  // `setAdminReady`, `redirectNow` y `reschedule` escriben todos el mismo
  // signal `state`, así que comparten `stateSeq` — si no, una respuesta
  // tardía de cualquiera de ellos podría pisar una más nueva de otro (p.ej.
  // un poll en vuelo desde antes de pulsar "Marcar listo" sobrescribiendo
  // el resultado, ya confirmado por el servidor, de esa misma acción).
  // `disconnect()` también invalida cualquier respuesta en vuelo al limpiar
  // `currentMeetingId`.
  private stateSeq = 0;
  private presenceSeq = 0;
  private chatSeq = 0;

  readonly state = signal<MeetingState | null>(null);
  readonly presence = signal<MeetingPresenceEntry[]>([]);
  readonly chatMessages = signal<MeetingChatMessage[]>([]);

  /**
   * `trackPresence`: la sala de espera se anuncia a sí misma (aparece en
   * "presentes"); el panel de anfitrión no (mismo comportamiento que
   * `WaitingRoomPage.tsx` vs `BeaconPage.tsx` en el original).
   * `adminHeartbeat`: solo el panel de anfitrión escribe `adminLastSeenAt`.
   */
  connect(meetingId: string, opts: { trackPresence?: boolean; adminHeartbeat?: boolean } = {}): void {
    this.disconnect();
    this.currentMeetingId = meetingId;

    void this.pollState();
    this.stateTimer = setInterval(() => void this.pollState(), STATE_POLL_MS);

    void this.pollChat();
    this.chatTimer = setInterval(() => void this.pollChat(), CHAT_POLL_MS);

    void this.pollPresence();
    this.presenceTimer = setInterval(() => void this.pollPresence(), PRESENCE_POLL_MS);

    if (opts.trackPresence) {
      void this.sendPresenceHeartbeat();
      this.presenceHeartbeatTimer = setInterval(() => void this.sendPresenceHeartbeat(), PRESENCE_HEARTBEAT_MS);
    }

    if (opts.adminHeartbeat) {
      void this.sendAdminHeartbeat();
      this.adminHeartbeatTimer = setInterval(() => void this.sendAdminHeartbeat(), ADMIN_HEARTBEAT_MS);
    }
  }

  disconnect(): void {
    for (const timer of [this.stateTimer, this.presenceTimer, this.chatTimer, this.presenceHeartbeatTimer, this.adminHeartbeatTimer]) {
      if (timer) clearInterval(timer);
    }
    this.stateTimer = this.presenceTimer = this.chatTimer = this.presenceHeartbeatTimer = this.adminHeartbeatTimer = null;
    this.currentMeetingId = null;
    this.state.set(null);
    this.presence.set([]);
    this.chatMessages.set([]);
  }

  private async pollState(): Promise<void> {
    const id = this.currentMeetingId;
    if (!id) return;
    const token = ++this.stateSeq;
    try {
      const result = await this.meetings.getMeetingState(id);
      if (token === this.stateSeq && this.currentMeetingId === id) this.state.set(result);
    } catch (error) {
      console.error('Error consultando el estado de la junta', error);
    }
  }

  private async pollPresence(): Promise<void> {
    const id = this.currentMeetingId;
    if (!id) return;
    const token = ++this.presenceSeq;
    try {
      const result = await this.meetings.listMeetingPresence(id);
      if (token === this.presenceSeq && this.currentMeetingId === id) this.presence.set(result);
    } catch (error) {
      console.error('Error consultando la presencia de la sala', error);
    }
  }

  private async pollChat(): Promise<void> {
    const id = this.currentMeetingId;
    if (!id) return;
    const token = ++this.chatSeq;
    try {
      const result = await this.meetings.listMeetingChat(id);
      if (token === this.chatSeq && this.currentMeetingId === id) this.chatMessages.set(result);
    } catch (error) {
      console.error('Error consultando el chat de la sala', error);
    }
  }

  private async sendPresenceHeartbeat(): Promise<void> {
    const id = this.currentMeetingId;
    if (!id) return;
    try {
      await this.meetings.heartbeatMeetingPresence(id, {});
    } catch (error) {
      console.error('Error enviando el heartbeat de presencia', error);
    }
  }

  private async sendAdminHeartbeat(): Promise<void> {
    const id = this.currentMeetingId;
    if (!id) return;
    const token = ++this.stateSeq;
    try {
      const result = await this.meetings.heartbeatMeetingAdmin(id);
      if (token === this.stateSeq && this.currentMeetingId === id) this.state.set(result);
    } catch (error) {
      console.error('Error enviando el heartbeat del anfitrión', error);
    }
  }

  async sendChatMessage(text: string): Promise<void> {
    const id = this.currentMeetingId;
    if (!id || !text.trim()) return;
    const message = await this.meetings.postMeetingChatMessage(id, text.trim());
    this.chatMessages.set([...this.chatMessages(), message]);
  }

  async setAdminReady(ready: boolean): Promise<void> {
    const id = this.currentMeetingId;
    if (!id) return;
    const token = ++this.stateSeq;
    const result = await this.meetings.updateMeetingState(id, { adminReady: ready });
    if (token === this.stateSeq && this.currentMeetingId === id) this.state.set(result);
  }

  async redirectNow(): Promise<void> {
    const id = this.currentMeetingId;
    if (!id) return;
    const token = ++this.stateSeq;
    const result = await this.meetings.updateMeetingState(id, { redirectNow: true });
    if (token === this.stateSeq && this.currentMeetingId === id) this.state.set(result);
  }

  async reschedule(scheduledStartAtIso: string): Promise<void> {
    const id = this.currentMeetingId;
    if (!id) return;
    const token = ++this.stateSeq;
    const result = await this.meetings.updateMeetingState(id, { scheduledStartAt: scheduledStartAtIso });
    if (token === this.stateSeq && this.currentMeetingId === id) this.state.set(result);
  }

  async recordAttendance(propertyIds: string[]): Promise<void> {
    const id = this.currentMeetingId;
    if (!id) return;
    await this.meetings.recordMeetingAttendance(id, propertyIds);
  }
}
