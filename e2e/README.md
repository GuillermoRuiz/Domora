# E2E (Playwright)

Tarea "Cross-browser & device QA" (ID 29 del MVP Tracker). Specs de navegador
real contra 5 proyectos: Chromium, Firefox, WebKit (desktop) + Pixel 5 e
iPhone 13 (emulación móvil, vía `playwright.config.ts`).

Esto complementa, no reemplaza, `backend/scripts/smoke-e2e.sh` (curl/bash
contra la API real, sin navegador) — ese sigue siendo el smoke de la API en
CI; esto agrega la capa de UI/DOM/cross-browser que ese script no puede
cubrir.

## Correr en local

No hay un solo `docker compose` que levante todo junto todavía — son las
mismas 3 piezas manuales de siempre para correr la app completa:

1. Backend + Postgres: `docker compose up --build` dentro de `backend/`
   (o `npm run start:dev` en `backend/` contra un Postgres local ya
   corriendo).
2. Seed (una vez, o cuando la base esté vacía): `npx prisma db seed` dentro
   de `backend/` — crea el usuario `admin@domora.app` / `admin123` que usan
   los specs.
3. Frontend: `npm start` desde la raíz del repo (`ng serve`, puerto 4200).

Con eso corriendo:

```bash
npx playwright test          # todos los proyectos
npx playwright test --project=chromium   # uno solo, para iterar rápido
npx playwright show-report   # reporte HTML del último run
```

`playwright.config.ts` tiene `webServer` configurado para arrancar el
frontend solo (`npm start`) si no está corriendo ya — pero backend+Postgres
hay que tenerlos arriba a mano, no los levanta Playwright.

### Usuario de los specs

Por defecto los specs inician sesión con `admin@domora.app` / `admin123` (el usuario del seed).
Para usar otro usuario, define `E2E_USER_EMAIL` y `E2E_USER_PASSWORD` antes de lanzar Playwright
(`e2e/fixtures/auth.ts`). Son credenciales de pruebas: no las apuntes contra un entorno real.

## En CI

`webServer` queda deshabilitado (`process.env.CI` lo apaga) — el pipeline
arranca backend y frontend como pasos explícitos con su propio polling de
salud, antes de correr `npx playwright test`. Ver el job `e2e` en
`azure-pipelines.yml`. El gate es **informativo (no bloqueante)** las
primeras 2-3 semanas — ver la nota de flakiness abajo, es la razón concreta.

## Login en los specs: por qué no hay un storageState compartido

`e2e/fixtures/auth.ts` loguea por API (no por el formulario) e inyecta el
refresh token en `localStorage` antes de que la app arranque — **cada test
pide su propio login**, nada se comparte entre tests. Esto no es la
optimización "obvia" (loguearse una vez, guardar `storageState`, reusarlo en
todos los proyectos) a propósito: se probó esa versión primero y expone un
gotcha real de esta app, no un bug de los tests.

El access token vive solo en memoria (nunca en `localStorage`, ver
`AuthService` en el frontend) y el refresh token es de un solo uso, rotado y
revocado server-side en cada `/auth/refresh` (ver `AuthService.refresh` en
el backend — "so a leaked refresh token cannot be replayed indefinitely").
Cualquier contexto de navegador nuevo arranca sin access token y consume el
refresh token una vez, automáticamente, al bootstrapear
(`tryRestoreSession`). Con un `storageState` compartido entre varios
proyectos/tests en paralelo, el primero en arrancar consume el token y
revoca el de los demás — carrera real, no determinista, confirmada con
capturas de pantalla antes de encontrar la causa. La fixture actual la
evita de raíz: ningún token se persiste en disco ni se reusa.

## Flakiness conocida en local (no en el código de los specs)

Corriendo la suite completa (`npx playwright test`, 5 proyectos) en local
contra el stack de desarrollo, una fracción de los tests de
`estates`/`accounting`/`login` falla de forma intermitente —
pero **cada uno pasa de forma confiable corrido solo o en un subconjunto
chico** (`npx playwright test e2e/smoke/accounting.spec.ts --project=chromium`),
lo que confirma que la lógica de la app y de los specs es correcta.

Se investigó a fondo antes de aceptar esto como conocido (no se dio por
sentado sin verificar):
- **Se descartó** que fuera el storageState compartido (ver arriba — ESE sí
  era un bug real, ya corregido).
- **Se descartó** que fuera `ng serve` en modo dev: la misma flakiness
  aparece sirviendo un build estático (`npx serve -s dist/.../browser`).
- **Se descartó** que fuera `nest start --watch`: la misma flakiness aparece
  con el backend compilado (`node dist/src/main.js`).
- **Se descartó** que fuera pura concurrencia de Playwright: persiste
  (menos, pero persiste) incluso con `--workers=1` (ejecución 100% serial).
- Candidato más probable sin confirmar del todo: `bcryptjs` (implementación
  pura en JS, no el binding nativo — ver `backend/package.json`) no libera
  el event loop de forma limpia durante `compare()`/`hash()`, y la suite
  dispara ~15-25 logins reales en una ventana corta. No se pudo aislar al
  100% como causa única (persiste incluso serializado), así que queda
  documentado como sospecha fuerte, no como diagnóstico cerrado.

Por eso el gate de CI es informativo, no bloqueante, los primeros tiempos —
exactamente la razón que preveía el plan original
(`sprightly-snacking-yao.md`, fase 7) antes de escribir un solo spec. Si
alguien retoma esto: antes de asumir que es "lo mismo de siempre", correr
`--workers=1` y comparar — si CI (stack compilado, agente sin otra carga)
resulta estable y local no, es evidencia a favor de recursos de la máquina
local, no de la app.
