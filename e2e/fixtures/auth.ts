import { test as base, expect } from '@playwright/test';

/**
 * Login real por API (no por el formulario) inyectado directo en
 * localStorage antes de que la app arranque — cada test se loguea de
 * cero, nada se comparte entre tests.
 *
 * Gotcha real encontrado armando esta suite (no es un bug de la app): el
 * access token vive solo en memoria (nunca en localStorage, ver
 * AuthService en el frontend) y el refresh token es de un solo uso,
 * rotado y revocado server-side en cada /auth/refresh (ver
 * AuthService.refresh en el backend). Eso significa que CUALQUIER
 * contexto de navegador nuevo arranca sin access token y consume el
 * refresh token una vez, de forma automática, al bootstrapear
 * (AuthService.tryRestoreSession). Un storageState compartido (un solo
 * archivo de sesión reusado por varios tests/proyectos en paralelo —
 * el patrón que recomienda la documentación de Playwright para "loguearse
 * una sola vez") se vuelve una carrera real: el primer navegador en
 * arrancar consume el refresh token y revoca el de los demás, que caen a
 * /login a mitad de test. Por eso acá cada test pide su PROPIO refresh
 * token por API justo antes de navegar — ninguno se reusa ni se persiste
 * en disco, así que no hay nada que competir.
 */
const API_BASE_URL =
  process.env.E2E_API_BASE_URL ?? 'http://localhost:3000/api/v1';

export const test = base.extend({
  page: [
    async ({ page }, use) => {
      const login = () =>
        fetch(`${API_BASE_URL}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: process.env.E2E_USER_EMAIL ?? 'admin@domora.app',
            password: process.env.E2E_USER_PASSWORD ?? 'admin123',
          }),
        });
      let res = await login();
      if (res.status === 429) {
        // Respect the real login throttle; never disable backend protections for smoke tests.
        const retryAfter = Number(res.headers.get('retry-after')) || 60;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(60, Math.max(1, retryAfter)) * 1000),
        );
        res = await login();
      }
      if (!res.ok) {
        throw new Error(
          `Login de fixture falló: ${res.status} ${await res.text()}`,
        );
      }
      const { refreshToken } = (await res.json()) as { refreshToken: string };

      await page.addInitScript((token) => {
        // A full navigation must retain the refresh token rotated by AuthService.
        if (!localStorage.getItem('domora-refresh-token'))
          localStorage.setItem('domora-refresh-token', token);
      }, refreshToken);

      await use(page);
    },
    { timeout: 90_000 },
  ],
});

export { expect };
