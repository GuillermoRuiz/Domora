import { setupComponent } from '../../../core/testing/component-harness';
import { RequestInfoDialogComponent } from './request-info-dialog.component';

describe('RequestInfoDialogComponent', () => {
  function setup(inputs: Record<string, unknown> = {}) {
    const h = setupComponent(RequestInfoDialogComponent, {});
    for (const [name, value] of Object.entries(inputs)) h.fixture.componentRef.setInput(name, value);
    h.fixture.detectChanges();
    const sent: string[] = [];
    const closed: number[] = [];
    h.component.sent.subscribe((text) => sent.push(text));
    h.component.closed.subscribe(() => closed.push(1));
    return { h, sent, closed };
  }
  const submit = (h: ReturnType<typeof setup>['h']) => h.el.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));

  it('asks for the text before sending anything', () => {
    const { h, sent } = setup();
    submit(h);
    h.fixture.detectChanges();
    expect(sent).toEqual([]);
    expect(h.el.querySelector('[data-error="text"]')?.textContent).toContain('Escribe qué información necesitas');
  });

  it('sends the trimmed text', () => {
    const { h, sent } = setup();
    h.component.text.set('  ¿Desde cuándo gotea?  ');
    submit(h);
    expect(sent).toEqual(['¿Desde cuándo gotea?']);
  });

  it('warns when the issue already waits for an answer and shows the server error', () => {
    const { h } = setup({ alreadyWaiting: true, error: 'No se pudo.' });
    expect(h.el.querySelector('[data-already-waiting]')).not.toBeNull();
    expect(h.el.querySelector('[role="alert"]')?.textContent).toContain('No se pudo.');
  });

  it('does not send twice while busy, and closes from the cross', () => {
    const { h, sent, closed } = setup({ busy: true });
    h.component.text.set('x');
    submit(h);
    expect(sent).toEqual([]);
    h.el.querySelector<HTMLButtonElement>('.close-btn')!.click();
    expect(closed).toEqual([1]);
  });
});
