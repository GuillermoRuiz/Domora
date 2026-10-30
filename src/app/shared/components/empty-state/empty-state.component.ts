import { Component, Input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="empty-state">
      <div class="empty-state__icon">
        <app-icon [name]="icon" [size]="28"></app-icon>
      </div>
      <div class="empty-state__title">{{ title }}</div>
      @if (description) {
        <p class="empty-state__desc">{{ description }}</p>
      }
      <div class="empty-state__actions"><ng-content></ng-content></div>
    </div>
  `,
  styles: [`
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 24px;
      text-align: center;
      gap: 12px;
    }
    .empty-state__icon {
      width: 56px;
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--color-border-light);
      border-radius: 50%;
      color: var(--color-light);
    }
    .empty-state__title {
      font-size: 16px;
      font-weight: 600;
      color: var(--color-text);
    }
    .empty-state__desc {
      font-size: 14px;
      color: var(--color-muted);
      max-width: 280px;
    }
    .empty-state__actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
    }
    .empty-state__actions:empty { display: none; }
  `]
})
export class EmptyStateComponent {
  @Input() icon = 'package';
  @Input() title = 'Sin resultados';
  @Input() description = '';
}
