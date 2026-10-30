import { actaDocument } from './acta-fixtures';
import { REPEATED_TABLE_HEADER, layoutBlocks, paginate, type ActaBlock } from './acta-layout';

const kinds = (blocks: ActaBlock[]) => blocks.map((block) => block.kind);

describe('layoutBlocks — del modelo canónico a bloques, sin recalcular nada', () => {
  it('sigue el orden del acta formal: encabezado, constitución, orden del día, asistencia, desarrollo, observaciones, actuaciones, cierre y firmas', () => {
    const blocks = layoutBlocks(actaDocument(), false);
    const texts = blocks.map((block) => block.text ?? block.cells?.join('|') ?? block.kind);
    expect(texts.slice(0, 5)).toEqual(['ACTA DE LA JUNTA GENERAL ORDINARIA', 'DE LA COMUNIDAD DE PROPIETARIOS', 'COMUNIDAD SOL 12', 'Calle Mayor 12, Madrid', 'rule']);
    const order = ['ORDEN DEL DÍA', 'ASISTENCIA', 'DESARROLLO', 'OBSERVACIONES', 'ACTUACIONES DERIVADAS DE LOS ACUERDOS'].map((heading) => texts.indexOf(heading));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(blocks[blocks.length - 1].kind).toBe('signatures');
    expect(texts).toContain('Y no habiendo más asuntos que tratar, se levanta la sesión a las 21:05 horas.');
  });

  it('usa los textos del modelo tal cual: líneas de votación, acuerdos y rótulos', () => {
    const blocks = layoutBlocks(actaDocument(), false);
    const vote = blocks.find((block) => block.kind === 'vote');
    expect(vote?.vote?.lines.options).toEqual(['Opción A: 2', 'Opción B: 1', 'Opción C: 0']);
    expect(blocks.find((block) => block.kind === 'agreement')?.text).toBe('ACUERDO: Se aprueba la propuesta sometida a votación.');
    expect(blocks.find((block) => block.kind === 'itemTitle')?.text).toBe('1º  APROBACIÓN DEL PRESUPUESTO 2027');
    expect(blocks.find((block) => block.kind === 'tableHeader')?.cells).toEqual(['PROPIEDAD', 'ASISTENTE', 'COEFICIENTE', 'ASISTENCIA']);
    expect(blocks.filter((block) => block.kind === 'tableRow').map((block) => block.cells)).toEqual([
      ['1A', 'Mónica Prieto Ruiz', '2,50 %', 'Presente'],
      ['1B', 'Luis Gómez Pardo, en representación de Ana Ruiz Soto', '2,90 %', 'Representada'],
      ['2A', 'Pedro Sanz Vega', '3,10 %', 'Presente'],
    ]);
  });

  it('un punto sin contenido muestra su frase real y no se inventa desarrollo', () => {
    const texts = layoutBlocks(actaDocument(), false).map((block) => block.text);
    expect(texts).toContain('El punto quedó tratado sin contenido adicional registrado.');
    expect(texts).toContain('Este punto no consta como tratado en la reunión.');
  });

  it('una sección sin texto no se muestra (salvo el hueco para escribirla en modo edición)', () => {
    const model = actaDocument({ observations: { ...actaDocument().observations, text: '' }, nextSteps: { ...actaDocument().nextSteps, text: '' } });
    const view = layoutBlocks(model, false);
    expect(view.some((block) => block.text === 'OBSERVACIONES')).toBe(false);
    expect(view.some((block) => block.text === 'ACTUACIONES DERIVADAS DE LOS ACUERDOS')).toBe(false);
    expect(view.some((block) => block.kind === 'placeholder')).toBe(false);

    const editing = layoutBlocks(model, true);
    const placeholders = editing.filter((block) => block.kind === 'placeholder').map((block) => block.text);
    expect(placeholders).toEqual(
      expect.arrayContaining(['Añadir un párrafo inicial (opcional)', 'Añadir desarrollo del punto', 'Añadir observaciones', 'Añadir actuaciones derivadas de los acuerdos']),
    );
  });

  it('marca como editables solo los textos redactables, con el botón en el primer párrafo de cada uno', () => {
    const model = actaDocument();
    model.items[0].narrative.text = 'Primer párrafo.\nSegundo párrafo.';
    const blocks = layoutBlocks(model, true);
    const narrative = blocks.filter((block) => block.edit?.key.kind === 'item' && block.kind === 'paragraph');
    expect(narrative.map((block) => [block.text, block.edit?.first])).toEqual([
      ['Primer párrafo.', true],
      ['Segundo párrafo.', false],
    ]);
    // Lo factual nunca es editable.
    for (const block of blocks.filter((entry) => ['vote', 'tableRow', 'agreement', 'itemTitle', 'signatures', 'constitution'].includes(entry.kind) || entry.key === 'constitution')) {
      expect(block.edit).toBeUndefined();
    }
  });

  it('sin permiso de edición no hay controles de edición en ningún bloque', () => {
    expect(layoutBlocks(actaDocument(), false).some((block) => !!block.edit)).toBe(false);
  });

  it('los títulos viajan con lo que les sigue', () => {
    const blocks = layoutBlocks(actaDocument(), false);
    for (const kind of ['heading', 'itemTitle'] as const) {
      expect(blocks.filter((block) => block.kind === kind).every((block) => block.keepWithNext)).toBe(true);
    }
    expect(kinds(blocks)).toContain('tableHeader');
  });
});

describe('paginate — reparto en páginas A4', () => {
  const block = (key: string, kind: ActaBlock['kind'] = 'paragraph', keepWithNext = false): ActaBlock => ({ key, kind, keepWithNext });

  it('mientras caben, todo va en una página', () => {
    expect(paginate([block('a'), block('b'), block('c')], [100, 100, 100], 400)).toEqual([[0, 1, 2]]);
  });

  it('un bloque que no cabe pasa a la página siguiente entero (no se parte)', () => {
    expect(paginate([block('a'), block('b'), block('c')], [300, 200, 100], 400)).toEqual([[0], [1, 2]]);
  });

  it('un título no se queda solo al final de una página: viaja con el bloque siguiente', () => {
    const blocks = [block('a'), block('h', 'heading', true), block('p')];
    expect(paginate(blocks, [300, 40, 100], 400)).toEqual([[0], [1, 2]]);
  });

  it('una cadena de títulos consecutivos se mantiene junta', () => {
    const blocks = [block('a'), block('h1', 'heading', true), block('h2', 'itemTitle', true), block('p')];
    expect(paginate(blocks, [250, 40, 40, 100], 400)).toEqual([[0], [1, 2, 3]]);
  });

  it('la tabla de asistencia repite su cabecera al continuar en otra página', () => {
    const blocks = [block('s'), block('th', 'tableHeader', true), block('r1', 'tableRow'), block('r2', 'tableRow'), block('r3', 'tableRow'), block('r4', 'tableRow')];
    const pages = paginate(blocks, [50, 20, 150, 150, 150, 150], 400);
    expect(pages).toEqual([[0, 1, 2, 3], [REPEATED_TABLE_HEADER, 4, 5]]);
  });

  it('un bloque más alto que una página ocupa una página para él solo y no se pierde', () => {
    const pages = paginate([block('a'), block('enorme'), block('b')], [100, 900, 100], 400);
    expect(pages).toEqual([[0], [1], [2]]);
  });

  it('un documento vacío tiene una página', () => {
    expect(paginate([], [], 400)).toEqual([[]]);
  });

  it('todos los bloques aparecen exactamente una vez', () => {
    const blocks = Array.from({ length: 40 }, (_, index) => block(`b${index}`, index % 7 === 0 ? 'heading' : 'paragraph', index % 7 === 0));
    const heights = blocks.map((_, index) => 60 + (index % 5) * 30);
    const placed = paginate(blocks, heights, 500).flat().filter((index) => index !== REPEATED_TABLE_HEADER);
    expect(placed).toEqual(blocks.map((_, index) => index));
  });
});
