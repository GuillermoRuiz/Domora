import { Component, computed, inject } from '@angular/core';
import { OfficeSetupService } from '../../core/office-setup.service';
import { PlatformMetricsService } from '../../core/platform-metrics.service';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { SectionCardComponent } from '../../shared/components/section-card/section-card.component';
import { StatCardComponent } from '../../shared/components/stat-card/stat-card.component';
import { OverviewSection } from '../overview-b/overview-section';
import { buildKpis } from './overview-a-kpis';
import { OverviewAActivityComponent } from './overview-a-lists/overview-a-activity.component';
import { OverviewAAttentionComponent } from './overview-a-lists/overview-a-attention.component';
import { OverviewACompletenessComponent } from './overview-a-lists/overview-a-completeness.component';
import { OverviewAMrrComponent } from './overview-a-mrr/overview-a-mrr.component';
import { OverviewASignupsComponent } from './overview-a-mrr/overview-a-signups.component';

const ACTIVITY_LIMIT = 8;

/**
 * Vista general of role A (S3): Domora's executive dashboard — how the
 * business evolves, which clients need attention, what is pending to collect
 * and how the platform is used. Each endpoint loads and fails on its own, so
 * one failing source never blanks the page.
 */
@Component({
  selector: 'app-overview-a',
  standalone: true,
  imports: [
    TopbarComponent,
    StatCardComponent,
    SectionCardComponent,
    EmptyStateComponent,
    OverviewAMrrComponent,
    OverviewASignupsComponent,
    OverviewAAttentionComponent,
    OverviewACompletenessComponent,
    OverviewAActivityComponent,
  ],
  templateUrl: './overview-a.component.html',
  styleUrl: './overview-a.component.scss',
})
export class OverviewAComponent {
  private readonly metrics = inject(PlatformMetricsService);
  private readonly officeSetup = inject(OfficeSetupService);

  readonly mrr = new OverviewSection(() => this.metrics.mrr());
  readonly clients = new OverviewSection(() => this.metrics.clientsSummary());
  readonly completeness = new OverviewSection(() => this.officeSetup.listOffices());
  readonly attention = new OverviewSection(() => this.metrics.attention());
  readonly activity = new OverviewSection(() => this.metrics.activity(ACTIVITY_LIMIT));

  readonly kpis = computed(() =>
    buildKpis({
      mrr: { data: this.mrr.data(), error: this.mrr.error() },
      clients: { data: this.clients.data(), error: this.clients.error() },
      completeness: { data: this.completeness.data(), error: this.completeness.error() },
    }),
  );

  /** KPI sources that failed, for the row's single «Reintentar». */
  readonly kpiFailed = computed(() => this.mrr.error() || this.clients.error() || this.completeness.error());

  constructor() {
    for (const section of this.sections()) void section.load(null);
  }

  retry = (section: OverviewSection<unknown>) => (): void => void section.load(null);

  retryKpis(): void {
    for (const section of [this.mrr, this.clients, this.completeness]) if (section.error()) void section.load(null);
  }

  private sections(): OverviewSection<unknown>[] {
    return [this.mrr, this.clients, this.completeness, this.attention, this.activity];
  }
}
