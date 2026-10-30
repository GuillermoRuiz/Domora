import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '../../prisma/client';
import { createHash } from 'node:crypto';
import { LibraryService } from '../../documents/library.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EstateAccessService } from '../../estate-access/estate-access.service';
import { StorageService } from '../../files/storage.service';
import type { AuthenticatedUser } from '../../auth/auth.types';
import { listPresentPropertyIds } from '../meeting-quorum.service';
import { buildActaDocument, type ActaTexts } from './acta-document.builder';
import type { ActaDocumentModel, ActaTextBlock } from './acta-document.model';
import { actaContentHash } from './acta-hash';
import { ActaNarrativeService, notesAsText, type NarrativeResult } from './acta-narrative.service';
import { ActaPdfService } from './acta-pdf.service';
import { ActaSnapshotService } from './acta-snapshot.service';
import type { ActaSourceSnapshot } from './acta-snapshot.types';
import { validateActaPreparation, type ActaValidation, type ActaValidationInput } from './acta-validation';
import type { GenerateActaDto, SaveActaEditsDto } from './dto/acta.dto';

/** Datos que se limpian al volver del archivo subido al acta generada. */
const UPLOAD_CLEARED = {
  actaOrigin: 'generated' as const,
  actaUploadS3Key: null,
  actaUploadFileName: null,
  actaUploadMimeType: null,
  actaUploadSizeBytes: null,
  actaUploadSha256: null,
  actaUploadedAt: null,
};

/** Datos mínimos de una versión para elegirla en el selector del visor. */
export interface ActaVersionSummary {
  id: string;
  versionNumber: number;
  status: VersionStatus;
  statusLabel: string;
  createdAt: string;
  savedByName: string | null;
}

type VersionStatus = 'draft' | 'readyForSignature' | 'signed' | 'superseded';

const STATUS_LABEL: Record<VersionStatus, string> = {
  draft: 'Borrador',
  readyForSignature: 'Lista para firma',
  signed: 'Firmada',
  superseded: 'Sustituida',
};

/** Fila de `meeting_acta_versions` de tipo documento (con `generatedAt`). */
interface FullVersionRow {
  id: string;
  versionNumber: number;
  status: VersionStatus;
  createdAt: Date;
  generatedAt: Date | null;
  sourceSnapshot: unknown;
  documentModel: unknown;
  narrative: unknown;
  versionHash: string | null;
  pdfS3Key: string | null;
  preparedAt: Date | null;
  savedBy?: { fullName: string } | null;
}

export interface ActaVersionView {
  id: string;
  versionNumber: number;
  status: VersionStatus;
  statusLabel: string;
  createdAt: string;
  generatedAt: string | null;
  preparedAt: string | null;
  savedByName: string | null;
  /** SHA-256 del contenido canónico del documento. Integridad, no firma. */
  versionHash: string | null;
  hasPdf: boolean;
  snapshotCapturedAt: string | null;
  narrative: { mode: 'llm' | 'fallback'; model: string | null; reason: string | null } | null;
  /** Las notas de la gestora cambiaron después de generar esta versión (se pueden volver a redactar). */
  notesChanged: boolean;
  /** Se puede editar: borrador o lista para firma (editar una lista para firma crea un borrador nuevo). */
  editable: boolean;
  document: ActaDocumentModel;
}

/** Fichero multipart tal y como lo entrega multer (sin @types/multer). */
export interface UploadedActaFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Formatos que admite un acta subida. */
export const ACTA_UPLOAD_MIME = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

/** Archivo subido como acta de la junta. */
export interface ActaUploadInfo {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** SHA-256 (hex) del archivo: lo que firman presidente y secretario. */
  sha256: string;
  uploadedAt: string;
}

export interface ActaState {
  /** Origen del acta: redactada en Domora o subida ya hecha. */
  origin: 'generated' | 'uploaded';
  /** Archivo subido (si lo hay). Con origen `uploaded` es el documento que se firma. */
  upload: ActaUploadInfo | null;
  version: ActaVersionView | null;
  /** Acta anterior al nuevo formato: solo existe el `.docx` heredado, si ya está firmada. */
  legacy: { signed: boolean; hasDocx: boolean };
}

function cleanText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** Cambia el texto de un bloque editable conservando el original para poder compararlo o restaurarlo. */
function setBlockText(block: ActaTextBlock, text: string): void {
  const next = cleanText(text);
  if (next === block.text) return;
  if (block.generatedText === undefined) {
    block.generatedText = block.text;
    block.generatedOrigin = block.origin === 'edited' ? 'notes' : block.origin;
  }
  block.text = next;
  block.origin = next === block.generatedText ? (block.generatedOrigin ?? 'notes') : 'edited';
}

export interface ActaEdits {
  introduction?: string;
  observations?: string;
  nextSteps?: string;
  items?: { id: string; narrative: string }[];
}

/**
 * Aplica las ediciones de la gestora a una COPIA del documento. Solo toca los bloques de texto
 * redactable; lo factual (asistencia, votos, resultados, fechas) no se puede modificar por aquí.
 */
export function applyActaEdits(model: ActaDocumentModel, edits: ActaEdits): ActaDocumentModel {
  const next = JSON.parse(JSON.stringify(model)) as ActaDocumentModel;
  if (edits.introduction !== undefined) setBlockText(next.constitution.introduction, edits.introduction);
  if (edits.observations !== undefined) setBlockText(next.observations, edits.observations);
  if (edits.nextSteps !== undefined) setBlockText(next.nextSteps, edits.nextSteps);
  for (const edit of edits.items ?? []) {
    const item = next.items.find((entry) => entry.id === edit.id);
    if (!item) throw new NotFoundException(`No hay ningún punto del acta con id "${edit.id}".`);
    setBlockText(item.narrative, edit.narrative);
  }
  return next;
}

/**
 * Orquesta el acta canónica: validar → congelar los datos (snapshot) → construir el documento →
 * versionarlo. Preview, PDF y `.docx` consumen el mismo `ActaDocumentModel` guardado en la
 * versión; nada se recalcula contra datos vivos una vez creada.
 */
@Injectable()
export class ActaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly snapshots: ActaSnapshotService,
    private readonly narrator: ActaNarrativeService,
    private readonly pdf: ActaPdfService,
    private readonly storage: StorageService,
    private readonly library: LibraryService,
  ) {}

  // ── acceso ───────────────────────────────────────────────────────────────

  private async loadMeeting(meetingId: string, user: AuthenticatedUser) {
    const meeting = await this.prisma.meeting.findFirst({ where: { id: meetingId } });
    if (!meeting) throw new NotFoundException(`Junta ${meetingId} no encontrada.`);
    this.estateAccess.assertAccess(meeting.estateId, user);
    if (user.role !== 'A' && user.role !== 'B') {
      throw new ForbiddenException('Solo un administrador de finca puede preparar el acta.');
    }
    return meeting;
  }

  /** Última versión de documento (en cualquier estado salvo `superseded`), la más reciente primero. */
  private async latestVersion(meetingId: string): Promise<FullVersionRow | null> {
    const row = await this.prisma.meetingActaVersion.findFirst({
      where: { meetingId, generatedAt: { not: null }, status: { not: 'superseded' } },
      orderBy: { versionNumber: 'desc' },
      include: { savedBy: { select: { fullName: true } } },
    });
    return row as unknown as FullVersionRow | null;
  }

  // ── lectura ──────────────────────────────────────────────────────────────

  async getCurrent(meetingId: string, user: AuthenticatedUser): Promise<ActaState> {
    const meeting = await this.loadMeeting(meetingId, user);
    const version = await this.latestVersion(meetingId);
    return {
      origin: meeting.actaOrigin === 'uploaded' ? 'uploaded' : 'generated',
      upload: meeting.actaUploadS3Key
        ? {
            fileName: meeting.actaUploadFileName ?? 'acta',
            mimeType: meeting.actaUploadMimeType ?? 'application/octet-stream',
            sizeBytes: meeting.actaUploadSizeBytes ?? 0,
            sha256: meeting.actaUploadSha256 ?? '',
            uploadedAt: (meeting.actaUploadedAt ?? new Date(0)).toISOString(),
          }
        : null,
      version: version ? this.toView(version, meeting) : null,
      legacy: { signed: meeting.status === 'firmada' || !!meeting.actaSignedAt, hasDocx: !!meeting.actaS3Key },
    };
  }

  /** Todas las versiones generadas del acta (también las sustituidas), la más reciente primero. */
  async listVersions(meetingId: string, user: AuthenticatedUser): Promise<ActaVersionSummary[]> {
    await this.loadMeeting(meetingId, user);
    const rows = await this.prisma.meetingActaVersion.findMany({
      where: { meetingId, generatedAt: { not: null } },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true, status: true, createdAt: true, savedBy: { select: { fullName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      versionNumber: row.versionNumber,
      status: row.status as VersionStatus,
      statusLabel: STATUS_LABEL[row.status as VersionStatus],
      createdAt: row.createdAt.toISOString(),
      savedByName: row.savedBy?.fullName ?? null,
    }));
  }

  /** Una versión concreta, para consultarla. Las sustituidas llegan siempre como solo lectura. */
  async getVersion(meetingId: string, versionId: string, user: AuthenticatedUser): Promise<ActaVersionView> {
    const meeting = await this.loadMeeting(meetingId, user);
    const row = (await this.prisma.meetingActaVersion.findFirst({
      where: { id: versionId, meetingId, generatedAt: { not: null } },
      include: { savedBy: { select: { fullName: true } } },
    })) as unknown as FullVersionRow | null;
    if (!row) throw new NotFoundException(`La versión ${versionId} del acta no existe.`);
    return this.toView(row, meeting);
  }

  async validate(meetingId: string, user: AuthenticatedUser): Promise<ActaValidation> {
    const meeting = await this.loadMeeting(meetingId, user);
    return this.runValidation(meeting);
  }

  private async runValidation(meeting: {
    id: string;
    estateId: string;
    status: string;
    scheduledAt1: Date;
    scheduledAt2: Date;
    celebratedAt: Date | null;
    actualStartAt: Date | null;
    actualEndAt: Date | null;
    effectiveConvocation: 'primera' | 'segunda' | null;
    location: string | null;
    agenda: unknown;
  }): Promise<ActaValidation> {
    const [open, closed, properties, present, latest] = await Promise.all([
      this.prisma.voteSession.count({ where: { meetingId: meeting.id, status: 'abierta' } }),
      this.prisma.voteSession.findMany({ where: { meetingId: meeting.id, status: 'cerrada' }, select: { agendaItemId: true, questionIndex: true } }),
      this.prisma.property.findMany({ where: { estateId: meeting.estateId, deletedAt: null }, select: { id: true, participationQuota: true } }),
      listPresentPropertyIds(this.prisma, meeting.id),
      this.latestVersion(meeting.id),
    ]);
    const input: ActaValidationInput = {
      meeting,
      openVoteSessions: open,
      closedVoteSessions: closed,
      censusCount: properties.length,
      missingQuotaCount: properties.filter((property) => property.participationQuota == null).length,
      presentCount: properties.filter((property) => present.has(property.id)).length,
      hasVersion: !!latest,
    };
    return validateActaPreparation(input);
  }

  // ── generar ──────────────────────────────────────────────────────────────

  /**
   * Prepara el borrador. Si ya hay una versión no se crea otra (abrir el visor no versiona); se
   * crea una nueva solo con `refresh` o si cambian los datos confirmados de la reunión.
   */
  async generate(meetingId: string, dto: GenerateActaDto, user: AuthenticatedUser): Promise<ActaVersionView> {
    let meeting = await this.loadMeeting(meetingId, user);
    if (meeting.status === 'firmada') {
      throw new ConflictException('El acta ya está firmada: no se puede generar de nuevo.');
    }

    const changes: Prisma.MeetingUpdateManyMutationInput = {};
    if (dto.actualStartAt && new Date(dto.actualStartAt).getTime() !== meeting.actualStartAt?.getTime()) changes.actualStartAt = new Date(dto.actualStartAt);
    if (dto.actualEndAt && new Date(dto.actualEndAt).getTime() !== meeting.actualEndAt?.getTime()) changes.actualEndAt = new Date(dto.actualEndAt);
    if (dto.effectiveConvocation && dto.effectiveConvocation !== meeting.effectiveConvocation) changes.effectiveConvocation = dto.effectiveConvocation;

    const latest = await this.latestVersion(meetingId);
    if (latest && !dto.refresh && Object.keys(changes).length === 0) return this.toView(latest, meeting);

    if (Object.keys(changes).length > 0) {
      if (meeting.status !== 'celebrada') {
        throw new ConflictException('Solo se pueden confirmar los datos de la reunión cuando la junta está celebrada.');
      }
      const { count } = await this.prisma.meeting.updateMany({ where: { id: meetingId, status: 'celebrada' }, data: changes });
      if (count === 0) throw new ConflictException('La junta ya no admite cambios en el acta.');
      meeting = await this.prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    }

    const validation = await this.runValidation(meeting);
    if (!validation.canGenerate) {
      throw new UnprocessableEntityException({ message: 'Faltan datos para preparar el acta.', validation });
    }

    const snapshot = await this.snapshots.capture(meetingId);
    const introduction = latest ? (latest.documentModel as ActaDocumentModel).constitution.introduction.text : '';
    const { model, narrative } = await this.compose(snapshot, introduction);
    const created = await this.createVersion(meeting, user, snapshot, model, this.narrativeRecord(narrative));
    return this.toView(created, meeting);
  }

  /** Redacta las notas y construye el documento a partir del snapshot (única vía de construcción). */
  private async compose(snapshot: ActaSourceSnapshot, introduction: string): Promise<{ model: ActaDocumentModel; narrative: NarrativeResult }> {
    const sections = [
      ...snapshot.agenda.filter((item) => item.comments).map((item) => ({ id: item.id, title: item.title, notes: item.comments as string })),
      ...(snapshot.text.generalComments ? [{ id: 'observations', title: 'Observaciones generales de la junta', notes: snapshot.text.generalComments }] : []),
    ];
    const narrative = await this.narrator.draft(sections);
    const drafted = (id: string) => {
      const section = narrative.sections[id];
      return section ? { text: section.text, origin: section.mode === 'llm' ? ('generated' as const) : ('notes' as const) } : undefined;
    };
    const texts: ActaTexts = {
      introduction,
      items: Object.fromEntries(snapshot.agenda.map((item) => [item.id, drafted(item.id)])),
      observations: drafted('observations') ?? null,
    };
    return { model: buildActaDocument(snapshot, texts), narrative };
  }

  private narrativeRecord(narrative: NarrativeResult) {
    return {
      mode: narrative.mode,
      model: narrative.model,
      reason: narrative.reason,
      sections: Object.fromEntries(Object.entries(narrative.sections).map(([id, section]) => [id, { mode: section.mode }])),
    };
  }

  /**
   * Crea una versión de documento: numeración compartida con las versiones de solo textos, las
   * versiones anteriores sin firmar pasan a `superseded` y se calcula el SHA-256 del contenido.
   */
  private async createVersion(
    meeting: { id: string; estateId: string; title: string },
    user: AuthenticatedUser,
    snapshot: ActaSourceSnapshot,
    model: ActaDocumentModel,
    narrative: unknown,
  ): Promise<FullVersionRow> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const last = await tx.meetingActaVersion.findFirst({ where: { meetingId: meeting.id }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true } });
        await tx.meetingActaVersion.updateMany({
          where: { meetingId: meeting.id, generatedAt: { not: null }, status: { in: ['draft', 'readyForSignature'] } },
          data: { status: 'superseded' },
        });
        const created = await tx.meetingActaVersion.create({
          data: {
            meetingId: meeting.id,
            versionNumber: (last?.versionNumber ?? 0) + 1,
            // Las columnas de texto se mantienen para que el histórico de textos de la pestaña Acta siga funcionando.
            generalComments: snapshot.text.generalComments,
            nextSteps: snapshot.text.nextSteps,
            pointComments: snapshot.agenda.map((item) => ({ id: item.id, title: item.title, comments: item.comments ?? '' })) as unknown as Prisma.InputJsonValue,
            savedByUserId: user.id,
            status: 'draft',
            generatedAt: new Date(),
            sourceSnapshot: snapshot as unknown as Prisma.InputJsonValue,
            documentModel: model as unknown as Prisma.InputJsonValue,
            narrative: narrative as Prisma.InputJsonValue,
            versionHash: actaContentHash(model),
          },
          include: { savedBy: { select: { fullName: true } } },
        });
        await tx.activityLogEntry.create({
          data: {
            actorUserId: user.id,
            subjectType: 'meeting',
            subjectId: meeting.id,
            verb: 'updated',
            summary: `Acta de "${meeting.title}": versión ${created.versionNumber} generada`,
            occurredAt: new Date(),
            estateId: meeting.estateId,
          },
        });
        return created as unknown as FullVersionRow;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Otra persona acaba de guardar una versión del acta: vuelve a intentarlo.');
      }
      throw error;
    }
  }

  // ── editar ───────────────────────────────────────────────────────────────

  async saveEdits(meetingId: string, dto: SaveActaEditsDto, user: AuthenticatedUser): Promise<ActaVersionView> {
    const meeting = await this.loadMeeting(meetingId, user);
    const latest = await this.requireEditable(meetingId, meeting.status);
    if (latest.id !== dto.baseVersionId) {
      throw new ConflictException('Hay una versión más reciente del acta: recárgala antes de guardar tus cambios.');
    }
    const current = latest.documentModel as ActaDocumentModel;
    const edited = applyActaEdits(current, dto);
    if (actaContentHash(edited) === actaContentHash(current)) return this.toView(latest, meeting);
    const created = await this.createVersion(meeting, user, latest.sourceSnapshot as ActaSourceSnapshot, edited, latest.narrative);
    return this.toView(created, meeting);
  }

  /**
   * Vuelve a redactar las notas de la gestora (y recoge las que cambió después de generar el
   * acta). La asistencia, los votos y demás datos congelados NO se tocan. Las ediciones hechas
   * a mano en los bloques redactados se sustituyen; el párrafo previo opcional se conserva.
   */
  async regenerateNarrative(meetingId: string, user: AuthenticatedUser): Promise<ActaVersionView> {
    const meeting = await this.loadMeeting(meetingId, user);
    const latest = await this.requireEditable(meetingId, meeting.status);
    const snapshot = this.withLiveNotes(latest, meeting);
    const introduction = (latest.documentModel as ActaDocumentModel).constitution.introduction.text;
    const { model, narrative } = await this.compose(snapshot, introduction);
    if (actaContentHash(model) === latest.versionHash) return this.toView(latest, meeting);
    const created = await this.createVersion(meeting, user, snapshot, model, this.narrativeRecord(narrative));
    return this.toView(created, meeting);
  }

  /**
   * Recoge en el borrador las notas que la gestora escribió o cambió después de generarlo
   * (comentarios generales, de cada punto y actuaciones derivadas), SIN pisar los textos que ya
   * editó a mano en el visor. Los datos congelados de la junta no se tocan, salvo el nombre y el
   * DNI de los asistentes en borradores anteriores a incluirlos.
   */
  async syncNotes(meetingId: string, user: AuthenticatedUser): Promise<ActaVersionView> {
    const meeting = await this.loadMeeting(meetingId, user);
    const latest = await this.requireEditable(meetingId, meeting.status);
    const current = latest.documentModel as ActaDocumentModel;
    let snapshot = this.withLiveNotes(latest, meeting);
    // Borradores anteriores a incluir nombre y DNI: se completan con quienes asisten ahora a cada propiedad.
    if (snapshot.attendance.length > 0 && snapshot.attendance.every((row) => row.attendeeDni === undefined)) {
      const { names, dnis } = await this.snapshots.attendeeIdentities(meetingId);
      snapshot = {
        ...snapshot,
        attendance: snapshot.attendance.map((row) => ({ ...row, attendeeName: names.get(row.propertyId) ?? null, attendeeDni: dnis.get(row.propertyId) ?? null })),
      };
    }
    const { model: fresh, narrative } = await this.compose(snapshot, current.constitution.introduction.text);
    const keepEdited = <T extends { origin: string }>(old: T | undefined, next: T): T => (old?.origin === 'edited' ? old : next);
    const model: ActaDocumentModel = {
      ...fresh,
      items: fresh.items.map((item) => {
        const old = current.items.find((entry) => entry.id === item.id);
        return { ...item, narrative: keepEdited(old?.narrative, item.narrative) };
      }),
      observations: keepEdited(current.observations, fresh.observations),
      nextSteps: keepEdited(current.nextSteps, fresh.nextSteps),
    };
    if (actaContentHash(model) === latest.versionHash) return this.toView(latest, meeting);
    const created = await this.createVersion(meeting, user, snapshot, model, this.narrativeRecord(narrative));
    return this.toView(created, meeting);
  }

  /** Snapshot congelado de la versión, con las notas vigentes de la junta en lugar de las que tenía al generarla. */
  private withLiveNotes(
    latest: FullVersionRow,
    meeting: { agenda: unknown; actaGeneralComments: string | null; actaNextSteps: string | null },
  ): ActaSourceSnapshot {
    const frozen = latest.sourceSnapshot as ActaSourceSnapshot;
    const agenda = (Array.isArray(meeting.agenda) ? meeting.agenda : []) as { id: string; comments?: string }[];
    return {
      ...frozen,
      agenda: frozen.agenda.map((item) => {
        const live = agenda.find((entry) => entry.id === item.id);
        return live ? { ...item, comments: live.comments?.trim() || null } : item;
      }),
      text: { generalComments: meeting.actaGeneralComments?.trim() || null, nextSteps: meeting.actaNextSteps?.trim() || null },
    };
  }

  private async requireEditable(meetingId: string, meetingStatus: string): Promise<FullVersionRow> {
    if (meetingStatus === 'firmada') throw new ConflictException('El acta ya está firmada: no se puede editar.');
    if (meetingStatus === 'cancelada') throw new ConflictException('La junta está cancelada: no tiene acta.');
    const latest = await this.latestVersion(meetingId);
    if (!latest) throw new NotFoundException('Todavía no hay un borrador del acta: genéralo primero.');
    if (latest.status === 'signed') throw new ConflictException('La versión del acta ya está firmada: no se puede editar.');
    return latest;
  }

  // ── preparar para firma ──────────────────────────────────────────────────

  /**
   * Marca la última versión como `readyForSignature` y guarda su PDF. NO firma: deja una versión
   * concreta, con su huella SHA-256 y su PDF, sobre la que la firma avanzada se conectará después.
   */
  async prepareForSignature(meetingId: string, user: AuthenticatedUser): Promise<ActaVersionView> {
    const meeting = await this.loadMeeting(meetingId, user);
    const latest = await this.requireEditable(meetingId, meeting.status);
    const switchesBack = meeting.actaOrigin === 'uploaded';
    // Ya preparada: no se repite el trabajo, salvo que haya que volver del archivo subido al borrador generado.
    const alreadyPrepared = latest.status === 'readyForSignature' && !!latest.pdfS3Key;
    if (alreadyPrepared && !switchesBack) return this.toView(latest, meeting);

    const validation = await this.runValidation(meeting);
    if (!validation.canGenerate) {
      throw new UnprocessableEntityException({ message: 'No se puede preparar el acta para la firma.', validation });
    }
    if (switchesBack && (meeting.actaSignedByPresidenteUserId || meeting.actaSignedBySecretarioUserId)) {
      throw new ConflictException('El acta subida ya tiene firmas: no se puede cambiar al borrador generado.');
    }
    const model = latest.documentModel as ActaDocumentModel;
    const key = alreadyPrepared
      ? (latest.pdfS3Key as string)
      : await this.storage.put(`meetings/${meetingId}/acta`, `acta-v${latest.versionNumber}.pdf`, await this.pdf.render(model, { footerNote: this.footerNote(latest.versionHash) }));
    const updated = await this.prisma.$transaction(async (tx) => {
      if (!alreadyPrepared) {
        const { count } = await tx.meetingActaVersion.updateMany({
          where: { id: latest.id, status: 'draft' },
          data: { status: 'readyForSignature', preparedAt: new Date(), pdfS3Key: key },
        });
        if (count === 0) throw new ConflictException('La versión del acta cambió mientras se preparaba: vuelve a intentarlo.');
        await tx.activityLogEntry.create({
          data: {
            actorUserId: user.id,
            subjectType: 'meeting',
            subjectId: meetingId,
            verb: 'updated',
            summary: `Acta de "${meeting.title}": versión ${latest.versionNumber} preparada para la firma`,
            occurredAt: new Date(),
            estateId: meeting.estateId,
          },
        });
      }
      // Elegir el borrador generado para la firma deja el acta como «generada»; el archivo subido se retira.
      if (switchesBack) {
        await tx.meeting.update({ where: { id: meetingId }, data: UPLOAD_CLEARED });
        await tx.activityLogEntry.create({
          data: {
            actorUserId: user.id,
            subjectType: 'meeting',
            subjectId: meetingId,
            verb: 'updated',
            summary: `Acta de "${meeting.title}": se usa el borrador generado en lugar del archivo subido`,
            occurredAt: new Date(),
            estateId: meeting.estateId,
          },
        });
      }
      return tx.meetingActaVersion.findUniqueOrThrow({ where: { id: latest.id }, include: { savedBy: { select: { fullName: true } } } });
    });
    if (switchesBack && meeting.actaUploadS3Key) await this.storage.delete(meeting.actaUploadS3Key).catch(() => undefined);
    return this.toView(updated as unknown as FullVersionRow, meeting);
  }

  // ── acta subida ──────────────────────────────────────────────────────────

  /**
   * Sube un acta ya hecha (PDF o Word) como acta de la junta.
   *  - `alreadySigned`: el archivo ya viene firmado fuera de Domora → la junta pasa a «firmada» sin proceso de firma.
   *  - si no, queda pendiente de firma y presidente y secretario firman en Domora sobre ese archivo (se guarda su SHA-256).
   * El borrador generado y sus versiones NO se tocan. Mientras no haya firmas se puede subir otro archivo.
   */
  async uploadExisting(meetingId: string, file: UploadedActaFile | undefined, alreadySigned: boolean, user: AuthenticatedUser): Promise<ActaState> {
    const meeting = await this.loadMeeting(meetingId, user);
    if (!file) throw new BadRequestException('No se recibió ningún archivo (campo "file").');
    if (meeting.status === 'cancelada') throw new ConflictException('La junta está cancelada: no tiene acta.');
    if (meeting.status === 'firmada' || meeting.actaSignedAt) throw new ConflictException('El acta ya está firmada: no se puede sustituir.');
    if (meeting.status !== 'celebrada') throw new ConflictException('Solo se puede subir el acta de una junta ya celebrada.');
    if (meeting.actaSignedByPresidenteUserId || meeting.actaSignedBySecretarioUserId) {
      throw new ConflictException('El acta ya tiene firmas puestas: no se puede sustituir el archivo.');
    }
    if (!ACTA_UPLOAD_MIME.has(file.mimetype)) throw new BadRequestException('Solo se admiten actas en PDF o DOCX.');
    this.storage.assertAllowed(file.mimetype, file.size);

    const now = new Date();
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const key = await this.storage.put(`meetings/${meetingId}/acta-upload`, file.originalname, file.buffer);
    const previousKey = meeting.actaUploadS3Key;
    await this.prisma.$transaction(async (tx) => {
      await tx.meeting.update({
        where: { id: meetingId },
        data: {
          actaOrigin: 'uploaded',
          actaUploadS3Key: key,
          actaUploadFileName: file.originalname,
          actaUploadMimeType: file.mimetype,
          actaUploadSizeBytes: file.size,
          actaUploadSha256: sha256,
          actaUploadedAt: now,
          // Ya firmada: es el documento definitivo (el mismo hueco que usa el Word firmado) y la junta queda firmada.
          ...(alreadySigned ? { actaS3Key: key, actaSignedAt: now, status: 'firmada' as const } : {}),
        },
      });
      await tx.activityLogEntry.create({
        data: {
          actorUserId: user.id,
          subjectType: 'meeting',
          subjectId: meetingId,
          verb: 'updated',
          summary: alreadySigned
            ? `Acta de "${meeting.title}": subido el acta firmada (${file.originalname})`
            : `Acta de "${meeting.title}": subido el acta pendiente de firma (${file.originalname})`,
          occurredAt: now,
          estateId: meeting.estateId,
        },
      });
    }).catch(async (error: unknown) => {
      // El archivo ya está en el almacén pero la junta no lo referencia: no se deja huérfano.
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    });
    if (previousKey && previousKey !== key) await this.storage.delete(previousKey).catch(() => undefined);
    // An already signed acta enters the estate library right away (as «Solo gestora»).
    if (alreadySigned) await this.library.registerSignedActa(meetingId).catch(() => undefined);
    return this.getCurrent(meetingId, user);
  }

  /** El archivo subido como acta (pendiente de firma o ya firmado). */
  async downloadUpload(meetingId: string, user: AuthenticatedUser): Promise<{ content: Buffer; fileName: string; mimeType: string }> {
    const meeting = await this.loadMeeting(meetingId, user);
    if (!meeting.actaUploadS3Key) throw new NotFoundException('Esta junta no tiene un acta subida.');
    return {
      content: await this.storage.get(meeting.actaUploadS3Key),
      fileName: meeting.actaUploadFileName ?? 'acta',
      mimeType: meeting.actaUploadMimeType ?? 'application/octet-stream',
    };
  }

  // ── PDF ──────────────────────────────────────────────────────────────────

  /** PDF de la versión actual (o de una concreta). Sale del modelo guardado, nunca de datos vivos. */
  async getPdf(meetingId: string, user: AuthenticatedUser, versionId?: string): Promise<{ content: Buffer; filename: string }> {
    await this.loadMeeting(meetingId, user);
    const version = versionId
      ? ((await this.prisma.meetingActaVersion.findFirst({ where: { id: versionId, meetingId, generatedAt: { not: null } } })) as unknown as FullVersionRow | null)
      : await this.latestVersion(meetingId);
    if (!version) throw new NotFoundException('Todavía no hay un acta generada para esta junta.');
    const filename = `acta-v${version.versionNumber}.pdf`;
    if (version.pdfS3Key) return { content: await this.storage.get(version.pdfS3Key), filename };
    const content = await this.pdf.render(version.documentModel as ActaDocumentModel, {
      footerNote: this.footerNote(version.versionHash),
    });
    return { content, filename };
  }

  /** Pie del PDF: solo la huella SHA-256 de la versión (sin número de versión ni estado). */
  private footerNote(hash: string | null): string {
    return hash ? `SHA-256 ${hash.slice(0, 8)}` : '';
  }

  // ── vista ────────────────────────────────────────────────────────────────

  private toView(
    version: FullVersionRow,
    meeting: { agenda: unknown; actaGeneralComments: string | null; actaNextSteps: string | null; status: string },
  ): ActaVersionView {
    const snapshot = version.sourceSnapshot as ActaSourceSnapshot | null;
    const narrative = version.narrative as { mode?: 'llm' | 'fallback'; model?: string | null; reason?: string | null } | null;
    const live = (Array.isArray(meeting.agenda) ? meeting.agenda : []) as { id: string; comments?: string }[];
    const notesChanged =
      !!snapshot &&
      (notesAsText(snapshot.text.generalComments ?? '') !== notesAsText(meeting.actaGeneralComments ?? '') ||
        notesAsText(snapshot.text.nextSteps ?? '') !== notesAsText(meeting.actaNextSteps ?? '') ||
        snapshot.agenda.some((item) => notesAsText(item.comments ?? '') !== notesAsText(live.find((entry) => entry.id === item.id)?.comments ?? '')));
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      statusLabel: STATUS_LABEL[version.status],
      createdAt: version.createdAt.toISOString(),
      generatedAt: version.generatedAt?.toISOString() ?? null,
      preparedAt: version.preparedAt?.toISOString() ?? null,
      savedByName: version.savedBy?.fullName ?? null,
      versionHash: version.versionHash,
      hasPdf: !!version.pdfS3Key,
      snapshotCapturedAt: snapshot?.capturedAt ?? null,
      narrative: narrative?.mode ? { mode: narrative.mode, model: narrative.model ?? null, reason: narrative.reason ?? null } : null,
      notesChanged,
      editable: (version.status === 'draft' || version.status === 'readyForSignature') && meeting.status === 'celebrada',
      document: version.documentModel as ActaDocumentModel,
    };
  }
}
