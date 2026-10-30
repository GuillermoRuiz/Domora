import { API, setupComponent, settle } from '../../../core/testing/component-harness';
import { CoefficientRecalcModalComponent } from './coefficient-recalc-modal.component';
import type { CoefficientAreaPreview } from '../../../core/models';

const ESTATE_ID = 'estate-1';

function openModal() {
  const h = setupComponent(CoefficientRecalcModalComponent);
  h.fixture.componentRef.setInput('estateId', ESTATE_ID);
  h.fixture.componentRef.setInput('open', true);
  h.fixture.detectChanges(); // carga al abrir, en un effect
  return h;
}

const PREVIEW_OK: CoefficientAreaPreview = {
  rows: [
    { propertyId: 'p1', ref: 'A', type: 'Piso', builtAreaM2: 60, currentQuota: null, proposedQuota: 60 },
    { propertyId: 'p2', ref: 'B', type: 'Piso', builtAreaM2: 40, currentQuota: null, proposedQuota: 40 },
  ],
  missingArea: [],
};

const PREVIEW_MISSING: CoefficientAreaPreview = {
  rows: [],
  missingArea: [{ propertyId: 'p3', ref: 'C', type: 'Local' }],
};

describe('CoefficientRecalcModalComponent', () => {
  it('al abrir pide el preview por API y lo muestra', async () => {
    const h = openModal();
    h.http.expectOne(`${API}/estates/${ESTATE_ID}/properties/coefficients/preview-by-area`).flush(PREVIEW_OK);
    await settle();

    expect(h.component.preview()).toEqual(PREVIEW_OK);
    expect(h.component.loading()).toBe(false);
  });

  it('si falta superficie en alguna propiedad, no ofrece aplicar — solo ir a revisar', async () => {
    const h = openModal();
    h.http.expectOne(`${API}/estates/${ESTATE_ID}/properties/coefficients/preview-by-area`).flush(PREVIEW_MISSING);
    await settle();

    expect(h.component.preview()?.missingArea.length).toBe(1);

    const reviewSpy = vi.fn();
    h.component.reviewProperties.subscribe(reviewSpy);
    const closedSpy = vi.fn();
    h.component.closed.subscribe(closedSpy);

    h.component.goToProperties();
    expect(reviewSpy).toHaveBeenCalled();
    expect(closedSpy).toHaveBeenCalled();
  });

  it('aplicar llama al endpoint de apply, emite applied y cierra', async () => {
    const h = openModal();
    h.http.expectOne(`${API}/estates/${ESTATE_ID}/properties/coefficients/preview-by-area`).flush(PREVIEW_OK);
    await settle();

    const appliedSpy = vi.fn();
    h.component.applied.subscribe(appliedSpy);
    const closedSpy = vi.fn();
    h.component.closed.subscribe(closedSpy);

    const applyPromise = h.component.apply();
    h.http.expectOne(`${API}/estates/${ESTATE_ID}/properties/coefficients/apply-by-area`).flush([
      { id: 'p1', participationQuota: '60.00' },
      { id: 'p2', participationQuota: '40.00' },
    ]);
    await applyPromise;

    expect(appliedSpy).toHaveBeenCalled();
    expect(closedSpy).toHaveBeenCalled();
  });

  it('un error del backend al previsualizar se muestra y no rompe el modal', async () => {
    const h = openModal();
    h.http.expectOne(`${API}/estates/${ESTATE_ID}/properties/coefficients/preview-by-area`)
      .flush({ message: 'La finca no tiene propiedades.' }, { status: 404, statusText: 'Not Found' });
    await settle();

    expect(h.component.errorMsg()).toBe('La finca no tiene propiedades.');
    expect(h.component.loading()).toBe(false);
  });
});
