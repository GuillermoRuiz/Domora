import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { setupComponent, makeUser } from '../../core/testing/component-harness';
import { StateService } from '../../core/state.service';
import { EstateNavigationService, type EstateTab } from '../../core/estate-navigation.service';
import { AccountingNavigationService, type AccountingTab } from '../../core/accounting-navigation.service';
import type { Estate, AccountingEstate } from '../../core/models';
import { OwnerScopeService } from '../../core/owner-scope.service';
import { SidebarComponent } from './sidebar.component';

describe('SidebarComponent', () => {
  it('rol B añade Vista general y conserva Fincas, Tareas, Informes y Contabilidad sin filas de cuenta ni sistema', () => {
    const { fixture, el, http } = setupComponent(SidebarComponent, { user: makeUser({ role: 'B', fullName: 'Ana García' }) });
    fixture.detectChanges();
    expect(Array.from(el.querySelectorAll('.sidebar__item-label'), item => item.textContent?.trim())).toEqual(['Vista general', 'Fincas', 'Juntas', 'Incidencias', 'Tareas', 'Informes', 'Contabilidad']);
    expect(Array.from(el.querySelectorAll('.sidebar__section-label'), item => item.textContent?.trim())).toEqual(['GESTIÓN', 'FINANZAS']);
    expect(el.querySelector('a[href="/b/reports"]')).not.toBeNull();
    for (const route of ['requests', 'messages', 'notifications', 'alerts', 'settings', 'subscription']) expect(el.querySelector(`a[href="/b/${route}"]`)).toBeNull();
    expect(el.querySelector('.sidebar__theme-toggle, .sidebar__logout')).toBeNull();
    expect(el.querySelector('.sidebar__user')).toBeNull();
    expect(el.textContent).not.toContain('Ana García');
    http.expectNone(() => true);
  });

  it('rol A agrupa su navegación en General, Negocio Domora, Supervisión de plataforma y Sistema', () => {
    const { fixture, el, http } = setupComponent(SidebarComponent, { user: makeUser({ role: 'A' }) });
    fixture.detectChanges();
    expect(Array.from(el.querySelectorAll('.sidebar__section-label'), item => item.textContent?.trim()))
      .toEqual(['GENERAL', 'NEGOCIO DOMORA', 'SUPERVISIÓN DE PLATAFORMA', 'SISTEMA']);
    expect(Array.from(el.querySelectorAll('.sidebar__item-label'), item => item.textContent?.trim())).toEqual([
      'Vista general', 'Administradores de fincas',
      'Clientes', 'Facturación y cobros', 'Analítica y adopción', 'Onboarding y completitud',
      'Soporte e incidencias', 'Comunidades', 'Usuarios y accesos',
      'Configuración', 'Seguridad y auditoría',
    ]);
    expect(Array.from(el.querySelectorAll('a.sidebar__item'), link => link.getAttribute('href'))).toEqual([
      '/a/overview', '/a/admins',
      '/a/clients', '/a/billing', '/a/analytics', '/a/onboarding',
      '/a/support', '/a/communities', '/a/users',
      '/a/settings', '/a/audit',
    ]);
    expect(el.querySelector('.sidebar__role-badge')?.textContent?.trim()).toBe('SUPERADMIN');
    http.expectNone(() => true);
  });

  it('solo el rol A lleva la etiqueta SUPERADMIN bajo el logo', () => {
    const { fixture, el } = setupComponent(SidebarComponent, { user: makeUser({ role: 'B' }) });
    fixture.detectChanges();
    expect(el.querySelector('.sidebar__role-badge')).toBeNull();
  });

  it('rol C agrupa su navegación en General, Operaciones y Sistema', () => {
    const { fixture, el, http } = setupComponent(SidebarComponent, { user: makeUser({ role: 'C' }) });
    fixture.detectChanges();
    expect(Array.from(el.querySelectorAll('.sidebar__section-label'), item => item.textContent?.trim())).toEqual(['GENERAL', 'OPERACIONES', 'SISTEMA']);
    expect(Array.from(el.querySelectorAll('.sidebar__item-label'), item => item.textContent?.trim())).toEqual([
      'Mi comunidad', 'Incidencias', 'Documentación', 'Mensajes', 'Juntas', 'Recibos y pagos', 'Mi perfil',
    ]);
    expect(el.querySelector('a[href="/c/messages"]')).not.toBeNull();
    expect(el.querySelector('a[href="/c/settings"]')).not.toBeNull();
    http.expectNone(() => true);
  });

  it('rol C abre Juntas y Recibos y pagos en sus módulos, con o sin propiedad elegida', () => {
    const { fixture, el } = setupComponent(SidebarComponent, { user: makeUser({ role: 'C' }) });
    const scope = TestBed.inject(OwnerScopeService);
    fixture.detectChanges();
    const hrefOf = (label: string) =>
      Array.from(el.querySelectorAll<HTMLAnchorElement>('a.sidebar__item')).find(a => a.textContent?.includes(label))?.getAttribute('href');
    expect(hrefOf('Juntas')).toBe('/c/juntas');
    expect(hrefOf('Recibos y pagos')).toBe('/c/recibos');

    scope.items.set([{ id: 'p1', nickname: '1ºA', estateId: 'e1', estateName: 'Residencial Plaza' } as never]);
    fixture.detectChanges();
    expect(hrefOf('Juntas')).toBe('/c/juntas');
    expect(hrefOf('Recibos y pagos')).toBe('/c/recibos');
  });

  it('rol C abre Incidencias en su página propia, con o sin propiedad elegida, y la marca activa', async () => {
    const { fixture, el } = setupComponent(SidebarComponent, {
      user: makeUser({ role: 'C' }),
      routes: [{ path: 'c/incidencias', children: [] }, { path: 'c/community', children: [] }],
    });
    const scope = TestBed.inject(OwnerScopeService);
    fixture.detectChanges();
    const link = () =>
      Array.from(el.querySelectorAll<HTMLAnchorElement>('a.sidebar__item')).find(a => a.textContent?.includes('Incidencias'))!;
    expect(link().getAttribute('href')).toBe('/c/incidencias');

    scope.items.set([{ id: 'p1', nickname: '1ºA', estateId: 'e1', estateName: 'Residencial Plaza' } as never]);
    fixture.detectChanges();
    expect(link().getAttribute('href')).toBe('/c/incidencias');

    await TestBed.inject(Router).navigateByUrl('/c/incidencias?issue=i1');
    fixture.detectChanges();
    expect(link().className).toContain('sidebar__item--active');
  });

  it('rol C abre Documentación en su página propia, con o sin propiedad elegida, y la marca activa', async () => {
    const { fixture, el } = setupComponent(SidebarComponent, {
      user: makeUser({ role: 'C' }),
      routes: [{ path: 'c/documentacion', children: [] }, { path: 'c/community', children: [] }],
    });
    const scope = TestBed.inject(OwnerScopeService);
    fixture.detectChanges();
    const link = () =>
      Array.from(el.querySelectorAll<HTMLAnchorElement>('a.sidebar__item')).find(a => a.textContent?.includes('Documentación'))!;
    expect(link().getAttribute('href')).toBe('/c/documentacion');
    expect(link().className).not.toContain('sidebar__item--active');

    scope.items.set([{ id: 'p1', nickname: '1ºA', estateId: 'e1', estateName: 'Residencial Plaza' } as never]);
    fixture.detectChanges();
    expect(link().getAttribute('href')).toBe('/c/documentacion');

    await TestBed.inject(Router).navigateByUrl('/c/documentacion?doc=d1');
    fixture.detectChanges();
    expect(link().className).toContain('sidebar__item--active');
  });

  it('Fincas es un enlace normal aunque haya una finca abierta: sus pestañas viven en la propia ficha', () => {
    const { fixture, el } = setupComponent(SidebarComponent, { user: makeUser({ role: 'B' }) });
    const nav = TestBed.inject(EstateNavigationService);
    const estate = signal<Estate | null>({ id: 'e1', name: 'Finca seleccionada' } as Estate);
    const activeTab = signal<EstateTab>('summary');
    nav.context.set({ estate, activeTab, selectTab: tab => activeTab.set(tab) }); fixture.detectChanges();
    expect(el.querySelector('a[href="/b/estates"]')).not.toBeNull();
    expect(el.querySelector('.sidebar__estate-toggle')).toBeNull();
    expect(el.querySelectorAll('[data-estate-group]')).toHaveLength(0);
    expect(el.textContent).not.toContain('Finca seleccionada');
  });

  it('mantiene los grupos contextuales de Contabilidad', () => {
    const { fixture, el } = setupComponent(SidebarComponent, { user: makeUser({ role: 'B' }) });
    const nav = TestBed.inject(AccountingNavigationService);
    const estate = signal<AccountingEstate | null>({ id: 'e1' } as AccountingEstate);
    const activeTab = signal<AccountingTab>('summary');
    nav.context.set({ estate, activeTab }); fixture.detectChanges();
    expect(el.querySelector('.sidebar__accounting-toggle')?.getAttribute('aria-expanded')).toBe('true');
    (el.querySelector('[data-accounting-group="collections"]') as HTMLButtonElement).click();
    expect(activeTab()).toBe('receipts');
  });

  it('mantiene la apertura y cierre del drawer por backdrop y enlaces', () => {
    const { fixture, el } = setupComponent(SidebarComponent, { user: makeUser({ role: 'A' }) });
    const state = TestBed.inject(StateService); fixture.detectChanges();
    expect(el.querySelector('.sidebar__backdrop')).toBeNull();
    state.sidebarOpen.set(true); fixture.detectChanges();
    expect(el.querySelector('.sidebar')?.className).toContain('sidebar--open');
    (el.querySelector('.sidebar__backdrop') as HTMLElement).click();
    expect(state.sidebarOpen()).toBe(false);
    state.sidebarOpen.set(true); fixture.detectChanges();
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    (el.querySelector('.sidebar__item') as HTMLElement).click();
    expect(state.sidebarOpen()).toBe(false);
  });
});
