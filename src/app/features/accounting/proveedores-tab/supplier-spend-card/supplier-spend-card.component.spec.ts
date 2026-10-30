import { setupComponent, type ComponentHarness } from '../../../../core/testing/component-harness';
import type { Supplier } from '../../../../core/models';
import { SupplierSpendCardComponent } from './supplier-spend-card.component';

function supplier(id: string, name: string, ytdSpend: number, category = 'Mantenimiento'): Supplier {
  return {
    id, administratorId: 'a1', estateId: 'e1', name, category, status: 'Activo',
    lastInvoice: '2026-01-01', lastAmount: 0, ytdSpend, pendingInvoices: 0, hasExpiringSoon: false,
  };
}

describe('SupplierSpendCardComponent', () => {
  let h: ComponentHarness<SupplierSpendCardComponent>;

  function mount(suppliers: Supplier[]): void {
    h = setupComponent(SupplierSpendCardComponent);
    h.fixture.componentRef.setInput('suppliers', suppliers);
    h.fixture.detectChanges();
  }
  const rows = () => Array.from(h.el.querySelectorAll('[data-supplier]'));
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('ordena de mayor a menor gasto, con importe, porcentaje y categoría', () => {
    mount([supplier('s1', 'Limpiezas Turia', 1000, 'Limpieza'), supplier('s2', 'Ascensores Levante', 3000, 'Ascensores')]);
    expect(rows().map((r) => r.getAttribute('data-supplier'))).toEqual(['s2', 's1']);
    expect(text(rows()[0])).toMatch(/Ascensores Levante\s?3\.000\s?€\s?75 %\s?Ascensores/);
    expect(text(rows()[1])).toMatch(/Limpiezas Turia\s?1\.000\s?€\s?25 %\s?Limpieza/);
    expect(text(h.el.querySelector('.spend__total'))).toMatch(/Total facturado: 4\.000\s?€/);
  });

  it('la barra mayor ocupa el 100 % y las demás son proporcionales', () => {
    mount([supplier('s1', 'A', 1000), supplier('s2', 'B', 4000)]);
    const widths = Array.from(h.el.querySelectorAll<HTMLElement>('.spend__bar')).map((b) => b.style.width);
    expect(widths).toEqual(['100%', '25%']);
  });

  it('muestra los 5 mayores y pliega el resto en "Otros (n)"', () => {
    mount([1, 2, 3, 4, 5, 6, 7].map((n) => supplier(`s${n}`, `Prov ${n}`, n * 100)));
    expect(rows()).toHaveLength(6);
    expect(rows().map((r) => r.getAttribute('data-supplier'))).toEqual(['s7', 's6', 's5', 's4', 's3', 'others']);
    expect(text(rows()[5])).toMatch(/Otros \(2\)\s?300\s?€\s?11 %/); // 100 + 200 de 2.800
  });

  it('ignora a los proveedores sin gasto este año', () => {
    mount([supplier('s1', 'Con gasto', 500), supplier('s2', 'Sin gasto', 0)]);
    expect(rows().map((r) => r.getAttribute('data-supplier'))).toEqual(['s1']);
  });

  it('sin gasto muestra el estado vacío con el año', () => {
    mount([supplier('s1', 'Sin gasto', 0)]);
    expect(rows()).toHaveLength(0);
    expect(h.el.querySelector('.spend__empty')?.textContent).toContain(`${new Date().getFullYear()}`);
  });

  it('pulsar un proveedor emite su id; "Otros" no es pulsable', () => {
    mount([1, 2, 3, 4, 5, 6].map((n) => supplier(`s${n}`, `Prov ${n}`, n * 100)));
    const selected: string[] = [];
    h.component.selectSupplier.subscribe((id) => selected.push(id));
    (rows()[0].querySelector('.spend__name--link') as HTMLButtonElement).click();
    expect(selected).toEqual(['s6']);
    expect(rows()[5].querySelector('button')).toBeNull();
  });
});
