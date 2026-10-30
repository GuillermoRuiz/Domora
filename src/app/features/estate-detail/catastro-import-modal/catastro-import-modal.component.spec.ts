import { API, setupComponent, settle } from '../../../core/testing/component-harness';
import { CatastroImportModalComponent, type CatastroImportEstate } from './catastro-import-modal.component';
import type { CatastroLookup, CatastroUnit } from '../../../core/models';

const PROVINCES = [{ code: '28', name: 'MADRID' }, { code: '41', name: 'SEVILLA' }];

function makeUnit(overrides: Partial<CatastroUnit> = {}): CatastroUnit {
  return {
    cadastralReference: '2853604VK4725D0001YP', type: 'Piso', use: 'Residencial',
    viaType: 'Calle', viaName: 'Alcala', streetNumber: '100', streetNumberSuffix: null,
    block: null, staircase: '1', floor: '2', door: 'A', postalCode: '28009',
    municipality: 'Madrid', province: 'Madrid', builtAreaM2: 80, participationQuota: 50,
    alreadyImported: false,
    ...overrides,
  };
}

function makeLookup(units: CatastroUnit[], overrides: Partial<CatastroLookup> = {}): CatastroLookup {
  return {
    source: { name: 'Dirección General del Catastro', parcelReference: '2853604VK4725D', fetchedAt: '2026-09-20T10:00:00.000Z' },
    units,
    warnings: [],
    ...overrides,
  };
}

const TWO_UNITS = [
  makeUnit({ cadastralReference: 'A'.repeat(20), floor: '1', participationQuota: 60 }),
  makeUnit({ cadastralReference: 'B'.repeat(20), floor: '2', participationQuota: 40 }),
];

const ESTATE: CatastroImportEstate = {
  id: 'e1', address: 'Calle Mayor', streetNumber: '12 bis', location: 'Madrid', province: 'Madrid', cadastralReference: null,
};

/**
 * Monta el modal abierto sobre `estate` y responde la carga inicial de
 * provincias. Con provincia + municipio + calle conocidos el modal propone
 * enseguida la calle de la finca (otra petición): por defecto se responde
 * vacía para que cada test parta de un estado limpio.
 */
async function openModal(estate: CatastroImportEstate = ESTATE, opts: { flushStreets?: boolean } = {}) {
  const h = setupComponent(CatastroImportModalComponent);
  h.fixture.componentRef.setInput('estate', estate);
  h.fixture.componentRef.setInput('open', true);
  h.fixture.detectChanges(); // el modal se inicializa al abrir, en un effect
  h.http.expectOne(`${API}/catastro/provinces`).flush(PROVINCES);
  await settle();
  if (opts.flushStreets ?? true) {
    h.http.match((r) => r.url === `${API}/catastro/streets`).forEach((r) => r.flush([]));
    await settle();
  }
  return h;
}

describe('CatastroImportModalComponent', () => {
  describe('apertura y precarga', () => {
    it('finca con referencia catastral: abre en modo referencia con la RC ya escrita', async () => {
      const h = await openModal({ ...ESTATE, cadastralReference: '2853604VK4725D' });

      expect(h.component.mode()).toBe('ref');
      expect(h.component.refCat()).toBe('2853604VK4725D');
      h.http.verify();
    });

    it('finca sin referencia: modo dirección, con calle sin el tipo de vía, número numérico y provincia casada sin importar mayúsculas', async () => {
      const h = await openModal(ESTATE, { flushStreets: false });
      // Con provincia + municipio + calle conocidos, propone la calle de la finca.
      const streetsReq = h.http.expectOne((r) => r.url === `${API}/catastro/streets`);
      expect(streetsReq.request.params.get('q')).toBe('Mayor');
      streetsReq.flush([{ sigla: 'CL', name: 'MAYOR' }]);
      await settle();

      expect(h.component.mode()).toBe('address');
      expect(h.component.province()).toBe('MADRID'); // "Madrid" de la finca → "MADRID" del catálogo
      expect(h.component.municipality()).toBe('Madrid');
      expect(h.component.streetQuery()).toBe('Mayor');
      expect(h.component.number()).toBe('12');
      expect(h.component.streetSuggestions()).toEqual([{ sigla: 'CL', name: 'MAYOR' }]);
      h.http.verify();
    });

    // Antes la selección de Provincia estaba habilitada de entrada, sin
    // indicar que el catálogo todavía estaba cargando: el usuario podía
    // interactuar con un desplegable vacío mientras la petición seguía en
    // vuelo. Ahora queda deshabilitada (con spinner) hasta que responde.
    it('Provincia está deshabilitada (con spinner) mientras carga el catálogo, y se habilita al llegar', async () => {
      const h = setupComponent(CatastroImportModalComponent);
      h.fixture.componentRef.setInput('estate', ESTATE);
      h.fixture.componentRef.setInput('open', true);
      h.fixture.detectChanges();
      // `NgModel` enruta `[disabled]` a su propio control y lo aplica en un
      // microtask (`resolvedPromise.then(...)` dentro de @angular/forms) —
      // hace falta dejarlo asentar antes de mirar el DOM.
      await settle();
      h.fixture.detectChanges();

      expect(h.component.provincesLoading()).toBe(true);
      expect(h.el.querySelector('select')?.disabled).toBe(true);
      expect(h.el.querySelector('.field-spinner')).not.toBeNull();

      h.http.expectOne(`${API}/catastro/provinces`).flush(PROVINCES);
      await settle();
      h.http.match((r) => r.url === `${API}/catastro/streets`).forEach((r) => r.flush([]));
      await settle();
      h.fixture.detectChanges();
      await settle();
      h.fixture.detectChanges();

      expect(h.component.provincesLoading()).toBe(false);
      expect(h.el.querySelector('select')?.disabled).toBe(false);
      expect(h.el.querySelector('.field-spinner')).toBeNull();
    });

    it('si el catálogo falla, avisa pero deja buscar por referencia', async () => {
      const h = setupComponent(CatastroImportModalComponent);
      h.fixture.componentRef.setInput('estate', ESTATE);
      h.fixture.componentRef.setInput('open', true);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/catastro/provinces`).flush({ message: 'x' }, { status: 503, statusText: 'Service Unavailable' });
      await settle();

      expect(h.component.errorMsg()).toContain('catálogo');
      h.component.mode.set('ref');
      h.component.refCat.set('2853604VK4725D');
      const p = h.component.search();
      h.http.expectOne(`${API}/estates/e1/catastro/lookup`).flush(makeLookup(TWO_UNITS));
      await p;
      expect(h.component.step()).toBe('review');
    });
  });

  describe('búsqueda', () => {
    it('una referencia mal formada se rechaza sin llamar al Catastro', async () => {
      const h = await openModal();
      h.component.mode.set('ref');
      h.component.refCat.set('123');

      await h.component.search();

      expect(h.component.errorMsg()).toMatch(/14, 18 o 20/);
      h.http.expectNone(`${API}/estates/e1/catastro/lookup`);
      expect(h.component.step()).toBe('search');
    });

    it('la referencia se normaliza (sin espacios, en mayúsculas) antes de enviarla', async () => {
      const h = await openModal();
      h.component.mode.set('ref');
      h.component.refCat.set(' 2853604vk4725d ');

      const p = h.component.search();
      const req = h.http.expectOne(`${API}/estates/e1/catastro/lookup`);
      expect(req.request.body).toEqual({ refCat: '2853604VK4725D' });
      req.flush(makeLookup(TWO_UNITS));
      await p;
    });

    it('por dirección exige elegir una calle de las sugerencias (hace falta su sigla)', async () => {
      const h = await openModal();
      h.component.mode.set('address');
      h.component.province.set('MADRID');
      h.component.municipality.set('Madrid');
      h.component.streetQuery.set('Mayor');
      h.component.number.set('12');

      await h.component.search();

      expect(h.component.errorMsg()).toMatch(/sugerencias/);
      h.http.expectNone(`${API}/estates/e1/catastro/lookup`);
    });

    it('por dirección envía provincia, municipio, sigla, calle y número', async () => {
      const h = await openModal();
      h.component.mode.set('address');
      h.component.province.set('MADRID');
      h.component.municipality.set('MADRID');
      h.component.pickStreet({ sigla: 'CL', name: 'ALCALA' });
      h.component.number.set('100');

      const p = h.component.search();
      const req = h.http.expectOne(`${API}/estates/e1/catastro/lookup`);
      expect(req.request.body).toEqual({ provincia: 'MADRID', municipio: 'MADRID', sigla: 'CL', calle: 'ALCALA', numero: '100' });
      req.flush(makeLookup(TWO_UNITS));
      await p;
    });

    it('un número de más de 4 dígitos se rechaza (límite del servicio)', async () => {
      const h = await openModal();
      h.component.mode.set('address');
      h.component.province.set('MADRID');
      h.component.municipality.set('MADRID');
      h.component.pickStreet({ sigla: 'CL', name: 'ALCALA' });
      h.component.number.set('12345');

      await h.component.search();

      expect(h.component.errorMsg()).toMatch(/1 y 4 dígitos/);
    });

    it('un fallo del Catastro muestra el mensaje del servidor y no cambia de paso', async () => {
      const h = await openModal();
      h.component.mode.set('ref');
      h.component.refCat.set('2853604VK4725D');

      const p = h.component.search();
      h.http.expectOne(`${API}/estates/e1/catastro/lookup`).flush(
        { message: 'No se pudo consultar el Catastro. Inténtalo de nuevo en unos minutos o da de alta las propiedades a mano.' },
        { status: 503, statusText: 'Service Unavailable' },
      );
      await p;

      expect(h.component.step()).toBe('search');
      expect(h.component.errorMsg()).toContain('da de alta las propiedades a mano');
      expect(h.component.loading()).toBe(false);
    });

    it('un 429 (límite de peticiones) se explica en claro', async () => {
      const h = await openModal();
      h.component.mode.set('ref');
      h.component.refCat.set('2853604VK4725D');

      const p = h.component.search();
      h.http.expectOne(`${API}/estates/e1/catastro/lookup`).flush({}, { status: 429, statusText: 'Too Many Requests' });
      await p;

      expect(h.component.errorMsg()).toMatch(/Demasiadas consultas/);
    });
  });

  describe('autocompletado', () => {
    it('solo se aplican las sugerencias de la ÚLTIMA búsqueda de calles (anti-carrera)', async () => {
      const h = await openModal();
      h.component.province.set('MADRID');
      h.component.municipality.set('Madrid');

      h.component.streetQuery.set('al');
      const first = h.component.searchStreets();
      const reqA = h.http.expectOne((r) => r.url === `${API}/catastro/streets` && r.params.get('q') === 'al');
      h.component.streetQuery.set('alc');
      const second = h.component.searchStreets();
      const reqB = h.http.expectOne((r) => r.url === `${API}/catastro/streets` && r.params.get('q') === 'alc');

      reqB.flush([{ sigla: 'CL', name: 'ALCALA' }]);
      await second;
      reqA.flush([{ sigla: 'CL', name: 'ALAMEDA' }]); // llega tarde: no debe pisar
      await first;

      expect(h.component.streetSuggestions()).toEqual([{ sigla: 'CL', name: 'ALCALA' }]);
    });

    it('cambiar de provincia o de municipio invalida la calle ya elegida (su sigla ya no vale)', async () => {
      const h = await openModal();
      h.component.pickStreet({ sigla: 'CL', name: 'ALCALA' });
      expect(h.component.selectedStreet()).not.toBeNull();

      h.component.onProvinceChange('SEVILLA');

      expect(h.component.selectedStreet()).toBeNull();
    });
  });

  // El usuario reportó ver sugerencias ajenas ("Config", "Valencia") al
  // rellenar estos campos: era el autocompletado NATIVO del navegador (que
  // reconoce Provincia/Municipio/Calle/Número como un formulario de
  // dirección e ignora autocomplete="off" si falta en algún campo), no un
  // dato que viniera del Catastro. Y, aparte de eso, nada impedía escribir
  // en Municipio o Calle antes de completar el paso anterior.
  describe('disponibilidad de campos', () => {
    it('todos los campos de texto llevan autocomplete="off" (evita sugerencias de otros formularios del navegador)', async () => {
      const h = await openModal();
      const selects = Array.from(h.el.querySelectorAll('select'));
      const addressInputs = Array.from(h.el.querySelectorAll('input[type="text"]'));
      for (const el of [...selects, ...addressInputs]) {
        expect(el.getAttribute('autocomplete')).toBe('off');
      }

      h.component.setMode('ref');
      h.fixture.detectChanges();
      expect(h.el.querySelector('input')?.getAttribute('autocomplete')).toBe('off');
    });

    it('Municipio está deshabilitado hasta elegir provincia', async () => {
      const h = await openModal();
      h.component.province.set('');
      h.fixture.detectChanges();
      // `NgModel` aplica `[disabled]` vía su propio control en un microtask
      // (`resolvedPromise.then(...)` en @angular/forms): hay que dejarlo asentar.
      await settle();
      h.fixture.detectChanges();
      const municipioInput = h.el.querySelector<HTMLInputElement>('.form-row input');
      expect(municipioInput?.disabled).toBe(true);

      h.component.province.set('MADRID');
      h.fixture.detectChanges();
      await settle();
      h.fixture.detectChanges();
      expect(municipioInput?.disabled).toBe(false);
    });

    it('Calle está deshabilitada hasta rellenar el municipio, y Número hasta elegir la calle', async () => {
      const h = await openModal();
      h.component.municipality.set('');
      h.fixture.detectChanges();
      await settle();
      h.fixture.detectChanges();
      const calleInput = h.el.querySelector<HTMLInputElement>('input[placeholder="Nombre de la calle"]');
      const numeroInput = h.el.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
      expect(calleInput?.disabled).toBe(true);
      expect(numeroInput?.disabled).toBe(true);

      h.component.municipality.set('Madrid');
      h.fixture.detectChanges();
      await settle();
      h.fixture.detectChanges();
      expect(calleInput?.disabled).toBe(false);
      expect(numeroInput?.disabled).toBe(true); // todavía no hay calle elegida

      h.component.pickStreet({ sigla: 'CL', name: 'ALCALA' });
      h.fixture.detectChanges();
      await settle();
      h.fixture.detectChanges();
      expect(numeroInput?.disabled).toBe(false);
    });
  });

  describe('revisión e importación', () => {
    async function inReview(units: CatastroUnit[], lookup: Partial<CatastroLookup> = {}) {
      const h = await openModal({ ...ESTATE, cadastralReference: '2853604VK4725D' });
      const p = h.component.search();
      h.http.expectOne(`${API}/estates/e1/catastro/lookup`).flush(makeLookup(units, lookup));
      await p;
      h.fixture.detectChanges();
      return h;
    }

    it('preselecciona las unidades importables y deja fuera (deshabilitadas) las ya importadas', async () => {
      const h = await inReview([
        ...TWO_UNITS,
        makeUnit({ cadastralReference: 'C'.repeat(20), alreadyImported: true }),
      ]);

      expect(h.component.step()).toBe('review');
      expect(h.component.selectedUnits().map((u) => u.cadastralReference)).toEqual(['A'.repeat(20), 'B'.repeat(20)]);
      const boxes = Array.from(h.el.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]'));
      expect(boxes.map((b) => b.checked)).toEqual([true, true, false]);
      expect(boxes.map((b) => b.disabled)).toEqual([false, false, true]);
      expect(h.el.textContent).toContain('Ya importada');
    });

    it('una unidad ya importada no se puede marcar (ni por código): no llegaría nunca a duplicarse', async () => {
      const already = makeUnit({ cadastralReference: 'C'.repeat(20), alreadyImported: true });
      const h = await inReview([...TWO_UNITS, already]);

      h.component.toggle(h.component.units()[2]);

      expect(h.component.isSelected(h.component.units()[2])).toBe(false);
      expect(h.component.selectedUnits()).toHaveLength(2);
    });

    it('la suma de coeficientes seleccionados se recalcula al desmarcar', async () => {
      const h = await inReview(TWO_UNITS);
      expect(h.component.selectedQuotaSum()).toBe(100);

      h.component.toggle(TWO_UNITS[1]);

      expect(h.component.selectedQuotaSum()).toBe(60);
      expect(h.component.allSelected()).toBe(false);
    });

    it('toggleAll marca y desmarca todas las importables', async () => {
      const h = await inReview([...TWO_UNITS, makeUnit({ cadastralReference: 'C'.repeat(20), alreadyImported: true })]);

      h.component.toggleAll();
      expect(h.component.selectedUnits()).toHaveLength(0);
      h.component.toggleAll();
      expect(h.component.selectedUnits()).toHaveLength(2);
    });

    it('muestra los avisos del Catastro y cita la fuente con la fecha de acceso', async () => {
      const h = await inReview(TWO_UNITS, { warnings: ['Los coeficientes suman 93% (no 100%).'] });

      expect(h.el.textContent).toContain('Los coeficientes suman 93%');
      expect(h.el.textContent).toContain('Dirección General del Catastro');
      expect(h.el.textContent).toContain('20/09/2026');
    });

    // Bug reportado: tras buscar (por dirección o por referencia catastral),
    // la revisión solo mostraba la referencia de la parcela — nunca la
    // CALLE que el Catastro encontró, así que no había forma de confirmar
    // que la búsqueda dio con la dirección correcta.
    it('muestra la dirección que encontró el Catastro (de la primera unidad), no solo la referencia de la parcela', async () => {
      const h = await inReview(TWO_UNITS);
      expect(h.el.querySelector('.summary__address')?.textContent).toContain('Calle Alcala, 100 (28009 Madrid)');
    });

    it('sin número de calle, omite el paréntesis y la coma colgante', async () => {
      const h = await inReview([makeUnit({ streetNumber: null, postalCode: null, municipality: null })]);
      expect(h.el.querySelector('.summary__address')?.textContent?.trim()).toBe('Calle Alcala');
    });

    it('setQuota ignora valores fuera de 0-100 y vacía el coeficiente con null', async () => {
      const h = await inReview(TWO_UNITS);
      const [first] = h.component.units();

      h.component.setQuota(first, 150);
      expect(h.component.units()[0].participationQuota).toBe(60);
      h.component.setQuota(first, -1);
      expect(h.component.units()[0].participationQuota).toBe(60);
      h.component.setQuota(first, 12.345);
      expect(h.component.units()[0].participationQuota).toBe(12.35);
      h.component.setQuota(first, null);
      expect(h.component.units()[0].participationQuota).toBeNull();
    });

    it('importa SOLO las seleccionadas, con el tipo y el coeficiente corregidos, y emite el resultado', async () => {
      const h = await inReview(TWO_UNITS);
      const emitted: unknown[] = [];
      h.component.imported.subscribe((r) => emitted.push(r));
      h.component.setType(h.component.units()[0], 'Local');
      h.component.setQuota(h.component.units()[0], 55);
      h.component.toggle(h.component.units()[1]); // desmarca la segunda

      const p = h.component.importSelected();
      const req = h.http.expectOne(`${API}/estates/e1/catastro/import`);
      expect(req.request.body.parcelReference).toBe('2853604VK4725D');
      expect(req.request.body.fetchedAt).toBe('2026-09-20T10:00:00.000Z');
      expect(req.request.body.units).toHaveLength(1);
      expect(req.request.body.units[0]).toMatchObject({ cadastralReference: 'A'.repeat(20), type: 'Local', participationQuota: 55 });
      req.flush({ created: 1, skipped: 0 });
      await p;
      h.fixture.detectChanges();

      expect(emitted).toEqual([{ created: 1, skipped: 0 }]);
      expect(h.component.step()).toBe('done');
      expect(h.el.textContent).toContain('1 propiedad creada');
    });

    it('con 0 seleccionadas no importa nada', async () => {
      const h = await inReview(TWO_UNITS);
      h.component.toggleAll();

      await h.component.importSelected();

      h.http.expectNone(`${API}/estates/e1/catastro/import`);
    });

    it('un fallo al importar deja la revisión intacta y muestra el error', async () => {
      const h = await inReview(TWO_UNITS);

      const p = h.component.importSelected();
      h.http.expectOne(`${API}/estates/e1/catastro/import`).flush({ message: 'Error de validación' }, { status: 400, statusText: 'Bad Request' });
      await p;

      expect(h.component.step()).toBe('review');
      expect(h.component.errorMsg()).toBe('Error de validación');
      expect(h.component.selectedUnits()).toHaveLength(2);
      expect(h.component.loading()).toBe(false);
    });

    it('el resultado informa de las omitidas', async () => {
      const h = await inReview(TWO_UNITS);

      const p = h.component.importSelected();
      h.http.expectOne(`${API}/estates/e1/catastro/import`).flush({ created: 1, skipped: 1 });
      await p;
      h.fixture.detectChanges();

      expect(h.el.textContent).toContain('1 ya existían y se omitieron');
    });

    it('unitLabel describe la ubicación y distingue la parcela sin división horizontal', async () => {
      const h = await inReview(TWO_UNITS);

      expect(h.component.unitLabel(makeUnit({ block: 'B', staircase: '1', floor: 'Bajo', door: 'IZ' }))).toBe('Bl. B · Esc. 1 · Planta Bajo · Pta. IZ');
      expect(h.component.unitLabel(makeUnit({ staircase: null, floor: null, door: null }))).toBe('Sin división horizontal');
    });
  });

  describe('ciclo de vida', () => {
    it('cerrar el modal cancela la búsqueda de autocompletado pendiente (no se consulta al Catastro con el modal cerrado)', async () => {
      const h = await openModal();
      vi.useFakeTimers();
      try {
        h.component.province.set('MADRID');
        h.component.onMunicipalityInput('alco'); // programa la búsqueda a los 300 ms

        h.fixture.componentRef.setInput('open', false);
        h.fixture.detectChanges();
        vi.advanceTimersByTime(1000);

        h.http.expectNone((r) => r.url === `${API}/catastro/municipalities`);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reabrir el modal parte de cero: vuelve al paso de búsqueda, sin resultados de la vez anterior', async () => {
      const h = await openModal({ ...ESTATE, cadastralReference: '2853604VK4725D' });
      h.component.refCat.set('2853604VK4725D');
      const p = h.component.search();
      h.http.expectOne(`${API}/estates/e1/catastro/lookup`).flush(makeLookup(TWO_UNITS));
      await p;
      expect(h.component.step()).toBe('review');

      h.fixture.componentRef.setInput('open', false);
      h.fixture.detectChanges();
      h.fixture.componentRef.setInput('open', true);
      h.fixture.detectChanges();
      h.http.expectOne(`${API}/catastro/provinces`).flush(PROVINCES);
      await settle();
      h.http.match((r) => r.url === `${API}/catastro/streets`).forEach((r) => r.flush([]));

      expect(h.component.step()).toBe('search');
      expect(h.component.units()).toEqual([]);
      expect(h.component.lookup()).toBeNull();
      expect(h.component.refCat()).toBe('2853604VK4725D'); // vuelve a precargarse desde la finca
    });

    it('cambiar de modo limpia el error del modo anterior', async () => {
      const h = await openModal();
      h.component.mode.set('ref');
      h.component.refCat.set('123');
      await h.component.search();
      expect(h.component.errorMsg()).not.toBeNull();

      h.component.setMode('address');

      expect(h.component.errorMsg()).toBeNull();
    });

    it('una segunda pulsación de "Buscar" mientras hay una consulta en curso no lanza otra', async () => {
      const h = await openModal();
      h.component.mode.set('ref');
      h.component.refCat.set('2853604VK4725D');

      const first = h.component.search();
      await h.component.search(); // ignorada
      h.http.expectOne(`${API}/estates/e1/catastro/lookup`).flush(makeLookup(TWO_UNITS));
      await first;
    });
  });

  it('cerrar emite `closed`', async () => {
    const h = await openModal();
    let closed = false;
    h.component.closed.subscribe(() => (closed = true));

    h.component.close();

    expect(closed).toBe(true);
  });
});
