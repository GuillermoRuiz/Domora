import { API, setupComponent, settle, type ComponentHarness } from '../../../core/testing/component-harness';
import type { Estate } from '../../../core/models';
import type { EstateGeneralOverview } from '../../../core/estate-general.service';
import { GeneralTabComponent } from './general-tab.component';

function estate(overrides: Partial<Estate> = {}): Estate {
  return {
    id: 'e1', administratorId: 'a1', name: 'Residencial Plaza', type: 'Edificio',
    address: 'Calle Gran Vía', streetNumber: '12', location: 'Madrid', province: 'Madrid', postalCode: '28013',
    cif: 'H12345678', cadastralReference: '1234567VK4713G', reserveTarget: 12500.5, iban: 'ES9121000418450200051332',
    description: 'Comunidad residencial en el centro.', catastroFacadeUrl: null,
    properties: 24, residents: 50, requests: 0, activeIssues: 0, occupancy: 90,
    yearBuilt: 2001, mainUse: 'Residencial', internalRef: 'FIN-0001', taxRegime: 'Entidad en régimen de atribución de rentas',
    applicableLaw: 'Ley de Propiedad Horizontal', notes: 'Revisar la cubierta en 2026.', parcelAreaM2: 1248, latitude: null, longitude: null,
    ...overrides,
  } as Estate;
}

function overview(overrides: Partial<EstateGeneralOverview> = {}): EstateGeneralOverview {
  return {
    properties: 24,
    coefficients: { total: 100, informed: 24, missing: 0, max: { ref: '1A', value: 8.7 }, min: { ref: 'T3', value: 0.25 } },
    surface: { parcelAreaM2: 1248, builtAreaM2: 3842, builtAreaInformed: 24 },
    fiscalYear: { year: 2026, startsOn: '2026-01-01', endsOn: '2026-12-31', status: 'Abierto' },
    bank: { bankName: 'Banco Santander', iban: 'ES12 ···· 3456', masked: true, accountCode: '5720001', alias: 'Cuenta principal' },
    administrator: { name: 'Domora Gestión S.L.', contactName: 'Carlos Ruiz', phone: '914567890', email: 'carlos.ruiz@domora.es' },
    offices: {
      president: { label: 'Presidente', name: 'José Luis Martínez', propertyRef: '3B', since: '2023-03-15' },
      vicePresidents: [{ label: 'Vicepresidente 1º', name: 'María Gómez', propertyRef: '2A', since: '2023-03-15' }],
    },
    keyContacts: [
      { name: 'José Luis Martínez', office: 'Presidente', propertyRefs: ['3B'], phone: '610123456', email: 'jl.martinez@ejemplo.com' },
      { name: 'Ana Pérez', office: null, propertyRefs: ['1A', '4C'], phone: null, email: null },
    ],
    essentialDocuments: [
      { type: 'Escritura de constitución', document: { id: 'd1', title: 'Escritura de constitución', date: '2018-03-15', size: '1,2 MB' } },
      { type: 'Estatutos', document: { id: 'd2', title: 'Estatutos', date: '2018-03-22', size: '980 KB' } },
      { type: 'CIF de la comunidad', document: null },
      { type: 'IBI', document: { id: 'd4', title: 'IBI 2025', date: '2025-01-12', size: '560 KB' } },
      { type: 'Póliza de seguro', document: null },
    ],
    insurance: [{ contractId: 'c1', type: 'Multirriesgo comunidad', insurer: 'Mapfre', contractNumber: '0987654321', endDate: '2026-12-31', renewalType: 'tacita', coverage: 'Daños por agua' }],
    ...overrides,
  };
}

describe('GeneralTabComponent', () => {
  let h: ComponentHarness<GeneralTabComponent>;
  const OVERVIEW_URL = `${API}/estates/e1/general-overview`;

  async function mount(e: Estate = estate(), o: EstateGeneralOverview | 'error' = overview()): Promise<void> {
    h = setupComponent(GeneralTabComponent);
    h.component.estateId = 'e1';
    h.fixture.componentRef.setInput('estate', e);
    h.fixture.detectChanges();
    h.http.match(`${API}/estates/e1/sepa-billing`).forEach((req) => req.flush({}));
    const req = h.http.expectOne(OVERVIEW_URL);
    if (o === 'error') req.flush({}, { status: 500, statusText: 'Error' });
    else req.flush(o);
    await settle();
    h.fixture.detectChanges();
  }

  const card = (id: string) => h.el.querySelector(`[data-card="${id}"]`) as HTMLElement;
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  /** label → value pairs of a card's field list. */
  const fields = (id: string) => Object.fromEntries(Array.from(card(id).querySelectorAll('.field')).map((f) => [text(f.querySelector('dt')), text(f.querySelector('dd'))]));
  const visibleCards = () => Array.from(h.el.querySelectorAll<HTMLElement>('[data-card]')).filter((c) => !c.hidden).map((c) => c.dataset['card']);

  afterEach(() => {
    h.http.match(() => true).forEach((req) => req.flush({}));
    h.http.verify();
  });

  it('pinta las doce tarjetas del mockup y mantiene el acreedor SEPA', async () => {
    await mount();
    expect(visibleCards()).toEqual(['community', 'address', 'contacts', 'fiscal', 'bank', 'documents', 'offices', 'administrator', 'cadastral', 'coefficients', 'insurance', 'notes']);
    expect(Array.from(h.el.querySelectorAll('[data-card] .card__title')).map(text)).toEqual([
      'Datos de la comunidad', 'Dirección y ubicación', 'Contactos clave', 'Datos fiscales / administrativos', 'Cuenta bancaria',
      'Documentos esenciales', 'Presidente y cargos', 'Administrador asignado', 'Referencia catastral', 'Coeficientes', 'Seguros básicos', 'Observaciones',
    ]);
    expect(h.el.querySelector('app-sepa-tab')).not.toBeNull();
  });

  it('es de solo lectura: no ofrece editar, añadir, subir ni cambiar', async () => {
    await mount();
    const outsideSepa = Array.from(h.el.querySelectorAll('button')).filter((b) => !b.closest('app-sepa-tab')).map(text);
    for (const label of outsideSepa) expect(label).not.toMatch(/^(Editar|Añadir|Subir|Cambiar)/);
  });

  it('datos de la comunidad: campos de la finca, nº de propiedades y «Sin informar» en lo vacío', async () => {
    await mount(estate({ internalRef: null }));
    expect(fields('community')).toEqual({
      Nombre: 'Residencial Plaza', Tipo: 'Edificio de viviendas', 'Año de construcción': '2001', 'Nº de propiedades': '24 unidades',
      'Uso principal': 'Residencial', 'Referencia interna': 'Sin informar', Descripción: 'Comunidad residencial en el centro.',
    });
  });

  it('dirección: sin coordenadas no hay mapa y el enlace busca la dirección en OpenStreetMap', async () => {
    await mount();
    expect(fields('address')).toEqual({ Dirección: 'Calle Gran Vía 12', 'Código postal': '28013', Población: 'Madrid', Provincia: 'Madrid' });
    expect(card('address').querySelector('app-estate-map')).toBeNull();
    const link = card('address').querySelector('a.map-link') as HTMLAnchorElement;
    expect(link.href).toBe('https://www.openstreetmap.org/search?query=Calle%20Gran%20V%C3%ADa%2012%2C%2028013%2C%20Madrid%2C%20Madrid%2C%20Espa%C3%B1a');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
  });

  it('dirección: con coordenadas muestra el mapa y el enlace apunta a ese punto', async () => {
    await mount(estate({ latitude: 40.42, longitude: -3.705 }));
    expect(card('address').querySelector('app-estate-map')).not.toBeNull();
    expect((card('address').querySelector('a.map-link') as HTMLAnchorElement).href).toBe('https://www.openstreetmap.org/?mlat=40.42&mlon=-3.705#map=18/40.42/-3.705');
  });

  it('contactos clave: nombre, cargo o «Propietario», propiedades y enlaces de teléfono y correo', async () => {
    await mount();
    const people = Array.from(card('contacts').querySelectorAll('.person'));
    expect(people.map((p) => text(p.querySelector('.person__role')))).toEqual(['Presidente · 3B', 'Propietario · 1A, 4C']);
    expect(people[0].querySelector('a[href="tel:610123456"]')).not.toBeNull();
    expect(people[0].querySelector('a[href="mailto:jl.martinez@ejemplo.com"]')).not.toBeNull();
    expect(text(people[1].querySelector('.person__contact'))).toBe('Sin teléfono ni correo');
  });

  it('contactos clave vacíos: explica dónde se marcan', async () => {
    await mount(estate(), overview({ keyContacts: [] }));
    expect(text(card('contacts'))).toContain('Sin contactos clave. Se marcan desde el menú de cada propiedad, en la pestaña Propiedades.');
  });

  it('datos fiscales: CIF, régimen, ejercicio, cuenta contable, normativa y fondo de reserva', async () => {
    await mount();
    expect(fields('fiscal')).toEqual({
      CIF: 'H12345678', 'Régimen fiscal': 'Entidad en régimen de atribución de rentas', 'Año fiscal': '1 ene – 31 dic 2026 (abierto)',
      'Nº de cuenta contable': '5720001', 'Normativa aplicable': 'Ley de Propiedad Horizontal', 'Fondo de reserva objetivo': '12.500,50 €',
    });
  });

  it('cuenta bancaria enmascarada: sin botón de copiar', async () => {
    await mount();
    expect(fields('bank')).toEqual({ Entidad: 'Banco Santander', IBAN: 'ES12 ···· 3456', Titular: 'Residencial Plaza', Uso: 'Cobros de cuotas y pagos de la comunidad' });
    expect(card('bank').querySelector('button')).toBeNull();
  });

  it('cuenta bancaria de referencia (IBAN completo): se puede copiar sin espacios', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await mount(estate(), overview({ bank: { bankName: 'CaixaBank', iban: 'ES91 2100 0418 4502 0005 1332', masked: false, accountCode: null, alias: null } }));
    (card('bank').querySelector('button[aria-label="Copiar IBAN"]') as HTMLButtonElement).click();
    await settle();
    expect(writeText).toHaveBeenCalledWith('ES9121000418450200051332');
  });

  it('sin cuenta bancaria: lo dice', async () => {
    await mount(estate(), overview({ bank: null }));
    expect(text(card('bank'))).toContain('Sin cuenta bancaria. Se configura en Contabilidad.');
  });

  it('documentos esenciales: los cinco tipos, «Sin subir» cuando falta y descarga del fichero', async () => {
    await mount();
    const rows = Array.from(card('documents').querySelectorAll('.doc'));
    expect(rows.map((r) => text(r.querySelector('.doc__title')))).toEqual(['Escritura de constitución', 'Estatutos', 'CIF de la comunidad', 'IBI 2025', 'Póliza de seguro']);
    expect(text(rows[2].querySelector('.doc__meta'))).toBe('Sin subir');
    expect(rows[2].querySelector('button')).toBeNull();
    expect(text(rows[3].querySelector('.doc__meta'))).toBe('IBI · 12 ene 2025 · 560 KB');
    // Title equal to the type: the type is not repeated.
    expect(text(rows[1].querySelector('.doc__meta'))).toBe('22 mar 2018 · 980 KB');
    (rows[3].querySelector('button[aria-label="Descargar IBI 2025"]') as HTMLButtonElement).click();
    const req = h.http.expectOne(`${API}/documents/d4/file`);
    expect(req.request.responseType).toBe('blob');
  });

  it('presidente y cargos: presidente y vicepresidentes vigentes con fecha; el enlace abre el historial', async () => {
    await mount();
    expect(fields('offices')).toEqual({ Presidente: 'José Luis Martínez (3B) desde 15 mar 2023', 'Vicepresidente 1º': 'María Gómez (2A) desde 15 mar 2023' });
    let opened = 0;
    h.component.officeHistory.subscribe(() => opened++);
    (Array.from(card('offices').querySelectorAll('button')).find((b) => text(b) === 'Ver historial de cargos') as HTMLButtonElement).click();
    expect(opened).toBe(1);
  });

  it('documentos esenciales: «Ver todos los documentos» abre la pestaña Documentos', async () => {
    await mount();
    let opened = 0;
    h.component.openDocuments.subscribe(() => opened++);
    (Array.from(card('documents').querySelectorAll('button')).find((b) => text(b) === 'Ver todos los documentos') as HTMLButtonElement).click();
    expect(opened).toBe(1);
  });

  it('sin presidente: lo dice', async () => {
    await mount(estate(), overview({ offices: { president: null, vicePresidents: [] } }));
    expect(fields('offices')).toEqual({ Presidente: 'Sin presidente registrado' });
  });

  it('administrador asignado: persona de contacto, gestora, teléfono y correo, sin «Cambiar»', async () => {
    await mount();
    expect(text(card('administrator').querySelector('.person__name'))).toBe('Carlos Ruiz');
    expect(text(card('administrator').querySelector('.person__role'))).toBe('Domora Gestión S.L.');
    expect(card('administrator').querySelector('a[href="tel:914567890"]')).not.toBeNull();
    expect(card('administrator').querySelector('button')).toBeNull();
  });

  it('referencia catastral: parcela y superficie construida, avisando si faltan propiedades', async () => {
    await mount(estate(), overview({ surface: { parcelAreaM2: 1248, builtAreaM2: 1920.5, builtAreaInformed: 12 } }));
    expect(fields('cadastral')).toEqual({ 'Referencia catastral': '1234567VK4713G', 'Superficie de parcela': '1.248 m²', 'Superficie construida': '1.920,5 m² (12 de 24 propiedades)' });
  });

  it('coeficientes: suma, mayor y menor; avisa de propiedades sin coeficiente', async () => {
    await mount();
    expect(fields('coefficients')).toEqual({ 'Total de coeficientes': '100,0000 %', 'Mayor coeficiente': '1A (8,7000 %)', 'Menor coeficiente': 'T3 (0,2500 %)' });
    expect(card('coefficients').querySelector('.warning')).toBeNull();
    h.component.overview.set(overview({ coefficients: { total: 96.5, informed: 23, missing: 1, max: null, min: null } }));
    h.fixture.detectChanges();
    expect(text(card('coefficients').querySelector('.warning'))).toBe('1 propiedad sin coeficiente');
  });

  it('seguros básicos: tipo, aseguradora, nº de póliza y vencimiento; sin pólizas lo explica', async () => {
    await mount();
    expect(fields('insurance')).toEqual({
      'Tipo de seguro': 'Multirriesgo comunidad', Aseguradora: 'Mapfre', 'Nº de póliza': '0987654321',
      Vencimiento: '31 dic 2026 · renovación tácita', Cobertura: 'Daños por agua',
    });
    h.component.overview.set(overview({ insurance: [] }));
    h.fixture.detectChanges();
    expect(text(card('insurance'))).toContain('Sin pólizas vigentes. Se registran como contrato con la aseguradora en la pestaña Contratos.');
  });

  it('observaciones: el texto de la finca o «Sin observaciones.»', async () => {
    await mount();
    expect(text(card('notes').querySelector('.notes'))).toBe('Revisar la cubierta en 2026.');
    h.fixture.componentRef.setInput('estate', estate({ notes: null }));
    h.fixture.detectChanges();
    expect(text(card('notes'))).toContain('Sin observaciones.');
  });

  it('el buscador filtra las tarjetas por su texto, sin distinguir mayúsculas ni tildes', async () => {
    await mount();
    h.component.search.set('POLIZA');
    h.fixture.detectChanges();
    expect(visibleCards()).toEqual(['documents', 'insurance']);
    h.component.search.set('mapfre');
    h.fixture.detectChanges();
    expect(visibleCards()).toEqual(['insurance']);
    h.component.search.set('5720001');
    h.fixture.detectChanges();
    expect(visibleCards()).toEqual(['fiscal']);
    h.component.search.set('no existe');
    h.fixture.detectChanges();
    expect(visibleCards()).toEqual([]);
    expect(text(h.el.querySelector('.no-matches'))).toBe('Ningún dato coincide con «no existe».');
    h.component.search.set('');
    h.fixture.detectChanges();
    expect(visibleCards()).toHaveLength(12);
  });

  it('si falla la carga lo dice, deja ver los datos de la finca y permite reintentar', async () => {
    await mount(estate(), 'error');
    expect(text(h.el.querySelector('[role="alert"]'))).toContain('No se pudieron cargar los cargos, contactos, documentos y seguros de la finca.');
    expect(fields('community')['Nombre']).toBe('Residencial Plaza');
    (h.el.querySelector('.load-error button') as HTMLButtonElement).click();
    h.http.expectOne(OVERVIEW_URL).flush(overview());
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('.load-error')).toBeNull();
    expect(fields('offices')['Presidente']).toContain('José Luis Martínez');
  });
});
