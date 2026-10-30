import { test, expect } from '../fixtures/auth';

const NOW = new Date().toISOString();
const ESTATES = [{ id: 'estate-1', name: 'Residencial Plaza' }, { id: 'estate-2', name: 'Edificio Mirador' }];
const ROWS = [
  { id: 'c1', otherUserId: 'neighbor-1', otherDisplayName: 'María García López', estateId: 'estate-1', lastMessagePreview: '¿Tenéis alguna actualización sobre la incidencia del ascensor?', lastMessageAt: NOW, unreadCount: 1, lastMessageSenderId: 'neighbor-1' },
  { id: 'c2', otherUserId: 'neighbor-2', otherDisplayName: 'Javier Pérez', estateId: 'estate-2', lastMessagePreview: 'Consulta sobre las cuotas de la comunidad.', lastMessageAt: NOW, unreadCount: 0, lastMessageSenderId: 'admin-test' },
  { id: 'c3', otherUserId: 'neighbor-3', otherDisplayName: 'Ana Contreras', estateId: 'estate-1', lastMessagePreview: 'Hola, desde hace varios días se escuchan ruidos en las zonas comunes.', lastMessageAt: NOW, unreadCount: 0, lastMessageSenderId: 'neighbor-3' },
];

test.beforeEach(async ({ page }) => {
  let userId = 'admin-test';
  await page.route('**/api/v1/auth/me', async route => {
    const response = await route.fetch();
    const body = await response.json();
    userId = body.id;
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/v1/assistant/estates', route => route.fulfill({ json: ESTATES }));
  const thread = [
    { id: 'm1', conversationId: 'c1', senderId: 'neighbor-1', text: 'Hola,\n¿tenéis alguna actualización sobre la incidencia del ascensor?\nSigue sin funcionar y ya llevamos varios días sin servicio.\n\nGracias.', createdAt: NOW },
    { id: 'm2', conversationId: 'c1', senderId: 'admin-test', text: 'Hola María,\nEl proveedor ya ha revisado la avería y está pendiente de recibir una pieza que llegará previsiblemente mañana. En cuanto la instalen, te avisaremos.\nSaludos.', createdAt: NOW },
    { id: 'm3', conversationId: 'c1', senderId: 'neighbor-1', text: 'Perfecto, muchas gracias por la información.\nQuedo a la espera.', createdAt: NOW },
  ];
  await page.route('**/api/v1/direct-messages/**', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.pathname.endsWith('/conversations')) {
      const estateId = url.searchParams.get('estateId');
      return route.fulfill({ json: ROWS.filter(row => !estateId || row.estateId === estateId) });
    }
    if (/\/conversations\/c\d\/messages$/.test(url.pathname)) {
      return route.fulfill({ json: thread.map(message => ({ ...message, senderId: message.senderId === 'admin-test' ? userId : message.senderId })) });
    }
    if (url.pathname.endsWith('/read')) return route.fulfill({ json: {} });
    if (url.pathname.endsWith('/contacts')) return route.fulfill({ json: [{ userId: 'neighbor-1', displayName: 'María García López', estateId: 'estate-1' }] });
    if (url.pathname.endsWith('/messages/with-attachments')) {
      const message = { id: 'm4', conversationId: 'c1', senderId: userId, text: 'Documento adjunto', createdAt: NOW, attachments: [{ id: 'a1', name: 'acta.pdf', mimeType: 'application/pdf', sizeBytes: 20 }] };
      thread.push(message);
      return route.fulfill({ json: message });
    }
    if (url.pathname.endsWith('/attachments/a1/file')) return route.fulfill({ contentType: 'application/octet-stream', body: '%PDF-1.4 QA attachment' });
    const single = /\/messages\/(m\d+)$/.exec(url.pathname);
    if (single && request.method() === 'PATCH') {
      const target = thread.find(message => message.id === single[1])!; Object.assign(target, { text: request.postDataJSON().text, editedAt: NOW });
      return route.fulfill({ json: target });
    }
    if (single && request.method() === 'DELETE') {
      const target = thread.find(message => message.id === single[1])!; Object.assign(target, { text: '', deletedAt: NOW });
      return route.fulfill({ json: { id: target.id, deletedAt: NOW } });
    }
    if (url.pathname.endsWith('/messages') && request.method() === 'POST') {
      const body = request.postDataJSON(); const message = { id: 'm5', conversationId: 'c1', senderId: userId, text: body.text, createdAt: NOW };
      thread.push(message); return route.fulfill({ json: message });
    }
    return route.fulfill({ status: 404, json: {} });
  });
});

test('bandeja de Mensajes: diseño, selector de bru_sidemenu y vista móvil', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.goto('/b/messages');
  await expect(page.locator('.conversation-row')).toHaveCount(3);
  await page.locator('.conversation-row').first().click();
  await expect(page.locator('.thread-message')).toHaveCount(3);
  await expect(page.locator('.thread-message--mine')).toHaveCount(1);
  for (const theme of ['dark', 'light']) {
    await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
    for (const width of [1440, 768, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.locator('.thread-composer textarea')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(page.locator('.community-heading__control')).toHaveCSS('height', '44px');
      await page.screenshot({ path: testInfo.outputPath(`messages-${theme}-${width}.png`), animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('combobox', { name: 'Comunidad', exact: true }).click();
  await page.locator('app-select-panel').getByRole('option', { name: 'Edificio Mirador', exact: true }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await expect(page.locator('.conversation-row')).toContainText('Javier Pérez');
  expect(errors).toEqual([]);
});

test('mensajes: búsqueda, no leídos, envío multipart y descarga de adjuntos', async ({ page }) => {
  await page.goto('/b/messages');
  // El botón flotante de rol (solo en desarrollo) cae justo sobre «Enviar» cuando la bandeja ocupa todo el alto.
  await page.addStyleTag({ content: '.role-switcher { display: none !important; }' });
  await expect(page.locator('.conversation-row')).toHaveCount(3);
  await page.getByRole('searchbox', { name: 'Buscar conversaciones' }).fill('ascensor');
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Buscar conversaciones' }).clear();
  await page.getByRole('button', { name: /Sin leer/ }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Todos', exact: true }).click();
  await page.locator('.conversation-row').first().click();
  await page.locator('.thread-composer input[type="file"]').first().setInputFiles({ name: 'acta.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 QA attachment') });
  await expect(page.locator('.draft-attachment')).toContainText('acta.pdf');
  await page.getByRole('textbox', { name: 'Escribe un mensaje' }).fill('Documento adjunto');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Descargar acta.pdf' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar acta.pdf' }).click();
  expect((await download).suggestedFilename()).toBe('acta.pdf');
});

test('mensajes: filtro de fechas por rango y sin filtro de estado', async ({ page }, testInfo) => {
  await page.goto('/b/messages');
  await expect(page.locator('.conversation-row')).toHaveCount(3);
  await expect(page.getByRole('combobox', { name: 'Estado de la conversación' })).toHaveCount(0);

  const picker = page.getByRole('button', { name: /Fecha de los mensajes/ });
  await picker.click();
  await expect(page.getByRole('dialog', { name: 'Fecha de los mensajes' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('messages-date-range-open.png'), animations: 'disabled' });

  // Rango del mes anterior: las conversaciones son de hoy, así que no debe quedar ninguna.
  await page.getByRole('button', { name: 'Mes anterior' }).click();
  await page.locator('.drp__day:not(.drp__day--outside)').first().click();
  await page.locator('.drp__day:not(.drp__day--outside)').nth(4).click();
  await expect(page.getByRole('dialog', { name: 'Fecha de los mensajes' })).toHaveCount(0);
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  await expect(picker).not.toContainText('Fecha: todas');
  await page.screenshot({ path: testInfo.outputPath('messages-date-range-applied.png'), animations: 'disabled' });

  // «Hoy» devuelve las tres; quitar el filtro también.
  await picker.click();
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'Quitar el filtro de fechas' }).click();
  await expect(picker).toContainText('Fecha: todas');
  await expect(page.locator('.conversation-row')).toHaveCount(3);
});

test('mensajes: el menú de tres puntos edita y borra los mensajes propios', async ({ page }, testInfo) => {
  await page.goto('/b/messages');
  await page.addStyleTag({ content: '.role-switcher { display: none !important; }' });
  await page.locator('.conversation-row').first().click();
  await expect(page.locator('.thread-message')).toHaveCount(3);
  // Solo el mensaje propio (m2) tiene menú.
  await expect(page.locator('.message-actions')).toHaveCount(1);

  const mine = page.locator('.thread-message--mine');
  await mine.getByRole('button', { name: 'Opciones del mensaje' }).click();
  await expect(page.getByRole('menuitem')).toHaveText([/Editar mensaje/, /Borrar mensaje/]);
  await page.screenshot({ path: testInfo.outputPath('messages-menu.png'), animations: 'disabled' });

  await page.getByRole('menuitem', { name: /Editar mensaje/ }).click();
  const editor = mine.getByRole('textbox', { name: 'Editar mensaje' });
  await editor.fill('Mensaje corregido');
  await mine.getByRole('button', { name: 'Guardar' }).click();
  await expect(mine).toContainText('Mensaje corregido');
  await expect(mine.locator('.thread-message__edited')).toHaveText('editado');

  await mine.getByRole('button', { name: 'Opciones del mensaje' }).click();
  await page.getByRole('menuitem', { name: /Borrar mensaje/ }).click();
  await expect(page.getByText('¿Borrar este mensaje?')).toBeVisible();
  await page.getByRole('menuitem', { name: 'Borrar', exact: true }).click();
  const deleted = mine.locator('.thread-message__deleted');
  await expect(deleted).toHaveText('Este mensaje ha sido borrado');
  await expect(deleted).toHaveCSS('font-style', 'italic');
  await expect(page.locator('.message-actions')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('messages-deleted.png'), animations: 'disabled' });
});
