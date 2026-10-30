import { TestBed } from '@angular/core/testing';
import { EstateSetupCardComponent, type EstateSetupAction } from './estate-setup-card.component';
import type { EstateSetupStatus, EstateSetupStep } from '../../../core/models';

function status(steps: EstateSetupStep[], extra: Partial<EstateSetupStatus> = {}): EstateSetupStatus {
  const required = steps.filter((s) => s.weight === 'required');
  const requiredDone = required.filter((s) => s.status === 'done').length;
  return {
    estateId: 'e1', steps, requiredDone, requiredTotal: required.length,
    complete: requiredDone === required.length, invitableOwners: 0, ...extra,
  };
}

const FRESH: EstateSetupStep[] = [
  { key: 'fiscal', weight: 'required', status: 'pending' },
  { key: 'properties', weight: 'required', status: 'pending', done: 0 },
  { key: 'quotas', weight: 'required', status: 'pending', done: 0, total: 0 },
  { key: 'coefficients', weight: 'recommended', status: 'pending', done: 0, total: 0 },
  { key: 'owners', weight: 'required', status: 'pending', done: 0, total: 0 },
  { key: 'sepa', weight: 'recommended', status: 'pending', done: 0, total: 3 },
  { key: 'opening', weight: 'recommended', status: 'pending' },
  { key: 'linked', weight: 'info', status: 'pending', done: 0, total: 0 },
];

/** Componente presentacional: se monta sin HTTP ni router — solo entradas y salidas. */
describe('EstateSetupCardComponent', () => {
  function mount(s: EstateSetupStatus) {
    const fixture = TestBed.createComponent(EstateSetupCardComponent);
    fixture.componentRef.setInput('status', s);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, component: fixture.componentInstance };
  }

  it('finca recién creada: progreso 0 y todos los pasos con su acción', () => {
    const { el } = mount(status(FRESH));

    expect(el.textContent).toContain('0 de 4 pasos imprescindibles completados');
    expect(el.querySelector<HTMLElement>('.setup-card__progress-fill')?.style.width).toBe('0%');
    const labels = Array.from(el.querySelectorAll('.setup-step__action')).map((b) => b.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['Añadir CIF', 'Importar', 'Añadir propiedad', 'Configurar SEPA', 'Configurar saldos iniciales', 'Importar propietarios']));
  });

  it('el paso de coeficientes sin cerrar ofrece recalcular por m² además de revisar propiedades', () => {
    const { el, component } = mount(status(FRESH));
    const actionButtons = Array.from(el.querySelectorAll<HTMLElement>('[data-step="coefficients"] .setup-step__action'));
    expect(actionButtons.map((b) => b.textContent?.trim())).toEqual(['Recalcular por m²', 'Revisar propiedades']);

    const emitted: EstateSetupAction[] = [];
    component.action.subscribe((a) => emitted.push(a));
    actionButtons[0].click();
    expect(emitted).toEqual(['recalculate-coefficients']);
  });

  it('marca como "Recomendado" los pasos que no bloquean', () => {
    const { el } = mount(status(FRESH));
    const tagged = Array.from(el.querySelectorAll('.setup-step'))
      .filter((li) => li.querySelector('.setup-step__tag'))
      .map((li) => li.getAttribute('data-step'));
    expect(tagged).toEqual(['coefficients', 'sepa', 'opening', 'linked']);
  });

  it('redacta el detalle con los contadores y oculta las acciones de lo ya hecho', () => {
    const { el } = mount(status([
      { key: 'fiscal', weight: 'required', status: 'done' },
      { key: 'properties', weight: 'required', status: 'done', done: 14 },
      { key: 'quotas', weight: 'required', status: 'pending', done: 12, total: 14 },
      { key: 'coefficients', weight: 'recommended', status: 'warning', done: 13, total: 14 },
      { key: 'owners', weight: 'required', status: 'pending', done: 9, total: 14 },
      { key: 'sepa', weight: 'recommended', status: 'done', done: 3, total: 3 },
      { key: 'opening', weight: 'recommended', status: 'pending' },
      { key: 'linked', weight: 'info', status: 'pending', done: 0, total: 14 },
    ], { invitableOwners: 5 }));

    const detail = (key: string) => el.querySelector(`[data-step="${key}"] .setup-step__detail`)?.textContent ?? '';
    expect(detail('quotas')).toContain('12 de 14 con cuota');
    expect(detail('coefficients')).toContain('13 de 14 informados');
    expect(detail('owners')).toContain('9 de 14 con propietario');
    expect(detail('linked')).toContain('5 propietarios importados con email');
    expect(el.querySelector('[data-step="fiscal"] .setup-step__action')).toBeNull();
    expect(el.querySelector('[data-step="coefficients"]')?.classList).toContain('setup-step--warning');
    expect(el.textContent).toContain('2 de 4 pasos imprescindibles');
  });

  it('emite la acción del botón pulsado, sin resolverla ella misma', () => {
    const { el, component } = mount(status(FRESH));
    const emitted: EstateSetupAction[] = [];
    component.action.subscribe((a) => emitted.push(a));

    (Array.from(el.querySelectorAll('.setup-step__action')).find((b) => b.textContent?.includes('Configurar SEPA')) as HTMLButtonElement).click();
    (Array.from(el.querySelectorAll('.setup-step__action')).find((b) => b.textContent?.includes('Importar propietarios')) as HTMLButtonElement).click();

    expect(emitted).toEqual(['open-sepa', 'import-owners']);
  });

  it('paso "Saldos iniciales": pendiente pide configurarlo, hecho no muestra acción', () => {
    const { el } = mount(status(FRESH));
    expect(el.querySelector('[data-step="opening"] .setup-step__action')?.textContent?.trim()).toBe('Configurar saldos iniciales');

    const { el: elDone } = mount(status([
      ...FRESH.filter((s) => s.key !== 'opening'),
      { key: 'opening', weight: 'recommended', status: 'done' },
    ]));
    expect(elDone.querySelector('[data-step="opening"] .setup-step__action')).toBeNull();
  });
});
