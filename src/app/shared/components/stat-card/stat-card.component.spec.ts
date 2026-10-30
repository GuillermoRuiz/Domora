import { TestBed } from '@angular/core/testing';
import { StatCardComponent } from './stat-card.component';

describe('StatCardComponent', () => {
  function setup(inputs: Partial<Pick<StatCardComponent, 'label' | 'value' | 'sub' | 'icon' | 'accent' | 'info' | 'change' | 'changeTone' | 'trend'>> = {}) {
    TestBed.configureTestingModule({ imports: [StatCardComponent] });
    const fixture = TestBed.createComponent(StatCardComponent);
    Object.assign(fixture.componentInstance, inputs);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('muestra label y value', () => {
    const { el } = setup({ label: 'Fincas gestionadas', value: 12 });
    expect(el.querySelector('.stat-card__label')?.textContent?.trim()).toBe('Fincas gestionadas');
    expect(el.querySelector('.stat-card__value')?.textContent?.trim()).toBe('12');
  });

  it('sin sub, no pinta la línea secundaria', () => {
    const { el } = setup({ label: 'x', value: 1 });
    expect(el.querySelector('.stat-card__sub')).toBeNull();
  });

  it('con sub, la muestra', () => {
    const { el } = setup({ label: 'x', value: 1, sub: '+3 este mes' });
    expect(el.querySelector('.stat-card__sub')?.textContent?.trim()).toBe('+3 este mes');
  });

  it('sin icon, no pinta el contenedor de icono', () => {
    const { el } = setup({ label: 'x', value: 1 });
    expect(el.querySelector('.stat-card__icon')).toBeNull();
  });

  it('con icon, lo pinta', () => {
    const { el } = setup({ label: 'x', value: 1, icon: 'chart' });
    expect(el.querySelector('.stat-card__icon svg')).not.toBeNull();
  });

  it('accent aplica el modificador visual de la tarjeta', () => {
    const { el } = setup({ label: 'x', value: 1, accent: true });
    expect(el.querySelector('.stat-card')?.className).toContain('stat-card--accent');
  });

  it('sin accent, no aplica el modificador', () => {
    const { el } = setup({ label: 'x', value: 1 });
    expect(el.querySelector('.stat-card')?.className).not.toContain('stat-card--accent');
  });

  it('las tarjetas existentes (sin info, variación ni tendencia) se pintan igual que antes', () => {
    const { el } = setup({ label: 'MRR total', value: '1.200 €', icon: 'chart', accent: true });
    expect(el.querySelector('.stat-card__info')).toBeNull();
    expect(el.querySelector('.stat-card__change')).toBeNull();
    expect(el.querySelector('app-sparkline')).toBeNull();
    expect(el.querySelector('.stat-card__icon svg')).not.toBeNull();
  });

  describe('icono de información del cálculo', () => {
    const INFO = 'Suma de las suscripciones activas, sin IVA.';
    const tip = (el: HTMLElement) => el.querySelector<HTMLElement>('.info-tip__bubble');

    it('al pasar el cursor por encima muestra cómo se calcula y lo oculta al salir', () => {
      const { fixture, el } = setup({ label: 'MRR total', value: 1, info: INFO });
      const button = el.querySelector<HTMLButtonElement>('.stat-card__info button')!;
      expect(button.getAttribute('aria-label')).toBe('Cómo se calcula «MRR total»');
      expect(tip(el)).toBeNull();
      button.dispatchEvent(new Event('mouseenter'));
      fixture.detectChanges();
      expect(tip(el)?.textContent?.trim()).toBe(INFO);
      expect(tip(el)?.getAttribute('role')).toBe('tooltip');
      expect(button.getAttribute('aria-describedby')).toBe(tip(el)?.id);
      button.dispatchEvent(new Event('mouseleave'));
      fixture.detectChanges();
      expect(tip(el)).toBeNull();
    });

    it('también se abre al llegar con el teclado y se cierra al salir o con Escape', () => {
      const { fixture, el } = setup({ label: 'MRR total', value: 1, info: INFO });
      const button = el.querySelector<HTMLButtonElement>('.stat-card__info button')!;
      button.dispatchEvent(new Event('focus'));
      fixture.detectChanges();
      expect(tip(el)?.textContent?.trim()).toBe(INFO);
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(tip(el)).toBeNull();
      button.dispatchEvent(new Event('focus'));
      button.dispatchEvent(new Event('blur'));
      fixture.detectChanges();
      expect(tip(el)).toBeNull();
    });

    it('en pantallas táctiles se abre y se cierra al tocarlo', () => {
      const { fixture, el } = setup({ label: 'MRR total', value: 1, info: INFO });
      const button = el.querySelector<HTMLButtonElement>('.stat-card__info button')!;
      button.click();
      fixture.detectChanges();
      expect(tip(el)).not.toBeNull();
      expect(button.getAttribute('aria-expanded')).toBe('true');
      button.click();
      fixture.detectChanges();
      expect(tip(el)).toBeNull();
    });
  });

  it('la variación lleva su texto y el tono que indica si es buena o mala', () => {
    const { el } = setup({ label: 'x', value: 1, change: '+12,5 % vs. mes anterior', changeTone: 'positive' });
    const change = el.querySelector('.stat-card__change')!;
    expect(change.textContent?.trim()).toBe('+12,5 % vs. mes anterior');
    expect(change.className).toContain('stat-card__change--positive');
  });

  it('con tendencia pinta una sparkline de los valores', () => {
    const { el } = setup({ label: 'x', value: 1, trend: [1, 2, 3] });
    expect(el.querySelector('app-sparkline .sparkline__line')).not.toBeNull();
  });
});
