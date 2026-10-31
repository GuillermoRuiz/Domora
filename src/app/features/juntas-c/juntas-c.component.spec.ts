import { ActivatedRoute, Router, convertToParamMap, type ParamMap } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { API, makeUser, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { OwnerScopeService, type ScopeProperty } from '../../core/owner-scope.service';
import { JuntasCComponent } from './juntas-c.component';
import { fakeOwnerScope } from '../../core/testing/fake-owner-scope';

const P1: ScopeProperty = { id: 'p1', nickname: '3A', addressFull: 'Calle Colón 24', estateId: 'e1', estateName: 'Colón 24', isLinked: true };
const P2: ScopeProperty = { id: 'p2', nickname: '1A', addressFull: 'Calle Cuba 18', estateId: 'e2', estateName: 'Cuba 18', isLinked: true };
const P3: ScopeProperty = { id: 'p3', nickname: 'Trastero', addressFull: 'Sin finca', estateId: null, estateName: null, isLinked: false };
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';


describe('JuntasCComponent', () => {
  let h: ComponentHarness<JuntasCComponent>;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function mount(scope = fakeOwnerScope([P1, P2], { selectedId: 'p1' }), query: Record<string, string> = {}) {
    const params = new BehaviorSubject<ParamMap>(convertToParamMap(query));
    // The query params are read as the component is created: spy before mounting.
    navigate = vi.spyOn(Router.prototype, 'navigate').mockResolvedValue(true);
    h = setupComponent(JuntasCComponent, {
      user: makeUser({ id: 'u1' }),
      providers: [
        { provide: OwnerScopeService, useValue: scope },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params.value }, queryParamMap: params } },
      ],
    });
    h.fixture.detectChanges();
    await settle();
    h.fixture.detectChanges();
    return scope;
  }

  /** Each juntas section asks for the meetings of its estate. */
  function flushMeetings(...estateIds: string[]) {
    for (const id of estateIds) h.http.expectOne(`${API}/estates/${id}/meetings`).flush([]);
  }

  afterEach(() => {
    h?.http.verify();
    navigate?.mockRestore();
  });

  it('shows the juntas of the selected property', async () => {
    await mount();
    flushMeetings('e1');

    expect(text(h.el.querySelector('h1'))).toBe('Juntas');
    expect(text(h.el.querySelector('[data-scope-chip]'))).toBe('Ámbito actual: 3A');
    expect(Array.from(h.el.querySelectorAll('[data-property]')).map((b) => b.getAttribute('data-property'))).toEqual(['p1']);
  });

  it('«Todas mis propiedades» shows one block per property with a community', async () => {
    await mount(fakeOwnerScope([P1, P2, P3], { selectedId: null }));
    flushMeetings('e1', 'e2');

    const blocks = Array.from(h.el.querySelectorAll('[data-property]'));
    expect(blocks.map((b) => b.getAttribute('data-property'))).toEqual(['p1', 'p2']);
    expect(text(blocks[1].querySelector('.juntas__block-title'))).toBe('Cuba 18 · 1A');
  });

  it('properties of the same community share their reads: one request for its meetings', async () => {
    const P1b: ScopeProperty = { ...P1, id: 'p1b', nickname: 'Garaje 4' };
    await mount(fakeOwnerScope([P1, P1b], { selectedId: null }));
    flushMeetings('e1');
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelectorAll('[data-property]')).toHaveLength(2);
  });

  it('?meeting= of a cancelled meeting shows it on top with its status, even though it takes no votes', async () => {
    await mount(fakeOwnerScope([P1], { selectedId: 'p1' }), { meeting: 'm9' });
    h.http.expectOne(`${API}/estates/e1/meetings`).flush([
      { id: 'm9', estateId: 'e1', title: 'Ordinaria 2026', status: 'cancelada', scheduledAt1: '2026-11-20T18:00:00.000Z', agenda: [] },
    ]);
    await settle();
    h.fixture.detectChanges();

    const featured = h.el.querySelector('[data-featured-meeting]');
    expect(featured?.getAttribute('data-meeting')).toBe('m9');
    expect(text(featured)).toContain('Cancelada');
    expect(text(featured)).toContain('Ordinaria 2026');
    expect(featured?.querySelector('[data-action="download-acta"]')).toBeNull();
  });

  it('a featured meeting with a signed acta offers to download it', async () => {
    await mount(fakeOwnerScope([P1], { selectedId: 'p1' }), { meeting: 'm9' });
    h.http.expectOne(`${API}/estates/e1/meetings`).flush([
      { id: 'm9', estateId: 'e1', title: 'Ordinaria 2026', status: 'firmada', actaS3Key: 'k', scheduledAt1: '2026-06-20T18:00:00.000Z', agenda: [] },
    ]);
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-featured-meeting] [data-action="download-acta"]')).not.toBeNull();
  });

  it('a ?meeting= that is not in the scope shows no featured card', async () => {
    await mount(fakeOwnerScope([P1], { selectedId: 'p1' }), { meeting: 'otra' });
    flushMeetings('e1');
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-featured-meeting]')).toBeNull();
  });

  it('a property without community explains it has no juntas', async () => {
    await mount(fakeOwnerScope([P3]));
    expect(text(h.el.querySelector('app-empty-state'))).toContain('Sin comunidad vinculada');
  });

  it('?propertyId= and ?estateId= choose the property and the params are dropped', async () => {
    const byProperty = await mount(fakeOwnerScope([P1, P2], { selectedId: 'p1' }), { propertyId: 'p2', meeting: 'm9' });
    expect(byProperty.select).toHaveBeenCalledWith('p2');
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { propertyId: null, estateId: null }, replaceUrl: true }));
    expect(h.component.highlightedMeetingId()).toBe('m9');
    h.fixture.detectChanges();
    h.http.match(() => true).forEach((r) => r.flush([]));
  });

  it('?estateId= chooses the first property of that community', async () => {
    const scope = await mount(fakeOwnerScope([P1, P2], { selectedId: 'p1' }), { estateId: 'e2' });
    expect(scope.select).toHaveBeenCalledWith('p2');
    h.fixture.detectChanges();
    h.http.match(() => true).forEach((r) => r.flush([]));
  });
});
