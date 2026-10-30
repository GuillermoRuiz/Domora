import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import { ReportTableComponent } from './report-table.component';

describe('ReportTableComponent', () => {
  let h: ComponentHarness<ReportTableComponent>;

  beforeEach(() => {
    h = setupComponent(ReportTableComponent);
  });

  it('formatea las columnas de dinero en euros y respeta el resto tal cual', () => {
    h.component.sections = [{
      title: 'Activo',
      columns: [
        { key: 'code', header: 'Cuenta' },
        { key: 'amount', header: 'Importe', money: true },
      ],
      rows: [{ code: '572', amount: 234.5 }],
      totals: { code: '', amount: 234.5 },
    }];
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Activo');
    expect(h.el.textContent).toContain('572');
    expect(h.el.textContent).toContain('234,50 €');
  });

  it('sin filas, muestra el mensaje de vacío en vez de la fila de totales', () => {
    h.component.sections = [{
      columns: [{ key: 'code', header: 'Cuenta' }],
      rows: [],
      totals: { code: 'Totales' },
      empty: 'Sin movimientos en el periodo.',
    }];
    h.fixture.detectChanges();
    expect(h.el.textContent).toContain('Sin movimientos en el periodo.');
    expect(h.el.textContent).not.toContain('Totales');
  });
});
