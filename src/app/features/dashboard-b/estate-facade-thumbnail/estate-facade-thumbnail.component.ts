import { Component, Injector, computed, effect, inject, input, signal } from "@angular/core";
import { EstatesService } from "../../../core/estates.service";
import { IconComponent } from "../../../shared/components/icon/icon.component";

@Component({
  selector: "app-estate-facade-thumbnail",
  standalone: true,
  imports: [IconComponent],
  host: { "[class.facade--wide]": "variant() === 'wide'" },
  template: `@if (imageUrl()) {
      <img
        [src]="imageUrl()"
        [alt]="'Fachada de ' + name()"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        (error)="onImageError()"
      />
    } @else {
      <span
        class="facade-fallback"
        role="img"
        [attr.aria-label]="'Fachada no disponible de ' + name()"
        ><app-icon
          name="building"
          [size]="variant() === 'wide' ? 48 : 24"
        ></app-icon
      ></span>
    }`,
  styles: [
    `
      :host {
        display: block;
        width: 48px;
        height: 48px;
        flex-shrink: 0;
        border-radius: var(--radius-md);
        overflow: hidden;
        background: var(--color-bg);
      }
      :host.facade--wide {
        width: 100%;
        height: auto;
        aspect-ratio: 16 / 9;
        border-radius: 0;
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .facade-fallback {
        width: 100%;
        height: 100%;
        min-height: inherit;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-light);
        background: var(--color-surface-hover);
      }
      :host.facade--wide .facade-fallback {
        aspect-ratio: 16 / 9;
      }
    `,
  ],
})
/**
 * Foto de una finca: la que subió la gestora si la hay, si no la fachada del
 * Catastro, si no el icono de edificio. La foto subida se pide con la sesión
 * (un `<img src>` no puede mandar el token), así que hace falta el id de la
 * finca y la versión de la foto (`photoUpdatedAt`).
 */
export class EstateFacadeThumbnailComponent {
  readonly url = input<string | null>(null);
  readonly name = input("");
  readonly variant = input<"small" | "wide">("small");
  /** Finca y versión de la foto subida; sin versión no se pide nada. */
  readonly estateId = input<string | null>(null);
  readonly photoVersion = input<string | null>(null);

  readonly failedUrl = signal<string | null>(null);
  private readonly uploadedUrl = signal<string | null>(null);
  private readonly uploadedFailed = signal(false);
  /** Hay foto subida y aún no ha llegado: no se muestra la del Catastro un instante para luego cambiarla. */
  private readonly uploadedLoading = signal(false);
  private readonly injector = inject(Injector);

  readonly imageUrl = computed(() => {
    if (this.uploadedLoading()) return null;
    const uploaded = this.uploadedUrl();
    if (uploaded && !this.uploadedFailed()) return uploaded;
    return this.url() && this.failedUrl() !== this.url() ? this.url() : null;
  });

  constructor() {
    effect((onCleanup) => {
      const id = this.estateId();
      const version = this.photoVersion();
      this.uploadedFailed.set(false);
      if (!id || !version) {
        this.uploadedUrl.set(null);
        this.uploadedLoading.set(false);
        return;
      }
      let cancelled = false;
      let objectUrl: string | null = null;
      this.uploadedLoading.set(true);
      // El servicio se pide aquí y no en el constructor: sin foto subida no hace falta HttpClient.
      this.injector.get(EstatesService).getEstatePhoto(id, version).then(
        (blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          this.uploadedUrl.set(objectUrl);
          this.uploadedLoading.set(false);
        },
        () => {
          if (cancelled) return;
          this.uploadedUrl.set(null);
          this.uploadedLoading.set(false);
        },
      );
      onCleanup(() => {
        cancelled = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      });
    });
  }

  onImageError(): void {
    if (this.uploadedUrl() && !this.uploadedFailed()) this.uploadedFailed.set(true);
    else this.failedUrl.set(this.url());
  }
}
