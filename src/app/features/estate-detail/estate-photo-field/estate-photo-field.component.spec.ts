import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import type { Estate } from '../../../core/models';
import { EstatePhotoFieldComponent, PHOTO_MAX_BYTES, type EstatePhotoChange } from './estate-photo-field.component';

const estate = (overrides: Partial<Estate> = {}): Estate =>
  ({ id: 'e1', name: 'Colón 24', type: 'Edificio', ...overrides }) as Estate;

describe('EstatePhotoFieldComponent', () => {
  let h: ComponentHarness<EstatePhotoFieldComponent>;
  let emitted: EstatePhotoChange[];

  beforeEach(() => {
    emitted = [];
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++n}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  function mount(e: Estate): void {
    h = setupComponent(EstatePhotoFieldComponent);
    h.fixture.componentRef.setInput('estate', e);
    h.component.changed.subscribe((c) => emitted.push(c));
    h.fixture.detectChanges();
    // El campo de foto de un test sin foto subida no pide nada; con foto sí.
    h.http.match(() => true).forEach((req) => req.flush(new Blob(['x'], { type: 'image/png' })));
  }
  const status = () => h.el.querySelector('[data-photo-status]')?.textContent?.trim();
  const action = (name: string) => h.el.querySelector(`[data-photo-action="${name}"]`) as HTMLButtonElement | null;
  const pick = (file: File) => {
    const input = h.el.querySelector('#photo-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
  };
  const image = (name = 'fachada.png', type = 'image/png', size = 1000) => new File([new Uint8Array(size)], name, { type });

  describe('qué foto tiene la finca', () => {
    it('sin foto ni Catastro lo dice y ofrece "Subir foto" (sin "Quitar")', () => {
      mount(estate());
      expect(status()).toBe('Sin foto: se muestra un icono de edificio.');
      expect(h.el.querySelector('label.photo-btn')?.textContent).toContain('Subir foto');
      expect(action('remove')).toBeNull();
    });

    it('sin foto propia pero con fachada del Catastro lo explica', () => {
      mount(estate({ catastroFacadeUrl: 'https://ovc.catastro.meh.es/x' }));
      expect(status()).toBe('Sin foto propia: se usa la fachada del Catastro.');
    });

    it('con foto subida dice cuándo, ofrece "Cambiar foto" y "Quitar foto"', () => {
      mount(estate({ photoUpdatedAt: '2026-10-17T10:00:00.000Z' }));
      expect(status()).toMatch(/^Foto subida el 17 de octubre de 2026\.$/);
      expect(h.el.querySelector('label.photo-btn')?.textContent).toContain('Cambiar foto');
      expect(action('remove')).not.toBeNull();
    });
  });

  describe('elegir una foto', () => {
    beforeEach(() => mount(estate()));

    it('muestra su vista previa, avisa al formulario y dice que se subirá al guardar', () => {
      const file = image('portal.png');
      pick(file);
      expect(h.el.querySelector('.photo-field__preview img')?.getAttribute('src')).toBe('blob:preview-1');
      expect(status()).toBe('Foto nueva: portal.png. Se subirá al guardar.');
      expect(emitted.at(-1)).toEqual({ file, remove: false });
      expect(action('discard')).not.toBeNull();
    });

    it('acepta JPG, PNG y WebP', () => {
      for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
        pick(image('f', type));
        expect(h.component.error()).toBeNull();
        expect(h.component.staged()?.type).toBe(type);
      }
    });

    it('rechaza lo que no es JPG, PNG o WebP (SVG, GIF, PDF…) sin cambiar lo elegido', () => {
      const good = image('buena.png');
      pick(good);
      for (const type of ['image/svg+xml', 'image/gif', 'application/pdf', '']) {
        pick(image('mala', type));
        expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('JPG, PNG o WebP');
      }
      expect(h.component.staged()).toBe(good);
    });

    it('rechaza una foto de más de 5 MB y acepta una de justo 5 MB', () => {
      pick(image('grande.png', 'image/png', PHOTO_MAX_BYTES + 1));
      expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('no puede superar los 5 MB');
      expect(h.component.staged()).toBeNull();
      pick(image('justa.png', 'image/png', PHOTO_MAX_BYTES));
      expect(h.component.error()).toBeNull();
      expect(h.component.staged()?.name).toBe('justa.png');
    });

    it('"Descartar" vuelve a como estaba y avisa de que ya no hay nada que subir', () => {
      pick(image());
      action('discard')!.click();
      h.fixture.detectChanges();
      expect(h.component.staged()).toBeNull();
      expect(h.el.querySelector('.photo-field__preview img[alt^="Vista previa"]')).toBeNull();
      expect(emitted.at(-1)).toEqual({ file: null, remove: false });
    });

    it('al elegir otra libera la vista previa de la anterior', () => {
      const revoke = vi.mocked(URL.revokeObjectURL);
      pick(image('a.png'));
      pick(image('b.png'));
      expect(revoke).toHaveBeenCalledWith('blob:preview-1');
      expect(h.el.querySelector('.photo-field__preview img')?.getAttribute('src')).toBe('blob:preview-2');
    });

    it('al destruirse libera la vista previa', () => {
      pick(image());
      h.fixture.destroy();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    });
  });

  describe('quitar la foto subida', () => {
    beforeEach(() => mount(estate({ photoUpdatedAt: '2026-10-17T10:00:00.000Z', catastroFacadeUrl: 'https://ovc.catastro.meh.es/x' })));

    it('"Quitar foto" la marca para quitarla al guardar, y "Deshacer" lo cancela', () => {
      action('remove')!.click();
      h.fixture.detectChanges();
      expect(status()).toBe('La foto se quitará al guardar y se usará la fachada del Catastro.');
      expect(emitted.at(-1)).toEqual({ file: null, remove: true });
      action('undo')!.click();
      h.fixture.detectChanges();
      expect(emitted.at(-1)).toEqual({ file: null, remove: false });
      expect(status()).toMatch(/^Foto subida el /);
    });

    it('elegir una foto nueva después de marcar "quitar" prevalece: se sustituye, no se quita', () => {
      action('remove')!.click();
      const file = image('nueva.png');
      pick(file);
      expect(emitted.at(-1)).toEqual({ file, remove: false });
    });
  });
});
