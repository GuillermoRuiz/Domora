import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';

/**
 * Tipos y tamaño que el backend acepta de verdad (`StorageService.ALLOWED_MIME` y
 * `MAX_SIZE_BYTES`, los mismos que ya usa Mensajes): se validan aquí para avisar
 * antes de crear la junta en vez de fallar al subir. Si cambian en el backend,
 * hay que actualizarlos aquí.
 */
export const ATTACHMENT_ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/xml',
  'text/xml',
  'text/plain',
  'text/csv',
]);
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.xml,.txt,.csv';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Por qué no se puede adjuntar el archivo (tipo, vacío o demasiado grande), o `null` si vale. */
export function attachmentProblem(file: File, allowed: ReadonlySet<string> = ATTACHMENT_ALLOWED_TYPES): string | null {
  if (!allowed.has(file.type)) return `«${file.name}»: tipo de archivo no admitido.`;
  if (!file.size) return `«${file.name}»: el archivo está vacío.`;
  if (file.size > ATTACHMENT_MAX_BYTES) return `«${file.name}»: supera el máximo de 10 MB.`;
  return null;
}

/** Zona de arrastrar/seleccionar archivos con lista de los ya elegidos (sin subir nada: lo hace el wizard al crear). */
@Component({
  selector: 'app-file-dropzone',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './file-dropzone.component.html',
  styleUrl: './file-dropzone.component.scss',
})
export class FileDropzoneComponent {
  @Input() files: File[] = [];
  @Input() disabled = false;
  @Output() filesChange = new EventEmitter<File[]>();

  readonly accept = ACCEPT;
  readonly dragging = signal(false);
  readonly rejected = signal<string[]>([]);
  readonly formatSize = formatFileSize;

  onSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(Array.from(input.files ?? []));
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
    if (!this.disabled) this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  remove(index: number): void {
    this.filesChange.emit(this.files.filter((_, i) => i !== index));
  }

  private addFiles(selected: File[]): void {
    const next = [...this.files];
    const problems: string[] = [];
    for (const file of selected) {
      const problem = attachmentProblem(file);
      if (problem) {
        problems.push(problem);
      } else if (!next.some((f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified)) {
        next.push(file);
      }
    }
    this.rejected.set(problems);
    if (next.length !== this.files.length) this.filesChange.emit(next);
  }
}
