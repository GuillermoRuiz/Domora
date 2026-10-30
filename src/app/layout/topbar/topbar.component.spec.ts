import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { API, setupComponent, makeUser, settle } from '../../core/testing/component-harness';
import { StateService } from '../../core/state.service';
import { TopbarComponent } from './topbar.component';
import type { AlertItem } from '../../core/models';

function makeAlert(overrides: Partial<AlertItem> = {}): AlertItem {
  return {
    id: 'a1', sourceType: 'issue', sourceId: 'i1', userId: 'u1', type: 'pago',
    title: 'Recibo pendiente', description: 'Cuota de marzo', date: '2026-01-01', urgent: false, read: false,
    ...overrides,
  };
}

describe('TopbarComponent', () => {
  it('tracks responsive borders and notices without changing on scroll, and releases observers', async () => {
    let notifyResize = () => {};
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback; }
      observe = observe; unobserve = unobserve; disconnect = disconnect;
    });
    const h = setupComponent(TopbarComponent, { user: makeUser() });
    const shell = document.createElement('div'); shell.className = 'app-shell';
    const main = document.createElement('main'); main.className = 'app-main';
    shell.append(main); main.append(h.el); document.body.append(shell);
    let noticeHeight = 0;
    let headerHeight = 64;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('app-shell')) return new DOMRect(0, 20, 840, 1000);
      if (this.classList.contains('app-main')) return new DOMRect(240, 20, 600, 1000);
      if (this.classList.contains('subscription-banner')) return new DOMRect(240, 20, 600, noticeHeight);
      if (this.classList.contains('topbar')) return new DOMRect(240, 20 + noticeHeight, 600, headerHeight);
      return new DOMRect();
    });
    const size = () => shell.style.getPropertyValue('--shell-header-bottom');
    try {
      h.fixture.detectChanges(); TestBed.tick();
      expect(size()).toBe('64px');
      headerHeight = 157; notifyResize();
      expect(size()).toBe('157px');
      const banner = document.createElement('div'); banner.className = 'subscription-banner';
      noticeHeight = 40; main.prepend(banner); await settle();
      expect(observe).toHaveBeenCalledWith(banner);
      expect(size()).toBe('197px');
      noticeHeight = 60; notifyResize();
      expect(size()).toBe('217px');
      noticeHeight = 0; banner.remove(); await settle();
      expect(unobserve).toHaveBeenCalledWith(banner);
      expect(size()).toBe('157px');
      main.scrollTop = 300; notifyResize();
      expect(size()).toBe('157px');
      const header = h.el.querySelector<HTMLElement>('.topbar')!;
      expect(header.style.top).toBe('20px');
      expect(header.style.left).toBe('240px');
      h.fixture.destroy();
      expect(disconnect).toHaveBeenCalledOnce();
      noticeHeight = 40; main.prepend(banner); await settle();
      expect(size()).toBe('157px');
    } finally {
      h.fixture.destroy(); shell.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks();
    }
  });

  for (const role of ['A', 'B', 'C'] as const) {
    it(`rol ${role}: Mensajes usa send y abre su ruta existente`, () => {
      const { fixture, el } = setupComponent(TopbarComponent, { user: makeUser({ role }) });
      fixture.detectChanges();
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const messages = el.querySelector('.topbar__messages') as HTMLButtonElement;
      expect(messages?.querySelector('app-icon')?.getAttribute('name')).toBe('send');
      messages.click();
      expect(navigate).toHaveBeenCalledWith([`/${role.toLowerCase()}/messages`]);
      const actions = Array.from(el.querySelector('.topbar__right')!.children);
      expect(actions.indexOf(messages)).toBeLessThan(actions.findIndex(action => action.classList.contains('bell-wrap')));
      expect(el.querySelector('app-account-menu app-avatar')).not.toBeNull();
    });
  }

  it('muestra el contador de mensajes del estado compartido sin pedir datos por pantalla', () => {
    const { fixture, el, http } = setupComponent(TopbarComponent, { user: makeUser() });
    TestBed.inject(StateService).unreadMessagesCount.set(4); fixture.detectChanges();
    expect(el.querySelector('.topbar__messages app-badge')?.textContent?.trim()).toBe('4');
    TestBed.inject(StateService).unreadMessagesCount.set(0); fixture.detectChanges();
    expect(el.querySelector('.topbar__messages app-badge')).toBeNull();
    http.expectNone(() => true);
  });
  it('pinta el título y sin breadcrumb no pinta la navegación de migas', () => {
    const { fixture, component, el } = setupComponent(TopbarComponent);
    component.title = 'Fincas';
    fixture.detectChanges();

    expect(el.querySelector('.topbar__title')?.textContent?.trim()).toBe('Fincas');
    expect(el.querySelector('.topbar__breadcrumb')).toBeNull();
  });

  it('con breadcrumb, pinta cada miga y un separador entre ellas (pero no tras la última)', () => {
    const { fixture, component, el } = setupComponent(TopbarComponent);
    component.title = 'Detalle';
    component.breadcrumb = ['Fincas', 'Edificio Sol'];
    fixture.detectChanges();

    const crumbs = el.querySelectorAll('.topbar__crumb');
    expect(crumbs).toHaveLength(2);
    expect(crumbs[0].textContent).toBe('Fincas');
    expect(crumbs[1].textContent).toBe('Edificio Sol');
    // Un separador entre las 2 migas, ninguno después de la última.
    expect(el.querySelectorAll('.topbar__breadcrumb app-icon')).toHaveLength(1);
  });

  it('sin alertas recientes, la campana no muestra el punto rojo', () => {
    const { fixture, el } = setupComponent(TopbarComponent);
    TestBed.inject(StateService).recentAlerts.set([]);
    fixture.detectChanges();

    expect(el.querySelector('.topbar__bell-dot')).toBeNull();
  });

  it('con alertas recientes SIN LEER, la campana muestra el punto rojo', () => {
    const { fixture, el } = setupComponent(TopbarComponent);
    TestBed.inject(StateService).recentAlerts.set([makeAlert({ read: false })]);
    fixture.detectChanges();

    expect(el.querySelector('.topbar__bell-dot')).not.toBeNull();
  });

  it('con alertas recientes pero TODAS LEÍDAS, no muestra el punto (antes se encendía igual)', () => {
    const { fixture, el } = setupComponent(TopbarComponent);
    TestBed.inject(StateService).recentAlerts.set([makeAlert({ read: true }), makeAlert({ id: 'a2', read: true })]);
    fixture.detectChanges();

    expect(el.querySelector('.topbar__bell-dot')).toBeNull();
  });

  it('con alertas recientes (alguna sin leer), la campana muestra el punto rojo', () => {
    const { fixture, el } = setupComponent(TopbarComponent);
    TestBed.inject(StateService).recentAlerts.set([makeAlert()]);
    fixture.detectChanges();

    expect(el.querySelector('.topbar__bell-dot')).not.toBeNull();
  });

  describe('dropdown de notificaciones', () => {
    it('carga como máximo las 6 recientes solo al abrir la campana', async () => {
      const { fixture, el, http } = setupComponent(TopbarComponent, {
        user: makeUser({ role: 'B' }),
      });
      fixture.detectChanges();
      http.expectNone(`${API}/alerts`);

      (el.querySelector('.topbar__bell') as HTMLButtonElement).click();
      const request = http.expectOne(
        (candidate) =>
          candidate.url === `${API}/alerts` &&
          candidate.params.get('limit') === '6',
      );
      request.flush([makeAlert()]);
      await settle();
      fixture.detectChanges();

      expect(el.querySelectorAll('.bell-item')).toHaveLength(1);
      http.verify();
    });

    it('cerrado por defecto; un click en la campana lo abre', () => {
      const { fixture, el } = setupComponent(TopbarComponent);
      fixture.detectChanges();
      expect(el.querySelector('.bell-dropdown')).toBeNull();

      (el.querySelector('.topbar__bell') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(el.querySelector('.bell-dropdown')).not.toBeNull();
    });

    it('un click en el backdrop lo cierra', () => {
      const { fixture, el } = setupComponent(TopbarComponent);
      fixture.detectChanges();
      (el.querySelector('.topbar__bell') as HTMLButtonElement).click();
      fixture.detectChanges();

      (el.querySelector('.bell-backdrop') as HTMLElement).click();
      fixture.detectChanges();

      expect(el.querySelector('.bell-dropdown')).toBeNull();
    });

    it('sin alertas, muestra el mensaje de "no tienes alertas nuevas"', () => {
      const { fixture, el } = setupComponent(TopbarComponent);
      TestBed.inject(StateService).recentAlerts.set([]);
      fixture.detectChanges();
      (el.querySelector('.topbar__bell') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(el.querySelector('.bell-dropdown__empty')?.textContent).toContain('No tienes alertas nuevas');
    });

    it('con alertas, lista como máximo las 6 más recientes y marca las no leídas', () => {
      const { fixture, el } = setupComponent(TopbarComponent);
      const alerts = Array.from({ length: 8 }, (_, i) => makeAlert({ id: `a${i}`, title: `Alerta ${i}`, read: i < 2 }));
      TestBed.inject(StateService).recentAlerts.set(alerts);
      fixture.detectChanges();
      (el.querySelector('.topbar__bell') as HTMLButtonElement).click();
      fixture.detectChanges();

      const items = el.querySelectorAll('.bell-item');
      expect(items).toHaveLength(6);
      expect(items[0].className).not.toContain('bell-item--unread'); // a0, read: true
      expect(items[2].className).toContain('bell-item--unread'); // a2, read: false
    });

    it('"Ver todas" cierra el dropdown y navega según el rol (B -> /b/alerts, C -> /c/alerts)', () => {
      const { fixture, el } = setupComponent(TopbarComponent, { user: makeUser({ role: 'C' }) });
      fixture.detectChanges();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      (el.querySelector('.topbar__bell') as HTMLButtonElement).click();
      fixture.detectChanges();

      (el.querySelector('.bell-dropdown__footer') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(navigateSpy).toHaveBeenCalledWith(['/c/alerts']);
      expect(el.querySelector('.bell-dropdown')).toBeNull();
    });
  });

  it('el botón de menú (visible solo en móvil vía CSS) alterna el drawer del sidebar', () => {
    const { fixture, el } = setupComponent(TopbarComponent);
    fixture.detectChanges();
    const state = TestBed.inject(StateService);
    expect(state.sidebarOpen()).toBe(false);

    (el.querySelector('.topbar__menu-btn') as HTMLButtonElement).click();
    expect(state.sidebarOpen()).toBe(true);

    (el.querySelector('.topbar__menu-btn') as HTMLButtonElement).click();
    expect(state.sidebarOpen()).toBe(false);
  });

  it('typeIcon devuelve el icono correcto por tipo de alerta', () => {
    const { component } = setupComponent(TopbarComponent);

    expect(component.typeIcon('pago')).toBe('card');
    expect(component.typeIcon('incidencia')).toBe('exclamation');
    expect(component.typeIcon('junta')).toBe('users');
    expect(component.typeIcon('documento')).toBe('key');
    expect(component.typeIcon('comunidad')).toBe('building');
  });
});
