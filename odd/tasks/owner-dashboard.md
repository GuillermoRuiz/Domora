# Owner dashboard (role C home)

Objective: make the role C home `/c/community` match the provided dashboard mockup. Branch `feat/owner-dashboard` (stacked on `feat/estate-documents`, which holds the document library). Delivery: ask-on-risk. Runners: `npx ng test` (frontend), `npm test` in `backend/` (Jest), Playwright `npm run e2e`.

## Specs

- S1. Default navigation is role-aware: `''` and the `**` wildcard send role C to `/c/community`, role A to `/a/admins`, role B to `/b/overview`. Today both redirect every role to `/b/overview`.
- S2. Role C sidebar grouped like the mockup: "GENERAL" → "Mi comunidad"; "OPERACIONES" → "Incidencias y solicitudes", "Documentación", "Mensajes", "Juntas", "Recibos y pagos"; "SISTEMA" → "Mi perfil". Documentación/Juntas/Recibos open the selected property's tabs (`?tab=documents|juntas|receipts`).
- S3. Estate/property selector moves from the page header to the topbar (left, as in the mockup), keeping `OwnerScopeService` memory.
- S4. Dashboard layout as in the mockup: page title "Mi comunidad", subtitle "Consulta el estado de tu comunidad, tus recibos, incidencias y documentos", chip "Ámbito actual: <estate>"; 4 KPI tiles; row of 2 (Resumen de la comunidad, Mis recibos y pagos); row of 3 (Actividad reciente, Próximos eventos, Documentos recientes); "Accesos rápidos" bar. Uses `styles.scss` tokens, works on mobile and light theme.
- S5. "Solicitudes abiertas" KPI shows the change vs the previous month ("+1 vs. mes anterior").
- S6. Out of scope (user decision, 2026-10-22): "El buscador y el widget se quedan fuera".
- S7. (L8) "La cabecera del propietario (rol C) debe comportarse del mismo modo que lo hace en el caso del administrador permitiendo la opción de mostrar todas las propiedades, incidencias, recibos, etc en el caso de que tenga mas de una." The topbar selector offers "Todas mis propiedades" only when the owner has more than one property; it is the default when there is no remembered choice (like the manager's "Todas mis comunidades") and the choice is remembered.
- S8. (L8) In "Todas": KPIs aggregate every accessible property (next receipt = earliest due across them; open/new requests summed; next meeting = earliest across their estates; new documents counted once per document); receipts, events, activity and recent documents merge every property without duplicates. Assumption: the summary card lists the owner's communities and picking one selects its first property; actions that need one property use the item's own property, otherwise they are disabled.
- S9. (L8) "Si selecciona una de ellas la aplicación muestra kpis, y datos del contexto relacionado con la finca seleccionada." Selecting a property keeps today's single-property behaviour.

## Tasks

- [x] T1 — S1 — inline — role-aware default redirects — 39d728c (RED 5 failing → GREEN; assess: medium, under_budget)
- [x] T2 — S2, S3 — inline — grouped sidebar + selector in topbar — e823960 (RED 2+1 → GREEN)
- [x] T3 — S4 — inline — dashboard layout/styling — a72ee6f (RED 1 → GREEN; screenshots desktop/mobile/light, no horizontal overflow)
- [x] T4 — S5 — inline — requests month-over-month delta (backend + KPI) — 4f79162 (RED backend 2 + frontend 3 → GREEN)
- [x] T5 — S1-S5 — inline — Playwright smoke for the dashboard + stale navigation-roles spec updated — 97068aa
- [x] T6 — S8 — inline — backend aggregate `GET /properties/my-overview` — 33f60b8 (RED 3 → GREEN; integration vs Postgres 17/17; live curl OK)
- [x] T7 — S7-S9 — inline — "Todas mis propiedades" in selector, scope service and view model — see commit (RED observed for scope service, page and event labels; selector tests written together with the code)

## Log

- L1 (2026-10-22, user): "Analiza como se comporta la aplicación cuando un usuario se da de alta en la plataforma. Vamos a crear un plan que tiene como objetivo modificar la vista inicial de un propietario (rol C). Dicha vista tiene que intentar ser lo mas similar a lo que se muestra en la imagen"
- L2 (2026-10-22, user): "El buscador y el widget se quedan fuera"
- L3 (2026-10-23, user): "Arranca con el plan"
- L4: Recent documents for owners already read through the library access rule on `feat/estate-documents` (commit fdcb170), so the plan's documents item needs no new work. Engram mirror pending: project could not be resolved in this session.
- L5 (2026-10-23): Verification. Backend Jest full: 223 suites / 2626 passed (44 skipped). Frontend full: 2888/2893; the 5 failures change between runs (mensajes-workspace, estate-scope-selector), pass in isolation (40/40) and touch no file of this feature — known load flakiness. e2e (chromium, demo DB via E2E_OWNER_EMAIL/E2E_OWNER_PASSWORD): owner-dashboard 4/4, navigation-roles rol C 1/1. The local DB is the demo DB, so specs using the standard seed accounts (maria.garcia@demo.app, admin@domora.app, superadmin@domora.app) get 401 here; not run for roles A/B. Login throttle is 5/min per IP+email: run owner e2e in batches of at most 4.
- L6: Interpretation of S5 (assumption): "mes anterior" = the 30 days before the last 30 days (rolling window, consistent with the existing newLast30Days); delta = new requests last 30 days − new requests previous 30 days.
- L7: Not done, outside the plan: user name next to the avatar in the topbar (shared account menu for every role); kebab menu per receipt row (no action behind it).
- L8 (2026-10-23, user): "La cabecera del propietario (rol C) debe comportarse del mismo modo que lo hace en el caso del administrador permitiendo la opción de mostrar todas las propiedades, incidencias, recibos, etc en el caso de que tenga mas de una. Si selecciona una de ellas la aplicación muestra kpis, y datos del contexto relacionado con la finca seleccionada."
- L9 (2026-10-23): T7 verification. Frontend full 2908/2909; the only failure is estate-scope-selector (role B, untouched), 4/4 in isolation. e2e chromium vs demo DB: owner-dashboard 5/5. Screenshot of «Todas» with the demo owner (3 properties, 2 estates): aggregated KPIs, receipts tagged per property, «Mis comunidades» list.
- L10: Decisions inside S8: «Pagar ahora» (total) hidden in «Todas» because each estate has its own IBAN; per-receipt «Pagar» uses the receipt's estate IBAN. Generic drill-downs (requests/documents KPIs, «Ver todos», «Nueva incidencia», «Ver recibos») open the selector to choose a property; next receipt and next meeting KPIs go to their own property. In «Todas» the sidebar property tabs still fall back to Mi comunidad (S2 behaviour). Events get the community name in front when the owner has several estates. «Descargar acta» only when all properties share one estate.
