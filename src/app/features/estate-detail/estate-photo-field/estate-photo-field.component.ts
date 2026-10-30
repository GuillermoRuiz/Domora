import { Component, OnDestroy, computed, input, output, signal } from '@angular/core';
import type { Estate } from '../../../core/models';
import { EstateFacadeThumbnailComponent } from '../../dashboard-b/estate-facade-thumbnail/estate-facade-thumbnail.component';
import { IconComponent } from '../../../shared/components/icon/icon.component';

/** Formatos y tamaño que acepta el servidor (que además comprueba el contenido real del fichero). */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/** Lo que el formulario de la finca debe hacer con la foto al guardar. */
export interface EstatePhotoChange {
  /** Foto nueva elegida (aún sin subir). */
  file: File | null;
  /** Quitar la foto subida. */
  remove: boolean;
}

const DATE = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * Campo "Foto de la finca" del formulario de edición. No sube nada por sí
 * mismo: avisa de lo elegido y el formulario lo aplica al pulsar "Guardar"
 * (así "Cancelar" lo descarta todo, como el resto de campos).
 */
@Component({
  selector: 'app-estate-photo-field',
  standalone: true,
  imports: [EstateFacadeThumbnailComponent, IconComponent],
  templateUrl: './estate-photo-field.component.html',
  styleUrl: './estate-photo-field.component.scss',
})
export class EstatePhotoFieldComponent implements OnDestroy {
  readonly estate = input.required<Estate>();
  readonly changed = output<EstatePhotoChange>();

  readonly accept = PHOTO_TYPES.join(',');
  readonly staged = signal<File | null>(null);
  readonly stagedUrl = signal<string | null>(null);
  readonly removing = signal(false);
  readonly error = signal<string | null>(null);

  readonly hasUploaded = computed(() => !!this.estate().photoUpdatedAt);
  readonly hasCatastro = computed(() => !!this.estate().catastroFacadeUrl);

  /** Qué foto se está usando (o se usará al guardar), en una frase. */
  readonly status = computed(() => {
    if (this.staged()) return `Foto nueva: ${this.staged()!.name}. Se subirá al guardar.`;
    if (this.removing()) {
      return this.hasCatastro()
        ? 'La foto se quitará al guardar y se usará la fachada del Catastro.'
        : 'La foto se quitará al guardar.';
    }
    const uploaded = this.estate().photoUpdatedAt;
    if (uploaded) return `Foto subida el ${DATE.format(new Date(uploaded))}.`;
    return this.hasCatastro()
      ? 'Sin foto propia: se usa la fachada del Catastro.'
      : 'Sin foto: se muestra un icono de edificio.';
  });

  choose(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = ''; // permite volver a elegir el mismo fichero tras descartarlo
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      this.error.set('La foto debe ser JPG, PNG o WebP.');
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      this.error.set('La foto no puede superar los 5 MB.');
      return;
    }
    this.error.set(null);
    this.revokePreview();
    this.staged.set(file);
    this.stagedUrl.set(URL.createObjectURL(file));
    this.removing.set(false);
    this.emit();
  }

  /** Descarta la foto elegida (sin tocar la que ya tuviera la finca). */
  discard(): void {
    this.revokePreview();
    this.staged.set(null);
    this.error.set(null);
    this.emit();
  }

  /** Marca la foto subida para quitarla al guardar. */
  remove(): void {
    this.removing.set(true);
    this.error.set(null);
    this.emit();
  }

  undoRemove(): void {
    this.removing.set(false);
    this.emit();
  }

  private emit(): void {
    this.changed.emit({ file: this.staged(), remove: this.removing() && !this.staged() });
  }

  private revokePreview(): void {
    const url = this.stagedUrl();
    if (url) URL.revokeObjectURL(url);
    this.stagedUrl.set(null);
  }

  ngOnDestroy(): void {
    this.revokePreview();
  }
}
