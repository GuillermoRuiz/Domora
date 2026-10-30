import { TestBed } from '@angular/core/testing';
import { AvatarComponent } from './avatar.component';

describe('AvatarComponent', () => {
  function setup(inputs: Partial<Pick<AvatarComponent, 'name' | 'size' | 'bg'>> = {}) {
    TestBed.configureTestingModule({ imports: [AvatarComponent] });
    const fixture = TestBed.createComponent(AvatarComponent);
    Object.assign(fixture.componentInstance, inputs);
    fixture.detectChanges();
    return { fixture, div: fixture.nativeElement.querySelector('.avatar') as HTMLElement };
  }

  it('con nombre y apellido, muestra las dos iniciales', () => {
    const { div } = setup({ name: 'Ana García' });
    expect(div.textContent?.trim()).toBe('AG');
  });

  it('con un solo nombre, muestra solo su inicial', () => {
    const { div } = setup({ name: 'Ana' });
    expect(div.textContent?.trim()).toBe('A');
  });

  it('con más de dos palabras, usa solo las dos primeras', () => {
    const { div } = setup({ name: 'Ana María García López' });
    expect(div.textContent?.trim()).toBe('AM');
  });

  it('sin nombre, muestra "?" en vez de romper', () => {
    const { div } = setup({ name: '' });
    expect(div.textContent?.trim()).toBe('?');
  });

  it('respeta espacios extra al recortar el nombre', () => {
    const { div } = setup({ name: '  Ana   García  ' });
    expect(div.textContent?.trim()).toBe('AG');
  });

  it('el tamaño por defecto es 36px, y se refleja en el ancho/alto', () => {
    const { div } = setup({ name: 'Ana' });
    expect(div.style.width).toBe('36px');
    expect(div.style.height).toBe('36px');
  });

  it('un size custom cambia ancho/alto y el tamaño de fuente proporcional', () => {
    const { div } = setup({ name: 'Ana', size: 50 });
    expect(div.style.width).toBe('50px');
    expect(div.style.fontSize).toBe('19px'); // 50 * 0.38
  });

  it('sin bg explícito, usa el verde por defecto', () => {
    const { div } = setup({ name: 'Ana' });
    expect(div.style.background).toContain('var(--color-secondary)');
  });

  it('con bg explícito, lo respeta en vez del verde por defecto', () => {
    const { div } = setup({ name: 'Ana', bg: '#FF00FF' });
    expect(div.style.background).toBe('rgb(255, 0, 255)');
  });
});
