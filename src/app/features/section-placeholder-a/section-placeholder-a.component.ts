import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';

/** Role A section that exists in the navigation but has no specification yet (title, description and icon come from the route data). */
@Component({
  selector: 'app-section-placeholder-a',
  standalone: true,
  imports: [TopbarComponent, EmptyStateComponent],
  template: `
    <app-topbar [title]="title" [breadcrumb]="['Panel de control', title]"></app-topbar>

    <header class="page-intro">
      <div class="page-intro__text">
        <h1 class="page-intro__title">{{ title }}</h1>
        <p class="page-intro__subtitle">{{ description }}</p>
      </div>
    </header>

    <div class="page-content">
      <div class="card">
        <app-empty-state
          [icon]="icon"
          title="Sección en preparación"
          description="Esta parte del panel de Domora todavía se está definiendo. Estará disponible próximamente."
        ></app-empty-state>
      </div>
    </div>
  `,
})
export class SectionPlaceholderAComponent {
  private readonly data = inject(ActivatedRoute).snapshot.data;
  readonly title: string = this.data['title'] ?? '';
  readonly description: string = this.data['description'] ?? '';
  readonly icon: string = this.data['icon'] ?? 'grid';
}
