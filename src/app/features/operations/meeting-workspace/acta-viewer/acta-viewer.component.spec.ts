import { setupComponent, settle } from '../../../../core/testing/component-harness';
import { ConfirmDialogService } from '../../../../shared/components/confirm-dialog/confirm-dialog.service';
import type { ActaVersionView } from '../../../../core/acta.models';
import { actaDocument, actaVersion } from './acta-fixtures';
import { ActaViewerComponent } from './acta-viewer.component';

function setup(version: ActaVersionView = actaVersion(), inputs: { busy?: boolean; error?: string; warnings?: { code: string; message: string }[] } = {}) {
  const h = setupComponent(ActaViewerComponent);
  h.fixture.componentRef.setInput('version', version);
  h.fixture.componentRef.setInput('busy', inputs.busy ?? false);
  h.fixture.componentRef.setInput('error', inputs.error ?? '');
  h.fixture.componentRef.setInput('warnings', inputs.warnings ?? []);
  h.fixture.detectChanges();
  const out = {
    back: vi.fn(),
    save: vi.fn(),
    regenerate: vi.fn(),
    downloadPdf: vi.fn(),
    prepare: vi.fn(),
    continueToSign: vi.fn(),
    editData: vi.fn(),
  };
  h.component.back.subscribe(out.back);
  h.component.save.subscribe(out.save);
  h.component.regenerate.subscribe(out.regenerate);
  h.component.downloadPdf.subscribe(out.downloadPdf);
  h.component.prepare.subscribe(out.prepare);
  h.component.continueToSign.subscribe(out.continueToSign);
  h.component.editData.subscribe(out.editData);
  return Object.assign(h, { out });
}
type Ctx = ReturnType<typeof setup>;
const host = (h: Ctx) => h.fixture.nativeElement as HTMLElement;
const paper = (h: Ctx) => (host(h).querySelector('.page__body') as HTMLElement).textContent!.replace(/\s+/g, ' ');
const toolbarButton = (h: Ctx, label: string) =>
  Array.from(host(h).querySelectorAll('.toolbar button')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;
const editButton = (h: Ctx, index = 0) => host(h).querySelectorAll<HTMLButtonElement>('.blk__edit')[index];

describe('ActaViewerComponent — visor documental del acta', () => {
  afterEach(() => vi.restoreAllMocks());

  describe('documento', () => {
    it('muestra una página A4 blanca con el acta formal completa, tal y como dice el modelo', () => {
      const h = setup();
      const pages = host(h).querySelectorAll('.page');
      expect(pages).toHaveLength(1);
      expect((pages[0] as HTMLElement).style.width).toBe('794px');
      expect((pages[0] as HTMLElement).style.minHeight).toBe('1123px');
      const text = paper(h);
      for (const expected of [
        'ACTA DE LA JUNTA GENERAL ORDINARIA',
        'DE LA COMUNIDAD DE PROPIETARIOS',
        'COMUNIDAD SOL 12',
        'siendo las 19:10 horas del día 14 de octubre de 2026',
        'ORDEN DEL DÍA',
        '1º Aprobación del presupuesto 2027',
        'ASISTENCIA',
        'Asisten, presentes o representadas, 3 de 4 propiedades',
        'DESARROLLO',
        '1º APROBACIÓN DEL PRESUPUESTO 2027',
        'Se presenta el presupuesto anual.',
        'OBSERVACIONES',
        'ACTUACIONES DERIVADAS DE LOS ACUERDOS',
        'se levanta la sesión a las 21:05 horas',
        'EL/LA PRESIDENTE/A',
        'EL/LA SECRETARIO/A-ADMINISTRADOR/A',
      ]) {
        expect(squash(text).includes(squash(expected))).toBe(true);
      }
    });

    it('la asistencia sale en tabla con propiedad, nombre completo de quien asistió, coeficiente y estado, y nunca muestra el DNI', () => {
      const h = setup();
      const rows = Array.from(host(h).querySelectorAll('.page .row')).map((row) => Array.from(row.children).map((cell) => cell.textContent!.trim()));
      expect(rows).toEqual([
        ['PROPIEDAD', 'ASISTENTE', 'COEFICIENTE', 'ASISTENCIA'],
        ['1A', 'Mónica Prieto Ruiz', '2,50 %', 'Presente'],
        ['1B', 'Luis Gómez Pardo, en representación de Ana Ruiz Soto', '2,90 %', 'Representada'],
        ['2A', 'Pedro Sanz Vega', '3,10 %', 'Presente'],
      ]);
      expect(host(h).textContent).not.toMatch(/@/);
      expect(host(h).textContent).not.toMatch(/DNI|12345678Z|87654321X|11223344B/);
    });

    it('las votaciones muestran las opciones reales con su recuento, la mayoría, el resultado y el acuerdo', () => {
      const text = paper(setup());
      expect(text).toContain('Propuesta sometida a votación: «¿Aprueba el presupuesto?»');
      expect(text).toContain('Opción A: 2');
      expect(text).toContain('Opción B: 1');
      expect(text).toContain('Opción C: 0');
      expect(text).not.toMatch(/En contra|Abstención/);
      expect(text).toContain('Mayoría aplicada: Mayoría simple.');
      expect(text).toContain('La propuesta resulta aprobada.');
      expect(text).toContain('ACUERDO: Se aprueba la propuesta sometida a votación.');
    });

    it('un punto sin comentarios ni votación no inventa contenido: dice su estado real', () => {
      const text = paper(setup());
      expect(text).toContain('El punto quedó tratado sin contenido adicional registrado.');
      expect(text).toContain('Este punto no consta como tratado en la reunión.');
    });

    it('con passed null no dice aprobado ni rechazado', () => {
      const document = actaDocument();
      document.items[0].votes[0] = { ...document.items[0].votes[0], outcome: null, outcomeText: null, lines: { ...document.items[0].votes[0].lines, outcome: null } };
      document.items[0].agreements = [];
      const text = paper(setup(actaVersion({ document })));
      expect(text).not.toContain('resulta aprobada');
      expect(text).not.toContain('ACUERDO:');
    });

    it('sin observaciones ni actuaciones, esas secciones no aparecen', () => {
      const base = actaDocument();
      const document = actaDocument({ observations: { ...base.observations, text: '' }, nextSteps: { ...base.nextSteps, text: '' } });
      const text = paper(setup(actaVersion({ document, editable: false })));
      expect(text).not.toContain('OBSERVACIONES');
      expect(text).not.toContain('ACTUACIONES DERIVADAS');
    });

    it('es un documento, no un dashboard: sin tarjetas, insignias ni barras de progreso dentro de la hoja', () => {
      const page = host(setup()).querySelector('.page') as HTMLElement;
      expect(page.querySelector('app-meeting-card, app-status-pill, app-badge, progress, .bar, .card')).toBeNull();
    });

    it('numera las páginas y repite el encabezado discreto a partir de la segunda', () => {
      const h = setup();
      h.component.pages.set([[0, 1, 2], [3, 4, 5], [6, 7]]);
      h.fixture.detectChanges();
      const footers = Array.from(host(h).querySelectorAll('.page__footer')).map((el) => el.textContent!.trim());
      expect(footers).toEqual(['Página 1 de 3', 'Página 2 de 3', 'Página 3 de 3']);
      expect(host(h).querySelectorAll('.page__header')).toHaveLength(2);
      expect(host(h).querySelector('.pages')!.children).toHaveLength(3);
    });

    it('con medidas reales reparte el documento en varias páginas A4 sin perder ni duplicar bloques', async () => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return { height: this.hasAttribute('data-block') ? 260 : 0, width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      });
      const h = setup();
      await settle();
      h.fixture.detectChanges();
      await settle();
      h.fixture.detectChanges();
      const pages = h.component.pages();
      expect(pages.length).toBeGreaterThan(2);
      const placed = pages.flat().filter((index) => index !== -1);
      expect(placed).toEqual(h.component.blocks().map((_, index) => index));
      expect(host(h).querySelectorAll('.page')).toHaveLength(pages.length);
      expect(host(h).querySelector('.page__footer')!.textContent).toContain(`de ${pages.length}`);
    });
  });

  describe('barra de herramientas y estado', () => {
    it('tiene Volver, Guardar, Regenerar redacción, Descargar PDF y Preparar para firma', () => {
      const h = setup();
      const labels = Array.from(host(h).querySelectorAll('.toolbar button')).map((b) => b.textContent!.replace(/\s+/g, ' ').trim());
      expect(labels).toEqual(['Volver', 'Guardar', 'Regenerar redacción', 'Descargar PDF', 'Preparar para firma']);
    });

    it('muestra la versión y su estado real', () => {
      const h = setup();
      expect(host(h).querySelector('[data-testid="version-status"]')!.textContent).toBe('Borrador');
      expect(host(h).querySelector('.toolbar__title')!.textContent).toContain('Versión 3');
    });

    it.each([
      ['draft', 'Borrador'],
      ['readyForSignature', 'Lista para firma'],
      ['signed', 'Firmada'],
      ['superseded', 'Sustituida'],
    ] as const)('el estado %s se rotula «%s»', (status, label) => {
      const h = setup(actaVersion({ status, statusLabel: label }));
      const chip = host(h).querySelector('[data-testid="version-status"]')!;
      expect(chip.textContent).toBe(label);
      expect(chip.className).toContain(`chip--${status}`);
    });

    describe('versiones', () => {
      const versions = [
        { id: 'v3', versionNumber: 3, status: 'draft' as const, statusLabel: 'Borrador', createdAt: '2026-10-14T21:30:00Z', savedByName: 'Ana' },
        { id: 'v2', versionNumber: 2, status: 'superseded' as const, statusLabel: 'Sustituida', createdAt: '2026-10-14T20:30:00Z', savedByName: 'Ana' },
      ];
      const withVersions = (version: ActaVersionView, busy = false) => {
        const h = setup(version, { busy });
        h.fixture.componentRef.setInput('versions', versions);
        h.fixture.detectChanges();
        const picked = vi.fn();
        h.component.pickVersion.subscribe(picked);
        return Object.assign(h, { picked });
      };
      const select = (h: Ctx) => host(h).querySelector<HTMLSelectElement>('select[aria-label="Versión del acta"]');

      it('con varias versiones el chip es un selector y elegir otra la pide', () => {
        const h = withVersions(actaVersion({ id: 'v3', versionNumber: 3 }));
        expect(Array.from(select(h)!.options).map((o) => o.textContent?.trim())).toEqual(['Versión 3 · Borrador', 'Versión 2 · Sustituida']);
        expect(select(h)!.value).toBe('v3');
        select(h)!.value = 'v2';
        select(h)!.dispatchEvent(new Event('change'));
        expect(h.picked).toHaveBeenCalledWith('v2');
      });

      it('con una sola versión sigue siendo un chip', () => {
        const h = setup();
        expect(select(h)).toBeNull();
        expect(host(h).querySelector('.toolbar__title .chip')?.textContent).toContain('Versión');
      });

      it('una versión sustituida es solo lectura, lo avisa y ofrece volver a la vigente', () => {
        const h = withVersions(actaVersion({ id: 'v2', versionNumber: 2, status: 'superseded', statusLabel: 'Sustituida', editable: false }));
        expect(host(h).querySelector('[data-testid="old-version"]')?.textContent).toContain('versión 2');
        expect(toolbarButton(h, 'Regenerar redacción')!.disabled).toBe(true);
        expect(toolbarButton(h, 'Preparar para firma')!.disabled).toBe(true);
        (host(h).querySelector('[data-testid="old-version"] button') as HTMLButtonElement).click();
        expect(h.picked).toHaveBeenCalledWith('v3');
      });

      it('no deja cambiar de versión mientras hay cambios sin guardar o una llamada en curso', () => {
        expect(select(withVersions(actaVersion(), true))!.disabled).toBe(true);
      });

      it('«Descargar PDF» emite la versión que se está viendo', () => {
        const h = withVersions(actaVersion({ id: 'v2', versionNumber: 2, status: 'superseded', editable: false }));
        toolbarButton(h, 'Descargar PDF')!.click();
        expect(h.out.downloadPdf).toHaveBeenCalledWith('v2');
      });
    });

    it('«Volver», «Descargar PDF» y «Preparar para firma» emiten', () => {
      const h = setup();
      toolbarButton(h, 'Volver')!.click();
      toolbarButton(h, 'Descargar PDF')!.click();
      toolbarButton(h, 'Preparar para firma')!.click();
      expect(h.out.back).toHaveBeenCalled();
      expect(h.out.downloadPdf).toHaveBeenCalled();
      expect(h.out.prepare).toHaveBeenCalled();
    });

    it('una versión lista para firma ofrece seguir a la firma en lugar de prepararla otra vez', () => {
      const h = setup(actaVersion({ status: 'readyForSignature', statusLabel: 'Lista para firma' }));
      expect(toolbarButton(h, 'Preparar para firma')).toBeUndefined();
      toolbarButton(h, 'Continuar a la firma')!.click();
      expect(h.out.continueToSign).toHaveBeenCalled();
    });

    it('mientras hay una llamada en curso, las acciones del servidor quedan desactivadas', () => {
      const h = setup(actaVersion(), { busy: true });
      expect(toolbarButton(h, 'Descargar PDF')!.disabled).toBe(true);
      expect(toolbarButton(h, 'Regenerar redacción')!.disabled).toBe(true);
      expect(toolbarButton(h, 'Preparar para firma')!.disabled).toBe(true);
    });

    it('Escape cierra el visor', () => {
      const h = setup();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(h.out.back).toHaveBeenCalled();
    });
  });

  describe('avisos', () => {
    it('muestra el error del servidor', () => {
      const h = setup(actaVersion(), { error: 'No se pudo guardar el acta.' });
      expect(host(h).querySelector('[role="alert"]')!.textContent).toContain('No se pudo guardar el acta.');
    });

    it('muestra los avisos de la validación previa sin bloquear nada', () => {
      const h = setup(actaVersion(), { warnings: [{ code: 'MISSING_QUOTA', message: '1 propiedad(es) no tienen coeficiente.' }] });
      expect(host(h).querySelector('[data-testid="warning"]')!.textContent).toContain('1 propiedad(es) no tienen coeficiente.');
      expect(toolbarButton(h, 'Preparar para firma')!.disabled).toBe(false);
    });

    it('sin IA lo dice: los textos recogen las notas tal cual', () => {
      const note = host(setup()).querySelector('[data-testid="narrative-note"]')!.textContent!;
      expect(note).toContain('recogen tus notas tal cual');
      expect(note).toContain('Redacción automática desactivada.');
    });

    it('con IA avisa de que hay que revisar la redacción', () => {
      const note = host(setup(actaVersion({ narrative: { mode: 'llm', model: 'gpt-x', reason: null } }))).querySelector('[data-testid="narrative-note"]')!.textContent!;
      expect(note).toContain('generado automáticamente');
      expect(note).toContain('Revísala');
    });

    it('avisa de que las notas cambiaron después de generar el borrador', () => {
      expect(host(setup(actaVersion({ notesChanged: true }))).querySelector('[data-testid="notes-changed"]')).not.toBeNull();
    });

    it('no avisa de cambios en las notas si no los hay', () => {
      expect(host(setup()).querySelector('[data-testid="notes-changed"]')).toBeNull();
    });

    it('anota los datos que no constan y se omiten del documento', () => {
      const h = setup(actaVersion({ document: actaDocument({ missing: ['actualEndAt'] }) }));
      expect(host(h).querySelector('.notices')!.textContent).toContain('la hora real de fin');
    });

    it('permite corregir las horas y la convocatoria', () => {
      const h = setup();
      (host(h).querySelector('.notices .link') as HTMLButtonElement).click();
      expect(h.out.editData).toHaveBeenCalled();
    });
  });

  describe('edición por bloques', () => {
    it('solo los textos redactables tienen botón de edición; lo factual no', () => {
      const h = setup();
      // párrafo inicial (hueco), desarrollo del punto 1, hueco del punto 2 y 3, observaciones y actuaciones
      const editable = Array.from(host(h).querySelectorAll('.blk--editable')).map((el) => el.getAttribute('data-block'));
      expect(editable).toEqual(expect.arrayContaining(['intro-empty', 'narrative-a1-0', 'narrative-a2-empty', 'observations-0', 'next-0']));
      for (const factual of ['constitution', 'attendance-sentence', 'row-0', 'vote-s1', 'agreement-s1', 'signatures']) {
        expect(host(h).querySelector(`[data-block="${factual}"]`)!.classList.contains('blk--editable')).toBe(false);
      }
    });

    it('editar el desarrollo de un punto: aparece el cuadro de texto, se aplica y queda «Cambios sin guardar»', async () => {
      const h = setup();
      editButton(h, 0).click();
      h.fixture.detectChanges();
      await settle();
      h.fixture.detectChanges();
      const textarea = host(h).querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Se presenta el presupuesto anual.');
      textarea.value = 'Texto corregido por la gestora.';
      textarea.dispatchEvent(new Event('input'));
      h.fixture.detectChanges();
      const apply = Array.from(host(h).querySelectorAll('.editor button')).find((b) => b.textContent?.includes('Aplicar')) as HTMLButtonElement;
      apply.click();
      h.fixture.detectChanges();
      expect(host(h).querySelector('textarea')).toBeNull();
      expect(paper(h)).toContain('Texto corregido por la gestora.');
      expect(host(h).textContent).toContain('Cambios sin guardar');
      expect(toolbarButton(h, 'Guardar')!.disabled).toBe(false);
      // Con cambios sin guardar no se puede preparar para la firma.
      expect(toolbarButton(h, 'Preparar para firma')!.disabled).toBe(true);
    });

    it('Guardar envía solo lo que cambió, sobre la versión mostrada', () => {
      const h = setup();
      h.component.startEdit({ kind: 'item', id: 'a1' });
      h.component.draftText.set('Nuevo desarrollo.');
      h.component.applyEdit();
      h.component.startEdit({ kind: 'introduction' });
      h.component.draftText.set('Párrafo previo.');
      h.component.applyEdit();
      h.fixture.detectChanges();
      toolbarButton(h, 'Guardar')!.click();
      expect(h.out.save).toHaveBeenCalledWith({ baseVersionId: 'v3', introduction: 'Párrafo previo.', items: [{ id: 'a1', narrative: 'Nuevo desarrollo.' }] });
    });

    it('un hueco vacío permite escribir el desarrollo de un punto que no lo tenía', () => {
      const h = setup();
      const placeholder = host(h).querySelector('[data-block="narrative-a2-empty"] .placeholder') as HTMLButtonElement;
      expect(placeholder.textContent).toContain('Añadir desarrollo del punto');
      placeholder.click();
      h.fixture.detectChanges();
      expect(host(h).querySelector('textarea')).not.toBeNull();
    });

    it('cancelar descarta el borrador del texto; volver al texto original no deja cambios pendientes', () => {
      const h = setup();
      h.component.startEdit({ kind: 'observations' });
      h.component.draftText.set('Otra cosa');
      h.component.cancelEdit();
      expect(h.component.hasChanges()).toBe(false);
      h.component.startEdit({ kind: 'observations' });
      h.component.draftText.set('Otra cosa');
      h.component.applyEdit();
      expect(h.component.hasChanges()).toBe(true);
      h.component.startEdit({ kind: 'observations' });
      h.component.draftText.set('La junta se desarrolló con normalidad.');
      h.component.applyEdit();
      expect(h.component.hasChanges()).toBe(false);
    });

    it('lo factual no se puede escribir: no hay forma de editar votos, asistencia o resultados', () => {
      const h = setup();
      h.component.startEdit({ kind: 'item', id: 'a1' });
      h.component.draftText.set('Aprobado por unanimidad con 99 votos');
      h.component.applyEdit();
      h.fixture.detectChanges();
      // El texto libre se acepta como desarrollo, pero los datos del modelo siguen siendo los del backend.
      expect(paper(h)).toContain('Opción A: 2');
      expect(paper(h)).toContain('La propuesta resulta aprobada.');
      expect(paper(h)).toContain('Asisten, presentes o representadas, 3 de 4 propiedades');
    });

    it('una versión firmada o sustituida es de solo lectura: sin botones de edición ni huecos', () => {
      const h = setup(actaVersion({ status: 'signed', statusLabel: 'Firmada', editable: false }));
      expect(host(h).querySelectorAll('.blk__edit')).toHaveLength(0);
      expect(host(h).querySelectorAll('.placeholder')).toHaveLength(0);
      expect(toolbarButton(h, 'Regenerar redacción')!.disabled).toBe(true);
      expect(toolbarButton(h, 'Preparar para firma')!.disabled).toBe(true);
      h.component.startEdit({ kind: 'item', id: 'a1' });
      expect(h.component.editing()).toBeNull();
    });

    it('al cambiar de versión se descartan los cambios pendientes', () => {
      const h = setup();
      h.component.startEdit({ kind: 'introduction' });
      h.component.draftText.set('Pendiente');
      h.component.applyEdit();
      expect(h.component.hasChanges()).toBe(true);
      h.fixture.componentRef.setInput('version', actaVersion({ id: 'v4', versionNumber: 4 }));
      h.fixture.detectChanges();
      expect(h.component.hasChanges()).toBe(false);
    });
  });

  describe('regenerar redacción', () => {
    it('sin ediciones a mano regenera directamente', async () => {
      const ask = vi.spyOn(ConfirmDialogService.prototype, 'ask');
      const h = setup();
      toolbarButton(h, 'Regenerar redacción')!.click();
      await settle();
      expect(ask).not.toHaveBeenCalled();
      expect(h.out.regenerate).toHaveBeenCalled();
    });

    it('con ediciones a mano pide confirmación porque se sustituyen; si se acepta, regenera y descarta lo pendiente', async () => {
      const ask = vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(true);
      const h = setup();
      h.component.startEdit({ kind: 'item', id: 'a1' });
      h.component.draftText.set('Edición manual');
      h.component.applyEdit();
      await h.component.onRegenerate();
      expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Regenerar la redacción' }));
      expect(h.out.regenerate).toHaveBeenCalled();
      expect(h.component.hasChanges()).toBe(false);
    });

    it('si se rechaza la confirmación no se regenera ni se pierde lo editado', async () => {
      vi.spyOn(ConfirmDialogService.prototype, 'ask').mockResolvedValue(false);
      const h = setup();
      h.component.startEdit({ kind: 'item', id: 'a1' });
      h.component.draftText.set('Edición manual');
      h.component.applyEdit();
      await h.component.onRegenerate();
      expect(h.out.regenerate).not.toHaveBeenCalled();
      expect(h.component.hasChanges()).toBe(true);
    });
  });

  it('se cuelga del <body> para cubrir toda la ventana y se retira al cerrarse', () => {
    const h = setup();
    expect(host(h).parentElement).toBe(document.body);
    const element = host(h);
    h.fixture.destroy();
    expect(document.body.contains(element)).toBe(false);
  });
});

/** Compara sin depender del espaciado exacto del documento. */
function squash(value: string): string {
  return value.replace(/\s+/g, '');
}
