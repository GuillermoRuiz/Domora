import { test, expect } from '../fixtures/auth';

/**
 * Recorrido principal de una incidencia (gestión):
 * incidencia con vía → Registrar actividad → «¿Qué pasa ahora?» → el recorrido se actualiza → se ejecuta la acción del paso
 * actual → el recorrido cambia de nuevo.
 *
 * Usa un usuario de gestión del seed de demo (E2E_USER_EMAIL / E2E_USER_PASSWORD, por defecto `gestora@demo.domora.app`) y crea
 * la incidencia por API para no depender de datos previos.
 */
const API = process.env.E2E_API_BASE_URL ?? 'http://localhost:3000/api/v1';
const EMAIL = process.env.E2E_USER_EMAIL ?? 'gestora@demo.domora.app';
const PASSWORD = process.env.E2E_USER_PASSWORD ?? 'Demo2026!';

// Un solo login por worker para crear incidencias: el login real tiene límite de intentos y la fixture ya hace el suyo.
let cachedToken: string | null = null;
async function token(): Promise<string> {
  if (cachedToken) return cachedToken;
  for (let attempt = 0; attempt < 3; attempt++) {
    const login = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    if (login.status === 429) {
      // Se respeta el límite real de intentos de acceso: no se desactiva ninguna protección del backend.
      await new Promise((resolve) => setTimeout(resolve, (Number(login.headers.get('retry-after')) || 30) * 1000));
      continue;
    }
    cachedToken = ((await login.json()) as { accessToken: string }).accessToken;
    return cachedToken;
  }
  throw new Error('No se pudo iniciar sesión para crear la incidencia (límite de intentos).');
}

async function createIssue(): Promise<string> {
  const accessToken = await token();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
  const estates = (await (await fetch(`${API}/estates`, { headers })).json()) as { id: string }[];
  const res = await fetch(`${API}/estates/${estates[0].id}/issues`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      type: 'Averia',
      title: `E2E recorrido ${Date.now()}`,
      description: 'Prueba del recorrido de la incidencia',
      priority: 'Normal',
      resolutionRoute: 'community_insurance',
    }),
  });
  if (!res.ok) throw new Error(`No se pudo crear la incidencia: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

test('incidencia → registrar actividad → siguiente paso → recorrido → acción → nuevo estado', async ({ page }) => {
  test.setTimeout(120_000);
  // El frontend de desarrollo apunta a :3000; si el backend de la prueba está en otro puerto, se reencamina.
  const apiOrigin = new URL(API).origin;
  if (apiOrigin !== 'http://localhost:3000')
    await page.route('http://localhost:3000/**', (route) => route.continue({ url: route.request().url().replace('http://localhost:3000', apiOrigin) }));

  const issueId = await createIssue();
  await page.goto(`/b/incidencias/${issueId}`);

  const journey = page.getByTestId('journey');
  const now = journey.getByTestId('journey-now');

  // 1. El paso actual es la tarea de la vía, con su acción.
  await expect(now).toContainText('Llamar al seguro');
  await expect(journey.getByTestId('journey-action')).toHaveText('Ver tarea');

  // 2. Registrar actividad: una llamada al seguro que abre el siniestro y deja una espera.
  await page.getByRole('button', { name: 'Registrar actividad' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Contraparte').selectOption('insurer');
  await dialog.getByLabel('Con quién has hablado').fill('Mapfre');
  await dialog.getByLabel('Qué ha pasado').fill('He llamado a Mapfre: abren el siniestro y responden en dos días.');
  await dialog.getByLabel('Se ha abierto un siniestro').check();

  // Sin elegir «¿Qué pasa ahora?» no se registra.
  await dialog.getByRole('button', { name: 'Registrar gestión' }).click();
  await expect(dialog).toContainText('Indica qué pasa ahora');

  await dialog.getByLabel('Estoy esperando una respuesta').check();
  await dialog.getByRole('button', { name: 'Registrar gestión' }).click();
  await expect(dialog).toBeHidden();

  // 3. El recorrido refleja lo ocurrido y lo que toca ahora: esperar a Mapfre, con su acción.
  await expect(journey).toContainText('Siniestro abierto');
  await expect(journey).toContainText('Llamada con Mapfre');
  await expect(now).toContainText('Esperando respuesta de Mapfre');
  await expect(now).toContainText('Desde');
  await expect(journey.getByTestId('journey-next')).toContainText('Después: revisar la respuesta');
  await expect(journey.getByTestId('journey-action')).toHaveText('Registrar respuesta');

  // 4. Ejecutar la acción del paso actual: registrar la respuesta (cierra la espera) y dar la incidencia por solucionada.
  await journey.getByTestId('journey-action').click();
  const reply = page.getByRole('dialog');
  await expect(reply.getByLabel('Contraparte')).toHaveValue('insurer');
  await reply.getByLabel('Qué ha pasado').fill('Mapfre confirma la cobertura y la reparación queda hecha.');
  await reply.getByLabel('La incidencia está solucionada').check();
  await reply.getByRole('button', { name: 'Registrar gestión' }).click();
  await expect(reply).toBeHidden();

  // 5. Nuevo estado del recorrido: resuelta, sin «Ahora» ni «Después».
  await expect(journey).toContainText('Incidencia resuelta');
  await expect(journey).toContainText('Respuesta de Mapfre');
  await expect(journey.getByTestId('journey-now')).toHaveCount(0);
  await expect(journey.getByTestId('journey-next')).toHaveCount(0);
});
