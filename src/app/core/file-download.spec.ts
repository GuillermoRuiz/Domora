import { fileNameFor, saveBlob } from './file-download';

describe('fileNameFor', () => {
  it('añade la extensión del tipo cuando el título no la trae', () => {
    expect(fileNameFor('Presupuesto 2027', 'application/pdf')).toBe('Presupuesto 2027.pdf');
    expect(fileNameFor('Acta', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('Acta.docx');
    expect(fileNameFor('Plano', 'image/png')).toBe('Plano.png');
  });

  it('respeta la extensión que ya tiene, sea cual sea su tipo', () => {
    expect(fileNameFor('Estatutos.pdf', 'application/pdf')).toBe('Estatutos.pdf');
    expect(fileNameFor('Estatutos.docx', 'application/pdf')).toBe('Estatutos.docx');
  });

  it('un punto en medio del título no cuenta como extensión', () => {
    expect(fileNameFor('Acta nº 3. Junta ordinaria', 'application/pdf')).toBe('Acta nº 3. Junta ordinaria.pdf');
  });

  it('ignora los parámetros del tipo de contenido y las mayúsculas', () => {
    expect(fileNameFor('Cuentas', 'Application/PDF; charset=binary')).toBe('Cuentas.pdf');
  });

  it('un tipo desconocido deja el título como está', () => {
    expect(fileNameFor('Cosa', 'application/x-raro')).toBe('Cosa');
    expect(fileNameFor('Cosa', '')).toBe('Cosa');
  });

  it('un título vacío usa «documento»', () => {
    expect(fileNameFor('   ', 'application/pdf')).toBe('documento.pdf');
  });
});

describe('saveBlob', () => {
  /** Intercepta la descarga del navegador y devuelve lo que se habría guardado. */
  function capture() {
    const create = vi.fn(() => 'blob:fake');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const saved: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ download: this.download, href: this.href });
    });
    return { saved, revoke };
  }
  afterEach(() => vi.restoreAllMocks());

  it('descarga el fichero con el nombre y la extensión adecuados y no deja rastro en la página', async () => {
    const { saved, revoke } = capture();
    const before = document.body.children.length;
    await saveBlob(new Blob(['%PDF-'], { type: 'application/pdf' }), 'Presupuesto 2027');
    expect(saved).toEqual([{ download: 'Presupuesto 2027.pdf', href: 'blob:fake' }]);
    expect(revoke).toHaveBeenCalledWith('blob:fake');
    expect(document.body.children.length).toBe(before);
  });

  it('si el servidor no dice el tipo (octet-stream o vacío), lo reconoce por el contenido', async () => {
    const { saved } = capture();
    await saveBlob(new Blob(['%PDF-1.7 ....'], { type: 'application/octet-stream' }), 'Normas');
    await saveBlob(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]), 'Plano');
    await saveBlob(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]), 'Foto');
    expect(saved.map(s => s.download)).toEqual(['Normas.pdf', 'Plano.png', 'Foto.jpg']);
  });

  it('un contenido que no se reconoce se guarda con el título tal cual', async () => {
    const { saved } = capture();
    await saveBlob(new Blob(['hola'], { type: 'application/octet-stream' }), 'Cosa');
    expect(saved[0].download).toBe('Cosa');
  });

  it('el tipo que declara el servidor manda sobre lo que parezca el contenido', async () => {
    const { saved } = capture();
    await saveBlob(new Blob(['%PDF-'], { type: 'text/plain' }), 'Nota');
    expect(saved[0].download).toBe('Nota.txt');
  });
});
