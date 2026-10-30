import { test, expect } from '../fixtures/auth';

test('secciones globales reales: comunidad, formularios, enlaces antiguos y responsive', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  for (const path of ['/b/juntas', '/b/incidencias']) {
    const response = page.waitForResponse(
      (res) =>
        res.url().includes('/operations/') && res.request().method() === 'GET',
    );
    await page.goto(path);
    expect((await response).status()).toBe(200);
    await expect(page.locator('.operations-layout')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    await expect(page.locator('.workspace-error')).toHaveCount(0);
    await expect(page.locator('.topbar .scope-selector select')).toBeVisible();
    await expect(page.locator('.operations-page .scope-selector')).toHaveCount(0);
    await expect
      .poll(() => page.locator('.scope-selector option').count())
      .toBeGreaterThan(1);
    const id = await page
      .locator('.scope-selector option')
      .nth(1)
      .getAttribute('value');
    for (const width of [320, 640, 900, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await expect(page.locator('.page-intro h1')).toHaveText(
        path.endsWith('juntas') ? 'Juntas' : 'Incidencias',
      );
      if ([320, 1440].includes(width))
        await page.screenshot({
          path: testInfo.outputPath(`${path.split('/').pop()}-${width}.png`),
          fullPage: true,
          animations: 'disabled',
        });
    }
    await page.getByRole('combobox', { name: 'Comunidad', exact: true }).click();
    await page.locator('app-select-panel .dd__option').nth(1).click();
    await expect(page).toHaveURL(new RegExp(`estateId=${id}`));
    await expect(page.locator('.operations-layout')).toHaveAttribute(
      'aria-busy',
      'false',
    );
    if (path.endsWith('juntas')) {
      const owners = page.waitForResponse((res) =>
        res.url().includes('/properties/owner-emails'),
      );
      await page
        .getByRole('button', { name: 'Nueva junta', exact: true })
        .click();
      await expect(
        page.getByRole('heading', { name: 'Nueva junta', exact: true }),
      ).toBeVisible();
      expect((await owners).status()).toBe(200);
      await page.locator('app-create-junta-modal .wizard__close').click();
      await expect(page.locator('app-create-junta-modal .wizard')).toHaveCount(
        0,
      );
      await page.goto(`/b/estates/${id}?tab=juntas`);
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === '/b/juntas' &&
          url.searchParams.get('estateId') === id,
      );
      await expect(page.locator('.operations-layout')).toHaveAttribute(
        'aria-busy',
        'false',
      );
    } else {
      await page
        .getByRole('button', { name: 'Nueva incidencia', exact: true })
        .click();
      // La incidencia se crea en un diálogo del propio listado, sin salir de /b/incidencias.
      await expect(
        page.getByRole('heading', { name: 'Nueva incidencia', exact: true }),
      ).toBeVisible();
      await expect(page).toHaveURL(
        (url) => url.pathname === '/b/incidencias',
      );
      await page
        .getByRole('dialog', { name: 'Nueva incidencia' })
        .getByRole('button', { name: 'Cerrar' })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // El enlace antiguo a las incidencias de una finca lleva al listado acotado a ella.
      await page.goto(`/b/estates/${id}?tab=issues`);
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === '/b/incidencias' &&
          url.searchParams.get('estateId') === id,
      );
      await expect(page.locator('.operations-layout')).toHaveAttribute(
        'aria-busy',
        'false',
      );
    }
  }
  expect(errors).toEqual([]);
});

import type { Page } from '@playwright/test';

async function mockMeetingDetail(page: Page, row: Record<string, unknown>) {
  const id = row['id'];
  await page.route(`**/meetings/${id}`, (route) =>
    route.fulfill({ json: { ...row, scheduledAt2: row['scheduledAt1'] } }),
  );
  await page.route(`**/meetings/${id}/quorum`, (route) =>
    route.fulfill({
      json: {
        convocatoria: 'primera',
        quorumRequired: true,
        quorumMet: true,
        owners: { present: 18, total: 24, percent: 75 },
        quota: { present: 72.4, total: 100, percent: 72.4 },
        missingParticipationQuotaCount: 0,
        attendingProperties: [],
      },
    }),
  );
  for (const suffix of ['attendance', 'delegations', 'vote-sessions', 'attachments'])
    await page.route(`**/meetings/${id}/${suffix}`, (route) =>
      route.fulfill({ json: [] }),
    );
}

for (const kind of ['meetings', 'issues'] as const) {
  test(`${kind}: listado y detalle poblados, filtros y temas`, async ({
    page,
  }, testInfo) => {
    const estate = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Residencial Plaza',
      address: 'Calle Gran Vía',
      streetNumber: '12',
      location: 'Madrid',
    };
    const rows =
      kind === 'meetings'
        ? [
            {
              id: 'm1',
              estateId: estate.id,
              title: 'Junta ordinaria de propietarios',
              type: 'ordinaria',
              status: 'convocada',
              scheduledAt1: '2026-11-15T18:30:00Z',
              estate,
              location: 'Salón de la comunidad',
              agenda: [
                { id: 'a1', title: 'Aprobación de cuentas y presupuesto' },
                { id: 'a2', title: 'Mantenimiento del ascensor' },
              ],
            },
            {
              id: 'm2',
              estateId: estate.id,
              title: 'Junta extraordinaria — obras',
              type: 'extraordinaria',
              status: 'celebrada',
              scheduledAt1: '2026-09-20T18:30:00Z',
              estate,
              agenda: [],
              actaSignedAt: null,
            },
          ]
        : [
            {
              id: 'i1',
              ref: '#INC-2026-001',
              title: 'Ascensor fuera de servicio',
              type: 'Averia',
              status: 'Abierta',
              priority: 'Urgente',
              date: '2026-10-15',
              description:
                'El ascensor no responde. Se ha avisado al servicio técnico.',
              estate,
              asset: { name: 'Ascensor 1' },
              situationView: {
                issueId: 'i1',
                situation: 'requires_attention',
                label: 'Requiere atención',
                nextStep: { kind: 'human', code: 'human_task', headline: 'x', label: 'Elegir proveedor' },
                ballInCourt: {
                  primary: 'administration',
                  holders: [{ party: 'administration', label: 'Elegir proveedor', source: 'task', since: null, dueAt: null, refId: 't1' }],
                },
                attention: { count: 0, tasks: [] },
              },
              _count: { photos: 3 },
            },
            {
              id: 'i2',
              ref: '#INC-2026-002',
              title: 'Fuga de agua en garaje',
              type: 'Fuga',
              status: 'EnReparacion',
              priority: 'Normal',
              date: '2026-10-14',
              description: 'Revisión de tuberías del garaje.',
              estate,
              asset: null,
              situationView: {
                issueId: 'i2',
                situation: 'waiting_third_party',
                label: 'Esperando tercero',
                nextStep: { kind: 'waiting', code: 'wait:provider', headline: 'x', label: 'Reparación en curso' },
                ballInCourt: {
                  primary: 'provider',
                  holders: [{ party: 'provider', label: 'Fontanería Sol', source: 'wait', since: null, dueAt: null, refId: 'w1' }],
                },
                attention: { count: 0, tasks: [] },
              },
              _count: { photos: 1 },
            },
          ];
    await page.route(`**/operations/${kind}*`, async (route) => {
      const params = new URL(route.request().url()).searchParams;
      const search = params.get('search') ?? '';
      const filter = params.get('filter') ?? 'all';
      const filtered = search
        ? []
        : filter === 'urgent'
          ? rows.slice(0, 1)
          : rows;
      await route.fulfill({
        json: {
          items: filtered,
          total: filtered.length,
          page: 1,
          pageSize: 12,
          summary: {
            convocada: 1,
            celebrada: 1,
            cancelada: 0,
            acta: 1,
            open: 1,
            inProgress: 1,
            urgent: 1,
            resolved: 0,
          },
        },
      });
    });
    if (kind === 'meetings') {
      // El detalle de junta (panel derecho) carga junta, quórum, asistencia,
      // propiedades, delegaciones y votaciones.
      await page.route(`**/estates/${estate.id}/properties`, (route) =>
        route.fulfill({ json: [] }),
      );
      for (const row of rows) await mockMeetingDetail(page, row);
    }
    await page.goto(kind === 'meetings' ? '/b/juntas' : '/b/incidencias');
    await expect(page.locator('.row-title')).toHaveCount(2);
    if (kind === 'meetings') {
      await expect(page.locator('.workspace-preview')).toContainText(
        rows[0].title,
      );
      await page.locator('.row-title').nth(1).click();
      await expect(page.locator('.workspace-preview')).toContainText(
        rows[1].title,
      );
      await page.locator('.row-title').first().click();
    } else {
      // Una fila de Incidencias dice quién tiene la pelota y cuál es el siguiente paso.
      await expect(page.locator('app-issues-list tbody tr').first()).toContainText(
        'Administración',
      );
      await expect(page.locator('app-issues-list tbody tr').nth(1)).toContainText(
        'Fontanería Sol',
      );
    }
    for (const theme of ['dark', 'light']) {
      for (const width of [1440, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: testInfo.outputPath(`${kind}-${theme}-${width}.png`),
          animations: 'disabled',
          fullPage: true,
        });
      }
      if (theme === 'dark') {
        await page.locator('.account-menu__trigger').click();
        await page
          .getByRole('menuitem', { name: 'Modo claro', exact: true })
          .click();
      }
    }
    await page
      .getByRole('searchbox', { name: 'Buscar', exact: true })
      .fill('sin resultados');
    await expect(page.locator('.empty-state')).toContainText('Sin resultados');
    await page
      .getByRole('button', {
        name: kind === 'meetings' ? 'Limpiar' : 'Limpiar filtros',
        exact: true,
      })
      .click();
    await expect(page.locator('.row-title')).toHaveCount(2);
    if (kind === 'meetings') {
      for (const name of ['Participación', 'Orden del día', 'Acta', 'Resumen'])
        await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.getByRole('tab', { name: 'Resumen' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.route('**/meetings/m1/status', async (route) => {
        expect(route.request().postDataJSON()).toEqual({ status: 'cancelada' });
        rows[0].status = 'cancelada';
        await route.fulfill({ json: rows[0] });
      });
      page.once('dialog', (dialog) => dialog.accept());
      await page
        .getByRole('button', { name: 'Más acciones de la junta' })
        .click();
      await page.getByRole('menuitem', { name: 'Cancelar junta' }).click();
      await expect(
        page.locator('.workspace-preview app-status-pill').first(),
      ).toContainText('Cancelada');
      await mockMeetingDetail(page, {
        ...rows[1],
        id: 'old',
        title: 'Junta fuera de página',
      });
      await page.route(`**/api/v1/estates/${estate.id}`, (route) =>
        route.fulfill({ json: estate }),
      );
      await page.goto('/b/juntas?entity=old');
      await expect(page.locator('.workspace-preview h1')).toHaveText(
        'Junta fuera de página',
      );
      await expect(page.locator('.workspace-error')).toHaveCount(0);
    }
  });
}
