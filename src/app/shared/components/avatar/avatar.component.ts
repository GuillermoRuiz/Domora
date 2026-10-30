import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-avatar',
  standalone: true,
  template: `<div class="avatar" [style.width.px]="size" [style.height.px]="size" [style.font-size.px]="size * 0.38" [style.background]="src ? 'var(--color-surface-hover)' : (bg || 'var(--color-secondary)')">@if (src) {<img [src]="src" [alt]="name" />} @else {{{ initials }}}</div>`,
  styles: [`
    .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      color: #fff;
      font-weight: 600;
      flex-shrink: 0;
      text-transform: uppercase;
      overflow: hidden;
    }
    img { width: 100%; height: 100%; object-fit: contain; }
  `]
})
export class AvatarComponent {
  @Input() name: string = '';
  @Input() size: number = 36;
  @Input() bg: string = '';
  /** Imagen en lugar de las iniciales (p. ej. Domo). */
  @Input() src: string = '';

  get initials(): string {
    const parts = this.name.trim().split(/\s+/);
    if (parts.length >= 2) return parts[0][0] + parts[1][0];
    return parts[0]?.[0] ?? '?';
  }
}
