import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { SelectDropdownDirective } from '../../../../shared/components/dropdown/select-dropdown.directive';
import { MeetingsService } from '../../../../core/meetings.service';
import { MeetingCardComponent } from '../meeting-card.component';
import { MeetingActaUploadCardComponent } from './acta-upload-card.component';
import { ActaUploadDialogComponent } from './acta-upload-dialog.component';
import { formatFileSize } from '../../../estate-detail/juntas-tab/create-junta-modal/file-dropzone/file-dropzone.component';
import { StatusPillComponent } from '../status-pill.component';
import { MeetingCommentsModalComponent, type CommentsTarget } from '../comments-modal.component';
import { ActaViewerComponent } from '../acta-viewer/acta-viewer.component';
import { ActaPrepareDialogComponent } from '../acta-viewer/acta-prepare-dialog.component';
import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import {
  actaEditable,
  attendanceGroups,
  formatDateTime,
  formatPercent,
  formatShortDateTime,
  meetingHeld,
  type ActaStatus,
  type AgendaRow,
  type AttendanceGroup,
  type ParticipationRow,
  type ParticipationStats,
  type Signer,
  type TallyOption,
  type Tone,
} from '../meeting-workspace.model';
import type { ActaVersion, Meeting } from '../../../../core/models';
import type { ActaSigning, ActaOrigin, ActaState, ActaUploadInfo, ActaValidation, ActaValidationIssue, ActaVersionSummary, ActaVersionView, GenerateActaPayload, SaveActaEditsPayload } from '../../../../core/acta.models';

/** Texto libre del acta que escribe la gestora. */
export type ActaNoteField = 'general' | 'next';

export interface SignStep {
  label: string;
  /** `done`: completado; `current`: el siguiente paso; `todo`: aún no toca. */
  state: 'done' | 'current' | 'todo';
  date: string;
}

/** Cambios hechos en esta pestaña que todavía no se han guardado como versión. */
interface PendingEdits {
  general?: string;
  next?: string;
  /** Comentarios de cada punto, por id. */
  points: Record<string, string>;
}

const EDITOR: Record<ActaNoteField, { heading: string; description: string; placeholder: string }> = {
  general: {
    heading: 'Observaciones',
    description: 'Resumen de cómo transcurrió la junta. Aparecerá en el acta cuando guardes la versión.',
    placeholder: 'La junta se celebra con normalidad y se tratan todos los puntos…',
  },
  next: {
    heading: 'Actuaciones derivadas de los acuerdos',
    description: 'Una línea por actuación o paso a seguir. Aparecerá en el acta cuando guardes la versión.',
    placeholder: 'Solicitar 3 presupuestos para las obras…',
  },
};

/** Lo que se está editando en el diálogo: un texto general o los comentarios de un punto. */
type Editing = { kind: ActaNoteField } | { kind: 'point'; row: AgendaRow };

/**
 * Pestaña «Acta»: el borrador del acta con su proceso de firma, la asistencia, los
 * resultados punto a punto y el texto libre (comentarios generales, comentarios de cada punto
 * y próximos pasos). Los textos se editan en un borrador y no se guardan hasta pulsar
 * «Guardar», que crea una versión; el selector permite consultar y restaurar las anteriores.
 */
@Component({
  selector: 'app-meeting-acta-tab',
  standalone: true,
  imports: [IconComponent, BtnComponent, MeetingCardComponent, StatusPillComponent, MeetingCommentsModalComponent, ActaViewerComponent, ActaPrepareDialogComponent, SelectDropdownDirective, MeetingActaUploadCardComponent, ActaUploadDialogComponent],
  templateUrl: './acta-tab.component.html',
  styleUrl: './acta-tab.component.scss',
})
export class MeetingActaTabComponent implements OnChanges {
  @Input({ required: true }) set meeting(value: Meeting) {
    this.meetingSignal.set(value);
  }
  get meeting(): Meeting {
    return this.meetingSignal();
  }
  @Input({ required: true }) status!: ActaStatus;
  @Input({ required: true }) signers!: Signer[];
  @Input({ required: true }) stats!: ParticipationStats;
  @Input({ required: true }) set agenda(value: AgendaRow[]) {
    this.agendaSignal.set(value);
  }
  get agenda(): AgendaRow[] {
    return this.agendaSignal();
  }
  @Input({ required: true }) set rows(value: ParticipationRow[]) {
    this.allRows.set(value);
  }
  @Input() typeLabel = '';
  @Input() community = '';
  @Input() address = '';
  @Input() busy = false;
  @Input() impugnacionDaysLeft: number | null = null;
  /** Seguir a la firma (pantalla de gestión) desde el visor del acta. */
  @Output() review = new EventEmitter<void>();
  /** Descargar el `.docx` firmado (acta heredada o ya firmada). */
  @Output() download = new EventEmitter<void>();
  /** Descargar el PDF de la versión actual del acta. */
  @Output() downloadPdf = new EventEmitter<string | undefined>();
  @Output() send = new EventEmitter<void>();
  /** Ir a la pestaña «Orden del día». */
  @Output() manageAgenda = new EventEmitter<void>();
  /** Se guardó una versión: la junta debe recargarse. */
  @Output() saved = new EventEmitter<string>();
  @Output() failed = new EventEmitter<string>();
  /** Descargar el archivo subido como acta (pendiente de firma o ya firmado). */
  @Output() downloadUpload = new EventEmitter<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly api = inject(MeetingsService);
  private readonly meetingSignal = signal<Meeting>(undefined as unknown as Meeting);
  private readonly agendaSignal = signal<AgendaRow[]>([]);
  private readonly allRows = signal<ParticipationRow[]>([]);
  private loadVersion = 0;

  readonly dateTime = formatDateTime;
  readonly formatSize = formatFileSize;
  readonly percent = formatPercent;
  readonly shortDateTime = formatShortDateTime;
  readonly menuOpen = signal(false);

  // ── Modo del acta: generada en Domora o subida ───────────────────────────
  /**
   * Modo que se está mostrando. Cambiarlo solo cambia lo que se ve: ni el borrador generado, ni los
   * textos sin guardar ni el archivo elegido se tocan. Sustituir un acta exige pulsar «Subir acta».
   */
  readonly mode = signal<ActaOrigin>('generated');
  /** El usuario ya eligió modo: lo que llegue del servidor no se lo cambia. */
  private modeChosen = false;
  /** Archivo elegido para subir; se conserva al cambiar de modo. */
  readonly uploadFile = signal<File | null>(null);
  readonly uploading = signal(false);
  /** Pregunta por el estado de firma abierta antes de subir. */
  readonly uploadDialog = signal(false);
  readonly uploadError = signal('');
  /** Con un archivo ya subido, se está eligiendo otro para sustituirlo. */
  readonly replacing = signal(false);

  // ── Versiones y borrador ─────────────────────────────────────────────────
  /** Versiones guardadas, la más reciente primero. */
  readonly versions = signal<ActaVersion[]>([]);
  readonly versionsLoaded = signal(false);
  /** Versión que se está consultando; `null` = el borrador actual. */
  readonly selectedId = signal<string | null>(null);
  private readonly pending = signal<PendingEdits>({ points: {} });
  readonly saving = signal(false);
  readonly editing = signal<Editing | null>(null);

  // ── Acta canónica: borrador generado por el backend, visor documental y datos de la reunión ──
  private readonly confirm = inject(ConfirmDialogService);
  /** Estado del acta canónica (versión actual y acta anterior al nuevo formato). */
  readonly acta = signal<ActaState | null>(null);
  /** Qué firmas puede poner quien está conectado ahora; `null` mientras carga. */
  readonly signing = signal<ActaSigning | null>(null);
  readonly signBusy = signal(false);
  readonly reviewBusy = signal(false);
  /** Versión abierta en el visor documental. */
  readonly viewer = signal<ActaVersionView | null>(null);
  /** Versiones del acta entre las que se puede cambiar en el visor, la más reciente primero. */
  readonly actaVersions = signal<ActaVersionSummary[]>([]);
  readonly viewerBusy = signal(false);
  /** Al abrir el visor, o cuando aparece una versión nueva, se rehace la lista de versiones. */
  private readonly viewerVersionsSync = effect(() => {
    const open = this.viewer() !== null;
    const latest = this.acta()?.version?.id;
    untracked(() => {
      if (open) void this.loadActaVersions();
      else if (latest === undefined) this.actaVersions.set([]);
    });
  });
  readonly viewerError = signal('');
  readonly viewerWarnings = signal<ActaValidationIssue[]>([]);
  /** Validación mostrada en el paso de preparación (datos de la reunión que faltan). */
  readonly prepareValidation = signal<ActaValidation | null>(null);
  readonly prepareBusy = signal(false);
  readonly prepareError = signal('');
  private prepareRefresh = false;

  readonly selectedVersion = computed(() => this.versions().find((version) => version.id === this.selectedId()) ?? null);
  /** Texto vigente del borrador: lo editado sin guardar o, si no, lo guardado en la junta. */
  private readonly draftGeneral = computed(() => this.pending().general ?? this.meetingSignal()?.actaGeneralComments ?? '');
  private readonly draftNext = computed(() => this.pending().next ?? this.meetingSignal()?.actaNextSteps ?? '');
  readonly general = computed(() => (this.selectedVersion() ? (this.selectedVersion()!.generalComments ?? '') : this.draftGeneral()).trim());
  readonly nextSteps = computed(() =>
    (this.selectedVersion() ? (this.selectedVersion()!.nextSteps ?? '') : this.draftNext())
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  /** Hay cambios respecto a la última versión guardada. */
  readonly dirty = computed(() => {
    if (!this.versionsLoaded()) return false;
    const latest = this.versions()[0];
    const same = (current: string, saved: string | null | undefined) => current.trim() === (saved ?? '').trim();
    if (!same(this.draftGeneral(), latest?.generalComments) || !same(this.draftNext(), latest?.nextSteps)) return true;
    return this.agendaSignal().some(
      (row) => !same(this.draftComment(row), latest?.pointComments.find((point) => point.id === row.id)?.comments),
    );
  });
  /** Se está mirando una versión anterior: es de solo lectura. */
  readonly readOnly = computed(() => this.selectedVersion() !== null);

  /** Propiedades presentes o representadas, agrupadas por edificio y filtradas por la búsqueda. */
  readonly groups = computed<AttendanceGroup[]>(() => {
    return attendanceGroups(this.allRows());
  });

  /** Datos del diálogo de edición abierto. */
  readonly dialog = computed(() => {
    const editing = this.editing();
    if (!editing) return null;
    if (editing.kind === 'point') {
      return {
        target: { number: editing.row.number, title: editing.row.title, comments: this.draftComment(editing.row) } as CommentsTarget,
        heading: 'Comentarios del punto',
        description: 'Escribe cualquier cosa relacionada con este punto. Aparecerá en el acta cuando guardes la versión.',
        placeholder: 'Intervenciones, reservas de voto, acuerdos verbales…',
        max: 2000,
      };
    }
    const copy = EDITOR[editing.kind];
    return {
      target: { number: '', title: copy.heading, comments: editing.kind === 'general' ? this.draftGeneral() : this.draftNext() } as CommentsTarget,
      ...copy,
      max: 4000,
    };
  });

  ngOnChanges(changes: SimpleChanges): void {
    const change = changes['meeting'];
    if (!change || !this.meeting) return;
    if (change.firstChange || change.previousValue?.id !== change.currentValue?.id) {
      this.pending.set({ points: {} });
      this.selectedId.set(null);
      this.editing.set(null);
      this.versionsLoaded.set(false);
      this.mode.set('generated');
      this.modeChosen = false;
      this.uploadFile.set(null);
      this.uploadDialog.set(false);
      this.replacing.set(false);
      this.viewer.set(null);
      this.prepareValidation.set(null);
      this.acta.set(null);
      void this.loadVersions();
      void this.loadActa();
    }
  }

  get signed(): boolean {
    return this.status.phase === 'signed';
  }
  get celebrated(): boolean {
    return meetingHeld(this.meeting);
  }
  get canSend(): boolean {
    return this.signed && !this.meeting.actaDistributedAt && !this.busy;
  }
  /** Los textos del acta se pueden escribir hasta que el acta se firma (y nunca con la junta cancelada). */
  get canEdit(): boolean {
    return actaEditable(this.meeting);
  }
  /** «Guardar» solo si hay cambios sobre el borrador y la junta aún admite cambios en el acta. */
  get canSave(): boolean {
    return this.canEdit && !this.readOnly() && this.dirty() && !this.saving() && !this.busy;
  }
  /** El acta se prepara con la junta ya celebrada (o firmada, para consultarla). */
  get canReview(): boolean {
    return meetingHeld(this.meeting);
  }

  /** Acuerdos adoptados, tal y como los dice el documento del acta (no se calculan aquí). */
  get agreementLines(): string[] {
    const document = this.acta()?.version?.document;
    if (!document) return [];
    return document.agreements.map((agreement) => {
      const item = document.items.find((entry) => entry.id === agreement.itemId);
      return item ? `${item.label} ${item.title}: ${agreement.text}` : agreement.text;
    });
  }

  /** Ya hay un acta generada en Domora (versión canónica o textos guardados) que subir sustituiría. */
  get hasGeneratedActa(): boolean {
    return !!this.acta()?.version || this.versions().length > 0;
  }

  get signedCount(): number {
    return this.signers.filter((signer) => signer.signed).length;
  }

  /** Opciones del selector: el borrador actual y las versiones guardadas. */
  get versionOptions(): { value: string; label: string }[] {
    return [
      { value: '', label: this.dirty() ? 'Borrador actual · sin guardar' : 'Borrador actual' },
      ...this.versions().map((version) => ({
        value: version.id,
        label: `Versión ${version.versionNumber} · ${formatShortDateTime(version.createdAt)}${version.savedByName ? ' · ' + version.savedByName : ''}`,
      })),
    ];
  }

  /** Pasos del proceso de firma: el primero sin completar es el actual. */
  get steps(): SignStep[] {
    const [president, secretary] = [this.signers[0]?.signed ?? false, this.signers[1]?.signed ?? false];
    const version = this.acta()?.version ?? null;
    // Crear acta: existe el borrador canónico. Enviada a firma: la gestora lo preparó con
    // «Revisar». Cada paso exige los anteriores.
    const uploaded = this.uploadedOrigin;
    const signing = president || secretary || this.signed;
    const sent = signing || uploaded || version?.status === 'readyForSignature' || version?.status === 'signed';
    const created = sent || !!version;
    const done = [created, sent, president || this.signed, secretary || this.signed, this.signed];
    const labels = [uploaded ? 'Acta subida' : 'Crear acta', 'Enviada a firma', 'Presidente firmado', 'Secretario firmado', 'Acta definitiva'];
    const uploadedAt = this.uploadInfo ? formatShortDateTime(this.uploadInfo.uploadedAt) : '';
    const dates = [
      uploaded ? uploadedAt : version?.generatedAt ? formatShortDateTime(version.generatedAt) : '',
      uploaded ? uploadedAt : version?.preparedAt ? formatShortDateTime(version.preparedAt) : '',
      '',
      '',
      this.meeting.actaSignedAt ? formatShortDateTime(this.meeting.actaSignedAt) : '',
    ];
    const currentIndex = done.indexOf(false);
    return labels.map((label, index) => ({
      label,
      state: done[index] ? 'done' : index === currentIndex ? 'current' : 'todo',
      date: done[index] ? dates[index] : '',
    }));
  }

  selectMode(mode: ActaOrigin): void {
    this.modeChosen = true;
    this.mode.set(mode);
  }

  /** Archivo subido como acta, si lo hay. */
  get uploadInfo(): ActaUploadInfo | null {
    return this.acta()?.upload ?? null;
  }

  /** El acta que se firma es el archivo subido. */
  get uploadedOrigin(): boolean {
    return this.acta()?.origin === 'uploaded' && !!this.uploadInfo;
  }

  /** Por qué ahora no se puede subir (o sustituir) un acta; vacío si se puede. */
  get uploadBlockedReason(): string {
    const status = this.meeting.status;
    if (this.signed || status === 'firmada') return 'El acta ya está firmada: no se puede sustituir.';
    if (status === 'cancelada') return 'La junta está cancelada: no tiene acta.';
    if (status !== 'celebrada') return 'Podrás subir el acta cuando la junta esté celebrada.';
    if (this.signers.some((signer) => signer.signed)) return 'El acta ya tiene firmas: no se puede sustituir el archivo.';
    return '';
  }

  /** «Subir acta»: pregunta primero por el estado de firma del archivo; subir es lo que sustituye al borrador. */
  requestUpload(): void {
    if (!this.uploadFile() || this.uploading() || this.uploadBlockedReason) return;
    this.uploadError.set('');
    this.uploadDialog.set(true);
  }

  closeUploadDialog(): void {
    if (!this.uploading()) this.uploadDialog.set(false);
  }

  async confirmUpload(alreadySigned: boolean): Promise<void> {
    const file = this.uploadFile();
    if (!file || this.uploading()) return;
    this.uploading.set(true);
    this.uploadError.set('');
    try {
      const state = await this.api.uploadActa(this.meeting.id, file, alreadySigned);
      this.acta.set(state);
      this.uploadFile.set(null);
      this.uploadDialog.set(false);
      this.replacing.set(false);
      // La junta cambia (firmada) o sus firmas dependen del archivo nuevo: hay que recargarla.
      this.saved.emit(alreadySigned ? 'Acta subida: la junta queda firmada.' : 'Acta subida: pendiente de firma.');
      void this.loadSigning();
    } catch (error: unknown) {
      this.uploadError.set(errorMessage(error, 'No se pudo subir el acta.'));
    } finally {
      this.uploading.set(false);
    }
  }


  // ── Acta canónica ────────────────────────────────────────────────────────

  private async loadActa(): Promise<void> {
    void this.loadSigning();
    try {
      const state = await this.api.getActa(this.meeting.id);
      this.acta.set(state);
      if (!this.modeChosen) this.mode.set(state.origin ?? 'generated');
    } catch {
      this.acta.set(null);
    }
  }

  private async loadSigning(): Promise<void> {
    try {
      this.signing.set(await this.api.getActaSigning(this.meeting.id));
    } catch {
      this.signing.set(null);
    }
  }

  /** ¿Puede quien está conectado firmar ahora en este puesto (0 = presidente, 1 = secretario/administrador)? */
  canSignAs(index: number): boolean {
    return !!this.signing()?.canSign[index === 0 ? 'presidente' : 'secretario'];
  }

  async sign(index: number): Promise<void> {
    if (this.signBusy() || !this.canSignAs(index)) return;
    const role = index === 0 ? 'presidente' : 'secretario';
    const label = this.signers[index]?.role ?? role;
    const confirmed = await this.confirm.ask({
      title: 'Firmar el acta',
      message: `Vas a firmar el acta como ${label.toLowerCase()}. La firma queda registrada y no se puede deshacer.`,
      confirmLabel: 'Firmar',
    });
    if (!confirmed) return;
    this.signBusy.set(true);
    try {
      const updated = await this.api.signActaAsSelf(this.meeting.id, role);
      await this.loadSigning();
      this.saved.emit(updated.actaSignedAt ? 'Acta firmada por ambas partes.' : 'Firma registrada.');
    } catch (error: unknown) {
      this.failed.emit(errorMessage(error, 'No se pudo registrar la firma.'));
    } finally {
      this.signBusy.set(false);
    }
  }

  /**
   * «Revisar»: abre el borrador canónico. Si ya existe, lo abre sin crear
   * otra versión; si no, valida los datos y, si faltan horas o convocatoria, los pide antes de generarlo.
   */
  async openReview(): Promise<void> {
    if (!this.canReview || this.reviewBusy()) return;
    this.reviewBusy.set(true);
    this.viewerError.set('');
    try {
      // Los comentarios aún sin guardar también tienen que salir en el acta: se guardan antes de abrirla.
      if (this.canSave) await this.save();
      const state = await this.api.getActa(this.meeting.id);
      this.acta.set(state);
      if (state.version) {
        this.viewerWarnings.set([]);
        // Notas escritas o cambiadas después de generar el borrador, o borrador anterior a incluir
        // nombre y DNI de los asistentes: se actualiza (sin pisar lo editado a mano).
        // Con alguna firma ya puesta no se rehace el borrador solo por completar los asistentes: lo firmado no cambia.
        const hasSignatures = !!this.meeting.actaSignedByPresidenteUserId || !!this.meeting.actaSignedBySecretarioUserId;
        const missingIdentities = !hasSignatures && state.version.document.attendance.rows.some((row) => row.attendeeDni === undefined);
        const outdated = state.version.notesChanged || missingIdentities;
        // Es un extra: si falla, el acta se abre igualmente tal y como está.
        const version = outdated && state.version.editable ? await this.api.syncActaNotes(this.meeting.id).catch(() => state.version!) : state.version;
        this.viewer.set(version);
        if (version !== state.version) await Promise.all([this.loadActa(), this.loadVersions()]);
        return;
      }
      if (state.legacy.signed) {
        await this.showLegacyNotice(state.legacy.hasDocx);
        return;
      }
      const validation = await this.api.validateActa(this.meeting.id);
      if (validation.canGenerate) {
        await this.generate({}, validation.warnings);
      } else {
        this.prepareError.set('');
        this.prepareRefresh = false;
        this.prepareValidation.set(validation);
      }
    } catch (error: unknown) {
      this.failed.emit(errorMessage(error, 'No se pudo abrir el acta.'));
    } finally {
      this.reviewBusy.set(false);
    }
  }

  /** Corregir las horas y la convocatoria: vuelve a congelar los datos de la junta. */
  async editMeetingData(): Promise<void> {
    try {
      const validation = await this.api.validateActa(this.meeting.id);
      this.prepareError.set('');
      this.prepareRefresh = true;
      this.prepareValidation.set(validation);
    } catch (error: unknown) {
      this.viewerError.set(errorMessage(error, 'No se pudieron cargar los datos de la reunión.'));
    }
  }

  closePrepare(): void {
    this.prepareValidation.set(null);
  }

  async confirmPrepare(payload: GenerateActaPayload): Promise<void> {
    const validation = this.prepareValidation();
    await this.generate({ ...payload, refresh: this.prepareRefresh || undefined }, validation?.warnings ?? []);
  }

  private async generate(payload: GenerateActaPayload, warnings: ActaValidationIssue[]): Promise<void> {
    this.prepareBusy.set(true);
    this.prepareError.set('');
    try {
      const version = await this.api.generateActa(this.meeting.id, payload);
      this.prepareValidation.set(null);
      this.viewerWarnings.set(warnings);
      this.viewerError.set('');
      this.viewer.set(version);
      await Promise.all([this.loadActa(), this.loadVersions()]);
      // Los datos confirmados de la reunión se guardaron en la junta: hay que recargarla.
      this.saved.emit('Borrador del acta generado.');
    } catch (error: unknown) {
      const validation = (error as { error?: { validation?: ActaValidation } } | null)?.error?.validation;
      if (validation) this.prepareValidation.set(validation);
      this.prepareError.set(errorMessage(error, 'No se pudo generar el borrador del acta.'));
    } finally {
      this.prepareBusy.set(false);
    }
  }

  private async showLegacyNotice(hasDocx: boolean): Promise<void> {
    const download = await this.confirm.ask({
      title: 'Acta anterior al nuevo formato',
      message: hasDocx
        ? 'Esta acta se firmó antes de existir el borrador de acta editable: solo está disponible el documento firmado (Word).'
        : 'Esta acta se firmó antes de existir el borrador de acta editable y no tiene documento disponible.',
      confirmLabel: hasDocx ? 'Descargar acta (Word)' : 'Entendido',
      cancelLabel: 'Cerrar',
    });
    if (download && hasDocx) this.download.emit();
  }

  closeViewer(): void {
    this.viewer.set(null);
    this.viewerError.set('');
  }

  /** Carga la lista de versiones del visor. */
  private async loadActaVersions(): Promise<void> {
    const meetingId = this.meeting.id;
    try {
      const versions = await this.api.listActaDocumentVersions(meetingId);
      if (this.meeting.id === meetingId) this.actaVersions.set(versions);
    } catch {
      // Sin la lista el visor sigue funcionando con la versión abierta; solo no deja cambiar de versión.
      this.actaVersions.set([]);
    }
  }

  /** Muestra otra versión del acta en el visor. Las sustituidas llegan en solo lectura. */
  async pickActaVersion(versionId: string): Promise<void> {
    if (this.viewerBusy() || versionId === this.viewer()?.id) return;
    this.viewerBusy.set(true);
    this.viewerError.set('');
    try {
      this.viewer.set(await this.api.getActaDocumentVersion(this.meeting.id, versionId));
    } catch (error: unknown) {
      this.viewerError.set(errorMessage(error, 'No se pudo cargar esa versión del acta.'));
    } finally {
      this.viewerBusy.set(false);
    }
  }

  private async runViewer(action: () => Promise<ActaVersionView>, done: string, failure: string): Promise<void> {
    this.viewerBusy.set(true);
    this.viewerError.set('');
    try {
      const version = await action();
      this.viewer.set(version);
      await Promise.all([this.loadActa(), this.loadVersions()]);
      this.saved.emit(done);
    } catch (error: unknown) {
      this.viewerError.set(errorMessage(error, failure));
    } finally {
      this.viewerBusy.set(false);
    }
  }

  saveViewerEdits(payload: SaveActaEditsPayload): Promise<void> {
    return this.runViewer(() => this.api.saveActaEdits(this.meeting.id, payload), 'Cambios del acta guardados.', 'No se pudieron guardar los cambios del acta.');
  }

  regenerateNarrative(): Promise<void> {
    return this.runViewer(() => this.api.regenerateActaNarrative(this.meeting.id), 'Redacción del acta regenerada.', 'No se pudo regenerar la redacción.');
  }

  prepareForSignature(): Promise<void> {
    return this.runViewer(() => this.api.prepareActaForSignature(this.meeting.id), 'Acta preparada para la firma.', 'No se pudo preparar el acta para la firma.');
  }

  continueToSigning(): void {
    this.viewer.set(null);
    this.review.emit();
  }

  // ── Versiones ────────────────────────────────────────────────────────────

  private async loadVersions(): Promise<void> {
    const version = ++this.loadVersion;
    const meetingId = this.meeting.id;
    try {
      const versions = await this.api.listActaVersions(meetingId);
      if (version !== this.loadVersion) return;
      this.versions.set(versions);
      this.versionsLoaded.set(true);
    } catch {
      if (version !== this.loadVersion) return;
      this.versions.set([]);
      // Sin el histórico no se puede saber qué hay sin guardar: no se ofrece guardar a ciegas.
      this.versionsLoaded.set(false);
      this.failed.emit('No se pudo cargar el histórico de versiones del acta.');
    }
  }

  selectVersion(value: string): void {
    this.selectedId.set(value || null);
  }

  /** Vuelve a poner los textos de la versión consultada en el borrador (hay que guardarlos para que cuenten). */
  restore(): void {
    const version = this.selectedVersion();
    if (!version) return;
    this.pending.set({
      general: version.generalComments ?? '',
      next: version.nextSteps ?? '',
      points: Object.fromEntries(
        this.agendaSignal().map((row) => [row.id, version.pointComments.find((point) => point.id === row.id)?.comments ?? '']),
      ),
    });
    this.selectedId.set(null);
  }

  async save(): Promise<void> {
    if (!this.canSave) return;
    this.saving.set(true);
    try {
      const saved = await this.api.saveActaVersion(this.meeting.id, {
        generalComments: this.draftGeneral(),
        nextSteps: this.draftNext(),
        pointComments: this.agendaSignal().map((row) => ({ itemId: row.id, comments: this.draftComment(row) })),
      });
      this.pending.set({ points: {} });
      await this.loadVersions();
      this.saved.emit(`Versión ${saved.versionNumber} del acta guardada.`);
    } catch (error: unknown) {
      this.failed.emit(errorMessage(error, 'No se pudo guardar el acta.'));
    } finally {
      this.saving.set(false);
    }
  }

  // ── Textos ───────────────────────────────────────────────────────────────

  /** Comentarios del punto en el borrador: lo editado sin guardar o, si no, lo guardado en la junta. */
  private draftComment(row: AgendaRow): string {
    return this.pending().points[row.id] ?? row.comments;
  }

  /** Comentarios del punto que se muestran: los de la versión consultada o los del borrador. */
  commentOf(row: AgendaRow): string {
    const version = this.selectedVersion();
    return (version ? (version.pointComments.find((point) => point.id === row.id)?.comments ?? '') : this.draftComment(row)).trim();
  }

  openNote(field: ActaNoteField): void {
    if (this.canEdit && !this.readOnly()) this.editing.set({ kind: field });
  }

  openPoint(row: AgendaRow): void {
    if (this.canEdit && !this.readOnly()) this.editing.set({ kind: 'point', row });
  }

  closeEditor(): void {
    this.editing.set(null);
  }

  /** Deja el texto en el borrador; no se guarda hasta pulsar «Guardar». */
  stage(text: string): void {
    const editing = this.editing();
    if (!editing) return;
    this.pending.update((pending) =>
      editing.kind === 'point'
        ? { ...pending, points: { ...pending.points, [editing.row.id]: text } }
        : editing.kind === 'general'
          ? { ...pending, general: text }
          : { ...pending, next: text },
    );
    this.editing.set(null);
  }

  // ── Orden del día y resultados ───────────────────────────────────────────

  /** Pill del punto: el resultado de la votación o, si no lo hay, su estado. */
  pill(row: AgendaRow): { label: string; tone: Tone } {
    return row.result ?? { label: row.statusLabel, tone: row.tone };
  }

  total(row: AgendaRow): number {
    return row.tally.reduce((sum, option) => sum + option.count, 0);
  }

  share(row: AgendaRow, option: TallyOption): number {
    const total = this.total(row);
    return total ? (option.count / total) * 100 : 0;
  }

  /** `11 a favor (68,8%) · 5 en contra (31,2%) · 0 abstenciones`. */
  summary(row: AgendaRow): string {
    if (!row.tally.length) return row.votable ? row.hint : 'Sin votación';
    return row.tally
      .map((option) => `${option.count} ${countLabel(option)} (${formatPercent(this.share(row, option))})`)
      .join(' · ');
  }

  // ── Menú «⋯» ─────────────────────────────────────────────────────────────

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  choose(action: 'download' | 'send'): void {
    this.menuOpen.set(false);
    if (action === 'download' && this.uploadedOrigin && this.uploadInfo) this.downloadUpload.emit(this.uploadInfo.fileName);
    else (action === 'download' ? this.download : this.send).emit();
  }

  @HostListener('document:click', ['$event'])
  closeMenuOnOutsideClick(event: Event): void {
    if (this.menuOpen() && !this.host.nativeElement.querySelector('.menu')?.contains(event.target as Node)) {
      this.menuOpen.set(false);
    }
  }

  @HostListener('keydown.escape')
  closeMenuOnEscape(): void {
    this.menuOpen.set(false);
  }
}

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' && message ? message : fallback;
}

/** `a favor`, `en contra`, `abstenciones`: la opción en minúsculas, con «abstención» en plural si no es 1. */
function countLabel(option: TallyOption): string {
  const label = option.label.trim().toLowerCase();
  return /^abstenci[oó]n$/.test(label) && option.count !== 1 ? 'abstenciones' : label;
}
