import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar/topbar.component';
import { BtnComponent } from '../../shared/components/btn/btn.component';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { EmptyStateComponent } from '../../shared/components/empty-state/empty-state.component';
import { ReportTableComponent } from '../../shared/components/report-table/report-table.component';
import { ReportCatalog, ReportEstate, ReportFormat, ReportInput, ReportResult, ReportScopeSelection } from '../../core/reporting.models';
import { ReportingService, reportError } from '../../core/reporting.service';
import { ReportEstateScopeSelectorComponent } from './report-estate-scope-selector.component';
import { ReportFiltersComponent } from './report-filters.component';
import { defaultReportInput, reportInputError, reportPeriodLabel, formatReportValue, formatReportCell } from './reporting.utils';
import { hasReportScopeParams, reportScopeFromParams, reportScopeFromShared, reportScopeParams, scopeForReport, sharedEstateForReport } from './report-scope-navigation';
import { CommunityScopeService } from '../../core/community-scope.service';

@Component({
  selector: 'app-report-viewer', standalone: true,
  imports: [RouterLink, TopbarComponent, BtnComponent, IconComponent, EmptyStateComponent, ReportTableComponent, ReportEstateScopeSelectorComponent, ReportFiltersComponent],
  templateUrl: './report-viewer.component.html', styleUrls: ['./reports.scss', './report-viewer.component.scss'],
})
export class ReportViewerComponent implements OnInit {
  private readonly reporting = inject(ReportingService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly communityScope = inject(CommunityScopeService);
  private readonly routeScope = signal<ReportScopeSelection>({ scopeMode: 'all', estateIds: [] });
  readonly scopeParams = computed(() => reportScopeParams(this.routeScope()));
  readonly reportKey = this.route.snapshot.paramMap.get('reportKey') ?? '';
  readonly catalog = signal<ReportCatalog>({ categories: [], reports: [] });
  readonly estates = signal<ReportEstate[]>(inject(CommunityScopeService).cachedEstates());
  readonly definition = computed(() => this.catalog().reports.find(r => r.key === this.reportKey && r.status === 'available'));
  readonly category = computed(() => this.catalog().categories.find(c => c.key === this.definition()?.category));
  readonly filterColumns = computed(() => {
    const report = this.definition();
    if (!report) return 1;
    const periodFields = { none: 0, range: 2, comparison: 4, year: 1, asOf: 1, quarter: 2 };
    return Math.max(1, Math.min(3, periodFields[report.periodMode] + report.filters.length));
  });
  readonly loading = signal(true); readonly querying = signal(false); readonly exporting = signal<ReportFormat | null>(null);
  readonly error = signal(''); readonly loadError = signal(''); readonly exportError = signal('');
  readonly input = signal<ReportInput>({ scopeMode: 'all' });
  readonly result = signal<ReportResult | null>(null);
  readonly properties = signal<{ id: string; name: string }[]>([]);
  readonly suppliers = signal<{ id: string; name: string }[]>([]);
  readonly optionsLoading = signal(false); readonly optionsError = signal('');
  readonly selection = computed<ReportScopeSelection>(() => ({ scopeMode: this.input().scopeMode, estateIds: this.input().estateIds ?? [] }));
  private readonly singleEstateId = computed(() => {
    const ids = this.input().scopeMode === 'all' ? this.estates().map(estate => estate.id) : this.input().estateIds ?? [];
    return ids.length === 1 ? ids[0] : null;
  });
  readonly singleEstate = computed(() => !!this.singleEstateId());
  readonly tableSections = computed(() => this.result()?.sections.map(section => ({ ...section,
    columns: section.columns.map(column => ({ ...column, money: column.kind === 'money', align: column.kind === 'int' ? 'right' as const : undefined })),
    rows: section.rows.map(row => Object.fromEntries(section.columns.map(column => [column.key, formatReportCell(row[column.key], column.kind, column.key)]))),
    totals: section.totals ? Object.fromEntries(section.columns.map(column => [column.key, formatReportCell(section.totals![column.key], column.kind, column.key)])) : undefined,
  })) ?? []);
  readonly periodLabel = computed(() => reportPeriodLabel(this.result()?.metadata.period ?? {}));
  readonly scopeLabel = computed(() => this.result()?.metadata.scope.estates.map(e => e.name).join(' · ') ?? '');
  readonly breadcrumbs = computed(() => ['Informes', ...(this.category() ? [this.category()!.title] : []), ...(this.definition() ? [this.definition()!.title] : [])]);
  readonly sensitivityLabels = { internal: 'Uso interno', personal_data: 'Contiene datos personales', financial: 'Información financiera', tax: 'Información fiscal' };
  readonly formatValue = formatReportValue;
  private revision = 0; private optionsRevision = 0;
  private generatedInput: ReportInput | null = null;
  ngOnInit(): void {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const selection = hasReportScopeParams(params) ? reportScopeFromParams(params) : reportScopeFromShared(this.communityScope.estateId());
      this.routeScope.set(selection);
      const definition = this.definition();
      if (definition) this.applyScope(scopeForReport(selection, definition.scopeMode === 'single'));
      else this.input.update(current => ({ ...current, ...selection }));
    });
    void this.load();
  }
  async load(): Promise<void> {
    this.loading.set(true); this.loadError.set('');
    try {
      const [catalog, estates] = await Promise.all([this.reporting.catalog(), this.reporting.estates()]);
      this.catalog.set(catalog); this.estates.set(estates);
      const definition = this.definition();
      if (definition) {
        this.input.set({ ...defaultReportInput(definition), ...scopeForReport(this.routeScope(), definition.scopeMode === 'single') });
        await this.loadOptions();
      }
    } catch (error) { this.loadError.set(reportError(error)); }
    finally { this.loading.set(false); }
  }
  updateInput(input: ReportInput): void {
    this.revision++; this.input.set(input); this.result.set(null); this.generatedInput = null;
    this.error.set(''); this.exportError.set('');
  }
  changeFilters(patch: Partial<ReportInput>): void {
    const current = this.input();
    this.updateInput({ ...current, ...patch, filters: { ...current.filters, ...patch.filters } });
  }
  changeScope(selection: ReportScopeSelection): void {
    this.routeScope.set(selection);
    const shared = sharedEstateForReport(selection);
    if (shared !== undefined) this.communityScope.select(shared);
    this.applyScope(selection);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { scopeMode: null, estateIds: null, ...reportScopeParams(selection) }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  private applyScope(selection: ReportScopeSelection): void {
    if (JSON.stringify(selection) === JSON.stringify(this.selection())) return;
    this.updateInput({ ...this.input(), ...selection, filters: { ...this.input().filters, propertyId: undefined, supplierId: undefined } });
    void this.loadOptions();
  }
  async loadOptions(): Promise<void> {
    const version = ++this.optionsRevision;
    this.properties.set([]); this.suppliers.set([]); this.optionsError.set('');
    if (!this.singleEstate()) { this.optionsLoading.set(false); return; }
    const definition = this.definition(); const estateId = this.singleEstateId()!; this.optionsLoading.set(true);
    try {
      const [properties, suppliers] = await Promise.all([
        definition?.filters.includes('propertyId') ? this.reporting.propertyOptions(estateId) : Promise.resolve([]),
        definition?.filters.includes('supplierId') ? this.reporting.supplierOptions(estateId) : Promise.resolve([]),
      ]);
      if (version === this.optionsRevision) { this.properties.set(properties); this.suppliers.set(suppliers); }
    } catch (error) { if (version === this.optionsRevision) this.optionsError.set(reportError(error)); }
    finally { if (version === this.optionsRevision) this.optionsLoading.set(false); }
  }
  async generate(): Promise<void> {
    const definition = this.definition(); if (!definition || this.querying() || this.exporting()) return;
    const invalid = reportInputError(this.input(), definition);
    if (invalid) { this.error.set(invalid); return; }
    const version = this.revision; const input = structuredClone(this.input());
    this.querying.set(true); this.error.set(''); this.exportError.set(''); this.result.set(null); this.generatedInput = null;
    try {
      const result = await this.reporting.query(this.reportKey, input);
      if (version === this.revision) { this.result.set(result); this.generatedInput = input; }
    } catch (error) { if (version === this.revision) this.error.set(reportError(error)); }
    finally { this.querying.set(false); }
  }
  async exportReport(format: ReportFormat): Promise<void> {
    if (!this.generatedInput || !this.result() || this.exporting() || !this.definition()?.formats.includes(format)) return;
    const version = this.revision; this.exporting.set(format); this.exportError.set('');
    try {
      const blob = await this.reporting.export(this.reportKey, this.generatedInput, format, this.result()?.metadata.snapshotId);
      if (version !== this.revision) return;
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement('a'); anchor.href = url;
        anchor.download = `domora-${this.reportKey.replace(/[^a-z0-9-]/gi, '-')}.${format}`;
        document.body.appendChild(anchor); anchor.click(); anchor.remove();
      } finally { URL.revokeObjectURL(url); }
    } catch (error) { if (version === this.revision) this.exportError.set(reportError(error)); }
    finally { this.exporting.set(null); }
  }
  generatedLabel(value: string): string { return new Date(value).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }); }
}
