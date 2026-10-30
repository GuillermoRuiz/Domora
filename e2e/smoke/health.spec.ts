import { test, expect } from '@playwright/test';

/**
 * Prueba de humo del pipeline en sí (Fase 0 de ID 29) — no depende de datos
 * sembrados ni de sesión. Valida que Playwright arranca, navega y corre
 * contra los 5 proyectos (chromium/firefox/webkit/mobile-chrome/mobile-safari)
 * antes de escribir specs reales que sí dependan del backend.
 */
test('la pantalla de login renderiza', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('h1')).toContainText('Domora');
  await expect(page.locator('button[type="submit"]')).toBeVisible();
});
