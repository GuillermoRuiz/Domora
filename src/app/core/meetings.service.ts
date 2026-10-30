import { Injectable, inject } from '@angular/core';
import { ApiClientService } from './api-client.service';
import {
  Meeting, MeetingState, MeetingPresenceEntry, MeetingChatMessage, CreateMeetingPayload, UpdateMeetingPayload, MeetingAttachment,
  MeetingAttendee, QuorumResult, AttendanceOption, EligibleAttendee, PropertyHolders, ParticipationHistoryEntry, ActaVersion, SaveActaVersionPayload,
  ConvocatoriaDocument, ConvocatoriaPreviewPayload,
} from './models';
import type { ActaSigning, ActaState, ActaValidation, ActaVersionSummary, ActaVersionView, GenerateActaPayload, SaveActaEditsPayload } from './acta.models';

/** Juntas de propietarios y videollamada — alta/consulta de juntas, sala de espera/panel de anfitrión (estado, presencia, chat), convocatoria y adjuntos. */
@Injectable({ providedIn: 'root' })
export class MeetingsService {
  private api = inject(ApiClientService);

  async listMeetingsByEstate(estateId: string): Promise<Meeting[]> {
    return this.api.get<Meeting[]>(`/estates/${estateId}/meetings`);
  }

  async createMeeting(estateId: string, payload: CreateMeetingPayload): Promise<Meeting> {
    return this.api.post<Meeting>(`/estates/${estateId}/meetings`, payload);
  }

  async updateMeeting(meetingId: string, payload: UpdateMeetingPayload): Promise<Meeting> {
    return this.api.patch<Meeting>(`/meetings/${meetingId}`, payload);
  }

  async findMeetingById(meetingId: string): Promise<Meeting> {
    return this.api.get<Meeting>(`/meetings/${meetingId}`);
  }

  /**
   * Cierre de la junta: `convocada` → `celebrada` | `cancelada`, terminal.
   * Distinto de `updateMeetingState`, que es el estado mutable de la
   * videollamada (sala de espera), no el ciclo de vida de la junta.
   */
  /** Comentarios del administrador sobre un punto (salen en el acta); vacío = borrarlos. */
  async setAgendaItemComments(meetingId: string, itemId: string, comments: string): Promise<Meeting> {
    return this.api.patch<Meeting>(`/meetings/${meetingId}/agenda/${itemId}/comments`, { comments });
  }

  /** Versiones guardadas del texto del acta, de la más reciente a la más antigua. */
  async listActaVersions(meetingId: string): Promise<ActaVersion[]> {
    return this.api.get<ActaVersion[]>(`/meetings/${meetingId}/acta-versions`);
  }

  /** Guarda una versión del texto del acta y deja esos textos como los vigentes. */
  async saveActaVersion(meetingId: string, payload: SaveActaVersionPayload): Promise<ActaVersion> {
    return this.api.post<ActaVersion>(`/meetings/${meetingId}/acta-versions`, payload);
  }

  // ── Acta canónica (borrador reproducible, versionado y con PDF) ─────────────────────────────

  /** Versión actual del acta (o `null` si aún no se ha generado) y estado del acta anterior al nuevo formato. */
  async getActa(meetingId: string): Promise<ActaState> {
    return this.api.get<ActaState>(`/meetings/${meetingId}/acta`);
  }

  /** Errores, avisos y datos de la reunión que faltan antes de preparar el acta. */
  async validateActa(meetingId: string): Promise<ActaValidation> {
    return this.api.get<ActaValidation>(`/meetings/${meetingId}/acta/validation`);
  }

  /** Confirma los datos de la reunión y crea el borrador; si ya existe, lo devuelve sin crear otro (salvo `refresh`). */
  async generateActa(meetingId: string, payload: GenerateActaPayload = {}): Promise<ActaVersionView> {
    return this.api.post<ActaVersionView>(`/meetings/${meetingId}/acta/generate`, payload);
  }

  /** Guarda las ediciones de los textos redactables como una versión nueva. */
  async saveActaEdits(meetingId: string, payload: SaveActaEditsPayload): Promise<ActaVersionView> {
    return this.api.patch<ActaVersionView>(`/meetings/${meetingId}/acta`, payload);
  }

  /** Vuelve a redactar las notas de la gestora sin tocar los datos congelados de la junta. */
  async regenerateActaNarrative(meetingId: string): Promise<ActaVersionView> {
    return this.api.post<ActaVersionView>(`/meetings/${meetingId}/acta/regenerate-narrative`, {});
  }

  /** Recoge en el borrador las notas nuevas (generales, de cada punto y actuaciones) sin pisar lo editado a mano. */
  async syncActaNotes(meetingId: string): Promise<ActaVersionView> {
    return this.api.post<ActaVersionView>(`/meetings/${meetingId}/acta/sync-notes`, {});
  }

  /** Deja la versión lista para firma (guarda su PDF y su huella). No firma. */
  async prepareActaForSignature(meetingId: string): Promise<ActaVersionView> {
    return this.api.post<ActaVersionView>(`/meetings/${meetingId}/acta/prepare-for-signature`, {});
  }

  /** PDF de la versión actual del acta o, con `versionId`, de una anterior. */
  downloadActaPdf(meetingId: string, versionId?: string): Promise<Blob> {
    return this.api.getBlob(`/meetings/${meetingId}/acta.pdf${versionId ? `?version=${encodeURIComponent(versionId)}` : ''}`);
  }

  /** Versiones generadas del acta (también las sustituidas), de la más reciente a la más antigua. */
  async listActaDocumentVersions(meetingId: string): Promise<ActaVersionSummary[]> {
    return this.api.get<ActaVersionSummary[]>(`/meetings/${meetingId}/acta/versions`);
  }

  /** Una versión concreta del acta, para consultarla (las sustituidas son solo lectura). */
  async getActaDocumentVersion(meetingId: string, versionId: string): Promise<ActaVersionView> {
    return this.api.get<ActaVersionView>(`/meetings/${meetingId}/acta/versions/${versionId}`);
  }

  /** Da por tratado un punto del orden del día sin votación. */
  async markAgendaItemTreated(meetingId: string, itemId: string): Promise<Meeting> {
    return this.api.patch<Meeting>(`/meetings/${meetingId}/agenda/${itemId}/treated`, {});
  }

  /** Quita la marca de «tratado» de un punto del orden del día sin votación. */
  async clearAgendaItemTreated(meetingId: string, itemId: string): Promise<Meeting> {
    return this.api.delete<Meeting>(`/meetings/${meetingId}/agenda/${itemId}/treated`);
  }

  async updateMeetingStatus(meetingId: string, status: 'celebrada' | 'cancelada'): Promise<Meeting> {
    return this.api.patch<Meeting>(`/meetings/${meetingId}/status`, { status });
  }

  /** Emails de propietarios vinculados de la finca — autocompleta "asistentes" al crear una junta. */
  async listEstateOwnerEmails(estateId: string): Promise<{ email: string; fullName: string; isOwner?: boolean; userId?: string }[]> {
    return this.api.get<{ email: string; fullName: string; isOwner?: boolean; userId?: string }[]>(`/estates/${estateId}/properties/owner-emails`);
  }

  /** Sondeado cada pocos segundos desde la sala de espera / panel de anfitrión (sin WebSocket todavía). */
  async getMeetingState(meetingId: string): Promise<MeetingState | null> {
    return this.api.get<MeetingState | null>(`/meetings/${meetingId}/state`);
  }

  async updateMeetingState(
    meetingId: string,
    patch: { adminReady?: boolean; scheduledStartAt?: string; announcement?: string; redirectNow?: boolean },
  ): Promise<MeetingState> {
    return this.api.patch<MeetingState>(`/meetings/${meetingId}/state`, patch);
  }

  /** Heartbeat de vida del admin — llamar cada ~15s mientras el panel de anfitrión está abierto. */
  async heartbeatMeetingAdmin(meetingId: string): Promise<MeetingState> {
    return this.api.post<MeetingState>(`/meetings/${meetingId}/heartbeat`, {});
  }

  /**
   * Confirmación EXPLÍCITA de asistencia — nunca automática (ver plan de
   * Fase 1: quórum real). El usuario elige por cuál(es) propiedad(es) está
   * presente, entre las suyas y las que lleva por delegación de voto.
   */
  async recordMeetingAttendance(meetingId: string, propertyIds: string[]): Promise<void> {
    await this.api.post(`/meetings/${meetingId}/attendance`, { propertyIds });
  }

  async listMeetingAttendance(meetingId: string): Promise<MeetingAttendee[]> {
    return this.api.get<MeetingAttendee[]>(`/meetings/${meetingId}/attendance`);
  }

  /** Propiedades propias + delegaciones activas del usuario para esta junta — puebla el selector de la sala de espera. */
  async myAttendanceOptions(meetingId: string): Promise<AttendanceOption[]> {
    return this.api.get<AttendanceOption[]>(`/meetings/${meetingId}/attendance/options`);
  }

  /** Visible a cualquiera con acceso a la finca, no solo gestora — mismo criterio que la presencia en directo. */
  async getMeetingQuorum(meetingId: string): Promise<QuorumResult> {
    return this.api.get<QuorumResult>(`/meetings/${meetingId}/quorum`);
  }

  /** Identidades elegibles (titulares vinculados + delegados) para el desplegable del pase de lista. */
  async listRollCallEligible(meetingId: string, propertyId: string): Promise<EligibleAttendee[]> {
    return this.api.get<EligibleAttendee[]>(`/meetings/${meetingId}/roll-call/eligible`, { propertyId });
  }

  /** Titulares vinculados de cada propiedad de la finca de la junta (los que aparecen por nombre en la participación). */
  async listRollCallHolders(meetingId: string): Promise<PropertyHolders[]> {
    return this.api.get<PropertyHolders[]>(`/meetings/${meetingId}/roll-call/holders`);
  }

  /** Pase de lista presencial — la gestora marca asistencia por propiedad, con o sin videollamada. */
  async markRollCall(meetingId: string, propertyId: string, userId: string): Promise<MeetingAttendee> {
    return this.api.post<MeetingAttendee>(`/meetings/${meetingId}/roll-call`, { propertyId, userId });
  }

  async undoRollCall(meetingId: string, attendanceId: string): Promise<void> {
    await this.api.delete(`/meetings/${meetingId}/roll-call/${attendanceId}`);
  }

  async listMeetingChat(meetingId: string): Promise<MeetingChatMessage[]> {
    return this.api.get<MeetingChatMessage[]>(`/meetings/${meetingId}/chat`);
  }

  async postMeetingChatMessage(meetingId: string, text: string): Promise<MeetingChatMessage> {
    return this.api.post<MeetingChatMessage>(`/meetings/${meetingId}/chat`, { text });
  }

  async listMeetingPresence(meetingId: string): Promise<MeetingPresenceEntry[]> {
    return this.api.get<MeetingPresenceEntry[]>(`/meetings/${meetingId}/presence`);
  }

  /** Heartbeat de presencia — llamar cada ~10s mientras la sala de espera está abierta. */
  async heartbeatMeetingPresence(
    meetingId: string,
    info: { building?: string; unit?: string; floor?: string },
  ): Promise<void> {
    await this.api.post(`/meetings/${meetingId}/presence`, info);
  }

  /** Convocatoria habitual redactada con los datos del borrador: punto de partida para editarla al crear la junta. */
  previewConvocatoria(estateId: string, draft: ConvocatoriaPreviewPayload): Promise<ConvocatoriaDocument> {
    return this.api.post<ConvocatoriaDocument>(`/estates/${estateId}/meetings/convocatoria-preview`, draft);
  }

  /** Convocatoria en .docx generada al vuelo — no se persiste, se pide de nuevo cada vez. */
  downloadMeetingConvocatoria(meetingId: string): Promise<Blob> {
    return this.api.getBlob(`/meetings/${meetingId}/convocatoria.docx`);
  }

  async listMeetingAttachments(meetingId: string): Promise<MeetingAttachment[]> {
    return this.api.get(`/meetings/${meetingId}/attachments`);
  }

  /** Se sube DESPUÉS de crear la junta (necesita el meetingId real) — igual que hace React tras `create-junta`. */
  async uploadMeetingAttachment(meetingId: string, file: File, title?: string): Promise<MeetingAttachment> {
    return this.api.uploadFile(`/meetings/${meetingId}/attachments`, file, { title });
  }

  downloadMeetingAttachment(meetingId: string, attachmentId: string): Promise<Blob> {
    return this.api.getBlob(`/meetings/${meetingId}/attachments/${attachmentId}/file`);
  }

  async deleteMeetingAttachment(meetingId: string, attachmentId: string): Promise<void> {
    await this.api.delete(`/meetings/${meetingId}/attachments/${attachmentId}`);
  }

  /** Firma el acta (art. 19 LPH) — resuelto por email, no por selector de directorio (mismo criterio que la delegación de voto). Solo genera y persiste el .docx cuando presidente Y secretario ya firmaron. */
  async signActa(meetingId: string, role: 'presidente' | 'secretario', signerEmail: string): Promise<Meeting> {
    return this.api.post<Meeting>(`/meetings/${meetingId}/acta/sign`, { role, signerEmail });
  }

  /** Estado de las firmas y si quien está conectado puede firmar ahora. */
  getActaSigning(meetingId: string): Promise<ActaSigning> {
    return this.api.get<ActaSigning>(`/meetings/${meetingId}/acta/signing`);
  }

  /** Firma quien está conectado: el presidente de la comunidad o un administrador de finca. */
  async signActaAsSelf(meetingId: string, role: 'presidente' | 'secretario'): Promise<Meeting> {
    return this.api.post<Meeting>(`/meetings/${meetingId}/acta/sign-self`, { role });
  }

  /**
   * Sube un acta ya hecha (PDF o DOCX). `alreadySigned`: el archivo ya viene firmado (la junta pasa a firmada);
   * si no, queda pendiente de firma en Domora. Devuelve el estado del acta.
   */
  async uploadActa(meetingId: string, file: File, alreadySigned: boolean): Promise<ActaState> {
    return this.api.uploadFile<ActaState>(`/meetings/${meetingId}/acta/upload`, file, { alreadySigned: String(alreadySigned) });
  }

  /** El archivo subido como acta (pendiente de firma o ya firmado). */
  downloadActaUpload(meetingId: string): Promise<Blob> {
    return this.api.getBlob(`/meetings/${meetingId}/acta/file`);
  }

  downloadActa(meetingId: string): Promise<Blob> {
    return this.api.getBlob(`/meetings/${meetingId}/acta.docx`);
  }

  /** Distribuye el acta ya firmada a todos los propietarios vinculados de la finca. */
  async sendActaNotice(meetingId: string): Promise<{ sentCount: number }> {
    return this.api.post(`/meetings/${meetingId}/acta/send`, {});
  }

  /** Solo editable antes de que exista ninguna sesión de voto — ver plan Fase 2.3. */
  async updateRequire2fa(meetingId: string, require2faForVoting: boolean): Promise<Meeting> {
    return this.api.patch<Meeting>(`/meetings/${meetingId}/require-2fa-for-voting`, { require2faForVoting });
  }

  /** Últimas 20 juntas celebradas de la finca: si se alcanzó quórum y qué % del censo usó delegación. */
  async getParticipationHistory(estateId: string): Promise<ParticipationHistoryEntry[]> {
    return this.api.get<ParticipationHistoryEntry[]>(`/estates/${estateId}/meetings/participation-history`);
  }
}
