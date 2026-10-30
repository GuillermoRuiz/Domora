import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { API, setupComponent, settle, type ComponentHarness } from '../../core/testing/component-harness';
import { MigracionComponent } from './migracion.component';
import type { ColumnPreset, Estate, ImportBatch, ImportCommitSummary, ImportValidationSummary } from '../../core/models';

function makeEstate(overrides: Partial<Estate> = {}): Estate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Edificio Sol', type: 'Edificio',
    address: 'Calle Mayor', location: 'Madrid', properties: 10, residents: 8,
    requests: 0, activeIssues: 0, occupancy: 80, reserveTarget: 0,
    ...overrides,
  };
}

function makeBatch(overrides: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: 'batch1', estateId: 'e1', administratorId: 'a1', sourcePlatform: 'GESFINCAS_NET',
    scope: 'current_state', status: 'uploading', rawFileKey: null, mapping: null, summary: null,
    createdByUserId: 'u1', createdAt: '2026-08-01T00:00:00.000Z', completedAt: null,
    ...overrides,
  };
}

function makeValidationSummary(overrides: Partial<ImportValidationSummary> = {}): ImportValidationSummary {
  return {
    entityType: 'property', totalRows: 10, okRows: 8, errorCount: 1, warningCount: 1,
    errors: [{ rowNumber: 3, errors: ['Falta el campo ref'] }],
    warnings: [{ rowNumber: 5, warnings: ['Coeficiente vacío'] }],
    ...overrides,
  };
}

function makeCommitSummary(overrides: Partial<ImportCommitSummary> = {}): ImportCommitSummary {
  return {
    ...makeValidationSummary(),
    committed: { createdCount: 8, skippedCount: 0, skippedReasons: [] },
    ...overrides,
  };
}

const PROPERTY_FIELDS: ColumnPreset[] = [
  { targetField: 'ref', label: 'Referencia', required: false, headerGuesses: ['REF'] },
  { targetField: 'participationQuota', label: 'Coeficiente', required: false, headerGuesses: ['COEF'] },
];

const OWNER_FIELDS: ColumnPreset[] = [
  { targetField: 'fullName', label: 'Nombre completo', required: true, headerGuesses: ['NOMBRE'] },
  { targetField: 'propertyRef', label: 'Referencia de propiedad', required: true, headerGuesses: ['REF'] },
  { targetField: 'email', label: 'Email', required: false, headerGuesses: ['EMAIL'] },
];

async function flushEstates(http: any, estates: Estate[] = [makeEstate()]): Promise<void> {
  http.expectOne((r: any) => r.url === `${API}/estates`).flush(estates);
  await settle();
}

/** Lleva el componente hasta el paso 2 con la finca 'e1' ya elegida. */
async function goToStep2(h: ComponentHarness<MigracionComponent>): Promise<void> {
  h.fixture.detectChanges();
  await flushEstates(h.http);
  h.fixture.detectChanges();
  h.component.selectedEstateId.set('e1');
  h.component.next();
  h.fixture.detectChanges();
}

/** Sube un fichero, lo parsea y carga los presets — deja el componente en el paso 3. */
async function goToStep3(
  h: ComponentHarness<MigracionComponent>,
  opts: { fields?: ColumnPreset[]; suggestedMapping?: Record<string, string> } = {},
): Promise<void> {
  await goToStep2(h);
  h.component.selectedFile.set(new File(['REF;COEF\n1A;10'], 'propiedades.csv', { type: 'text/csv' }));
  h.component.next();

  const uploadReq = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports` && r.method === 'POST');
  uploadReq.flush(makeBatch());
  await settle();

  const parseReq = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/parse` && r.method === 'POST');
  parseReq.flush({ headers: ['REF', 'COEF'], sampleRows: [{ REF: '1A', COEF: '10' }], totalRows: 42 });
  await settle();

  const presetsReq = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/presets`);
  presetsReq.flush({
    fields: opts.fields ?? PROPERTY_FIELDS,
    suggestedMapping: opts.suggestedMapping ?? { ref: 'REF' },
  });
  await settle();
  h.fixture.detectChanges();
}

/** Desde el paso 3 (ya con mapping válido), valida y llega al paso 4. */
async function goToStep4(h: ComponentHarness<MigracionComponent>, summary?: Partial<ImportValidationSummary>): Promise<void> {
  h.component.next();
  const req = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/validate` && r.method === 'POST');
  req.flush({ summary: makeValidationSummary(summary) });
  await settle();
  h.fixture.detectChanges();
}

describe('MigracionComponent', () => {
  let h: ComponentHarness<MigracionComponent>;

  beforeEach(() => {
    h = setupComponent(MigracionComponent, { routes: [] });
  });

  afterEach(() => h.http.verify());

  it('carga las fincas al montar', async () => {
    h.fixture.detectChanges();
    await flushEstates(h.http, [makeEstate({ id: 'e1', name: 'Edificio Sol' }), makeEstate({ id: 'e2', name: 'Casa Norte' })]);
    h.fixture.detectChanges();

    expect(h.component.estates().map((e) => e.name)).toEqual(['Edificio Sol', 'Casa Norte']);
  });

  describe('paso 1 — origen', () => {
    it('bloquea avanzar hasta elegir una finca', async () => {
      h.fixture.detectChanges();
      await flushEstates(h.http);
      h.fixture.detectChanges();

      expect(h.component.step()).toBe(1);
      expect(h.component.canAdvance()).toBe(false);

      h.component.selectedEstateId.set('e1');
      expect(h.component.canAdvance()).toBe(true);

      h.component.next();
      expect(h.component.step()).toBe(2);
    });

    it('cancelar en el paso 1 navega fuera del asistente', async () => {
      h.fixture.detectChanges();
      await flushEstates(h.http);
      h.fixture.detectChanges();

      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      h.component.close();
      expect(navigateSpy).toHaveBeenCalledWith(['/b/settings']);
    });

    it('agrupa los tipos de dato en Estado actual / Histórico contable, con las 7 opciones de las Fases 3 y 9', async () => {
      h.fixture.detectChanges();
      await flushEstates(h.http);
      h.fixture.detectChanges();

      expect(h.component.entityTypeOptions.map(o => o.value)).toEqual([
        'property', 'owner', 'movement', 'receipt', 'remesa', 'opening-balance', 'supplier-invoice',
      ]);
      expect(h.el.textContent).toContain('Movimientos (libro mayor)');
      expect(h.el.textContent).toContain('Remesas ya presentadas');
      expect(h.el.textContent).toContain('Saldos iniciales');
      expect(h.el.textContent).toContain('Facturas de proveedor pendientes');
    });

    it('elegir "remesa" deriva scope=historical_accounting para la etiqueta del resumen', () => {
      h.component.entityType.set('remesa');
      expect(h.component.selectedEntityTypeLabel()).toBe('Remesas ya presentadas');
    });
  });

  describe('subir fichero → parse → presets', () => {
    it('sube el fichero, lo parsea y precarga el mapeo desde el preset sugerido', async () => {
      await goToStep3(h);

      expect(h.component.step()).toBe(3);
      expect(h.component.headers()).toEqual(['REF', 'COEF']);
      expect(h.component.totalRows()).toBe(42);
      expect(h.component.mapping()).toEqual({ ref: 'REF' });
    });

    it('el multipart de subida manda sourcePlatform y el scope derivado del tipo de entidad (property → current_state)', async () => {
      await goToStep2(h);
      h.component.selectedFile.set(new File(['a'], 'x.csv'));
      h.component.next();

      const uploadReq = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports` && r.method === 'POST');
      const body = uploadReq.request.body as FormData;
      expect(body instanceof FormData).toBe(true);
      expect(body.get('sourcePlatform')).toBe('GESFINCAS_NET');
      expect(body.get('scope')).toBe('current_state');
      expect(body.get('file')).toBeInstanceOf(File);

      uploadReq.flush(makeBatch());
      await settle();
      h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/parse`).flush({ headers: [], sampleRows: [], totalRows: 0 });
      await settle();
      h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/presets`).flush({ fields: [], suggestedMapping: {} });
      await settle();
    });

    it('un tipo de entidad de histórico contable (p. ej. "movement") manda scope=historical_accounting', async () => {
      h.component.entityType.set('movement');
      await goToStep2(h);
      h.component.selectedFile.set(new File(['a'], 'x.csv'));
      h.component.next();

      const uploadReq = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports` && r.method === 'POST');
      expect((uploadReq.request.body as FormData).get('scope')).toBe('historical_accounting');

      uploadReq.flush(makeBatch());
      await settle();
      h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/parse`).flush({ headers: [], sampleRows: [], totalRows: 0 });
      await settle();
      h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/presets`).flush({ fields: [], suggestedMapping: {} });
      await settle();
    });

    it('pide los presets con la plataforma, el tipo de entidad y las cabeceras reales del fichero', async () => {
      h.component.entityType.set('owner');
      await goToStep2(h);
      h.component.selectedFile.set(new File(['a'], 'x.csv'));
      h.component.next();

      h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports`).flush(makeBatch());
      await settle();
      h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/parse`)
        .flush({ headers: ['NOMBRE', 'REF'], sampleRows: [], totalRows: 5 });
      await settle();

      const presetsReq = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/presets`);
      expect(presetsReq.request.params.get('platform')).toBe('GESFINCAS_NET');
      expect(presetsReq.request.params.get('entityType')).toBe('owner');
      expect(presetsReq.request.params.get('headers')).toBe('NOMBRE,REF');
      presetsReq.flush({ fields: OWNER_FIELDS, suggestedMapping: {} });
      await settle();
    });

    it('un error de subida (p. ej. fichero demasiado grande) se muestra y no avanza de paso', async () => {
      await goToStep2(h);
      h.component.selectedFile.set(new File(['a'], 'x.csv'));
      h.component.next();

      const uploadReq = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports` && r.method === 'POST');
      uploadReq.flush({ message: 'Payload too large' }, { status: 413, statusText: 'Payload Too Large' });
      await settle();
      h.fixture.detectChanges();

      expect(h.component.step()).toBe(2);
      expect(h.component.uploadError()).toContain('No se pudo subir el fichero');
      expect(h.el.textContent).toContain('No se pudo subir el fichero');
    });
  });

  describe('paso 3 — mapeo de columnas', () => {
    it('renderiza una fila por campo del preset, con el asterisco de obligatorio', async () => {
      await goToStep3(h, { fields: OWNER_FIELDS, suggestedMapping: { fullName: 'NOMBRE' } });

      const rows = h.el.querySelectorAll('.mapping-table tbody tr');
      expect(rows.length).toBe(OWNER_FIELDS.length);
      expect(h.el.textContent).toContain('Nombre completo');
      expect(h.el.querySelectorAll('.required').length).toBeGreaterThanOrEqual(2); // fullName + propertyRef
    });

    it('bloquea avanzar si falta mapear un campo obligatorio, y desbloquea al completarlo', async () => {
      await goToStep3(h, { fields: OWNER_FIELDS, suggestedMapping: { fullName: 'NOMBRE' } });

      expect(h.component.requiredMissing()).toBe(true); // falta propertyRef
      expect(h.component.canAdvance()).toBe(false);

      h.component.setMapping('propertyRef', 'REF');
      expect(h.component.requiredMissing()).toBe(false);
      expect(h.component.canAdvance()).toBe(true);
    });

    it('setMapping con cadena vacía desmapea el campo en vez de guardar un valor vacío', async () => {
      await goToStep3(h, { suggestedMapping: { ref: 'REF' } });
      expect(h.component.mapping()).toEqual({ ref: 'REF' });

      h.component.setMapping('ref', '');
      expect(h.component.mapping()).toEqual({});
    });
  });

  describe('paso 4 — revisión', () => {
    it('valida el mapeo y muestra los contadores + tablas de errores/avisos', async () => {
      await goToStep3(h);
      await goToStep4(h);

      expect(h.component.step()).toBe(4);
      expect(h.el.textContent).toContain('Fila 3');
      expect(h.el.textContent).toContain('Falta el campo ref');
      expect(h.el.textContent).toContain('Fila 5');
      expect(h.el.textContent).toContain('Coeficiente vacío');
    });

    it('el POST de validación manda el entityType y solo los campos mapeados', async () => {
      await goToStep3(h);
      h.component.next();
      const req = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/validate` && r.method === 'POST');
      expect(req.request.body).toEqual({ entityType: 'property', mapping: { ref: 'REF' } });
      req.flush({ summary: makeValidationSummary() });
      await settle();
    });

    describe('exportar filas con error a CSV', () => {
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;
      beforeEach(() => {
        URL.createObjectURL = vi.fn(() => 'blob:fake-url');
        URL.revokeObjectURL = vi.fn();
      });
      afterEach(() => {
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      });

      it('genera un Blob descargable con las filas de error/aviso', async () => {
        await goToStep3(h);
        await goToStep4(h);

        h.component.exportErrorsCsv();

        expect(URL.createObjectURL).toHaveBeenCalled();
        const blobArg = (URL.createObjectURL as any).mock.calls[0][0] as Blob;
        expect(blobArg.type).toContain('text/csv');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
      });

      it('no hace nada si todavía no hay resumen de validación', () => {
        h.component.exportErrorsCsv();
        expect(URL.createObjectURL).not.toHaveBeenCalled();
      });
    });
  });

  describe('paso 5 — confirmar y commit', () => {
    it('confirma la importación y pasa al resumen (paso 6)', async () => {
      await goToStep3(h);
      await goToStep4(h);
      h.component.next(); // -> paso 5
      expect(h.component.step()).toBe(5);

      const promise = h.component.commit();
      const req = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/commit` && r.method === 'POST');
      req.flush(makeCommitSummary({ committed: { createdCount: 8, skippedCount: 2, skippedReasons: [{ rowNumber: 9, reason: 'ref duplicada' }] } }));
      await promise;
      h.fixture.detectChanges();

      expect(h.component.step()).toBe(6);
      expect(h.el.textContent).toContain('Importación completada');
      expect(h.el.textContent).toContain('8');
      expect(h.el.textContent).toContain('ref duplicada');
    });

    it('si el commit falla, muestra el error y se queda en el paso 5', async () => {
      await goToStep3(h);
      await goToStep4(h);
      h.component.next();

      const promise = h.component.commit();
      const req = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/commit` && r.method === 'POST');
      req.flush({ message: 'error' }, { status: 500, statusText: 'Server Error' });
      await promise;
      h.fixture.detectChanges();

      expect(h.component.step()).toBe(5);
      expect(h.component.commitError()).toContain('No se pudo confirmar');
    });
  });

  describe('paso 6 — resumen', () => {
    async function goToStep6(hh: ComponentHarness<MigracionComponent>): Promise<void> {
      await goToStep3(hh);
      await goToStep4(hh);
      hh.component.next();
      const promise = hh.component.commit();
      hh.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/commit`).flush(makeCommitSummary());
      await promise;
      hh.fixture.detectChanges();
    }

    it('muestra la sección estática "no importado en esta versión" con sus 4 categorías', async () => {
      await goToStep6(h);

      const text = h.el.textContent ?? '';
      expect(text).toContain('No importado en esta versión');
      expect(text).toContain('Juntas / Actas');
      expect(text).toContain('Seguros y siniestros');
      expect(text).toContain('Nómina');
      expect(text).toContain('Firma electrónica en documentos');
      expect((text.match(/Domora no gestiona esto todavía/g) ?? []).length).toBe(4);
    });

    describe('deshacer la importación', () => {
      it('si el usuario cancela el confirm(), no llama al backend', async () => {
        await goToStep6(h);
        vi.spyOn(window, 'confirm').mockReturnValue(false);

        await h.component.rollback();

        h.http.expectNone((r: any) => r.url === `${API}/estates/e1/imports/batch1/rollback`);
      });

      it('si confirma, deshace la importación y muestra el resultado', async () => {
        await goToStep6(h);
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        const promise = h.component.rollback();
        const req = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/rollback` && r.method === 'POST');
        req.flush({ removedProperties: 3, removedOwners: 5 });
        await promise;
        h.fixture.detectChanges();

        expect(h.component.rolledBack()).toBe(true);
        expect(h.el.textContent).toContain('Importación deshecha');
        expect(h.el.textContent).toContain('3');
        expect(h.el.textContent).toContain('5');
      });

      it('si el backend rechaza el rollback (400), muestra el mensaje del servidor', async () => {
        await goToStep6(h);
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        const promise = h.component.rollback();
        const req = h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/rollback` && r.method === 'POST');
        req.flush({ message: 'Hay un propietario manual vinculado a una propiedad importada' }, { status: 400, statusText: 'Bad Request' });
        await promise;
        h.fixture.detectChanges();

        expect(h.component.rolledBack()).toBe(false);
        expect(h.el.textContent).toContain('Hay un propietario manual vinculado a una propiedad importada');
      });

      it('para "opening-balance"/"supplier-invoice" no ofrece deshacer: esas filas no dejan nada propio que revertir', async () => {
        h.component.entityType.set('opening-balance');
        await goToStep6(h);

        h.http.expectNone((r: any) => r.url === `${API}/estates/e1/imports/batch1/rollback`);
        expect(h.el.querySelector('.btn-outline')).toBeNull();
        expect(h.el.textContent).toContain('solo rellenaron el borrador');

        const router = TestBed.inject(Router);
        const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        (Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Ir al borrador de saldos iniciales')) as HTMLButtonElement).click();
        expect(navigateSpy).toHaveBeenCalledWith(['/b/accounting', 'e1'], { queryParams: { tab: 'opening' } });
      });
    });

    it('cerrar navega fuera del asistente', async () => {
      await goToStep6(h);
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      h.component.close();
      expect(navigateSpy).toHaveBeenCalledWith(['/b/settings']);
    });
  });

  it('onFileSelected fija el fichero elegido desde el <input type="file">', async () => {
    await goToStep2(h);
    const file = new File(['a'], 'propietarios.xlsx');
    h.component.onFileSelected({ target: { files: [file] } } as unknown as Event);
    expect(h.component.selectedFile()).toBe(file);
  });
});

/** Otro `ActivatedRoute` por test: TestBed no admite reconfigurarse dentro del describe principal. */
describe('MigracionComponent — llegada desde la puesta en marcha de una finca', () => {
  let h: ComponentHarness<MigracionComponent>;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function mountWith(query: Record<string, string>, estates: Estate[] = [makeEstate({ id: 'e1' })]): Promise<void> {
    h = setupComponent(MigracionComponent, {
      providers: [{
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(query), paramMap: convertToParamMap({}) } },
      }],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    h.fixture.detectChanges();
    await flushEstates(h.http, estates);
    h.fixture.detectChanges();
  }

  afterEach(() => h.http.verify());

  it('preselecciona la finca y el tipo de dato, sin saltarse el paso 1 (ahí se elige el programa de origen)', async () => {
    await mountWith({ estateId: 'e1', entity: 'owner', returnTo: 'setup' });

    expect(h.component.step()).toBe(1);
    expect(h.component.selectedEstateId()).toBe('e1');
    expect(h.component.entityType()).toBe('owner');
    expect(h.component.canAdvance()).toBe(true);
  });

  it('con returnTo=setup, cancelar vuelve a la finca en vez de a Ajustes', async () => {
    await mountWith({ estateId: 'e1', entity: 'property', returnTo: 'setup' });

    h.component.close();

    expect(navigate).toHaveBeenCalledWith(['/b/estates', 'e1']);
  });

  it('un estateId que no está entre las fincas del usuario se ignora (y el returnTo con él)', async () => {
    await mountWith({ estateId: 'finca-ajena', entity: 'owner', returnTo: 'setup' });

    expect(h.component.selectedEstateId()).toBe('');
    expect(h.component.canAdvance()).toBe(false);
    h.component.close();
    expect(navigate).toHaveBeenCalledWith(['/b/settings']);
  });

  it('un tipo de dato desconocido se ignora y se queda en Propiedades', async () => {
    await mountWith({ estateId: 'e1', entity: 'nominas' });
    expect(h.component.entityType()).toBe('property');
  });

  it('tras importar propiedades ofrece importar los propietarios: vuelve al paso 1 con la misma finca y todo limpio', async () => {
    await mountWith({ estateId: 'e1', entity: 'property', returnTo: 'setup' });
    h.component.selectedFile.set(new File(['REF;COEF\n1A;10'], 'propiedades.csv', { type: 'text/csv' }));
    h.component.next(); // paso 1 -> 2
    h.component.next(); // sube el fichero
    h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports` && r.method === 'POST').flush(makeBatch());
    await settle();
    h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/parse`).flush({ headers: ['REF'], sampleRows: [], totalRows: 1 });
    await settle();
    h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/presets`).flush({ fields: PROPERTY_FIELDS, suggestedMapping: { ref: 'REF' } });
    await settle();
    h.component.next(); // valida
    h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/validate`).flush({ summary: makeValidationSummary() });
    await settle();
    h.component.next(); // paso 5
    const commit = h.component.commit();
    h.http.expectOne((r: any) => r.url === `${API}/estates/e1/imports/batch1/commit`).flush(makeCommitSummary());
    await commit;
    h.fixture.detectChanges();

    const ownersBtn = Array.from(h.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Importar ahora los propietarios')) as HTMLButtonElement;
    expect(ownersBtn).toBeDefined();
    expect(h.el.textContent).toContain('Volver a la finca');
    ownersBtn.click();
    h.fixture.detectChanges();

    expect(h.component.step()).toBe(1);
    expect(h.component.entityType()).toBe('owner');
    expect(h.component.selectedEstateId()).toBe('e1');
    expect(h.component.batch()).toBeNull();
    expect(h.component.commitSummary()).toBeNull();
    expect(h.component.selectedFile()).toBeNull();
  });
});
