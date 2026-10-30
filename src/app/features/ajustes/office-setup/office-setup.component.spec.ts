import { setupComponent } from '../../../core/testing/component-harness';
import type { OfficeCompletenessDetail, OfficeSetupStep } from '../../../core/office-setup.service';
import { OfficeSetupComponent } from './office-setup.component';

const steps = (pending: string[]): OfficeSetupStep[] =>
  ([
    ['contact', 'recommended'],
    ['billing', 'required'],
    ['payment', 'required'],
    ['estates', 'required'],
    ['team', 'info'],
    ['twoFactor', 'recommended'],
  ] as const).map(([key, weight]) => ({ key, weight, status: pending.includes(key) ? 'pending' : 'done' }));

const detail = (pending: string[]): OfficeCompletenessDetail => ({
  administratorId: 'a1', name: 'Despacho Ruiz', office: 0, estates: 0, total: 0, estateCount: 0,
  onboardingComplete: false, includedInAverage: true, officeSteps: steps(pending), estateDetails: [],
});

describe('OfficeSetupComponent', () => {
  const render = (data: OfficeCompletenessDetail | null) => {
    const h = setupComponent(OfficeSetupComponent);
    h.fixture.componentRef.setInput('data', data);
    h.fixture.detectChanges();
    return h;
  };

  it('muestra cada paso del despacho con su estado, su peso y el progreso', () => {
    const h = render(detail(['contact', 'payment', 'team']));
    expect(h.el.querySelector('h3')?.textContent).toContain('Puesta en marcha del despacho');
    const rows = [...h.el.querySelectorAll<HTMLElement>('[data-step]')];
    expect(rows.map((r) => r.dataset['step'])).toEqual(['contact', 'billing', 'payment', 'estates', 'team', 'twoFactor']);
    const row = (key: string) => rows.find((r) => r.dataset['step'] === key)!;
    expect(row('payment').dataset['status']).toBe('pending');
    expect(row('payment').textContent).toContain('Obligatorio');
    expect(row('contact').textContent).toContain('Recomendado');
    expect(row('team').textContent).toContain('Opcional');
    expect(row('billing').dataset['status']).toBe('done');
    expect(row('twoFactor').textContent).toContain('Verificación en dos pasos');
    // 3 de 5 pasos que cuentan (los opcionales no cuentan)
    expect(h.el.querySelector('.office-setup__progress')?.textContent).toContain('3 de 5');
  });

  it('cada paso pendiente enlaza con la pantalla donde se resuelve', () => {
    const h = render(detail(['contact', 'payment', 'estates', 'team', 'twoFactor', 'billing']));
    const href = (key: string) => h.el.querySelector(`[data-step="${key}"] a`)?.getAttribute('href') ?? null;
    expect(href('contact')).toBe('/b/settings#ajustes-empresa');
    expect(href('payment')).toBe('/b/subscription');
    expect(href('estates')).toBe('/b/estates');
    expect(href('team')).toBe('/b/settings#ajustes-equipo');
    expect(href('twoFactor')).toBe('/b/settings#ajustes-seguridad');
    // El propio despacho edita sus datos de facturación en Ajustes (S17).
    expect(href('billing')).toBe('/b/settings#ajustes-facturacion');
    expect(h.el.querySelector('[data-step="billing"]')?.textContent).toContain('Ajustes › Datos de facturación');
  });

  it('lleva en la esquina superior derecha el mismo punto de aviso que el menú de cuenta', () => {
    const h = render(detail(['payment']));
    expect(h.el.querySelector('.section-card__tools .office-setup__dot')).not.toBeNull();
  });

  it('desaparece cuando los obligatorios y recomendados están hechos, aunque falte el opcional', () => {
    expect(render(detail(['team'])).el.querySelector('.office-setup')).toBeNull();
  });

  it('sin datos no pinta nada', () => {
    expect(render(null).el.querySelector('.office-setup')).toBeNull();
  });
});
