import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { By } from '@angular/platform-browser';
import { API, makeUser, setupComponent, settle } from '../../core/testing/component-harness';
import { EstateNavigationService } from '../../core/estate-navigation.service';
import { EstateDetailPageComponent } from './estate-detail-page.component';
import { EstateDetailComponent } from './estate-detail.component';
import type { Estate } from '../../core/models';
import { AccountingDetailComponent } from '../accounting/accounting-detail/accounting-detail.component';
import { AccountingNavigationService } from '../../core/accounting-navigation.service';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import type { AiIntelligenceView } from '../../core/ai.service';

registerLocaleData(localeEs);

const estate = (id: string): Estate => ({
  id, administratorId: 'a1', name: `Finca ${id}`, type: 'Edificio', address: 'Mayor', location: 'Madrid',
  properties: 0, residents: 0, requests: 0, activeIssues: 0, occupancy: 0, reserveTarget: 0,
});
const setup = () => setupComponent(EstateDetailPageComponent, {
  user: makeUser({ role: 'B', administratorId: 'a1', estateIds: ['e1', 'e2', 'e3'] }),
  routes: [
    { path: 'b/estates/:id', component: EstateDetailPageComponent },
    { path: 'b/accounting/:id', component: AccountingDetailComponent },
  ],
});
async function flush(h: ReturnType<typeof setup>, harness: RouterTestingHarness, id: string, review: AiIntelligenceView = { latest: null, processing: null }) {
  h.http.expectOne(`${API}/estates/${id}`).flush(estate(id));
  await settle();
  h.http.expectOne(`${API}/estates/${id}/properties`).flush([]);
  h.http.expectOne(r => r.url === `${API}/estates/${id}/adhesion-requests`).flush([]);
  await settle();
  h.http.expectOne(`${API}/estates/${id}/external-owners`).flush([]);
  h.http.expectOne(`${API}/estates/${id}/setup-status`).flush({ complete: true, steps: [], requiredDone: 0, requiredTotal: 0 });
  harness.detectChanges();
  h.http.match(r => r.url === `${API}/estates/${id}/ai/intelligence`)
    .forEach(request => request.flush(review));
  h.http.match(r => r.url === `${API}/estates/${id}/dashboard/cashflow`)
    .forEach(request => request.flush({ year: 2026, years: [2026], months: [] }));
  h.http.match(r => r.url === `${API}/estates/${id}/dashboard/expense-breakdown`)
    .forEach(request => request.flush({ year: 2026, total: 0, categories: [] }));
  h.http.match(r => r.url === `${API}/estates/${id}/dashboard/properties`)
    .forEach(request => request.flush({ total: 0, items: [] }));
  h.http.match(r => r.url === `${API}/estates/${id}/dashboard/property-statuses`)
    .forEach(request => request.flush({ items: [] }));
  h.http.match(r => r.url === `${API}/estates/${id}/dashboard/activity`)
    .forEach(request => request.flush({ items: [] }));
  h.http.match(r => r.url === `${API}/estates/${id}/dashboard/milestones`)
    .forEach(request => request.flush({ items: [] }));
  h.http.match(r => r.url === `${API}/estates/${id}/dashboard/summary`)
    .forEach(request => request.flush({
      estateId: id, units: 0, balance: 0, pendingDues: { amount: 0, properties: 0 },
      issues: { open: 0, thisYear: 0 }, nextMeeting: null,
    }));
  flushOfficeTerms(h, id);
}
/** El panel de cargos (presidente…) de la pestaña Propiedades carga sus mandatos cada vez que se pinta. */
function flushOfficeTerms(h: ReturnType<typeof setup>, id: string) {
  h.http.match(r => r.url === `${API}/estates/${id}/office-terms`).forEach(request => request.flush([]));
}
function detail(harness: RouterTestingHarness): EstateDetailComponent {
  return harness.routeDebugElement!.query(By.directive(EstateDetailComponent)).componentInstance;
}

describe('EstateDetailPageComponent', () => {
  it('una tarjeta de Intelligence abre la subopción de la misma finca sin recargar el detalle', async () => {
    const h = setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/b/estates/e1');
    await flush(h, harness, 'e1', {
      latest: {
        id: 'review1', weekKey: '2026-W41', snapshotAt: '2026-10-04T12:00:00Z', completedAt: '2026-10-04T12:00:00Z',
        summary: 'Revisar los documentos de la finca',
        items: [{ signal_id: 'signal1', priority: 'medium', title: 'Documento pendiente', explanation: 'Hay un documento para revisar.',
          recommended_action: 'Revisar documento', entity_type: 'document', entity_id: 'd1', link: '/b/estates/e1?tab=documents' }],
      },
      processing: null,
    });
    await settle();
    harness.detectChanges();
    const first = detail(harness);
    (harness.routeNativeElement!.querySelector('app-intelligence-panel a') as HTMLAnchorElement).click();
    await settle();
    harness.detectChanges();
    h.http.expectOne(`${API}/estates/e1/library?folderId=root`).flush({ folders: [], rootDocumentCount: 0, documents: [] });
    expect(detail(harness)).toBe(first);
    expect(detail(harness).activeTab()).toBe('documents');
    expect(harness.routeNativeElement!.querySelector('app-intelligence-panel')).toBeNull();
    expect(detail(harness).isLegacyTab()).toBe(false); // Documentos vuelve a ser pestaña (biblioteca)
    await harness.navigateByUrl('/b/estates/e1');
    harness.detectChanges();
    expect(detail(harness)).toBe(first);
    expect(detail(harness).activeTab()).toBe('summary');
    expect(harness.routeNativeElement!.querySelector('app-intelligence-panel')).not.toBeNull();
    h.http.expectOne(`${API}/estates/e1/ai/intelligence`).flush({ latest: null, processing: null });
    // Al volver al Resumen se vuelven a pedir sus indicadores (la pestaña se monta de nuevo).
    h.http.expectOne(`${API}/estates/e1/dashboard/summary`).flush({
      estateId: 'e1', units: 0, balance: 0, pendingDues: { amount: 0, properties: 0 },
      issues: { open: 0, thisYear: 0 }, nextMeeting: null,
    });
    h.http.expectOne(r => r.url === `${API}/estates/e1/dashboard/cashflow`).flush({ year: 2026, years: [2026], months: [] });
    await settle();
    h.http.match(r => r.url === `${API}/estates/e1/dashboard/expense-breakdown`).forEach(r => r.flush({ year: 2026, total: 0, categories: [] }));
    h.http.match(r => r.url === `${API}/estates/e1/dashboard/milestones`).forEach(r => r.flush({ items: [] }));
    h.http.match(r => r.url === `${API}/estates/e1/dashboard/activity`).forEach(r => r.flush({ items: [] }));
    h.http.match(r => r.url === `${API}/estates/e1/dashboard/properties`).forEach(r => r.flush({ total: 0, items: [] }));
    h.http.match(r => r.url === `${API}/estates/e1/dashboard/property-statuses`).forEach(r => r.flush({ items: [] }));
    h.http.expectNone(`${API}/estates/e1`);
    h.http.verify();
  }, 20_000); // monta la ficha completa: con toda la batería en paralelo supera los 5 s por defecto

  it('Fincas y Contabilidad conservan sus apartados al alternar entre módulos', async () => {
    const h = setup();
    const harness = await RouterTestingHarness.create();
    const estates = TestBed.inject(EstateNavigationService);
    const accounting = TestBed.inject(AccountingNavigationService);
    await harness.navigateByUrl('/b/estates/e1');
    await flush(h, harness, 'e1');
    expect(estates.context()?.estate()?.id).toBe('e1');
    expect(accounting.context()).toBeNull();
    await harness.navigateByUrl('/b/accounting/e1');
    h.http.expectOne(`${API}/estates/e1/accounting/summary`).flush({
      id: 'e1', name: 'Finca e1', balance: 0, income: 0, expenses: 0, reserve: 0, reserveTarget: 0, units: 0,
    });
    h.http.expectOne(r => r.url === `${API}/estates/e1/journal`).flush({ items: [], total: 0, page: 1, pageSize: 5 });
    await settle();
    harness.detectChanges();
    h.http.expectOne(r => r.url === `${API}/estates/e1/ai/reconciliation`).flush({
      counts: { bankMovements: 0, automaticallyReconciled: 0, suggested: 0, unmatched: 0 }, data: [], total: 0,
    });
    expect(estates.context()).toBeNull();
    expect(accounting.context()?.estate()?.id).toBe('e1');
    expect(accounting.groups).toHaveLength(5);
    expect(harness.routeNativeElement!.querySelector('app-accounting-community-selector')).not.toBeNull();
    await harness.navigateByUrl('/b/estates/e2');
    await flush(h, harness, 'e2');
    expect(accounting.context()).toBeNull();
    expect(estates.context()?.estate()?.id).toBe('e2');
    expect(estates.tabs).toHaveLength(7);
    expect(harness.routeNativeElement!.querySelector('app-estate-community-selector')).not.toBeNull();
    h.http.verify();
  });

  it('cambiar comunidad conserva Documentos y carga un nuevo detalle sin formularios ni datos anteriores', async () => {
    const h = setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/b/estates/e1?tab=documents');
    await flush(h, harness, 'e1');
    h.http.expectOne(`${API}/estates/e1/library?folderId=root`).flush({ folders: [], rootDocumentCount: 0, documents: [] });
    const first = detail(harness);
    first.openEditEstate();
    harness.detectChanges();
    expect(first.showEditEstate()).toBe(true);
    (harness.routeNativeElement!.querySelector('.community-selector__trigger') as HTMLButtonElement).click();
    harness.detectChanges();
    h.http.expectOne(`${API}/estates`).flush([estate('e1'), estate('e2')]);
    await settle();
    harness.detectChanges();
    (harness.routeNativeElement!.querySelector('[data-community-id="e2"]') as HTMLButtonElement).click();
    await settle();
    harness.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/b/estates/e2?tab=documents');
    expect(detail(harness)).not.toBe(first);
    expect(detail(harness).showEditEstate()).toBe(false);
    expect(detail(harness).estate).toBeNull();
    await flush(h, harness, 'e2');
    h.http.expectOne(`${API}/estates/e2/library?folderId=root`).flush({ folders: [], rootDocumentCount: 0, documents: [] });
    await settle();
    harness.detectChanges();
    expect(detail(harness).activeTab()).toBe('documents');
    expect(detail(harness).isLegacyTab()).toBe(false); // Documentos es pestaña visible
    expect(harness.routeNativeElement!.querySelector('.community-selector__name')?.textContent).toContain('Finca e2');
    h.http.verify();
  });

  it('una respuesta tardía de una finca descartada no sustituye la comunidad actual', async () => {
    const h = setup();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/b/estates/e1');
    const late = h.http.expectOne(`${API}/estates/e1`);
    await harness.navigateByUrl('/b/estates/e2?tab=properties');
    await flush(h, harness, 'e2');
    late.flush(estate('e1'));
    await settle();
    harness.detectChanges();
    expect(detail(harness).estate?.id).toBe('e2');
    expect(detail(harness).activeTab()).toBe('properties');
    expect(TestBed.inject(EstateNavigationService).context()?.estate()?.id).toBe('e2');
    h.http.expectNone(`${API}/estates/e1/properties`);
    h.http.verify();
  });
});
