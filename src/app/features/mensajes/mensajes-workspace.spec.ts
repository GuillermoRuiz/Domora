import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { API, setupComponent, settle, makeUser } from '../../core/testing/component-harness';
import { MensajesComponent } from './mensajes.component';
import type { ConversationSummary } from '../../core/models';

const ESTATES = [{ id: 'e1', name: 'Residencial Sol' }, { id: 'e2', name: 'Edificio Luna' }];
function row(id = 'c1', estateId = 'e1'): ConversationSummary {
  return { id, otherUserId: 'u2', otherDisplayName: 'María García', lastMessageAt: '2026-10-17T12:00:00Z', lastMessagePreview: 'Ascensor averiado', unreadCount: 0, estateId };
}
async function mount() {
  const h = setupComponent(MensajesComponent, { user: makeUser(), providers: [{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } }] });
  h.fixture.detectChanges();
  h.http.expectOne(`${API}/assistant/estates`).flush(ESTATES);
  h.http.expectOne(`${API}/direct-messages/conversations`).flush([row()]);
  await settle(); h.fixture.detectChanges();
  return h;
}
async function openThread(h: Awaited<ReturnType<typeof mount>>) {
  void h.component.openConversation(row());
  h.http.expectOne(`${API}/direct-messages/conversations/c1/messages`).flush([]);
  await settle(); h.fixture.detectChanges();
}

describe('Mensajes: bandeja y adjuntos', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('el selector de la cabecera consulta la comunidad elegida y descarta respuestas antiguas', async () => {
    const h = await mount();
    const first = h.component.changeEstate('e1');
    const request1 = h.http.expectOne(r => r.url === `${API}/direct-messages/conversations` && r.params.get('estateId') === 'e1');
    const second = h.component.changeEstate('e2');
    h.http.expectOne(r => r.url === `${API}/direct-messages/conversations` && r.params.get('estateId') === 'e2').flush([row('second', 'e2')]);
    await second;
    request1.flush([row('first', 'e1')]); await first; h.fixture.detectChanges();
    await settle(); h.fixture.detectChanges();
    expect(h.component.conversations().map(c => c.id)).toEqual(['second']);
    expect((h.el.querySelector('.topbar select[aria-label="Comunidad"]') as HTMLSelectElement).value).toBe('e2');
  });

  it('mantiene búsqueda y no leídos como filtros independientes', async () => {
    const h = await mount();
    h.component.setFilter('search', 'MARIA'); h.fixture.detectChanges();
    expect(h.el.querySelectorAll('.conversation-row')).toHaveLength(1);
    h.component.setFilter('unreadOnly', true); h.fixture.detectChanges();
    expect(h.el.querySelectorAll('.conversation-row')).toHaveLength(0);
    expect(h.el.textContent).toContain('No hay coincidencias');
  });

  it('un envío con archivos usa multipart y conserva el borrador si el servidor falla', async () => {
    const h = await mount(); await openThread(h);
    const file = new File(['contenido'], 'acta.pdf', { type: 'application/pdf' });
    h.component.messageText.set('Adjunto el acta'); h.component.draftFiles.set([file]);
    const sending = h.component.sendMessage();
    const request = h.http.expectOne(`${API}/direct-messages/messages/with-attachments`);
    expect(request.request.body).toBeInstanceOf(FormData);
    expect((request.request.body as FormData).get('conversationId')).toBe('c1');
    expect((request.request.body as FormData).getAll('files')).toHaveLength(1);
    request.flush({}, { status: 500, statusText: 'Server Error' }); await sending;
    expect(h.component.messageText()).toBe('Adjunto el acta'); expect(h.component.draftFiles()).toEqual([file]);
    expect(h.component.error()).toContain('reintentarlo');
  });

  it('permite enviar un archivo sin texto y pinta el adjunto descargable', async () => {
    const h = await mount(); await openThread(h);
    h.component.draftFiles.set([new File(['pdf'], 'acta.pdf', { type: 'application/pdf' })]);
    const sending = h.component.sendMessage();
    const message = { id: 'm1', conversationId: 'c1', senderId: makeUser().id, text: '', createdAt: new Date().toISOString(), attachments: [{ id: 'a1', name: 'acta.pdf', mimeType: 'application/pdf', sizeBytes: 3 }] };
    h.http.expectOne(`${API}/direct-messages/messages/with-attachments`).flush(message);
    await settle();
    h.http.expectOne(`${API}/direct-messages/conversations`).flush([row()]);
    h.http.expectOne(`${API}/direct-messages/conversations/c1/messages`).flush([message]);
    await sending; h.fixture.detectChanges();
    expect(h.component.draftFiles()).toEqual([]);
    expect(h.el.querySelector('[aria-label="Descargar acta.pdf"]')).not.toBeNull();
  });

  it('Mayús+Enter no envía y volver a la lista cierra el hilo móvil', async () => {
    const h = await mount(); await openThread(h);
    h.component.messageText.set('Texto');
    h.component.onComposerKeydown(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }));
    h.http.expectNone(`${API}/direct-messages/messages`);
    h.component.backToList(); h.fixture.detectChanges();
    expect(h.el.querySelector('.messages-layout--thread-open')).toBeNull();
  });
});
