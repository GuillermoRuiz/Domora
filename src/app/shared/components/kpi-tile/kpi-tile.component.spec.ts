import { TestBed } from '@angular/core/testing';
import { KpiTileComponent } from './kpi-tile.component';

describe('KpiTileComponent', () => {
  function setup(inputs: Partial<Pick<KpiTileComponent, 'label' | 'value' | 'sub' | 'icon' | 'tone' | 'iconTone'>> = {}) {
    TestBed.configureTestingModule({ imports: [KpiTileComponent] });
    const fixture = TestBed.createComponent(KpiTileComponent);
    Object.assign(fixture.componentInstance, inputs);
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement };
  }

  it('muestra etiqueta y cifra', () => {
    const { el } = setup({ label: 'Saldo actual', value: '12.450,00 €' });
    expect(el.querySelector('.kpi__label')?.textContent?.trim()).toBe('Saldo actual');
    expect(el.querySelector('.kpi__value')?.textContent?.trim()).toBe('12.450,00 €');
  });

  it('la cifra 0 se pinta (no se confunde con vacío)', () => {
    const { el } = setup({ label: 'Incidencias abiertas', value: 0 });
    expect(el.querySelector('.kpi__value')?.textContent?.trim()).toBe('0');
  });

  it('sin sub ni icon no pinta esos bloques; con ellos sí', () => {
    const bare = setup({ label: 'x', value: 1 });
    expect(bare.el.querySelector('.kpi__sub')).toBeNull();
    expect(bare.el.querySelector('.kpi__icon')).toBeNull();

    TestBed.resetTestingModule();
    const full = setup({ label: 'x', value: 1, sub: 'en 2 propiedades', icon: 'building' });
    expect(full.el.querySelector('.kpi__sub')?.textContent?.trim()).toBe('en 2 propiedades');
    expect(full.el.querySelector('.kpi__icon svg')).not.toBeNull();
  });

  it('el tono se aplica como modificador y por defecto es neutro', () => {
    const neutral = setup({ label: 'x', value: 1 });
    expect(neutral.el.querySelector('.kpi')?.classList.contains('kpi--default')).toBe(true);

    TestBed.resetTestingModule();
    const danger = setup({ label: 'x', value: 1, tone: 'danger' });
    expect(danger.el.querySelector('.kpi')?.classList.contains('kpi--danger')).toBe(true);
  });

  it('the existing icon tones still tint the icon square', () => {
    for (const tone of ['accent', 'error', 'success', 'purple'] as const) {
      TestBed.resetTestingModule();
      const { el } = setup({ label: 'x', value: 1, icon: 'building', iconTone: tone });
      expect(el.querySelector('.kpi__icon')?.classList.contains(`kpi__icon--${tone}`)).toBe(true);
    }
  });

  it('the blue icon tone tints the icon square blue', () => {
    const { el } = setup({ label: 'En curso', value: 2, icon: 'clock', iconTone: 'blue' });
    expect(el.querySelector('.kpi__icon')?.classList.contains('kpi__icon--blue')).toBe(true);
  });
});
