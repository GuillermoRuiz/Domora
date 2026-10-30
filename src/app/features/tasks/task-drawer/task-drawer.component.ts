import { Component, HostListener, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { AgendaTasksService } from '../../../core/agenda-tasks.service';
import {
  AgendaTask,
  AgendaTaskDetail,
  AgendaTaskPriority,
  AgendaTaskStatus,
  AgendaTaskType,
  LINK_TYPES,
  LinkedEntity,
  TASK_PRIORITIES,
  TASK_PRIORITY_KEYS,
  TASK_STATUSES,
  TASK_STATUS_KEYS,
  TASK_TYPES,
  TASK_TYPE_KEYS,
  TaskRecurrence,
  UpdateAgendaTaskPayload,
} from '../../../core/agenda-tasks.model';
import { DatetimeFieldComponent } from '../../../shared/components/datetime-field/datetime-field.component';
import { DropdownComponent } from '../../../shared/components/dropdown/dropdown.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { FocusTrapDirective } from '../focus-trap.directive';
import { TaskStatusBadgeComponent } from '../task-badges/task-badges.component';
import { TaskCatalogService } from '../task-catalog.service';
import { TaskDecisionPanelComponent } from '../task-decision-panel/task-decision-panel.component';
import { ReviewNextStepPanelComponent } from '../review-next-step-panel/review-next-step-panel.component';
import { TaskLabelPickerComponent } from '../task-label-picker/task-label-picker.component';
import { TaskLinkPickerComponent } from '../task-link-picker/task-link-picker.component';
import { TaskRecurrenceFieldComponent } from '../task-recurrence-field/task-recurrence-field.component';
import { TaskReminderFieldComponent } from '../task-reminder-field/task-reminder-field.component';
import { TaskAction, addDaysToDateInput, allDayDateInput, allDayIso, combineLocal, endAfterStartChange, minutesBetween, scheduleProblem, taskActionItems, toDateInput, toTimeInput } from '../tasks.util';
import { messageFrom } from '../../incidencias-c/issue-helpers';
import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
/**
 * Detalle completo y edición. Cada campo se guarda al cambiarlo
 * (blur/selección) con un PATCH puntual, así que no hay botón "Guardar" y
 * nadie pierde cambios al cerrar. Tras cada guardado el servidor devuelve la
 * tarea completa y se avisa a la página (`changed`) para refrescar el
 * calendario.
 */
@Component({
  selector: 'app-task-drawer',
  standalone: true,
  imports: [
    FormsModule, FocusTrapDirective, TaskDecisionPanelComponent, ReviewNextStepPanelComponent, IconComponent, TaskStatusBadgeComponent, TaskLabelPickerComponent, TaskLinkPickerComponent,
    TaskRecurrenceFieldComponent, TaskReminderFieldComponent, SelectDropdownDirective
  , DatetimeFieldComponent, DropdownComponent],
  templateUrl: './task-drawer.component.html',
  styleUrl: './task-drawer.component.scss',
})
export class TaskDrawerComponent {
  private readonly agenda = inject(AgendaTasksService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  readonly catalog = inject(TaskCatalogService);

  /** Tarea seleccionada en el calendario (aporta la ocurrencia concreta). */
  readonly task = input.required<AgendaTask>();

  readonly changed = output<AgendaTaskDetail>();
  readonly deleteRequested = output<AgendaTask>();
  readonly duplicated = output<AgendaTaskDetail>();
  readonly closed = output<void>();

  /** Las dos secciones del detalle, como las pestañas de una junta: los datos de la tarea y su seguimiento. */
  readonly sections = [
    { id: 'details', label: 'Detalles' },
    { id: 'follow', label: 'Seguimiento' },
  ] as const;
  readonly section = signal<'details' | 'follow'>('details');
  readonly types = TASK_TYPE_KEYS.map((key) => ({ key, label: TASK_TYPES[key].label }));
  readonly priorities = TASK_PRIORITY_KEYS.map((key) => ({ key, label: TASK_PRIORITIES[key].label }));
  readonly statuses = TASK_STATUS_KEYS.filter((s) => s !== 'COMPLETADA' && s !== 'CANCELADA').map((key) => ({ key, label: TASK_STATUSES[key].label }));
  readonly linkTypes = LINK_TYPES;

  readonly detail = signal<AgendaTaskDetail | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal(false);
  private readonly pending = signal(0);
  /** Hay algún guardado en curso o en cola. */
  readonly saving = computed(() => this.pending() > 0);
  readonly error = signal('');

  readonly checklistDraft = signal('');
  readonly commentDraft = signal('');
  readonly editingSchedule = signal(false);
  /** Inicio (fecha y hora) y fin (fecha y hora) mientras se edita. */
  readonly scheduleDate = signal('');
  readonly scheduleStart = signal('');
  readonly scheduleEndDate = signal('');
  readonly scheduleEnd = signal('');
  readonly scheduleAllDay = signal(false);

  readonly currentUserId = computed(() => this.auth.currentUser()?.id ?? '');
  /** Estado EFECTIVO de la ocurrencia seleccionada (en series, el de esa ocurrencia). */
  readonly status = computed<AgendaTaskStatus>(() => this.task().status);
  readonly overdue = computed(() => this.task().overdue);
  readonly terminal = computed(() => this.status() === 'COMPLETADA' || this.status() === 'CANCELADA');

  /** Acciones del menú inferior: completar, reabrir, cancelar o eliminar según el estado. */
  readonly actionItems = computed(() => taskActionItems({ status: this.status(), kind: this.detail()?.kind ?? this.task().kind }));

  readonly checklistProgress = computed(() => {
    const items = this.detail()?.checklist ?? [];
    const done = items.filter((i) => i.done).length;
    return { done, total: items.length, percent: items.length ? Math.round((done / items.length) * 100) : 0 };
  });

  private loadedId = '';
  private chain: Promise<unknown> = Promise.resolve();

  constructor() {
    // Carga el detalle al cambiar de tarea (no al cambiar de ocurrencia de la misma serie).
    effect(() => {
      const id = this.task().id;
      untracked(() => {
        if (id !== this.loadedId) void this.load(id);
      });
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closed.emit();
  }

  async load(id: string = this.task().id): Promise<void> {
    this.loadedId = id;
    this.loading.set(true);
    this.loadError.set(false);
    this.detail.set(null);
    try {
      this.detail.set(await this.agenda.get(id));
    } catch (error) {
      console.error('No se pudo cargar la tarea', error);
      this.loadError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  // ── Guardado ─────────────────────────────────────────────────────────────

  /**
   * Serializa TODO lo que escribe en el servidor. Dos cambios seguidos (p. ej.
   * el `blur` del título y el cambio de un desplegable) no se pisan ni se
   * descartan: cada uno parte del resultado del anterior.
   */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    this.pending.update((n) => n + 1);
    const result = this.chain.then(job, job);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    ).then(() => this.pending.update((n) => n - 1));
    return result;
  }

  /**
   * Tras un fallo se vuelve a leer la tarea: sin esto un desplegable o una casilla
   * seguiría mostrando el valor que el servidor NO aceptó (la pantalla parecería
   * haber guardado). El aviso de error se conserva.
   */
  private async resync(): Promise<void> {
    await this.load(this.loadedId);
  }

  /** Aplica un PATCH calculado sobre el estado más reciente; devuelve false si falla. */
  private patchWith(build: (current: AgendaTaskDetail) => UpdateAgendaTaskPayload): Promise<boolean> {
    return this.enqueue(async () => {
      const current = this.detail();
      if (!current) return false;
      this.error.set('');
      try {
        const updated = await this.agenda.update(current.id, build(current));
        this.detail.set(updated);
        this.changed.emit(updated);
        return true;
      } catch (error) {
        console.error('No se pudo guardar el cambio', error);
        this.error.set('No se pudo guardar el cambio. Inténtalo de nuevo.');
        await this.resync();
        return false;
      }
    });
  }

  private patch(patch: UpdateAgendaTaskPayload): Promise<boolean> {
    return this.patchWith(() => patch);
  }

  /** En las tareas de incidencia el título empieza por su referencia y « · »: esa parte no se edita. */
  titlePrefix(d: AgendaTaskDetail): string {
    const at = d.title.indexOf(' · ');
    return d.issueId && at > 0 ? d.title.slice(0, at + 3) : '';
  }

  saveTitle(value: string): void {
    const title = value.trim();
    const current = this.detail();
    if (!current) return;
    if (!title) {
      this.error.set('El título no puede estar vacío.');
      return;
    }
    if (title !== current.title) void this.patch({ title });
  }

  saveDescription(value: string): void {
    const description = value.trim();
    if (description !== (this.detail()?.description ?? '')) void this.patch({ description: description || null });
  }

  saveEstate(estateId: string): void {
    void this.patch({ estateId: estateId || null });
  }

  saveAssignee(userId: string): void {
    void this.patch({ assignedToUserId: userId || null });
  }

  saveType(type: AgendaTaskType): void {
    void this.patch({ type });
  }

  savePriority(priority: AgendaTaskPriority): void {
    void this.patch({ priority });
  }

  saveLabels(labelIds: string[]): void {
    void this.patch({ labelIds });
  }

  saveReminder(minutes: number | null): void {
    void this.patch({ reminderMinutesBefore: minutes });
  }

  saveRecurrence(rule: TaskRecurrence | null): void {
    void this.patch({ recurrence: rule ? { freq: rule.freq, interval: rule.interval, until: rule.until } : null });
  }

  async addLink(link: LinkedEntity): Promise<void> {
    await this.patchWith((current) => ({
      links: [...current.links, link].map((l) => ({ type: l.type, id: l.id })),
    }));
  }

  async removeLink(link: LinkedEntity): Promise<void> {
    await this.patchWith((current) => ({
      links: current.links.filter((l) => !(l.type === link.type && l.id === link.id)).map((l) => ({ type: l.type, id: l.id })),
    }));
  }

  /** La incidencia de la que nace la tarea (solo las que abre Domora o una regla): su vínculo de origen. */
  originIssue(d: AgendaTaskDetail): LinkedEntity | null {
    return d.issueId ? (d.links.find((l) => l.type === 'issue' && l.id === d.issueId) ?? null) : null;
  }

  isOrigin(d: AgendaTaskDetail, link: LinkedEntity): boolean {
    return !!d.issueId && link.type === 'issue' && link.id === d.issueId;
  }

  /** Flechas y Inicio/Fin cambian de sección, como en las pestañas de una junta. */
  onSectionKeydown(event: KeyboardEvent, index: number): void {
    const last = this.sections.length - 1;
    const next =
      event.key === 'ArrowRight' ? (index + 1) % this.sections.length
      : event.key === 'ArrowLeft' ? (index - 1 + this.sections.length) % this.sections.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : -1;
    if (next < 0) return;
    event.preventDefault();
    this.section.set(this.sections[next].id);
    queueMicrotask(() => document.getElementById(`task-tab-${this.sections[next].id}`)?.focus());
  }

  openLink(link: LinkedEntity): void {
    void this.router.navigateByUrl(link.route);
  }

  // ── Estado y acciones rápidas ────────────────────────────────────────────

  /** En series, el estado se aplica a la ocurrencia seleccionada y no a toda la serie. */
  private applyStatus(status: AgendaTaskStatus, restorePrevious = false): Promise<void> {
    const task = this.task();
    return this.enqueue(async () => {
      this.error.set('');
      try {
        const updated = await this.agenda.setStatus(task.id, status, task.recurring ? task.occurrenceStart : undefined, restorePrevious || undefined);
        this.detail.set(updated);
        this.changed.emit(updated);
      } catch (error) {
        console.error('No se pudo cambiar el estado', error);
        this.error.set(messageFrom(error, 'No se pudo cambiar el estado.'));
        await this.resync();
      }
    });
  }

  /** Una decisión de incidencia (aprobar, confirmar, reclamar…) ya resuelta por el servidor. */
  onDecisionResolved(updated: AgendaTaskDetail): void {
    this.detail.set(updated);
    this.changed.emit(updated);
  }

  complete(): void {
    const open = this.checklistProgress().total - this.checklistProgress().done;
    if (open > 0) {
      this.error.set(open === 1 ? 'No se puede completar la tarea: queda 1 subtarea de la checklist sin completar.' : `No se puede completar la tarea: quedan ${open} subtareas de la checklist sin completar.`);
      return;
    }
    void this.applyStatus('COMPLETADA');
  }

  cancel(): void {
    void this.applyStatus('CANCELADA');
  }

  onAction(action: TaskAction): void {
    if (action === 'complete') this.complete();
    else if (action === 'reopen') this.reopen();
    else if (action === 'cancel') this.cancel();
    else this.deleteRequested.emit(this.task());
  }

  /** Vuelve al estado que tenía antes de completarse (PENDIENTE si venía de cancelada o no se conoce). */
  reopen(): void {
    void this.applyStatus('PENDIENTE', true);
  }

  /** Estados no terminales: solo cambian la tarea entera (en una serie, la serie). */
  changeStatus(status: AgendaTaskStatus): Promise<void> {
    return this.enqueue(async () => {
      this.error.set('');
      try {
        const updated = await this.agenda.setStatus(this.task().id, status);
        this.detail.set(updated);
        this.changed.emit(updated);
      } catch (error) {
        console.error('No se pudo cambiar el estado', error);
        this.error.set('No se pudo cambiar el estado.');
        await this.resync();
      }
    });
  }

  /** No reentrante: un doble clic no debe crear dos copias. */
  async duplicate(): Promise<void> {
    if (this.saving()) return;
    await this.enqueue(async () => {
      this.error.set('');
      try {
        this.duplicated.emit(await this.agenda.duplicate(this.task().id));
      } catch (error) {
        console.error('No se pudo duplicar la tarea', error);
        this.error.set('No se pudo duplicar la tarea.');
      }
    });
  }

  // ── Fecha y hora ─────────────────────────────────────────────────────────

  startScheduleEdit(): void {
    const d = this.detail();
    if (!d) return;
    this.scheduleAllDay.set(d.allDay);
    if (d.allDay) {
      const first = allDayDateInput(d.startAt);
      // El fin se guarda exclusivo (medianoche siguiente): en el formulario se enseña el último día.
      const last = addDaysToDateInput(allDayDateInput(d.endAt), -1);
      this.scheduleDate.set(first);
      this.scheduleEndDate.set(last < first ? first : last);
    } else {
      const start = new Date(d.startAt);
      const end = new Date(d.endAt);
      this.scheduleDate.set(toDateInput(start));
      this.scheduleStart.set(toTimeInput(start));
      this.scheduleEndDate.set(toDateInput(end));
      this.scheduleEnd.set(toTimeInput(end));
    }
    this.error.set('');
    this.editingSchedule.set(true);
  }

  /** Valores de los campos de fecha y hora (`YYYY-MM-DDTHH:mm`, o solo la fecha si es de todo el día; vacío si falta algo). */
  readonly scheduleStartValue = computed(() => this.fieldValue(this.scheduleDate(), this.scheduleStart()));
  readonly scheduleEndValue = computed(() => this.fieldValue(this.scheduleEndDate(), this.scheduleEnd()));

  private fieldValue(date: string, time: string): string {
    if (this.scheduleAllDay()) return date;
    return date && time ? `${date}T${time}` : '';
  }

  onScheduleStartValue(value: string): void {
    if (!value) {
      this.scheduleDate.set('');
      this.scheduleStart.set('');
      return;
    }
    const [date, time = this.scheduleStart()] = value.split('T');
    this.onScheduleStartChange({ date, time });
    void this.autoSaveSchedule();
  }

  onScheduleEndValue(value: string): void {
    const [date = '', time = ''] = value.split('T');
    this.scheduleEndDate.set(date);
    if (!this.scheduleAllDay()) this.scheduleEnd.set(time);
    void this.autoSaveSchedule();
  }

  /** Mover el inicio mueve el fin con él: la tarea conserva lo que dura. */
  onScheduleStartChange(change: { date?: string; time?: string }): void {
    const previous = { date: this.scheduleDate(), time: this.scheduleStart(), endDate: this.scheduleEndDate(), endTime: this.scheduleEnd() };
    const next = { date: change.date ?? previous.date, time: change.time ?? previous.time };
    const end = endAfterStartChange(previous, next, this.scheduleAllDay());
    this.scheduleDate.set(next.date);
    this.scheduleStart.set(next.time);
    this.scheduleEndDate.set(end.endDate);
    this.scheduleEnd.set(end.endTime);
  }

  /** «Todo el día»: el fin pasa a ser, como mínimo, el día del inicio. */
  onScheduleAllDayChange(allDay: boolean): void {
    this.scheduleAllDay.set(allDay);
    if (allDay && (!this.scheduleEndDate() || this.scheduleEndDate() < this.scheduleDate())) this.scheduleEndDate.set(this.scheduleDate());
    void this.autoSaveSchedule();
  }

  /** Guarda la fecha y hora en cuanto son válidas; mientras no lo sean (p. ej. el fin antes del inicio) no se toca el servidor. */
  private async autoSaveSchedule(): Promise<void> {
    if (!this.scheduleDate() || this.scheduleError) return;
    await this.saveSchedule(true);
  }

  get scheduleError(): string | null {
    return scheduleProblem(
      { date: this.scheduleDate(), time: this.scheduleStart(), endDate: this.scheduleEndDate(), endTime: this.scheduleEnd() },
      this.scheduleAllDay(),
    );
  }

  async saveSchedule(keepOpen = false): Promise<void> {
    if (!this.scheduleDate()) return;
    const problem = this.scheduleError;
    if (problem) {
      this.error.set(problem);
      return;
    }
    let startAt: string;
    let endAt: string;
    if (this.scheduleAllDay()) {
      startAt = allDayIso(this.scheduleDate());
      endAt = allDayIso(this.scheduleEndDate(), 1);
    } else {
      startAt = combineLocal(this.scheduleDate(), this.scheduleStart()).toISOString();
      endAt = combineLocal(this.scheduleEndDate(), this.scheduleEnd() || this.scheduleStart()).toISOString();
    }
    const ok = await this.patch({
      startAt,
      endAt,
      allDay: this.scheduleAllDay(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (ok && !keepOpen) this.editingSchedule.set(false);
  }

  get scheduleSummary(): string {
    const d = this.detail();
    if (!d) return '';
    const day = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const shortDay = new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
    if (d.allDay) {
      const first = allDayDateInput(d.startAt);
      const last = addDaysToDateInput(allDayDateInput(d.endAt), -1);
      const firstDate = new Date(first + 'T00:00:00');
      if (last <= first) return `${day.format(firstDate)} · Todo el día`;
      return `${shortDay.format(firstDate)} – ${shortDay.format(new Date(last + 'T00:00:00'))} · Todo el día`;
    }
    const start = new Date(d.startAt);
    const end = new Date(d.endAt);
    const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (toDateInput(start) !== toDateInput(end)) {
      return `${shortDay.format(start)}, ${time.format(start)} – ${shortDay.format(end)}, ${time.format(end)}`;
    }
    const minutes = minutesBetween(d.startAt, d.endAt);
    return `${day.format(start)} · ${time.format(start)} – ${time.format(end)}${minutes > 0 ? ` (${minutes} min)` : ''}`;
  }

  // ── Checklist ────────────────────────────────────────────────────────────

  async addChecklistItem(): Promise<void> {
    const text = this.checklistDraft().trim();
    const d = this.detail();
    if (!text || !d || this.saving()) return;
    await this.run(async () => {
      const item = await this.agenda.addChecklistItem(d.id, text);
      this.detail.update((cur) => (cur ? { ...cur, checklist: [...cur.checklist, item], checklistTotal: cur.checklistTotal + 1 } : cur));
      this.checklistDraft.set('');
      this.emitCurrent();
    });
  }

  async toggleChecklistItem(itemId: string, done: boolean): Promise<void> {
    const d = this.detail();
    if (!d) return;
    await this.run(async () => {
      const item = await this.agenda.updateChecklistItem(d.id, itemId, { done });
      this.detail.update((cur) => (cur ? this.withChecklist(cur, cur.checklist.map((c) => (c.id === itemId ? item : c))) : cur));
      this.emitCurrent();
    }, undefined, true);
  }

  async deleteChecklistItem(itemId: string): Promise<void> {
    const d = this.detail();
    if (!d || this.saving()) return;
    await this.run(async () => {
      await this.agenda.deleteChecklistItem(d.id, itemId);
      this.detail.update((cur) => (cur ? this.withChecklist(cur, cur.checklist.filter((c) => c.id !== itemId)) : cur));
      this.emitCurrent();
    });
  }

  private withChecklist(detail: AgendaTaskDetail, checklist: AgendaTaskDetail['checklist']): AgendaTaskDetail {
    return { ...detail, checklist, checklistTotal: checklist.length, checklistDone: checklist.filter((c) => c.done).length };
  }

  // ── Comentarios ──────────────────────────────────────────────────────────

  async addComment(): Promise<void> {
    const text = this.commentDraft().trim();
    const d = this.detail();
    if (!text || !d || this.saving()) return;
    await this.run(async () => {
      const comment = await this.agenda.addComment(d.id, text);
      this.detail.update((cur) => (cur ? { ...cur, comments: [...cur.comments, comment], commentCount: cur.commentCount + 1 } : cur));
      this.commentDraft.set('');
      this.emitCurrent();
    });
  }

  async deleteComment(commentId: string): Promise<void> {
    const d = this.detail();
    if (!d || this.saving()) return;
    await this.run(async () => {
      await this.agenda.deleteComment(d.id, commentId);
      this.detail.update((cur) => (cur ? { ...cur, comments: cur.comments.filter((c) => c.id !== commentId), commentCount: cur.commentCount - 1 } : cur));
      this.emitCurrent();
    });
  }

  // ── Adjuntos ─────────────────────────────────────────────────────────────

  async onFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const d = this.detail();
    if (!d || files.length === 0 || this.saving()) return;
    await this.run(async () => {
      for (const file of files) {
        const attachment = await this.agenda.uploadAttachment(d.id, file);
        this.detail.update((cur) => (cur ? { ...cur, attachments: [...cur.attachments, attachment], attachmentCount: cur.attachmentCount + 1 } : cur));
      }
      this.emitCurrent();
    }, 'No se pudo subir el fichero (comprueba el tipo y que no supere 10 MB).');
  }

  async download(attachmentId: string, fileName: string): Promise<void> {
    const d = this.detail();
    if (!d) return;
    await this.run(async () => {
      const blob = await this.agenda.downloadAttachment(d.id, attachmentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    }, 'No se pudo descargar el fichero.');
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    const d = this.detail();
    if (!d || this.saving()) return;
    await this.run(async () => {
      await this.agenda.deleteAttachment(d.id, attachmentId);
      this.detail.update((cur) => (cur ? { ...cur, attachments: cur.attachments.filter((a) => a.id !== attachmentId), attachmentCount: cur.attachmentCount - 1 } : cur));
      this.emitCurrent();
    });
  }

  sizeLabel(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  commentTime(iso: string): string {
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }

  private emitCurrent(): void {
    const current = this.detail();
    if (current) this.changed.emit(current);
  }

  /** Ejecuta una operación en la cola; con `resync`, un fallo vuelve a leer la tarea del servidor. */
  private run(
    action: () => Promise<void>,
    message = 'No se pudo completar la acción.',
    resync = false,
  ): Promise<void> {
    return this.enqueue(async () => {
      this.error.set('');
      try {
        await action();
      } catch (error) {
        console.error(message, error);
        this.error.set(message);
        if (resync) await this.resync();
      }
    });
  }
}
