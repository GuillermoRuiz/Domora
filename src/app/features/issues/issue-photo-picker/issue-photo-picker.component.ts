import { Component, effect, model, signal } from '@angular/core';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { checkAttachments } from '../../incidencias-c/issue-helpers';

interface Preview {
  file: File;
  /** Miniatura de una imagen; null para un PDF o si el navegador no puede crearla. */
  url: string | null;
}

function isTouchDevice(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function previewUrl(file: File): string | null {
  if (!file.type.startsWith('image/') || typeof URL.createObjectURL !== 'function') return null;
  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

/**
 * Adjuntos de «Nueva incidencia» (propietario y gestión): una zona para soltar o elegir archivos, las miniaturas de
 * lo elegido con su aspa y un «+» para añadir más. Valida como el servidor (imagen o PDF, 10 MB como máximo) y en móvil
 * ofrece hacer la foto con la cámara trasera. Los archivos viven en el `model` del padre; subirlos es cosa suya.
 */
@Component({
  selector: 'app-issue-photo-picker',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './issue-photo-picker.component.html',
  styleUrl: './issue-photo-picker.component.scss',
})
export class IssuePhotoPickerComponent {
  readonly files = model<File[]>([]);

  readonly touch = isTouchDevice();
  readonly error = signal<string | null>(null);
  readonly dragging = signal(false);
  readonly previews = signal<Preview[]>([]);

  constructor() {
    // Una miniatura por archivo; las URL se liberan al cambiar la lista o al destruir el componente.
    effect((onCleanup) => {
      const previews = this.files().map((file) => ({ file, url: previewUrl(file) }));
      this.previews.set(previews);
      onCleanup(() => previews.forEach((p) => p.url && URL.revokeObjectURL(p.url)));
    });
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.add(Array.from(input.files ?? []));
    try {
      input.value = '';
    } catch {
      // Not resettable in every environment.
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.add(Array.from(event.dataTransfer?.files ?? []));
  }

  remove(index: number): void {
    this.files.update((files) => files.filter((_, i) => i !== index));
  }

  private add(picked: File[]): void {
    const { valid, errors } = checkAttachments(picked);
    this.error.set(errors.length ? errors.join(' ') : null);
    if (valid.length) this.files.update((files) => [...files, ...valid]);
  }
}
