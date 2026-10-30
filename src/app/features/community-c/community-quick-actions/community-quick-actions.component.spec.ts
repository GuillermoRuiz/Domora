import { setupComponent, type ComponentHarness } from '../../../core/testing/component-harness';
import { CommunityQuickActionsComponent, type QuickAction } from './community-quick-actions.component';

describe('CommunityQuickActionsComponent', () => {
  let h: ComponentHarness<CommunityQuickActionsComponent>;

  function mount(actaAvailable: boolean): void {
    h = setupComponent(CommunityQuickActionsComponent);
    h.fixture.componentRef.setInput('actaAvailable', actaAvailable);
    h.fixture.detectChanges();
  }
  const quick = (id: string) => h.el.querySelector(`[data-quick="${id}"]`) as HTMLButtonElement;

  it('ofrece los cuatro accesos con su descripción', () => {
    mount(true);
    const text = (id: string) => quick(id).textContent?.replace(/\s+/g, ' ').trim();
    expect(text('issue')).toMatch(/Nueva incidencia\s?Comunica un problema/);
    expect(text('message')).toMatch(/Enviar mensaje\s?Contacta con tu administrador/);
    expect(text('receipts')).toMatch(/Ver recibos\s?Consulta tus pagos/);
    expect(text('acta')).toMatch(/Descargar acta\s?Última junta celebrada/);
  });

  it('cada acceso avisa de su acción', () => {
    mount(true);
    const runs: QuickAction[] = [];
    h.component.run.subscribe(a => runs.push(a));
    for (const id of ['issue', 'message', 'receipts', 'acta']) quick(id).click();
    expect(runs).toEqual(['issue', 'message', 'receipts', 'acta']);
  });

  it('sin acta firmada, «Descargar acta» está desactivado, lo dice y no avisa', () => {
    mount(false);
    expect(quick('acta').disabled).toBe(true);
    expect(quick('acta').textContent).toContain('Sin acta disponible');
    const runs: QuickAction[] = [];
    h.component.run.subscribe(a => runs.push(a));
    quick('acta').click();
    expect(runs).toEqual([]);
  });

  it('los demás accesos no dependen del acta', () => {
    mount(false);
    for (const id of ['issue', 'message', 'receipts']) expect(quick(id).disabled).toBe(false);
  });
});
