import { Component, computed, input, signal } from '@angular/core';
import { IconComponent } from '../../../shared/components/icon/icon.component';

@Component({
  selector: 'app-accounting-facade-thumbnail',
  standalone: true,
  imports: [IconComponent],
  host: { '[class.facade--wide]': "variant() === 'wide'" },
  template: `@if (imageUrl()) {
      <img
        [src]="imageUrl()"
        [alt]="'Fachada de ' + name()"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        (error)="failedUrl.set(url())"
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
export class AccountingFacadeThumbnailComponent {
  readonly url = input<string | null>(null);
  readonly name = input('');
  readonly variant = input<'small' | 'wide'>('small');
  readonly failedUrl = signal<string | null>(null);
  readonly imageUrl = computed(() =>
    this.url() && this.failedUrl() !== this.url() ? this.url() : null,
  );
}
