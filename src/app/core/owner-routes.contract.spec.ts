import type { Route } from '@angular/router';
import { routes } from '../app.routes';
import {
  OWNER_ACTIVITY_ROUTE, OWNER_ALERTS_ROUTE, OWNER_DOCUMENTS_ROUTE, OWNER_HOME, OWNER_ISSUES_ROUTE, OWNER_MEETINGS_ROUTE,
  OWNER_MESSAGES_ROUTE, OWNER_NOTIFICATIONS_ROUTE, OWNER_PROPERTY_ROUTE, OWNER_RECEIPTS_ROUTE, OWNER_SETTINGS_ROUTE,
} from './owner-routes';
import { ROLE_HOME } from './role-home';

const flat = (list: Route[]): Route[] => list.flatMap((r) => [r, ...flat(r.children ?? [])]);
const byPath = (path: string) => flat(routes).find((r) => r.path === path.replace(/^\//, ''));

describe('rutas del propietario (contrato)', () => {
  it.each([
    OWNER_HOME, OWNER_ISSUES_ROUTE, OWNER_DOCUMENTS_ROUTE, OWNER_MEETINGS_ROUTE, OWNER_RECEIPTS_ROUTE, OWNER_MESSAGES_ROUTE,
    OWNER_ACTIVITY_ROUTE, OWNER_ALERTS_ROUTE, OWNER_NOTIFICATIONS_ROUTE, OWNER_SETTINGS_ROUTE,
  ])('%s es una pantalla de la app, no una redirección', (path) => {
    const route = byPath(path);
    expect(route).toBeDefined();
    expect(route?.redirectTo).toBeUndefined();
    expect(route?.loadComponent ?? route?.component).toBeDefined();
  });

  it('la ficha de una propiedad es /c/properties/:id y /c/properties lleva a Mi comunidad', () => {
    expect(byPath(`${OWNER_PROPERTY_ROUTE}/:id`)?.loadComponent).toBeDefined();
    expect(byPath(OWNER_PROPERTY_ROUTE)?.redirectTo).toBe('c/community');
  });

  it('el inicio del rol C es Mi comunidad', () => {
    expect(ROLE_HOME['C']).toBe(OWNER_HOME);
  });
});
