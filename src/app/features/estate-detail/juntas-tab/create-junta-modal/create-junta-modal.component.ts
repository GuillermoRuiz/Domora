import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import {
  Component,
  ElementRef,
  EventEmitter,
  Injector,
  Input,
  Output,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { AgendaBuilderComponent } from '../agenda-builder/agenda-builder.component';
import { MeetingsService } from '../../../../core/meetings.service';
import type { Meeting } from '../../../../core/models';
import { JuntaDetailsStepComponent } from './junta-details-step/junta-details-step.component';
import { JuntaGuestsStepComponent } from './junta-guests-step/junta-guests-step.component';
import { JuntaDraftStore, type JuntaStep, type JuntaStepError } from './junta-draft.store';

interface SuccessInfo {
  meeting: Meeting;
  waitRoomUrl: string;
  beaconUrl: string | null;
  password: string | null;
  /** Nombres de los adjuntos que el backend rechazó o no se pudieron subir. */
  failedUploads: string[];
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Mensaje de validación del servidor (400/409/422) si lo hay; si no, uno genérico. */
function createErrorMessage(error: unknown, fallback = 'No se pudo crear la junta.'): string {
  if (error instanceof HttpErrorResponse && (error.status === 400 || error.status === 409 || error.status === 422)) {
    const message: unknown = error.error?.message;
    if (Array.isArray(message)) {
      const text = message.filter((m): m is string => typeof m === 'string').join(' ');
      if (text) return text;
    }
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

/**
 * Alta de junta en 3 pasos (Datos · Orden del día · Invitados y documentos) más una
 * confirmación. Mismo contrato que el modal anterior (`estateId`, `open`, `closed`,
 * `created`); el estado vive en `JuntaDraftStore`, así que ir y volver entre pasos no
 * pierde nada. Los adjuntos se suben DESPUÉS de crear la junta (el endpoint necesita un
 * `meetingId` real).
 */
@Component({
  selector: 'app-create-junta-modal',
  standalone: true,
  imports: [BtnComponent, IconComponent, AgendaBuilderComponent, JuntaDetailsStepComponent, JuntaGuestsStepComponent],
  providers: [JuntaDraftStore],
  templateUrl: './create-junta-modal.component.html',
  styleUrl: './create-junta-modal.component.scss',
})
export class CreateJuntaModalComponent {
  /** Comunidad de la junta (la del selector de comunidades, si la hay); vacío si hay que elegirla en el paso 1. */
  @Input() estateId = '';
  /** Si se indican, el paso 1 muestra un selector de comunidad (preseleccionada con `estateId`). */
  @Input() estates: { id: string; name: string }[] = [];

  @Input()
  set open(value: boolean) {
    this.openSignal.set(value);
    if (value) void this.onOpen();
  }
  get open(): boolean {
    return this.openSignal();
  }

  /** Si se indica, el modal edita esa junta (solo datos y orden del día) en vez de crear una nueva. */
  @Input() meeting: Meeting | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<Meeting>();
  /** Edición guardada: la junta ya actualizada. */
  @Output() saved = new EventEmitter<Meeting>();
  /** "Ver junta" en la confirmación: quien aloja el modal puede abrir/seleccionar la junta creada. */
  @Output() viewed = new EventEmitter<Meeting>();

  readonly draft = inject(JuntaDraftStore);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly meetings = inject(MeetingsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  private readonly openSignal = signal(false);
  private openVersion = 0;
  private previouslyFocused: HTMLElement | null = null;

  private readonly allSteps: { n: JuntaStep; label: string }[] = [
    { n: 1, label: 'Datos de la junta' },
    { n: 2, label: 'Orden del día' },
    { n: 3, label: 'Invitados y documentos' },
  ];
  readonly step = signal<JuntaStep>(1);

  get editing(): boolean {
    return this.meeting !== null;
  }
  /** Al editar no hay paso de invitados y documentos: ni los invitados ni la sala se modifican. */
  get steps(): { n: JuntaStep; label: string }[] {
    return this.editing ? this.allSteps.slice(0, 2) : this.allSteps;
  }
  get lastStep(): JuntaStep {
    return this.editing ? 2 : 3;
  }

  constructor() {
    // Un error de validación deja de tener sentido en cuanto el usuario edita algo.
    let first = true;
    effect(() => {
      this.draft.snapshot();
      if (first) {
        first = false;
        return;
      }
      untracked(() => {
        if (this.draft.error()) this.draft.error.set(null);
      });
    });
  }

  showSuccess = signal(false);
  successInfo = signal<SuccessInfo | null>(null);
  toastMessage = signal<string | null>(null);

  private async onOpen(): Promise<void> {
    const version = ++this.openVersion;
    this.draft.reset();
    this.step.set(1);
    this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.focusStepHeading();

    if (this.meeting) {
      this.draft.loadFromMeeting(this.meeting);
      return;
    }

    this.draft.estateId.set(this.estateId);
    this.draft.estateOptions.set(this.estates);
    if (!this.estateId) {
      // La comunidad se elige en el paso 1; los propietarios se cargan al elegirla.
      this.draft.markPristine();
      return;
    }
    await this.loadOwners(version);
  }

  /** El usuario elige comunidad en el paso 1: los asistentes pasan a ser los propietarios de esa finca. */
  async onEstateChosen(estateId: string): Promise<void> {
    this.draft.estateId.set(estateId);
    this.draft.owners.set([]);
    this.draft.attendees.set([]);
    if (!estateId) return;
    await this.loadOwners(++this.openVersion, false);
  }

  /** `pristine`: al abrir, la precarga forma parte del estado inicial; al cambiar de comunidad no (no tapa lo ya escrito). */
  private async loadOwners(version: number, pristine = true): Promise<void> {
    this.draft.loadingOwners.set(true);
    try {
      const owners = await this.meetings.listEstateOwnerEmails(this.draft.estateId());
      if (version !== this.openVersion) return;
      this.draft.owners.set(owners);
      // Igual que antes: se preseleccionan los propietarios de la finca (si el usuario aún no ha elegido a nadie).
      if (owners.length > 0 && this.draft.attendees().length === 0) {
        this.draft.attendees.set(owners.map((o) => ({ email: o.email, name: o.fullName || undefined })));
      }
      if (pristine) this.draft.markPristine();
    } catch (error) {
      console.error('Error cargando los emails de los propietarios', error);
    } finally {
      if (version === this.openVersion) this.draft.loadingOwners.set(false);
    }
  }

  // ── Navegación entre pasos ────────────────────────────────────────────

  next(): void {
    const current = this.step();
    const error = this.draft.firstError(current, current);
    if (error) return this.showError(error);
    this.draft.prepareAgenda();
    this.draft.error.set(null);
    this.go(Math.min(this.lastStep, current + 1) as JuntaStep);
  }

  back(): void {
    this.draft.error.set(null);
    this.go(Math.max(1, this.step() - 1) as JuntaStep);
  }

  /** Pulsar un paso del indicador: hacia atrás siempre; hacia delante solo si los anteriores son válidos. */
  goTo(target: JuntaStep): void {
    if (this.draft.saving() || target === this.step()) return;
    if (target > 1) this.draft.prepareAgenda();
    if (target > this.step()) {
      const error = this.draft.firstError(this.step(), (target - 1) as JuntaStep);
      if (error) return this.showError(error);
    }
    this.draft.error.set(null);
    this.go(target);
  }

  private go(step: JuntaStep): void {
    this.step.set(step);
    this.focusStepHeading();
  }

  private showError(error: JuntaStepError): void {
    this.draft.error.set(error);
    if (error.step !== this.step()) this.go(error.step);
  }

  private focusStepHeading(): void {
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>('[data-step-heading]')?.focus({ preventScroll: true }),
      { injector: this.injector },
    );
  }

  // ── Cierre ────────────────────────────────────────────────────────────

  /** Cancelar / × / Esc / clic fuera: pide confirmación solo si hay datos sin guardar. */
  async requestClose(): Promise<void> {
    if (this.draft.saving()) return;
    if (
      this.draft.isDirty() &&
      !(await this.confirmDialog.ask({
        title: this.editing ? '¿Descartar los cambios?' : '¿Descartar la junta?',
        message: this.editing
          ? 'Se perderán las modificaciones de la junta.'
          : 'Se perderán los datos introducidos y la junta no se guardará.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Seguir editando',
        tone: 'danger',
      }))
    )
      return;
    this.close();
  }

  close(): void {
    this.showSuccess.set(false);
    this.successInfo.set(null);
    this.openSignal.set(false);
    this.openVersion++;
    this.closed.emit();
    const target = this.previouslyFocused;
    this.previouslyFocused = null;
    if (target?.isConnected) afterNextRender(() => target.focus(), { injector: this.injector });
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.requestClose();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      this.requestClose();
      return;
    }
    if (event.key !== 'Tab') return;
    // Trampa de foco dentro del modal.
    const dialog = event.currentTarget as HTMLElement;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ── Alta ──────────────────────────────────────────────────────────────

  /** Guarda los cambios de una junta existente y cierra el modal. */
  private async saveEdit(meeting: Meeting): Promise<void> {
    this.draft.saving.set(true);
    try {
      const updated = await this.meetings.updateMeeting(meeting.id, this.draft.toUpdatePayload());
      this.saved.emit(updated);
      this.draft.markPristine();
      this.close();
    } catch (saveError) {
      console.error('Error guardando la junta', saveError);
      this.draft.error.set({
        step: this.step(),
        field: null,
        message: createErrorMessage(saveError, 'No se pudieron guardar los cambios.'),
      });
    } finally {
      this.draft.saving.set(false);
    }
  }

  async submit(): Promise<void> {
    if (this.draft.saving()) return; // evita el doble envío
    this.draft.prepareAgenda();
    const error = this.draft.firstError(1, 2);
    if (error) return this.showError(error);
    this.draft.error.set(null);
    if (this.meeting) return this.saveEdit(this.meeting);
    this.draft.saving.set(true);

    try {
      const meeting = await this.meetings.createMeeting(this.draft.estateId(), this.draft.toPayload());

      // Best-effort: la junta ya se creó y persistió; un adjunto que falla no impide la
      // confirmación, pero ya NO se oculta: se lista en ella.
      const failedUploads: string[] = [];
      await Promise.all(
        this.draft.attachments().map((file) =>
          this.meetings.uploadMeetingAttachment(meeting.id, file).catch((uploadError) => {
            console.error(`Error subiendo el adjunto ${file.name}`, uploadError);
            failedUploads.push(file.name);
          }),
        ),
      );

      this.successInfo.set({
        meeting,
        waitRoomUrl: meeting.waitRoomUrl ?? '',
        beaconUrl: meeting.beaconUrl ?? null,
        password: meeting.jitsiAccessPassword ?? null,
        failedUploads,
      });
      this.showSuccess.set(true);
      this.created.emit(meeting);
    } catch (createError) {
      console.error('Error creando la junta', createError);
      this.draft.error.set({ step: this.step(), field: null, message: createErrorMessage(createError) });
    } finally {
      this.draft.saving.set(false);
    }
  }

  // ── Confirmación ──────────────────────────────────────────────────────

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => this.toastMessage.set(null), 2500);
  }

  copy(text: string, label: string): void {
    navigator.clipboard.writeText(text);
    this.showToast(`${label} copiado al portapapeles`);
  }

  copyAll(): void {
    const info = this.successInfo();
    if (!info) return;
    const lines = [`Sala de espera: ${info.waitRoomUrl}`];
    if (info.password) lines.push(`Contraseña: ${info.password}`);
    if (info.beaconUrl) lines.push(`Admin: ${info.beaconUrl}`);
    navigator.clipboard.writeText(lines.join('\n'));
    this.showToast('Toda la información ha sido copiada');
  }

  /** Convocatoria de la junta recién creada (la editada en el paso 3 o la habitual) en Word. */
  async downloadConvocatoria(): Promise<void> {
    const info = this.successInfo();
    if (!info) return;
    try {
      const blob = await this.meetings.downloadMeetingConvocatoria(info.meeting.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `convocatoria-${info.meeting.title.replace(/\s+/g, '-')}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error descargando la convocatoria', error);
      this.showToast('No se pudo descargar la convocatoria');
    }
  }

  viewMeeting(): void {
    const info = this.successInfo();
    if (info) this.viewed.emit(info.meeting);
    this.close();
  }
}
