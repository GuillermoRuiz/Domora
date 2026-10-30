import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { API, setupComponent, settle, makeUser } from '../../core/testing/component-harness';
import { MensajesComponent } from './mensajes.component';
import type { ConversationSummary, DirectMessage } from '../../core/models';

const route = { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } };
const ME = makeUser().id;

const conversation = (overrides: Partial<ConversationSummary> = {}): ConversationSummary =>
  ({ id: 'c1', otherUserId: 'u2', otherDisplayName: 'Ana García', lastMessagePreview: 'Hola', lastMessageAt: '2026-01-01T10:00:00.000Z', unreadCount: 0, ...overrides });
const message = (overrides: Partial<DirectMessage> = {}): DirectMessage =>
  ({ id: 'm1', conversationId: 'c1', senderId: 'u2', text: 'Hola', createdAt: '2026-01-01T10:00:00.000Z', ...overrides });

/** Abre c1 con los mensajes dados y devuelve el entorno listo para actuar. */
async function openThread(messages: DirectMessage[], conversations: ConversationSummary[] = [conversation()]) {
  const env = setupComponent(MensajesComponent, { user: makeUser(), providers: [route] });
  const { fixture, http, el } = env;
  fixture.detectChanges();
  http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations`).flush(conversations);
  http.expectOne(`${API}/assistant/estates`).flush([{ id: 'e1', name: 'Residencial Sol' }]);
  await settle(); fixture.detectChanges();
  (el.querySelector('.conversation-row') as HTMLElement).click();
  http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations/c1/messages`).flush(messages);
  await settle(); fixture.detectChanges();
  return env;
}

const click = (el: HTMLElement, selector: string) => (el.querySelector(selector) as HTMLElement).click();
const buttonByText = (el: HTMLElement, text: string) => Array.from(el.querySelectorAll('button')).find(b => b.textContent?.includes(text)) as HTMLButtonElement;

describe('MensajesComponent — editar y borrar mensajes', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('solo los mensajes propios tienen el menú de tres puntos', async () => {
    const { el } = await openThread([message({ id: 'm1', senderId: 'u2' }), message({ id: 'm2', senderId: ME, text: 'Mío' })]);
    const rows = Array.from(el.querySelectorAll('.thread-message'));
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.message-actions')).toBeNull();
    expect(rows[1].querySelector('.message-actions')).not.toBeNull();
  });

  it('el menú ofrece exactamente editar y borrar', async () => {
    const { fixture, el } = await openThread([message({ id: 'm2', senderId: ME, text: 'Mío' })]);
    click(el, '.message-actions__toggle'); fixture.detectChanges();
    const items = Array.from(el.querySelectorAll('.message-menu [role="menuitem"]')).map(b => b.textContent?.trim());
    expect(items).toEqual(['Editar mensaje', 'Borrar mensaje']);
  });

  it('editar guarda el texto nuevo y marca el mensaje como «editado»', async () => {
    const { fixture, http, el } = await openThread([message({ id: 'm2', senderId: ME, text: 'Mañana' })]);
    click(el, '.message-actions__toggle'); fixture.detectChanges();
    buttonByText(el, 'Editar mensaje').click(); fixture.detectChanges();
    await settle(); fixture.detectChanges();

    const box = el.querySelector('.message-edit textarea') as HTMLTextAreaElement;
    expect(box.value).toBe('Mañana');
    box.value = 'Pasado mañana'; box.dispatchEvent(new Event('input')); fixture.detectChanges();
    buttonByText(el, 'Guardar').click();

    const req = http.expectOne((r: any) => r.url === `${API}/direct-messages/messages/m2` && r.method === 'PATCH');
    expect(req.request.body).toEqual({ text: 'Pasado mañana' });
    req.flush(message({ id: 'm2', senderId: ME, text: 'Pasado mañana', editedAt: '2026-01-01T11:00:00.000Z' }));
    await settle(); fixture.detectChanges();

    expect(el.querySelector('.message-edit')).toBeNull();
    expect(el.querySelector('.thread-message__bubble')!.textContent).toContain('Pasado mañana');
    expect(el.querySelector('.thread-message__edited')!.textContent).toContain('editado');
  });

  it('no deja guardar sin cambios y Escape cancela la edición', async () => {
    const { fixture, el } = await openThread([message({ id: 'm2', senderId: ME, text: 'Mañana' })]);
    click(el, '.message-actions__toggle'); fixture.detectChanges();
    buttonByText(el, 'Editar mensaje').click(); fixture.detectChanges();
    expect(buttonByText(el, 'Guardar').disabled).toBe(true);

    (el.querySelector('.message-edit textarea') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.message-edit')).toBeNull();
    expect(el.querySelector('.thread-message__bubble')!.textContent).toContain('Mañana');
  });

  it('borrar pide confirmación y deja «Este mensaje ha sido borrado» en cursiva sin menú', async () => {
    const { fixture, http, el } = await openThread([message({ id: 'm2', senderId: ME, text: 'Secreto' })]);
    click(el, '.message-actions__toggle'); fixture.detectChanges();
    buttonByText(el, 'Borrar mensaje').click(); fixture.detectChanges();
    expect(el.querySelector('.message-menu')!.textContent).toContain('¿Borrar este mensaje?');
    http.expectNone((r: any) => r.method === 'DELETE');

    (el.querySelector('.message-menu__buttons .message-menu__danger') as HTMLElement).click();
    const del = http.expectOne((r: any) => r.url === `${API}/direct-messages/messages/m2` && r.method === 'DELETE');
    del.flush({ id: 'm2', deletedAt: '2026-01-01T12:00:00.000Z' });
    await settle();
    http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations`).flush([conversation({ lastMessagePreview: 'Este mensaje ha sido borrado' })]);
    await settle(); fixture.detectChanges();

    const deleted = el.querySelector('.thread-message__deleted') as HTMLElement;
    expect(deleted.textContent).toContain('Este mensaje ha sido borrado');
    expect(getComputedStyle(deleted).fontStyle).toBe('italic');
    expect(el.querySelector('.thread-message .message-actions')).toBeNull();
    expect(el.textContent).not.toContain('Secreto');
    expect(el.querySelector('.conversation-row__preview--deleted')).not.toBeNull();
  });

  it('un fallo del servidor al borrar muestra el aviso y conserva el mensaje', async () => {
    const { fixture, http, el } = await openThread([message({ id: 'm2', senderId: ME, text: 'Sigo aquí' })]);
    click(el, '.message-actions__toggle'); fixture.detectChanges();
    buttonByText(el, 'Borrar mensaje').click(); fixture.detectChanges();
    (el.querySelector('.message-menu__buttons .message-menu__danger') as HTMLElement).click();
    http.expectOne((r: any) => r.method === 'DELETE').flush({}, { status: 500, statusText: 'Server Error' });
    await settle(); fixture.detectChanges();
    expect(el.querySelector('.notice--error')!.textContent).toContain('No se ha podido borrar');
    expect(el.querySelector('.thread-message__bubble')!.textContent).toContain('Sigo aquí');
  });

  it('los mensajes ya borrados llegan del servidor sin menú y sin texto', async () => {
    const { el } = await openThread([message({ id: 'm2', senderId: ME, text: '', deletedAt: '2026-01-01T12:00:00.000Z' })]);
    expect(el.querySelector('.thread-message__deleted')!.textContent).toContain('Este mensaje ha sido borrado');
    expect(el.querySelector('.message-actions')).toBeNull();
    expect(el.querySelector('.thread-message__edited')).toBeNull();
  });

  it('marca como leídos (doble check) solo los propios que el otro ya vio', async () => {
    const { el } = await openThread([message({ id: 'm1', senderId: ME, readByRecipient: true }), message({ id: 'm2', senderId: ME, readByRecipient: false })]);
    const status = Array.from(el.querySelectorAll('.thread-message__status'));
    expect(status[0].classList.contains('thread-message__status--read')).toBe(true);
    expect(status[1].classList.contains('thread-message__status--read')).toBe(false);
  });
});

describe('MensajesComponent — estrella y adjuntos', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('la lista no tiene asunto y marca con estrella las fijadas', async () => {
    const { fixture, el } = await openThread([], [conversation(), conversation({ id: 'c2', otherUserId: 'u3', otherDisplayName: 'Luis' })]);
    expect(el.textContent).not.toContain('Asunto');
    fixture.componentInstance.togglePin('c2'); fixture.detectChanges();
    expect(el.querySelectorAll('.pin-toggle--pinned')).toHaveLength(1);
  });

  it('un contacto nuevo no pide asunto: se envía solo el destinatario y el texto', async () => {
    const env = setupComponent(MensajesComponent, { user: makeUser(), providers: [route] });
    const { fixture, http, el } = env;
    fixture.detectChanges();
    http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations`).flush([]);
    http.expectOne(`${API}/assistant/estates`).flush([{ id: 'e1', name: 'Residencial Sol' }]);
    await settle(); fixture.detectChanges();
    fixture.componentInstance.startConversationWith({ userId: 'u9', displayName: 'Nuevo Contacto', estateId: 'e1' });
    fixture.detectChanges();

    expect(el.querySelector('input[aria-label="Asunto"]')).toBeNull();
    const text = el.querySelector('.thread-composer textarea') as HTMLTextAreaElement;
    text.value = 'Hola'; text.dispatchEvent(new Event('input')); fixture.detectChanges();
    buttonByText(el, 'Enviar mensaje').click();

    const req = http.expectOne((r: any) => r.url === `${API}/direct-messages/messages` && r.method === 'POST');
    expect(req.request.body).toEqual({ recipientUserId: 'u9', text: 'Hola' });
  });

  it('al elegir un contacto con una conversación eliminada, su historial se muestra antes de escribir', async () => {
    const env = setupComponent(MensajesComponent, { user: makeUser(), providers: [route] });
    const { fixture, http, el } = env;
    fixture.detectChanges();
    http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations`).flush([]);
    http.expectOne(`${API}/assistant/estates`).flush([{ id: 'e1', name: 'Residencial Sol' }]);
    await settle(); fixture.detectChanges();

    fixture.componentInstance.startConversationWith({ userId: 'u9', displayName: 'Nuevo Contacto', estateId: 'e1', conversationId: 'old1' });
    http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations/old1/messages`)
      .flush([message({ id: 'h1', conversationId: 'old1', text: 'Mensaje de la conversación eliminada' })]);
    await settle(); fixture.detectChanges();

    expect(el.textContent).toContain('Mensaje de la conversación eliminada');
    expect(el.textContent).not.toContain('Escribe el primer mensaje');
    expect(el.querySelector('button[aria-label="Opciones de la conversación"]')).toBeNull();

    const text = el.querySelector('.thread-composer textarea') as HTMLTextAreaElement;
    text.value = 'Retomamos'; text.dispatchEvent(new Event('input')); fixture.detectChanges();
    buttonByText(el, 'Enviar mensaje').click();
    const req = http.expectOne((r: any) => r.url === `${API}/direct-messages/messages` && r.method === 'POST');
    expect(req.request.body).toEqual({ conversationId: 'old1', text: 'Retomamos' });
  });

  it('el campo de escribir ofrece un único botón para adjuntar archivos', async () => {
    const { el } = await openThread([]);
    const labels = Array.from(el.querySelectorAll('.composer-tools button')).map(b => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Adjuntar archivos']);
  });

  it('un mensaje que no cabe en 10 líneas ofrece «Leer más» y al pulsarlo se despliega', async () => {
    const { fixture, el } = await openThread([message({ id: 'long', text: 'texto largo '.repeat(200) })]);
    expect(el.querySelector('.thread-message__more')).toBeNull();

    fixture.componentInstance.setOverflow('long', true); fixture.detectChanges();
    expect(el.querySelector('.thread-message__text--clamped')).not.toBeNull();
    click(el, '.thread-message__more'); fixture.detectChanges();

    expect(el.querySelector('.thread-message__more')).toBeNull();
    expect(el.querySelector('.thread-message__text--clamped')).toBeNull();
  });

  it('eliminar la conversación pide confirmación, la quita de la lista y cierra el hilo', async () => {
    const { fixture, http, el } = await openThread([message()], [conversation(), conversation({ id: 'c2', otherUserId: 'u3', otherDisplayName: 'Luis Pérez' })]);
    click(el, 'button[aria-label="Opciones de la conversación"]'); fixture.detectChanges();
    click(el, '.thread-options__danger'); fixture.detectChanges();
    expect(el.textContent).toContain('¿Eliminar esta conversación?');
    expect(http.match(r => r.method === 'DELETE')).toHaveLength(0);

    buttonByText(el, 'Eliminar').click();
    http.expectOne(r => r.method === 'DELETE' && r.url === `${API}/direct-messages/conversations/c1`).flush(null);
    await settle(); fixture.detectChanges();

    const names = Array.from(el.querySelectorAll('.conversation-row__name')).map(n => n.textContent?.trim());
    expect(names).toContain('Luis Pérez');
    expect(names).not.toContain('Ana García');
    expect(fixture.componentInstance.activeConversationId()).toBeNull();
  });

  it('cancelar la confirmación no elimina nada', async () => {
    const { fixture, http, el } = await openThread([message()]);
    click(el, 'button[aria-label="Opciones de la conversación"]'); fixture.detectChanges();
    click(el, '.thread-options__danger'); fixture.detectChanges();
    buttonByText(el, 'Cancelar').click(); fixture.detectChanges();
    expect(http.match(r => r.method === 'DELETE')).toHaveLength(0);
    expect(el.querySelectorAll('.conversation-row').length).toBe(1);
  });

  it('un mensaje corto no muestra «Leer más»', async () => {
    const { fixture, el } = await openThread([message({ id: 'short', text: 'Hola' })]);
    fixture.componentInstance.setOverflow('short', false); fixture.detectChanges();
    expect(el.querySelector('.thread-message__more')).toBeNull();
  });
});
