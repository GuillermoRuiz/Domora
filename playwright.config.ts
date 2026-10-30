import { defineConfig, devices } from '@playwright/test';

/**
 * Tarea "Cross-browser & device QA" (ID 29 del MVP Tracker). 5 proyectos:
 * 3 navegadores de escritorio + 2 emulaciones móviles — es justamente la
 * combinación la que entrega "cross-browser & device", no solo más
 * cobertura de Chrome de escritorio.
 *
 * Sin storageState ni proyecto de "setup" compartido a propósito — ver el
 * gotcha documentado en e2e/fixtures/auth.ts. Cada test que necesita sesión
 * pide su propio refresh token por API justo antes de arrancar.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  // En CI: anotaciones inline (github) + HTML publicado como artefacto
  // (ver el job `e2e` en azure-pipelines.yml) — 'github' solo no deja nada
  // navegable para cuando el gate informativo falla y hay que mirar el porqué.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
  // Solo en local: levanta el frontend solo. El backend+Postgres son
  // responsabilidad del desarrollador (ver e2e/README.md) — mismas 3 piezas
  // manuales que ya hacen falta hoy para correr la app completa. En CI queda
  // sin definir a propósito: el pipeline arranca backend+frontend como pasos
  // explícitos con su propio polling de salud (ver azure-pipelines.yml),
  // más confiable en un contenedor que el healthcheck genérico de acá.
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm start',
        url: 'http://localhost:4200',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
