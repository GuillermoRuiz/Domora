import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { BtnComponent } from '../../../../shared/components/btn/btn.component';
import { MeetingCardComponent } from '../meeting-card.component';
import { attachmentProblem, formatFileSize } from '../../../estate-detail/juntas-tab/create-junta-modal/file-dropzone/file-dropzone.component';

/** Formatos que admite un acta subida. */
export const ACTA_UPLOAD_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const ACCEPT = '.pdf,.docx';

/**
 * Modo «Subir acta existente» de la pestaña Acta: elegir (o arrastrar) un PDF/DOCX y subirlo. No sabe
 * nada del acta generada: el archivo elegido vive en quien lo usa y la subida se pide con `submitted`.
 */
@Component({
  selector: 'app-meeting-acta-upload-card',
  standalone: true,
  imports: [IconComponent, BtnComponent, MeetingCardComponent],
  templateUrl: './acta-upload-card.component.html',
  styleUrl: './acta-upload-card.component.scss',
})
export class MeetingActaUploadCardComponent {
  /** Archivo elegido (aún sin subir). */
  @Input() file: File | null = null;
  @Input() disabled = false;
  /** Por qué no se puede subir ahora (junta sin celebrar, acta firmada…); vacío si se puede. */
  @Input() blockedReason = '';
  @Input() busy = false;
  @Output() fileChange = new EventEmitter<File | null>();
  @Output() submitted = new EventEmitter<void>();

  readonly accept = ACCEPT;
  readonly dragging = signal(false);
  readonly problem = signal('');
  readonly formatSize = formatFileSize;

  get canSubmit(): boolean {
    return !!this.file && !this.disabled && !this.busy;
  }

  onSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.choose(input.files?.[0] ?? null);
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    if (this.disabled) return;
    event.preventDefault();
    this.dragging.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (!this.disabled) this.choose(event.dataTransfer?.files?.[0] ?? null);
  }

  remove(): void {
    this.problem.set('');
    this.fileChange.emit(null);
  }

  /** Un solo archivo: si el elegido no vale se explica y se conserva el anterior. */
  private choose(file: File | null): void {
    if (!file) return;
    const problem = attachmentProblem(file, ACTA_UPLOAD_TYPES);
    this.problem.set(problem ? problem.replace('tipo de archivo no admitido', 'solo se admiten PDF y DOCX') : '');
    if (!problem) this.fileChange.emit(file);
  }
}
