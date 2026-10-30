import { AfterViewInit, Component, ElementRef, HostListener, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/auth.service';
import { AgendaTasksService } from '../../../core/agenda-tasks.service';
import {
  AgendaTaskDetail,
  AgendaTaskPriority,
  AgendaTaskStatus,
  AgendaTaskType,
  CreateAgendaTaskPayload,
  LinkedEntity,
  LINK_TYPES,
  TASK_PRIORITIES,
  TASK_PRIORITY_KEYS,
  TASK_STATUSES,
  TASK_STATUS_KEYS,
  TASK_TYPES,
  TASK_TYPE_KEYS,
  TaskRecurrence,
} from '../../../core/agenda-tasks.model';
import { BtnComponent } from '../../../shared/components/btn/btn.component';
import { DatetimeFieldComponent } from '../../../shared/components/datetime-field/datetime-field.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { FocusTrapDirective } from '../focus-trap.directive';
import { TaskCatalogService } from '../task-catalog.service';
import { TaskLabelPickerComponent } from '../task-label-picker/task-label-picker.component';
import { TaskLinkPickerComponent } from '../task-link-picker/task-link-picker.component';
import { TaskRecurrenceFieldComponent } from '../task-recurrence-field/task-recurrence-field.component';
import { TaskReminderFieldComponent } from '../task-reminder-field/task-reminder-field.component';
import { allDayIso, combineLocal, endAfterStartChange, nextFullHour, sameDay, scheduleProblem, toDateInput, toTimeInput } from '../tasks.util';

import { SelectDropdownDirective } from '../../../shared/components/dropdown/select-dropdown.directive';
export interface TaskPrefill {
  date: Date;
  /** Minutos desde las 00:00; sin valor, la próxima hora en punto. */
  minutes?: number;
  allDay?: boolean;
}

export interface TaskCreated {
  task: AgendaTaskDetail;
  /** Adjuntos que no se pudieron subir (la tarea sí se creó). */
  failedUploads: number;
}

/** Lo que dura una tarea nueva hasta que se elija otro fin. */
const DEFAULT_DURATION_MS = 3_600_000;

/**
 * "Nueva tarea". Solo se piden de entrada los campos que casi siempre se
 * rellenan (título, comunidad, responsable, cuándo, tipo, prioridad); el
 * resto —estado, descripción, etiquetas, recordatorio, repetición, checklist,
 * vínculos y adjuntos— queda tras "Más opciones". La edición posterior se
 * hace en el panel de detalle, no aquí.
 */
@Component({
  selector: 'app-task-form-dialog',
  standalone: true,
  imports: [
    FormsModule, BtnComponent, FocusTrapDirective, IconComponent, TaskLabelPickerComponent, TaskLinkPickerComponent,
    TaskRecurrenceFieldComponent, TaskReminderFieldComponent, SelectDropdownDirective, DatetimeFieldComponent
  ],
  templateUrl: './task-form-dialog.component.html',
  styleUrl: './task-form-dialog.component.scss',
})
export class TaskFormDialogComponent implements AfterViewInit {
  private readonly agenda = inject(AgendaTasksService);
  private readonly auth = inject(AuthService);
  readonly catalog = inject(TaskCatalogService);

  readonly prefill = input<TaskPrefill | null>(null);
  /** Comunidad a preseleccionar (la del filtro activo). */
  readonly defaultEstateId = input('');

  readonly created = output<TaskCreated>();
  readonly closed = output<void>();

  readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  readonly types = TASK_TYPE_KEYS.map((key) => ({ key, label: TASK_TYPES[key].label }));
  readonly priorities = TASK_PRIORITY_KEYS.map((key) => ({ key, label: TASK_PRIORITIES[key].label }));
  readonly statuses = TASK_STATUS_KEYS.map((key) => ({ key, label: TASK_STATUSES[key].label }));
  readonly linkTypes = LINK_TYPES;

  // Campos principales
  readonly title = signal('');
  readonly estateId = signal('');
  readonly assigneeId = signal('');
  /** Inicio (fecha y hora) y fin (fecha y hora) de la tarea. */
  readonly date = signal('');
  readonly time = signal('');
  readonly endDate = signal('');
  readonly endTime = signal('');
  readonly allDay = signal(false);
  readonly noDuration = signal(false);
  readonly type = signal<AgendaTaskType>('OTRA');
  readonly priority = signal<AgendaTaskPriority>('MEDIA');

  // Campos secundarios
  readonly showMore = signal(false);
  readonly status = signal<AgendaTaskStatus>('PENDIENTE');
  readonly description = signal('');
  readonly labelIds = signal<string[]>([]);
  readonly reminder = signal<number | null>(null);
  readonly recurrence = signal<TaskRecurrence | null>(null);
  readonly checklist = signal<string[]>([]);
  readonly checklistDraft = signal('');
  readonly links = signal<LinkedEntity[]>([]);
  readonly files = signal<File[]>([]);

  readonly saving = signal(false);
  readonly error = signal('');
  readonly submitted = signal(false);

  constructor() {
    const today = new Date();
    this.setStart(toDateInput(today), this.defaultTime(today));
  }

  ngAfterViewInit(): void {
    const prefill = this.prefill();
    if (prefill) {
      if (prefill.allDay) this.allDay.set(true);
      if (prefill.minutes !== undefined) {
        const d = new Date(prefill.date);
        d.setHours(0, prefill.minutes, 0, 0);
        this.setStart(toDateInput(prefill.date), toTimeInput(d));
      } else {
        this.setStart(toDateInput(prefill.date), this.defaultTime(prefill.date));
      }
    }
    this.estateId.set(this.defaultEstateId());
    this.assigneeId.set(this.auth.currentUser()?.id ?? '');
    this.titleInput()?.nativeElement.focus();
  }

  /**
   * Hora de partida cuando nadie la ha elegido: hoy, la próxima hora en punto
   * si cae en horario de trabajo; cualquier otro caso, las 09:00 (no las
   * 00:00 a las 23:30).
   */
  private defaultTime(date: Date): string {
    const now = new Date();
    if (sameDay(date, now)) {
      const next = nextFullHour(now);
      if (sameDay(next, now) && next.getHours() >= 8 && next.getHours() <= 19) return toTimeInput(next);
    }
    return '09:00';
  }

  /** Pone el inicio y, partiendo de cero, el fin una hora después (o el mismo día si es de día completo). */
  private setStart(date: string, time: string): void {
    this.date.set(date);
    this.time.set(time);
    const end = new Date(combineLocal(date, time).getTime() + DEFAULT_DURATION_MS);
    this.endDate.set(this.allDay() ? date : toDateInput(end));
    this.endTime.set(toTimeInput(end));
  }

  /** Valores de los campos de fecha y hora (`YYYY-MM-DDTHH:mm`, o solo la fecha si es de día completo; vacío si falta algo). */
  readonly startValue = computed(() => this.fieldValue(this.date(), this.time()));
  readonly endValue = computed(() => this.fieldValue(this.endDate(), this.endTime()));

  private fieldValue(date: string, time: string): string {
    if (this.allDay()) return date;
    return date && time ? `${date}T${time}` : '';
  }

  onStartValue(value: string): void {
    if (!value) {
      this.date.set('');
      this.time.set('');
      return;
    }
    const [date, time = this.time()] = value.split('T');
    this.onStartChange({ date, time });
  }

  onEndValue(value: string): void {
    const [date = '', time = ''] = value.split('T');
    this.endDate.set(date);
    this.endTime.set(this.allDay() ? this.endTime() : time);
  }

  /** Mover el inicio mueve el fin con él: la tarea conserva lo que dura. */
  onStartChange(change: { date?: string; time?: string }): void {
    const previous = { date: this.date(), time: this.time(), endDate: this.endDate(), endTime: this.endTime() };
    const next = { date: change.date ?? previous.date, time: change.time ?? previous.time };
    const end = endAfterStartChange(previous, next, this.allDay());
    this.date.set(next.date);
    this.time.set(next.time);
    this.endDate.set(end.endDate);
    this.endTime.set(end.endTime);
  }

  /** «Sin duración»: solo cuenta la fecha de inicio (se guarda como un día de calendario, sin hora ni fin propios). */
  onNoDurationChange(value: boolean): void {
    this.noDuration.set(value);
    this.onAllDayChange(value);
  }

  /** «Dura todo el día»: el fin pasa a ser, como mínimo, el día del inicio. */
  onAllDayChange(allDay: boolean): void {
    this.allDay.set(allDay);
    if (allDay && (!this.endDate() || this.endDate() < this.date())) this.endDate.set(this.date());
  }

  get scheduleError(): string | null {
    return this.submitted() ? scheduleProblem({ date: this.date(), time: this.time(), endDate: this.endDate(), endTime: this.endTime() }, this.allDay()) : null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.saving()) this.closed.emit();
  }

  get titleInvalid(): boolean {
    return this.submitted() && !this.title().trim();
  }

  get dateInvalid(): boolean {
    return this.submitted() && !this.date();
  }

  addChecklistItem(): void {
    const text = this.checklistDraft().trim();
    if (!text) return;
    this.checklist.update((items) => [...items, text]);
    this.checklistDraft.set('');
  }

  removeChecklistItem(index: number): void {
    this.checklist.update((items) => items.filter((_, i) => i !== index));
  }

  addLink(link: LinkedEntity): void {
    if (this.links().some((l) => l.type === link.type && l.id === link.id)) return;
    this.links.update((links) => [...links, link]);
    // Si aún no había comunidad, la de la entidad vinculada pasa a ser la de la tarea.
    if (!this.estateId()) this.estateId.set(link.estateId);
  }

  removeLink(link: LinkedEntity): void {
    this.links.update((links) => links.filter((l) => !(l.type === link.type && l.id === link.id)));
  }

  /** Cambiar de comunidad invalida los vínculos de la anterior. */
  onEstateChange(estateId: string): void {
    this.estateId.set(estateId);
    this.links.update((links) => links.filter((l) => l.estateId === estateId));
  }

  readonly dragging = signal(false);

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.files.update((files) => [...files, ...Array.from(event.dataTransfer?.files ?? [])]);
  }

  onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.files.update((files) => [...files, ...Array.from(input.files ?? [])]);
    input.value = '';
  }

  removeFile(index: number): void {
    this.files.update((files) => files.filter((_, i) => i !== index));
  }

  private buildPayload(): CreateAgendaTaskPayload {
    const allDay = this.allDay();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let startAt: string;
    let endAt: string;
    if (allDay) {
      // Día completo: fin exclusivo, así que el último día se guarda como la medianoche siguiente.
      startAt = allDayIso(this.date());
      endAt = allDayIso(this.noDuration() ? this.date() : this.endDate(), 1);
    } else {
      startAt = combineLocal(this.date(), this.time()).toISOString();
      endAt = combineLocal(this.endDate(), this.endTime() || this.time()).toISOString();
    }
    const recurrence = this.recurrence();
    return {
      title: this.title().trim(),
      description: this.description().trim() || undefined,
      estateId: this.estateId() || undefined,
      assignedToUserId: this.assigneeId() || undefined,
      type: this.type(),
      priority: this.priority(),
      status: this.status(),
      startAt,
      endAt,
      allDay,
      noDuration: this.noDuration() || undefined,
      timezone,
      reminderMinutesBefore: this.reminder() ?? undefined,
      recurrence: recurrence ? { freq: recurrence.freq, interval: recurrence.interval, until: recurrence.until } : undefined,
      labelIds: this.labelIds().length ? this.labelIds() : undefined,
      checklist: this.checklist().length ? this.checklist() : undefined,
      links: this.links().length ? this.links().map((l) => ({ type: l.type, id: l.id })) : undefined,
    };
  }

  async submit(): Promise<void> {
    // No reentrante: un doble clic (o Intro + clic) no debe crear dos tareas.
    if (this.saving()) return;
    this.submitted.set(true);
    const problem = this.scheduleError;
    if (!this.title().trim() || !this.date() || (!this.allDay() && !this.time()) || problem) {
      this.error.set(problem ?? 'Revisa los campos marcados.');
      return;
    }
    this.saving.set(true);
    this.error.set('');
    try {
      const task = await this.agenda.create(this.buildPayload());
      let failedUploads = 0;
      for (const file of this.files()) {
        try {
          await this.agenda.uploadAttachment(task.id, file);
        } catch {
          failedUploads += 1;
        }
      }
      this.created.emit({ task, failedUploads });
    } catch (error) {
      console.error('No se pudo crear la tarea', error);
      this.error.set('No se pudo crear la tarea. Inténtalo de nuevo.');
      this.saving.set(false);
    }
  }
}
