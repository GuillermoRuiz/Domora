import { TestBed } from '@angular/core/testing';
import { DemoBannerComponent } from './demo-banner.component';

/** Luminancia relativa WCAG 2.x de un color #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Duplicados de --demo-banner-fg / --demo-banner-bg en src/styles.scss
// (`:root` = oscuro, `[data-theme='light']` = claro). Si se cambian allí, hay
// que cambiarlos aquí: este test existe para que el contraste no regrese.
const TOKENS = {
  dark: { fg: '#14120A', bg: '#D9A62E' },
  light: { fg: '#211D12', bg: '#F0C75E' },
};

describe('DemoBannerComponent', () => {
  it('muestra el aviso veraz (sin prometer reset nocturno) y publica su altura mientras está montado', () => {
    const fixture = TestBed.createComponent(DemoBannerComponent);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Entorno de demostración');
    expect(text).toContain('datos ficticios');
    expect(text).not.toContain('restablecen');
    expect(document.documentElement.style.getPropertyValue('--demo-banner-h')).toBe('32px');

    fixture.destroy();
    expect(document.documentElement.style.getPropertyValue('--demo-banner-h')).toBe('');
  });

  it('el dorado del banner cumple contraste WCAG AA (>= 4,5:1) en tema oscuro', () => {
    expect(contrast(TOKENS.dark.fg, TOKENS.dark.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('el dorado del banner cumple contraste WCAG AA (>= 4,5:1) en tema claro', () => {
    expect(contrast(TOKENS.light.fg, TOKENS.light.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
