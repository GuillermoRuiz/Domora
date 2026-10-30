import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { API, setupComponent, settle, makeUser } from '../../core/testing/component-harness';
import { MensajesComponent } from './mensajes.component';
import type { ConversationSummary, DirectMessage, DirectMessageContact } from '../../core/models';

function withRoute(withUserId: string | null = null) {
  return { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(withUserId ? { with: withUserId } : {}) } } };
}

function makeConversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return { id: 'c1', otherUserId: 'u2', otherDisplayName: 'Ana García', lastMessagePreview: 'Hola', lastMessageAt: '2026-01-01', unreadCount: 0, ...overrides };
}

function makeMessage(overrides: Partial<DirectMessage> = {}): DirectMessage {
  return { id: 'm1', conversationId: 'c1', senderId: 'u2', text: 'Hola', createdAt: '2026-01-01T10:00:00.000Z', ...overrides };
}

function makeContact(overrides: Partial<DirectMessageContact> = {}): DirectMessageContact {
  return { userId: 'u2', displayName: 'Ana García', estateId: 'e1', ...overrides };
}

async function flushInitial(http: any, conversations: ConversationSummary[]): Promise<void> {
  http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations`).flush(conversations);
  http.expectOne(`${API}/assistant/estates`).flush([{ id: 'e1', name: 'Residencial Sol' }, { id: 'e2', name: 'Edificio Luna' }]);
  await settle();
}

describe('MensajesComponent', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());
  it('sin conversaciones, muestra el estado vacío tras cargar', async () => {
    const { fixture, http, el } = setupComponent(MensajesComponent, { user: makeUser(), providers: [withRoute()] });
    fixture.detectChanges();
    expect(el.textContent).toContain('Cargando');
    await flushInitial(http, []);
    fixture.detectChanges();

    expect(el.textContent).toContain('Todavía no tienes conversaciones');
  });

  it('pinta la lista de conversaciones con su badge de no leídos', async () => {
    const { fixture, http, el } = setupComponent(MensajesComponent, { user: makeUser(), providers: [withRoute()] });
    fixture.detectChanges();
    await flushInitial(http, [makeConversation({ id: 'c1', otherDisplayName: 'Ana García', unreadCount: 3 })]);
    fixture.detectChanges();

    expect(el.querySelectorAll('.conversation-row')).toHaveLength(1);
    expect(el.querySelector('.conversation-row app-badge .badge')?.textContent?.trim()).toBe('3');
  });

  it('abrir una conversación con no leídos carga sus mensajes y los marca como leídos', async () => {
    const { fixture, http, el } = setupComponent(MensajesComponent, { user: makeUser(), providers: [withRoute()] });
    fixture.detectChanges();
    await flushInitial(http, [makeConversation({ id: 'c1', unreadCount: 2 })]);
    fixture.detectChanges();

    (el.querySelector('.conversation-row') as HTMLElement).click();
    http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations/c1/messages`).flush([makeMessage()]);
    await settle();
    const readReq = http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations/c1/read` && r.method === 'PATCH');
    readReq.flush(null);
    await settle();
    fixture.detectChanges();

    expect(el.querySelectorAll('.thread-message')).toHaveLength(1);
    expect(el.querySelector('.conversation-row app-badge')).toBeNull();
  });

  it('enviar un mensaje en una conversación activa limpia el campo y recarga hilo + lista', async () => {
    const { fixture, http, el } = setupComponent(MensajesComponent, { user: makeUser(), providers: [withRoute()] });
    fixture.detectChanges();
    await flushInitial(http, [makeConversation({ id: 'c1', unreadCount: 0 })]);
    fixture.detectChanges();
    (el.querySelector('.conversation-row') as HTMLElement).click();
    http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations/c1/messages`).flush([]);
    await settle();
    fixture.detectChanges();

    const input = el.querySelector('.thread-composer textarea') as HTMLTextAreaElement;
    input.value = 'Buenas tardes';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (Array.from(el.querySelectorAll('.thread-composer button')).find((b) => b.textContent?.includes('Enviar mensaje')) as HTMLButtonElement).click();

    const sendReq = http.expectOne((r: any) => r.url === `${API}/direct-messages/messages` && r.method === 'POST');
    expect(sendReq.request.body).toEqual({ conversationId: 'c1', text: 'Buenas tardes' });
    sendReq.flush(makeMessage({ id: 'm2', text: 'Buenas tardes', senderId: 'u1' }));
    await settle();
    http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations`).flush([makeConversation({ id: 'c1' })]);
    http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations/c1/messages`).flush([makeMessage({ id: 'm2', text: 'Buenas tardes', senderId: 'u1' })]);
    await settle();
    fixture.detectChanges();

    expect((el.querySelector('.thread-composer textarea') as HTMLTextAreaElement).value).toBe('');
  });

  describe('nuevo mensaje (compose)', () => {
    it('abre la lista de contactos y filtra por nombre', async () => {
      const { fixture, http, el } = setupComponent(MensajesComponent, { user: makeUser(), providers: [withRoute()] });
      fixture.detectChanges();
      await flushInitial(http, []);
      fixture.detectChanges();

      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Nuevo mensaje')) as HTMLElement).click();
      http.expectOne((r: any) => r.url === `${API}/direct-messages/contacts`).flush([
        makeContact({ userId: 'u2', displayName: 'Ana García' }),
        makeContact({ userId: 'u3', displayName: 'Luis Pérez' }),
      ]);
      await settle();
      fixture.detectChanges();

      expect(el.querySelectorAll('.contact-row')).toHaveLength(2);

      const searchInput = el.querySelector('.modal input') as HTMLInputElement;
      searchInput.value = 'luis';
      searchInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(el.querySelectorAll('.contact-row')).toHaveLength(1);
    });

    it('elegir un contacto sin conversación previa deja el hilo listo para el primer mensaje', async () => {
      const { fixture, http, el } = setupComponent(MensajesComponent, { user: makeUser(), providers: [withRoute()] });
      fixture.detectChanges();
      await flushInitial(http, []);
      fixture.detectChanges();
      (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Nuevo mensaje')) as HTMLElement).click();
      http.expectOne((r: any) => r.url === `${API}/direct-messages/contacts`).flush([makeContact({ userId: 'u9', displayName: 'Nuevo Contacto' })]);
      await settle();
      fixture.detectChanges();

      (el.querySelector('.contact-row') as HTMLElement).click();
      fixture.detectChanges();

      expect(el.querySelector('.modal-backdrop')).toBeNull();
      expect(el.textContent).toContain('Escribe el primer mensaje para iniciar la conversación');
      expect(el.textContent).toContain('Nuevo Contacto');
    });
  });

  it('el query param ?with= abre directamente la conversación existente con ese usuario', async () => {
    const { fixture, http, el } = setupComponent(MensajesComponent, { user: makeUser(), providers: [withRoute('u2')] });
    fixture.detectChanges();
    await flushInitial(http, [makeConversation({ id: 'c1', otherUserId: 'u2', unreadCount: 0 })]);
    http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations/c1/messages`).flush([]);
    await settle();
    fixture.detectChanges();

    expect(el.querySelector('.conversation-row--active')).not.toBeNull();
  });

  it('ngOnDestroy cancela el polling — no dispara más peticiones tras destruir el componente', async () => {
    vi.useFakeTimers();
    try {
      const { fixture, http } = setupComponent(MensajesComponent, { user: makeUser(), providers: [withRoute()] });
      fixture.detectChanges();
      http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations`).flush([]);
      http.expectOne(`${API}/assistant/estates`).flush([{ id: 'e1', name: 'Residencial Sol' }]);
      await vi.advanceTimersByTimeAsync(0);

      await vi.advanceTimersByTimeAsync(15000);
      http.expectOne((r: any) => r.url === `${API}/direct-messages/conversations`).flush([]);
      await vi.advanceTimersByTimeAsync(0);

      fixture.destroy();

      await vi.advanceTimersByTimeAsync(30000);
      http.expectNone((r: any) => r.url === `${API}/direct-messages/conversations`);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MensajesComponent — Domo', () => {
  it('muestra a Domo fijo arriba y su hilo usa el asistente (no la mensajería directa)', async () => {
    const { fixture, http, el } = setupComponent(MensajesComponent, { user: makeUser(), providers: [withRoute()] });
    fixture.detectChanges();
    await flushInitial(http, []);
    fixture.detectChanges();

    const domo = el.querySelector('.domo-row') as HTMLElement;
    expect(domo.textContent).toContain('Domo');

    fixture.componentInstance.selectedEstateId.set('e1');
    await fixture.componentInstance.openDomo();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();

    expect(el.querySelector('app-assistant-chat')).not.toBeNull();
    expect(el.textContent).toContain('Soy Domo');
    expect(el.querySelector('app-assistant-chat app-dropdown')).toBeNull();
    expect((el.querySelector('.topbar select[aria-label="Comunidad"]') as HTMLSelectElement).value).toBe('e1');
  });
});
