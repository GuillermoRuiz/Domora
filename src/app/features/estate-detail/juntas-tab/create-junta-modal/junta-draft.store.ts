import { Injectable, computed, signal } from '@angular/core';
import type {
  AgendaItem,
  ConvocatoriaDocument,
  ConvocatoriaPreviewPayload,
  CreateMeetingPayload,
  Meeting,
  MeetingConvokedBy,
  MeetingSignerRole,
  MeetingType,
  UpdateMeetingPayload,
} from '../../../../core/models';
import { newAgendaItem } from '../agenda-builder/agenda-builder.component';
import { ORDINARY_AGENDA, ordinaryAgendaItem, ordinaryAgendaKey } from '../../../../core/ordinary-agenda';
import { buildFullAddress } from './map-address.util';

export interface JuntaAttendee {
  email: string;
  /** Solo si el dato real (propietarios de la finca) lo trae; si no, se muestra el email. */
  name?: string;
}

export interface JuntaOwner {
  email: string;
  fullName: string;
}

export type JuntaStep = 1 | 2 | 3;

/** Minutos que se sugieren entre la 1ª y la 2ª convocatoria (editable por el usuario). */
export const SECOND_CONVOCATION_GAP_MINUTES = 30;

/** `YYYY-MM-DDTHH:mm` (hora local) + N minutos, con cambio de día/mes/año si hace falta. */
export function addMinutes(value: string, minutes: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return '';
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi + minutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/** ISO → `YYYY-MM-DDTHH:mm` en hora local (el formato del borrador). */
export function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export type JuntaErrorField = 'estate' | 'title' | 'dates' | 'agenda';

export interface JuntaStepError {
  step: JuntaStep;
  /** `null` = error general (p. ej. del servidor) que no corresponde a un campo concreto. */
  field: JuntaErrorField | null;
  message: string;
}

/**
 * Estado y reglas del alta de junta, compartidos por los pasos del wizard (se
 * provee a nivel de `CreateJuntaModalComponent`, así que vive mientras el modal).
 * Las validaciones y el payload son los del formulario anterior, sin cambios de
 * contrato: solo se reparten por paso.
 */
@Injectable()
export class JuntaDraftStore {
  // Paso 1 — datos
  /** Comunidad de la junta. La fija quien abre el modal o, si hay varias, el selector del paso 1. */
  readonly estateId = signal('');
  /** Comunidades entre las que elegir en el paso 1; vacío = sin selector (la comunidad viene fija). */
  readonly estateOptions = signal<{ id: string; name: string }[]>([]);
  readonly title = signal('');
  readonly type = signal<MeetingType>('ordinaria');
  readonly convokedBy = signal<MeetingConvokedBy>('presidente');
  readonly street = signal('');
  readonly postalCode = signal('');
  readonly city = signal('');
  /** `YYYY-MM-DDTHH:mm` (hora local) o vacío si falta fecha u hora — igual que el `datetime-local` anterior. */
  readonly scheduledAt1 = signal('');
  readonly scheduledAt2 = signal('');
  /** Si el usuario ya ha tocado la 2ª convocatoria: a partir de ahí deja de seguir a la 1ª. */
  readonly secondConvocationEdited = signal(false);
  readonly showMap = signal(false);

  // Paso 2 — orden del día
  readonly agenda = signal<AgendaItem[]>([newAgendaItem()]);

  // Paso 3 — invitados y documentos
  readonly attendees = signal<JuntaAttendee[]>([]);
  readonly owners = signal<JuntaOwner[]>([]);
  readonly loadingOwners = signal(false);
  readonly includeJitsi = signal(false);
  readonly telematicBackingConfirmed = signal(false);
  readonly attachments = signal<File[]>([]);
  readonly signerRole = signal<MeetingSignerRole>('administrador');
  readonly signerName = signal('');

  // Paso 3 — convocatoria: el servidor la redacta con los datos del borrador y la gestora la edita aquí.
  readonly convocatoria = signal<ConvocatoriaDocument | null>(null);
  /** Texto con el que se redactó (JSON), para saber si la gestora lo ha editado. */
  readonly convocatoriaBase = signal('');
  /** Datos del borrador con los que se redactó (ver `convocatoriaKey`), para saber si han cambiado después. */
  readonly convocatoriaSource = signal('');
  readonly convocatoriaLoading = signal(false);
  readonly convocatoriaError = signal('');

  // Estado del flujo
  readonly saving = signal(false);
  readonly error = signal<JuntaStepError | null>(null);
  readonly errorField = computed(() => this.error()?.field ?? null);

  readonly fullAddress = computed(() => buildFullAddress(this.street(), this.postalCode(), this.city()));

  /** La gestora ha cambiado algo del texto que redactó el servidor. */
  readonly convocatoriaEdited = computed(() => {
    const doc = this.convocatoria();
    return doc !== null && JSON.stringify(doc) !== this.convocatoriaBase();
  });

  /**
   * Datos del borrador que entran en la convocatoria (tipo, convocante, fechas, lugar, títulos del orden del día
   * y firma); `null` mientras las fechas no sean válidas.
   */
  readonly convocatoriaKey = computed<string | null>(() => {
    const payload = this.convocatoriaPayload();
    if (!payload) return null;
    return JSON.stringify({ ...payload, agenda: payload.agenda.map((item) => item.title.trim()) });
  });

  /** La convocatoria se redactó con unos datos que han cambiado desde entonces. */
  readonly convocatoriaStale = computed(() => {
    const key = this.convocatoriaKey();
    return this.convocatoria() !== null && key !== null && key !== this.convocatoriaSource();
  });

  /** Cambia con cualquier edición del borrador (lo usa el wizard para retirar un error ya corregido). */
  readonly snapshot = computed(() => this.serialize());

  private baseline = '';
  private agendaPrepared = false;

  /** Explicit selection also works while editing; loading historical data does not call this. */
  setType(type: MeetingType): void {
    this.type.set(type);
    if (type === 'ordinaria') this.addOrdinaryPoints();
  }

  /** Seed the initial ordinary selection once, before displaying/validating the agenda. */
  prepareAgenda(): void {
    if (this.agendaPrepared) return;
    this.agendaPrepared = true;
    if (this.type() === 'ordinaria') this.addOrdinaryPoints();
  }

  private addOrdinaryPoints(): void {
    this.agendaPrepared = true;
    const existing = this.agenda().map(item => {
      const key = ordinaryAgendaKey(item);
      return key && !item.systemKey ? { ...item, systemKey: key } : item;
    });
    const missing = ORDINARY_AGENDA.filter(definition => !existing.some(item => item.systemKey === definition.key))
      .map(definition => ordinaryAgendaItem(definition, newAgendaItem()));
    // Replace only the untouched initial empty placeholder; never discard user content.
    const onlyBlank = existing.length === 1 && !existing[0].title && !existing[0].description
      && !existing[0].comments && !existing[0].hasVote && !existing[0].voteTemplate
      && !existing[0].treatedAt && !existing[0].systemKey;
    this.agenda.set([...missing, ...(onlyBlank && missing.length ? [] : existing)]);
  }

  reset(): void {
    this.agendaPrepared = false;
    this.estateId.set('');
    this.estateOptions.set([]);
    this.title.set('');
    this.type.set('ordinaria');
    this.convokedBy.set('presidente');
    this.street.set('');
    this.postalCode.set('');
    this.city.set('');
    this.scheduledAt1.set('');
    this.scheduledAt2.set('');
    this.secondConvocationEdited.set(false);
    this.showMap.set(false);
    this.agenda.set([newAgendaItem()]);
    this.attendees.set([]);
    this.owners.set([]);
    this.loadingOwners.set(false);
    this.includeJitsi.set(false);
    this.telematicBackingConfirmed.set(false);
    this.attachments.set([]);
    this.convocatoria.set(null);
    this.convocatoriaBase.set('');
    this.convocatoriaSource.set('');
    this.convocatoriaLoading.set(false);
    this.convocatoriaError.set('');
    this.signerRole.set('administrador');
    this.signerName.set('');
    this.saving.set(false);
    this.error.set(null);
    this.markPristine();
  }

  /**
   * Precarga el borrador con una junta existente (edición). El lugar se guarda como una sola
   * cadena, así que va entero en `street`: `fullAddress` lo devuelve tal cual.
   */
  loadFromMeeting(meeting: Meeting): void {
    this.reset();
    this.title.set(meeting.title);
    this.type.set(meeting.type);
    this.convokedBy.set(meeting.convokedBy);
    this.street.set(meeting.location ?? '');
    this.scheduledAt1.set(toLocalInput(meeting.scheduledAt1));
    this.scheduledAt2.set(toLocalInput(meeting.scheduledAt2));
    // Las convocatorias ya existen: la 2ª no debe volver a seguir a la 1ª.
    this.secondConvocationEdited.set(true);
    this.agenda.set(structuredClone(meeting.agenda));
    this.agendaPrepared = true;
    this.signerRole.set(meeting.signerRole);
    this.signerName.set(meeting.signerName ?? '');
    this.markPristine();
  }

  /** Fija el estado actual como "sin cambios" (p. ej. tras precargar los propietarios). */
  markPristine(): void {
    this.baseline = this.serialize();
  }

  isDirty(): boolean {
    return this.serialize() !== this.baseline;
  }

  private serialize(): string {
    return JSON.stringify([
      this.estateId(), this.title(), this.type(), this.convokedBy(), this.street(), this.postalCode(), this.city(),
      this.scheduledAt1(), this.scheduledAt2(), this.agenda(), this.attendees(),
      this.includeJitsi(), this.telematicBackingConfirmed(), this.signerRole(), this.signerName(),
      this.convocatoriaEdited() ? this.convocatoria() : null,
      this.attachments().map((f) => [f.name, f.size, f.lastModified]),
    ]);
  }

  // ── Validación (mismas reglas y mensajes que el formulario único anterior) ──

  validateDetails(): JuntaStepError | null {
    if (this.estateOptions().length && !this.estateId()) return { step: 1, field: 'estate', message: 'Elige la comunidad de la junta.' };
    if (!this.title().trim()) return { step: 1, field: 'title', message: 'El título es obligatorio.' };
    if (this.title().trim().length > 36) return { step: 1, field: 'title', message: 'El título no puede superar los 36 caracteres.' };
    if (!this.scheduledAt1() || !this.scheduledAt2()) {
      return { step: 1, field: 'dates', message: 'Debes indicar fecha y hora de 1ª y 2ª convocatoria.' };
    }
    if (new Date(this.scheduledAt2()) <= new Date(this.scheduledAt1())) {
      return { step: 1, field: 'dates', message: 'La 2ª convocatoria debe ser posterior a la 1ª convocatoria.' };
    }
    return null;
  }

  validateAgenda(): JuntaStepError | null {
    const agenda = this.agenda();
    const fail = (message: string): JuntaStepError => ({ step: 2, field: 'agenda', message });
    if (agenda.length === 0) return fail('Agrega al menos un punto al orden del día.');
    if (agenda.some((i) => !i.title.trim())) return fail('Todos los puntos deben tener título.');
    for (const item of agenda) {
      if (!item.hasVote || !item.voteTemplate) continue;
      for (const q of item.voteTemplate.questions) {
        if (!q.title.trim()) return fail(`Hay preguntas sin título en "${item.title}".`);
        if ((q.type === 'single_choice' || q.type === 'multiple_choice') && (q.options?.length ?? 0) < 2) {
          return fail(`Una pregunta de opciones necesita al menos 2 opciones en "${item.title}".`);
        }
        if (q.type !== 'text' && !q.majorityType) {
          return fail(`Elige el tipo de mayoría de cada pregunta de "${item.title}".`);
        }
      }
    }
    return null;
  }

  /**
   * 1ª convocatoria: al completarla se sugiere la 2ª (+30 min) mientras el usuario no haya
   * editado la 2ª. Si la 1ª se vacía o queda incompleta, la 2ª no se toca.
   */
  setFirstConvocation(value: string): void {
    this.scheduledAt1.set(value);
    if (value && !this.secondConvocationEdited()) {
      this.scheduledAt2.set(addMinutes(value, SECOND_CONVOCATION_GAP_MINUTES));
    }
  }

  /** Cualquier edición del usuario en la 2ª convocatoria la fija: no se vuelve a sobrescribir. */
  setSecondConvocation(value: string): void {
    this.secondConvocationEdited.set(true);
    this.scheduledAt2.set(value);
  }

  /** La 2ª es una sugerencia (no editada) y hay valor: se avisa de que es modificable. */
  readonly secondConvocationSuggested = computed(() => !this.secondConvocationEdited() && !!this.scheduledAt2());

  /** Primer error de los pasos `from`…`to` (inclusive); el paso 3 no tiene validaciones obligatorias. */
  firstError(from: JuntaStep, to: JuntaStep): JuntaStepError | null {
    if (from <= 1 && to >= 1) {
      const error = this.validateDetails();
      if (error) return error;
    }
    if (from <= 2 && to >= 2) {
      const error = this.validateAgenda();
      if (error) return error;
    }
    return null;
  }

  /** Datos con los que el servidor redacta la convocatoria; `null` si las fechas aún no son válidas. */
  convocatoriaPayload(): ConvocatoriaPreviewPayload | null {
    const first = new Date(this.scheduledAt1());
    const second = new Date(this.scheduledAt2());
    if (Number.isNaN(first.getTime()) || Number.isNaN(second.getTime()) || second <= first) return null;
    return {
      type: this.type(),
      convokedBy: this.convokedBy(),
      scheduledAt1: first.toISOString(),
      scheduledAt2: second.toISOString(),
      location: this.fullAddress() || undefined,
      agenda: this.agenda(),
      signerRole: this.signerRole(),
      signerName: this.signerName().trim() || undefined,
    };
  }

  /** Guarda una convocatoria recién redactada por el servidor como punto de partida. */
  setConvocatoria(doc: ConvocatoriaDocument, key: string | null): void {
    this.convocatoria.set(doc);
    this.convocatoriaBase.set(JSON.stringify(doc));
    this.convocatoriaSource.set(key ?? '');
  }

  toUpdatePayload(): UpdateMeetingPayload {
    return {
      title: this.title().trim(),
      type: this.type(),
      scheduledAt1: new Date(this.scheduledAt1()).toISOString(),
      scheduledAt2: new Date(this.scheduledAt2()).toISOString(),
      agenda: this.agenda(),
      convokedBy: this.convokedBy(),
      location: this.fullAddress(),
      signerRole: this.signerRole(),
      signerName: this.signerName().trim(),
    };
  }

  toPayload(): CreateMeetingPayload {
    return {
      title: this.title().trim(),
      type: this.type(),
      scheduledAt1: new Date(this.scheduledAt1()).toISOString(),
      scheduledAt2: new Date(this.scheduledAt2()).toISOString(),
      agenda: this.agenda(),
      convokedBy: this.convokedBy(),
      location: this.fullAddress() || undefined,
      signerRole: this.signerRole(),
      signerName: this.signerName().trim() || undefined,
      attendeeEmails: this.attendees().map((a) => a.email),
      includeJitsi: this.includeJitsi(),
      telematicBackingConfirmed: this.includeJitsi() ? this.telematicBackingConfirmed() : undefined,
      // Solo si la gestora la ha editado: si no, el servidor la redacta igual al pedirla.
      convocatoria: this.convocatoriaEdited() ? (this.convocatoria() ?? undefined) : undefined,
    };
  }
}
