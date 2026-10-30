import { Component, EventEmitter, HostListener, Input, Output, signal } from '@angular/core';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import type { MeetingAttachment } from '../../../core/models';
import { MeetingCardComponent } from './meeting-card.component';
import { attachmentKind, formatFileSize, formatShortDate } from './meeting-workspace.model';

/** Tipos que acepta el backend (ver StorageService.ALLOWED_MIME). */
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.csv,.xml';

/** «Documentos adjuntos» de la junta: lista, adjuntar nuevos, descargar y eliminar. */
@Component({
  selector: 'app-meeting-attachments',
  standalone: true,
  imports: [IconComponent, MeetingCardComponent],
  templateUrl: './meeting-attachments.component.html',
  styleUrl: './meeting-attachments.component.scss',
})
export class MeetingAttachmentsComponent {
  @Input({ required: true }) attachments!: MeetingAttachment[];
  /** Mientras se sube o elimina un documento. */
  @Input() busy = false;
  @Output() upload = new EventEmitter<File[]>();
  @Output() download = new EventEmitter<MeetingAttachment>();
  @Output() remove = new EventEmitter<MeetingAttachment>();

  readonly accept = ACCEPT;
  readonly openMenuId = signal<string | null>(null);
  readonly kind = attachmentKind;

  meta(attachment: MeetingAttachment): string {
    const parts = [attachmentKind(attachment).label];
    const size = formatFileSize(attachment.sizeBytes);
    if (size) parts.push(size);
    parts.push(formatShortDate(attachment.uploadedAt));
    return parts.join(' • ');
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // permite volver a elegir el mismo fichero
    if (files.length) this.upload.emit(files);
  }

  toggleMenu(id: string): void {
    this.openMenuId.update((open) => (open === id ? null : id));
  }

  act(action: 'download' | 'remove', attachment: MeetingAttachment): void {
    this.openMenuId.set(null);
    if (action === 'download') this.download.emit(attachment);
    else this.remove.emit(attachment);
  }

  @HostListener('document:click', ['$event'])
  closeOnOutsideClick(event: Event): void {
    if (this.openMenuId() && !(event.target as HTMLElement).closest('.doc__menu')) this.openMenuId.set(null);
  }

  @HostListener('document:keydown.escape')
  closeOnEscape(): void {
    this.openMenuId.set(null);
  }
}
