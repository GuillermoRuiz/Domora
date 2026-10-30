import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import type { UpcomingReview } from '../../../core/installations.models';
import { InstallationReviewsPanelsComponent } from './installation-reviews-panels.component';

function review(id: string, dueDate: string, daysLeft: number, overrides: Partial<UpcomingReview> = {}): UpcomingReview {
  return {
    inspectionId: `i-${id}`, assetId: `a-${id}`, assetName: `Instalación ${id}`, category: 'Ascensor', location: `Lugar ${id}`,
    title: 'Revisión anual obligatoria', dueDate, daysLeft, overdue: daysLeft < 0, supplierName: `Proveedor ${id}`, ...overrides,
  };
}

const DATA: UpcomingReview[] = [
  review('cubierta', '2026-09-25', -20, { category: 'Cubierta', supplierName: null }),
  review('caldera', '2026-10-19', 3, { category: 'Calefacción / ACS' }),
  review('pci', '2026-10-19', 3, { category: 'PCI' }),
  review('piscina', '2026-12-15', 60, { category: 'Piscina' }),
  review('grupo', '2027-01-14', 90, { category: 'Electricidad' }),
  review('ascensor', '2027-03-05', 140),
  review('portal', '2027-04-01', 165, { category: 'Accesos' }),
];

describe('InstallationReviewsPanelsComponent', () => {
  let h: ComponentHarness<InstallationReviewsPanelsComponent>;

  function mount(upcoming: UpcomingReview[]): void {
    h = setupComponent(InstallationReviewsPanelsComponent);
    h.fixture.componentRef.setInput('upcoming', upcoming);
    h.fixture.detectChanges();
  }
  const ids = (list: string) => Array.from(h.el.querySelectorAll(`[data-list="${list}"] [data-review]`)).map(r => r.getAttribute('data-review'));
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('"Próximos mantenimientos y revisiones" muestra las 4 más inmediatas, empezando por las vencidas', () => {
    mount(DATA);
    expect(ids('next')).toEqual(['i-cubierta', 'i-caldera', 'i-pci', 'i-piscina']);
  });

  it('cada fila lleva día y mes, instalación, tipo de revisión, ubicación, proveedor y plazo', () => {
    mount(DATA);
    const row = h.el.querySelector('[data-list="next"] [data-review="i-caldera"]');
    expect(text(row?.querySelector('.review__date') ?? null)).toMatch(/^19\s?oct$/);
    expect(text(row?.querySelector('.review__name') ?? null)).toBe('Instalación caldera');
    expect(text(row?.querySelector('.review__text .review__sub') ?? null)).toBe('Revisión anual obligatoria');
    expect(text(row?.querySelector('.review__where') ?? null)).toBe('Lugar calderaProveedor caldera');
    expect(text(row?.querySelector('app-status-pill') ?? null)).toBe('En 3 días');
    expect(row?.querySelector('.review__icon app-icon')).not.toBeNull();
  });

  it('sin proveedor lo dice; los plazos se escriben con mayúscula inicial', () => {
    mount(DATA);
    const row = h.el.querySelector('[data-list="next"] [data-review="i-cubierta"]');
    expect(text(row?.querySelector('.review__where') ?? null)).toContain('Sin proveedor');
    expect(text(row?.querySelector('app-status-pill') ?? null)).toBe('Hace 20 días');
  });

  it('los tonos avisan: vencida en peligro, ≤30 días en aviso, el resto neutro', () => {
    mount(DATA);
    const tone = (id: string) => h.el.querySelector(`[data-list="next"] [data-review="${id}"]`)!;
    expect(tone('i-cubierta').querySelector('.review__date--danger')).not.toBeNull();
    expect(tone('i-cubierta').querySelector('.pill--danger')).not.toBeNull();
    expect(tone('i-caldera').querySelector('.review__date--warning')).not.toBeNull();
    expect(tone('i-caldera').querySelector('.pill--warning')).not.toBeNull();
    expect(tone('i-piscina').querySelector('.review__date--warning, .review__date--danger')).toBeNull();
    expect(tone('i-piscina').querySelector('.pill--neutral')).not.toBeNull();
  });

  it('el calendario agrupa por mes con las vencidas aparte y arriba, y enseña las 6 primeras', () => {
    mount(DATA);
    expect(Array.from(h.el.querySelectorAll('[data-list="calendar"] .reviews__month')).map(m => m.textContent?.trim())).toEqual(['Vencidas', 'Octubre de 2026', 'Diciembre de 2026', 'Enero de 2027', 'Marzo de 2027']);
    expect(ids('calendar')).toEqual(['i-cubierta', 'i-caldera', 'i-pci', 'i-piscina', 'i-grupo', 'i-ascensor']);
  });

  it('"Ver todos" amplía el calendario y "Ver menos" lo recoge; con 6 o menos no hay botón', () => {
    mount(DATA);
    const action = () => h.el.querySelectorAll('.section-card__action');
    expect(action()).toHaveLength(2); // "Ver calendario" y "Ver todos"
    (action()[1] as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(ids('calendar')).toHaveLength(7);
    expect(text(action()[1])).toContain('Ver menos');
    (action()[1] as HTMLButtonElement).click();
    h.fixture.detectChanges();
    expect(ids('calendar')).toHaveLength(6);

    h.fixture.destroy();
  });

  it('con pocas revisiones solo queda "Ver calendario"', () => {
    mount(DATA.slice(0, 3));
    expect(h.el.querySelectorAll('.section-card__action')).toHaveLength(1);
    expect(text(h.el.querySelector('.section-card__action'))).toContain('Ver calendario');
  });

  it('pulsar una revisión emite la instalación y "Ver calendario" emite openCalendar', () => {
    mount(DATA);
    const opened: string[] = [];
    const calendar = vi.fn();
    h.component.openAsset.subscribe(id => opened.push(id));
    h.component.openCalendar.subscribe(calendar);
    (h.el.querySelector('[data-list="next"] [data-review="i-pci"]') as HTMLButtonElement).click();
    (h.el.querySelector('.section-card__action') as HTMLButtonElement).click();
    expect(opened).toEqual(['a-pci']);
    expect(calendar).toHaveBeenCalledTimes(1);
  });

  it('sin revisiones pendientes lo dice en las dos tarjetas', () => {
    mount([]);
    expect(h.el.textContent).toContain('No hay revisiones pendientes');
    expect(h.el.textContent).toContain('No hay revisiones previstas');
  });
});
