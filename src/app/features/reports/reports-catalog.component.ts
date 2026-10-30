import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { ReportCatalog, ReportDefinition, ReportEstate, ReportScopeSelection } from '../../core/reporting.models';
import { ReportingService, reportError } from '../../core/reporting.service';
import { normalizeReportSearch } from './reporting.utils';
import { ReportEstateScopeSelectorComponent } from './report-estate-scope-selector.component';
import { hasReportScopeParams, reportScopeFromParams, reportScopeFromShared, reportScopeParams, sharedEstateForReport } from './report-scope-navigation';
import { CommunityScopeService } from '../../core/community-scope.service';

@Component({
  selector: 'app-reports-catalog', standalone: true,
  imports: [RouterLink, TopbarComponent, IconComponent, BtnComponent, EmptyStateComponent, ReportEstateScopeSelectorComponent],
  templateUrl: './reports-catalog.component.html', styleUrls: ['./reports.scss', './reports-catalog.component.scss'],
})
export class ReportsCatalogComponent implements OnInit {
  private readonly reporting = inject(ReportingService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly communityScope = inject(CommunityScopeService);
  readonly categoryKey = this.route.snapshot.paramMap.get('categoryKey');
  readonly estates = signal<ReportEstate[]>(inject(CommunityScopeService).cachedEstates());
  readonly selection = signal<ReportScopeSelection>({ scopeMode: 'all', estateIds: [] });
  readonly scopeParams = computed(() => reportScopeParams(this.selection()));
  readonly catalog = signal<ReportCatalog>({ categories: [], reports: [] });
  readonly loading = signal(true);
  readonly error = signal('');
  readonly errorTitle = 'No se han podido cargar los informes';
  readonly search = signal('');
  readonly category = computed(() => this.catalog().categories.find(c => c.key === this.categoryKey));
  readonly title = computed(() => this.category()?.title ?? 'Informes');
  readonly reports = computed(() => this.catalog().reports.filter(r => r.status === 'available'));
  readonly matching = computed(() => {
    const term = normalizeReportSearch(this.search().trim());
    return this.reports().filter(r => (!this.categoryKey || r.category === this.categoryKey)
      && (!term || normalizeReportSearch([r.title, r.description, this.categoryTitle(r)].join(' ')).includes(term)));
  });
  readonly groups = computed(() => this.catalog().categories
    .map(category => ({ category, reports: this.matching().filter(r => r.category === category.key) }))
    .filter(group => group.reports.length > 0));
  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => this.selection.set(hasReportScopeParams(params) ? reportScopeFromParams(params) : reportScopeFromShared(this.communityScope.estateId())));
    void this.load();
  }
  changeScope(selection: ReportScopeSelection): void {
    this.selection.set(selection);
    const shared = sharedEstateForReport(selection);
    if (shared !== undefined) this.communityScope.select(shared);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { scopeMode: null, estateIds: null, ...reportScopeParams(selection) }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  async load(): Promise<void> {
    this.loading.set(true); this.error.set('');
    try {
      const [catalog, estates] = await Promise.all([this.reporting.catalog(), this.reporting.estates()]);
      this.catalog.set(catalog); this.estates.set(estates);
    }
    catch (error) { this.error.set(reportError(error, this.errorTitle)); }
    finally { this.loading.set(false); }
  }
  count(categoryKey: string): number { return this.reports().filter(r => r.category === categoryKey).length; }
  categoryTitle(report: ReportDefinition): string { return this.catalog().categories.find(c => c.key === report.category)?.title ?? ''; }
}
