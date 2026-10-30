import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { MeetingCardComponent } from '../meeting-card.component';
import { MeetingAttachmentsComponent } from '../meeting-attachments.component';
import { StatusPillComponent } from '../status-pill.component';
import {
  formatLongDate,
  formatPercent,
  formatTime,
  type ActaStatus,
  type AgendaRow,
  type ParticipationStats,
} from '../meeting-workspace.model';
import type { Meeting, MeetingAttachment } from '../../../../core/models';

/** Pestaña «Resumen»: ¿en qué estado está esta junta? */
@Component({
  selector: 'app-meeting-summary-tab',
  standalone: true,
  imports: [IconComponent, BtnComponent, MeetingCardComponent, MeetingAttachmentsComponent, StatusPillComponent],
  templateUrl: './summary-tab.component.html',
  styleUrl: './summary-tab.component.scss',
})
export class MeetingSummaryTabComponent {
  @Input({ required: true }) meeting!: Meeting;
  @Input({ required: true }) stats!: ParticipationStats;
  @Input({ required: true }) agenda!: AgendaRow[];
  @Input({ required: true }) acta!: ActaStatus;
  @Input() attachments: MeetingAttachment[] = [];
  /** Subiendo o eliminando un documento. */
  @Input() attachmentsBusy = false;
  /** Etiqueta ya traducida del tipo de junta (Ordinaria / Extraordinaria). */
  @Input() typeLabel = '';
  @Output() openAgenda = new EventEmitter<void>();
  /** Descargar el acta: solo se ofrece una vez enviada a los propietarios. */
  @Output() download = new EventEmitter<void>();
  @Output() attach = new EventEmitter<File[]>();
  @Output() downloadAttachment = new EventEmitter<MeetingAttachment>();
  @Output() removeAttachment = new EventEmitter<MeetingAttachment>();

  readonly percent = formatPercent;
  readonly date = formatLongDate;
  readonly time = formatTime;

  get secondCallLabel(): string {
    const first = new Date(this.meeting.scheduledAt1);
    const second = new Date(this.meeting.scheduledAt2);
    const sameDay = first.toDateString() === second.toDateString();
    return sameDay
      ? this.time(this.meeting.scheduledAt2)
      : `${this.date(this.meeting.scheduledAt2)}, ${this.time(this.meeting.scheduledAt2)}`;
  }
}
