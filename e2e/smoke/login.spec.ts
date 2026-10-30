import { test, expect } from '@playwright/test';

/**
 * Flujo 1 de 4 de la fase 6 (ID 29). A diferencia del resto de los specs de
 * esta carpeta, arranca deslogueado a propósito — es el único que tiene algo
 * real que probar en el formulario de login en sí, así que pisa el
 * storageState autenticado que usan los demás proyectos.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login', () => {
  test('credenciales incorrectas muestran error sin redirigir', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@domora.app');
    await page.fill('input[type="password"]', 'password-incorrecta');
    await page.click('button[type="submit"]');

    await expect(page.getByText('Email o contraseña incorrectos.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('login real redirige al dashboard del rol (B → /b/overview)', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"]', 'admin@domora.app');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');

    await page.waitForURL('**/b/overview');
    await expect(page.getByRole('button', { name: 'Abrir menú de cuenta' })).toBeVisible();
  });
});
