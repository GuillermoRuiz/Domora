import { API, makeUser, setupComponent, settle } from '../../../core/testing/component-harness';
import { InformRequesterDialogComponent } from './inform-requester-dialog.component';

describe('InformRequesterDialogComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  async function setup() {
    const h = setupComponent(InformRequesterDialogComponent, { user: makeUser() });
    h.fixture.componentRef.setInput('issueId', 'i1');
    h.fixture.detectChanges();
    await settle();
    return h;
  }
  const choose = async (h: Awaited<ReturnType<typeof setup>>, value: string) => {
    const select = h.el.querySelector<HTMLSelectElement>('select[aria-label="Mensaje"]')!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    h.fixture.detectChanges();
    await settle();
  };

  it('offers the messages in a dropdown, not as cards, with free text as the last option', async () => {
    const h = await setup();
    const select = h.el.querySelector<HTMLSelectElement>('select[aria-label="Mensaje"]')!;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
      'Hemos contactado con el tercero',
      'Seguimos esperando su respuesta',
      'La incidencia está resuelta',
      'Escribir un mensaje',
    ]);
    expect(h.el.querySelector('.ir-option')).toBeNull();
    expect(h.el.querySelector('[data-field="custom-text"]')).toBeNull();
  });

  it('asks for the text, previews it exactly and sends it as the custom template', async () => {
    const h = await setup();
    const sent: unknown[] = [];
    h.component.submitted.subscribe((body) => sent.push(body));
    await choose(h, 'custom');
    const area = h.el.querySelector<HTMLTextAreaElement>('[data-field="custom-text"]')!;
    expect(area).not.toBeNull();
    expect(h.el.querySelector('input[aria-label="Tercero"]')).toBeNull();
    // Sin texto no se pide ninguna vista previa ni se envía.
    h.http.expectNone(`${API}/issues/i1/requester-notices/preview`);
    area.value = 'Mañana pasa el técnico.';
    area.dispatchEvent(new Event('input'));
    h.fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 320));
    const preview = h.http.expectOne(`${API}/issues/i1/requester-notices/preview`);
    expect(preview.request.body).toEqual({ template: 'custom', text: 'Mañana pasa el técnico.' });
    preview.flush({ title: 'Mensaje sobre tu incidencia', body: 'Mañana pasa el técnico.' });
    await settle();
    h.fixture.detectChanges();
    expect(h.el.querySelector('[data-testid="notice-preview"]')?.textContent).toContain('Mañana pasa el técnico.');
    expect(h.el.querySelector('.ir-count')?.textContent?.trim()).toBe('23/500');
    h.component.submit();
    expect(sent).toEqual([
      expect.objectContaining({ effects: [{ type: 'inform_requester', template: 'custom', text: 'Mañana pasa el técnico.' }] }),
    ]);
    h.http.verify();
  });

  it('does not send an empty message', async () => {
    const h = await setup();
    const sent: unknown[] = [];
    h.component.submitted.subscribe((body) => sent.push(body));
    await choose(h, 'custom');
    h.component.submit();
    h.fixture.detectChanges();
    expect(sent).toEqual([]);
    expect(h.el.querySelector('.ir-problems')?.textContent).toContain('Escribe el mensaje que se enviará.');
  });
});
