import { TestBed } from '@angular/core/testing';
import { IconComponent } from './icon.component';

describe('IconComponent', () => {
  function setup(inputs: Partial<Pick<IconComponent, 'name' | 'size'>> = {}) {
    TestBed.configureTestingModule({ imports: [IconComponent] });
    const fixture = TestBed.createComponent(IconComponent);
    Object.assign(fixture.componentInstance, inputs);
    fixture.detectChanges();
    return { fixture, svg: fixture.nativeElement.querySelector('svg') as SVGElement | null };
  }

  it('un nombre conocido renderiza su svg', () => {
    const { svg } = setup({ name: 'home' });
    expect(svg).not.toBeNull();
  });

  it('un nombre desconocido no rompe el render — cae al icono por defecto', () => {
    const { svg } = setup({ name: 'esto-no-existe' });
    expect(svg).not.toBeNull();
    // El @default es un círculo simple (r=10) — confirma que no hay
    // ningún caso oculto que intente devolver contenido para nombres
    // arbitrarios.
    expect(svg?.querySelector('circle')?.getAttribute('r')).toBe('10');
  });

  it('el size por defecto es 16', () => {
    const { svg } = setup({ name: 'home' });
    expect(svg?.getAttribute('width')).toBe('16');
    expect(svg?.getAttribute('height')).toBe('16');
  });

  it('un size custom se refleja en el width/height del svg', () => {
    const { svg } = setup({ name: 'home', size: 24 });
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('height')).toBe('24');
  });

  it('el logo de Domora NO vive acá — se extrajo a public/domora-logo.svg en la auditoría de rendimiento (E4)', () => {
    // Ningún <path> de los iconos de este componente debería acercarse al
    // tamaño de un logo trazado desde bitmap (el hallazgo real fue de 84 KB
    // en un solo case). Un icono de línea normal no debería superar unos
    // pocos cientos de caracteres de "d".
    const { svg } = setup({ name: 'settings' }); // el más complejo de los icons de línea reales
    const path = svg?.querySelector('path');
    expect((path?.getAttribute('d')?.length ?? 0)).toBeLessThan(1000);
  });

  it.each(['wrench', 'elevator', 'flame', 'extinguisher', 'camera', 'pool', 'bolt', 'roof', 'layers', 'droplet', 'sparkles', 'leaf', 'shield'])(
    'el icono de instalación "%s" existe (no cae al círculo por defecto)',
    (name) => {
      const { svg } = setup({ name });
      expect(svg).not.toBeNull();
      expect(svg?.querySelector('circle')?.getAttribute('r')).not.toBe('10');
    },
  );
});
