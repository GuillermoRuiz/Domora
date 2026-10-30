import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { AuthService } from './auth.service';
import { NavigationStatusService } from './navigation-status.service';
import { StateService } from './state.service';
import { API, makeUser } from './testing/data-service-harness';
import { settle } from './testing/component-harness';

describe('NavigationStatusService', () => {
  function setup(role: 'A' | 'B' | 'C' | null = 'B') {
    const user = signal(role ? makeUser({ role }) : null);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { currentUser: user } },
      ],
    });
    TestBed.inject(NavigationStatusService);
    TestBed.tick();
    return {
      user,
      state: TestBed.inject(StateService),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('sin sesión no consulta la API', () => {
    const { state, http } = setup(null);
    http.expectNone(() => true);
    expect(state.unreadMessagesCount()).toBe(0);
    expect(state.recentAlerts()).toEqual([]);
  });

  it('carga solo los contadores compartidos durante bootstrap', async () => {
    const { state, http } = setup();
    TestBed.inject(NavigationStatusService);
    http
      .expectOne(`${API}/notifications/summary`)
      .flush({ unreadMessages: 4, unreadNotifications: 7, pendingTasks: 2 });
    await settle();
    expect(state.unreadMessagesCount()).toBe(4);
    expect(state.notificationsCount()).toBe(7);
    expect(state.recentAlerts()).toEqual([]);
    http.expectNone(`${API}/alerts`);
    http.expectNone(`${API}/direct-messages/conversations`);
    http.expectNone(`${API}/estates`);
    http.verify();
  });

  it('la invalidación refresca contadores sin descargar el feed', async () => {
    const { state, http } = setup();
    http
      .expectOne(`${API}/notifications/summary`)
      .flush({ unreadMessages: 3, unreadNotifications: 0 });
    await settle();
    state.bumpNotifications();
    TestBed.tick();
    http
      .expectOne(`${API}/notifications/summary`)
      .flush({ unreadMessages: 0, unreadNotifications: 0 });
    await settle();
    expect(state.unreadMessagesCount()).toBe(0);
    http.verify();
  });

  it('rol C carga sus contadores y alertas sin pedir nada más', async () => {
    const { state, http } = setup('C');
    http
      .expectOne(`${API}/notifications/summary`)
      .flush({ unreadMessages: 2, unreadNotifications: 1 });
    await settle();
    expect(state.unreadMessagesCount()).toBe(2);
    expect(state.notificationsCount()).toBe(1);
    http.verify();
  });

  it('rol A carga mensajes sin consultar un feed de alertas de otro rol', async () => {
    const { state, http } = setup('A');
    http
      .expectOne(`${API}/notifications/summary`)
      .flush({ unreadMessages: 2, unreadNotifications: 1 });
    await settle();
    expect(state.unreadMessagesCount()).toBe(2);
    http.expectNone(`${API}/alerts`);
    http.verify();
  });

  it('una respuesta anterior no restaura datos después de cerrar sesión', async () => {
    const { state, http, user } = setup();
    const summary = http.expectOne(`${API}/notifications/summary`);
    user.set(null);
    TestBed.tick();
    summary.flush({ unreadMessages: 8, unreadNotifications: 7 });
    await settle();
    expect(state.unreadMessagesCount()).toBe(0);
    expect(state.recentAlerts()).toEqual([]);
    http.verify();
  });

  it('un fallo del resumen no dispara una carga alternativa pesada', async () => {
    const { state, http } = setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    http
      .expectOne(`${API}/notifications/summary`)
      .flush({}, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(state.recentAlerts()).toEqual([]);
    http.expectNone(`${API}/alerts`);
    http.verify();
  });
});
