import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { API, setupComponent, settle } from '../../core/testing/component-harness';
import { StateService } from '../../core/state.service';
import { AddPropertyComponent } from './add-property.component';
import type { OwnerProperty } from '../../core/models';

function makeOwnerProperty(overrides: Partial<OwnerProperty> = {}): OwnerProperty {
  return { id: 'p1', type: 'Piso', estateId: null, administratorId: null, status: 'Ocupado', ...overrides } as OwnerProperty;
}

/** `estateContext` se lee en el CONSTRUCTOR — hay que fijarlo en StateService ANTES de crear el fixture. */
function setupInEstateMode(context: { id: string; name: string; address: string; streetNumber?: string; location: string }) {
  TestBed.configureTestingModule({
    imports: [AddPropertyComponent],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  const state = TestBed.inject(StateService);
  state.addPropertyEstateContext.set(context);
  const fixture = TestBed.createComponent(AddPropertyComponent);
  const http = TestBed.inject(HttpTestingController);
  return { fixture, component: fixture.componentInstance, http, state, get el() { return fixture.nativeElement as HTMLElement; } };
}

describe('AddPropertyComponent', () => {
  describe('modo propietario (rol C, sin contexto de finca)', () => {
    it('el paso 1 exige elegir un tipo antes de poder avanzar', () => {
      const { fixture, el } = setupComponent(AddPropertyComponent);
      fixture.detectChanges();

      const nextBtn = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Siguiente')) as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);

      (el.querySelector('.type-card') as HTMLElement).click();
      fixture.detectChanges();

      expect(nextBtn.disabled).toBe(false);
    });

    it('needsCommunity/hasFloorDoor dependen del tipo elegido', () => {
      const { fixture, component } = setupComponent(AddPropertyComponent);
      fixture.detectChanges();

      component.selectedType.set('Casa');
      expect(component.needsCommunity).toBe(false);
      expect(component.hasFloorDoor).toBe(false);

      component.selectedType.set('Piso');
      expect(component.needsCommunity).toBe(true);
      expect(component.hasFloorDoor).toBe(true);
    });

    it('ya no ofrece «Vincular a comunidad existente» ni consulta el catálogo de fincas: arranca en «Solicitar alta»', () => {
      const { fixture, http, el, component } = setupComponent(AddPropertyComponent);
      fixture.detectChanges();
      expect(component.linkMode()).toBe('request');
      expect(el.textContent).not.toContain('Vincular a comunidad existente');
      http.expectNone((r) => r.url.includes('/estates/search'));
    });

    it('canSubmit exige un nombre en modo "request"', () => {
      const { fixture, component } = setupComponent(AddPropertyComponent);
      fixture.detectChanges();
      component.selectedType.set('Piso'); // needsCommunity = true

      component.linkMode.set('request');
      expect(component.canSubmit).toBe(false);
      component.reqCommunityName.set('Comunidad Nueva');
      expect(component.canSubmit).toBe(true);

      component.linkMode.set('later');
      expect(component.canSubmit).toBe(true);
    });

    it('sin vincular («más tarde»), crea la propiedad sin finca', async () => {
      const { fixture, http, component } = setupComponent(AddPropertyComponent);
      fixture.detectChanges();
      component.selectedType.set('Casa');
      component.street.set('Gran Vía');
      component.city.set('Madrid');
      component.linkMode.set('later'); // Casa no needsCommunity, alcanza con "later"

      const submitPromise = component.submit();
      const req = http.expectOne((r) => r.url === `${API}/properties` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ type: 'Casa', viaName: 'Gran Vía', municipality: 'Madrid', country: 'ES' });
      expect(req.request.body.estateId).toBeUndefined();
      req.flush(makeOwnerProperty({ id: 'p-nueva' }));
      await submitPromise;
      fixture.detectChanges();

      expect(component.step()).toBe(4);
      expect(TestBed.inject(StateService).propertiesVersion()).toBe(1);
    });

    it('solicitando alta de comunidad nueva, crea la propiedad y además la solicitud de onboarding', async () => {
      const { fixture, http, component } = setupComponent(AddPropertyComponent);
      fixture.detectChanges();
      component.selectedType.set('Piso');
      component.linkMode.set('request');
      component.reqCommunityName.set('Comunidad Nueva');

      const submitPromise = component.submit();
      const propReq = http.expectOne((r) => r.url === `${API}/properties` && r.method === 'POST');
      propReq.flush(makeOwnerProperty({ id: 'p-nueva' }));
      await settle();
      const onboardingReq = http.expectOne((r) => r.url === `${API}/estate-onboarding-requests` && r.method === 'POST');
      expect(onboardingReq.request.body).toMatchObject({ propertyId: 'p-nueva', communityName: 'Comunidad Nueva' });
      onboardingReq.flush(null);
      await submitPromise;
      fixture.detectChanges();

      expect(component.step()).toBe(4);
      expect(fixture.nativeElement.textContent).toContain('Comunidad Nueva');
    });

    it('si falla el guardado, muestra el error y no avanza de paso', async () => {
      const { fixture, http, component, el } = setupComponent(AddPropertyComponent);
      fixture.detectChanges();
      component.selectedType.set('Casa');
      component.linkMode.set('later');

      const submitPromise = component.submit();
      const req = http.expectOne((r) => r.url === `${API}/properties` && r.method === 'POST');
      req.flush({ message: 'error' }, { status: 500, statusText: 'Server Error' });
      await submitPromise;
      fixture.detectChanges();

      expect(component.step()).not.toBe(4);
      expect(el.textContent).toContain('No se pudo guardar la propiedad');
    });

    it('close() resetea el wizard entero y cierra el modal', () => {
      const { fixture, component } = setupComponent(AddPropertyComponent);
      fixture.detectChanges();
      component.selectedType.set('Piso');
      component.step.set(3);
      component.linkMode.set('request');
      component.reqCommunityName.set('Algo');
      TestBed.inject(StateService).showAddPropertyModal.set(true);

      component.close();

      expect(component.step()).toBe(1);
      expect(component.selectedType()).toBe('');
      expect(component.reqCommunityName()).toBe('');
      expect(TestBed.inject(StateService).showAddPropertyModal()).toBe(false);
    });
  });

  describe('modo finca (rol B/A, abierto desde estate-detail)', () => {
    it('precarga la dirección de la finca y no exige comunidad', async () => {
      const { fixture, component, el } = setupInEstateMode({ id: 'e1', name: 'Edificio Sol', address: 'Calle Mayor', streetNumber: '10', location: 'Madrid' });
      fixture.detectChanges();

      expect(component.isEstateMode()).toBe(true);
      expect(component.street()).toBe('Calle Mayor');
      expect(component.number()).toBe('10');
      expect(component.city()).toBe('Madrid');
      expect(el.textContent).toContain('Edificio Sol');
    });

    it('crea la propiedad dentro de la finca vía createEstateProperty, con la cuota indicada', async () => {
      const { fixture, http, component } = setupInEstateMode({ id: 'e1', name: 'Edificio Sol', address: 'Calle Mayor', location: 'Madrid' });
      fixture.detectChanges();
      component.selectedType.set('Piso');
      component.quotaMonthly.set(85);

      const submitPromise = component.submit();
      const req = http.expectOne((r) => r.url === `${API}/estates/e1/properties` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ type: 'Piso', quotaMonthly: 85 });
      req.flush(makeOwnerProperty({ id: 'p-nueva', estateId: 'e1' }));
      await submitPromise;
      fixture.detectChanges();

      expect(component.step()).toBe(4);
    });

    it('envía el coeficiente de participación indicado', async () => {
      const { fixture, http, component } = setupInEstateMode({ id: 'e1', name: 'Edificio Sol', address: 'Calle Mayor', location: 'Madrid' });
      fixture.detectChanges();
      component.selectedType.set('Piso');
      component.participationQuota.set(2.5);

      const submitPromise = component.submit();
      const req = http.expectOne((r) => r.url === `${API}/estates/e1/properties` && r.method === 'POST');
      expect(req.request.body).toMatchObject({ type: 'Piso', participationQuota: 2.5 });
      req.flush(makeOwnerProperty({ id: 'p-nueva', estateId: 'e1' }));
      await submitPromise;
    });

    it('sin coeficiente, no manda el campo (es opcional)', async () => {
      const { fixture, http, component } = setupInEstateMode({ id: 'e1', name: 'Edificio Sol', address: 'Calle Mayor', location: 'Madrid' });
      fixture.detectChanges();
      component.selectedType.set('Piso');

      const submitPromise = component.submit();
      const req = http.expectOne((r) => r.url === `${API}/estates/e1/properties` && r.method === 'POST');
      expect(req.request.body.participationQuota).toBeUndefined();
      req.flush(makeOwnerProperty({ id: 'p-nueva', estateId: 'e1' }));
      await submitPromise;
    });

    it('close() vacía el coeficiente para que no se arrastre a la siguiente alta', () => {
      const { component } = setupInEstateMode({ id: 'e1', name: 'Edificio Sol', address: 'Calle Mayor', location: 'Madrid' });
      component.participationQuota.set(5);

      component.close();

      expect(component.participationQuota()).toBeNull();
    });
  });
});
