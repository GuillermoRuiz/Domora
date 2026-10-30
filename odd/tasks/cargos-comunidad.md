# Cargos de la comunidad desde el listado de propiedades

Objetivo: quitar el bloque «Órganos de gobierno» de la pestaña Propiedades; nombrar o cesar al presidente y a los vicepresidentes desde el menú de cada propiedad; consultar el histórico desde el menú «Acciones» de la finca.
Rama: `feat/office-holders` (desde `main`, sin push). Entrega: `ask-on-risk`. Tests: `npx ng test` (frontend), `npm test` en `backend/` (Jest; integración con Postgres).
ESTADO: IMPLEMENTADO Y VERIFICADO (L3).

## Specs

- **S1** Se elimina el componente `app-estate-governance` de la pestaña Propiedades (L1: «eliminar el componente de Organo de Gobierno dentro del módulo de Propiedades»).
- **S2** El menú de acciones de cada fila del listado de propiedades permite «marcar a un vecino como presidente o vicepresidente» (L1).
- **S3** Reglas de cargos (art. 13 y 15.1 LPH):
  - S3.1 Presidente único: nombrar uno nuevo cierra el mandato del anterior con la fecha de inicio del nuevo (ya implementado en backend).
  - S3.2 Vicepresidentes opcionales, varios y ordenados (1º, 2º…). Nombrar uno nuevo lo añade al final y no cesa a los demás.
  - S3.3 Una persona no ocupa dos cargos a la vez: si un vicepresidente pasa a presidente, su vicepresidencia termina en esa fecha.
  - S3.4 Solo pueden ocupar cargos los titulares propietarios de la finca (los candidatos de `GET office-terms/candidates`). En copropiedad se elige a una persona concreta.
  - S3.5 Cesar a un vicepresidente hace subir un puesto a los que van detrás.
  - S3.6 Sin fecha de fin obligatoria: el mandato sigue vigente hasta que se nombra un sucesor o se cesa.
- **S4** Opciones de la fila y avisos (supuesto de diseño, pendiente de validar con el usuario):

  | Situación | Opción | Confirmación o aviso |
  |---|---|---|
  | No hay presidente | Nombrar presidente | Confirmación con fecha de inicio (hoy por defecto) |
  | Hay presidente (X) | Nombrar presidente | «X (ref.) es presidente desde dd/mm/aaaa. Al nombrar a Y, el mandato de X terminará el [fecha].» |
  | Es el presidente | Cesar como presidente | Fecha de cese + «La comunidad quedará sin presidente» |
  | Es vicepresidente | Nombrar presidente | Aviso de que deja de ser vicepresidente |
  | Cualquier propietario | Nombrar vicepresidente | Se añade como «Vicepresidente Nº» |
  | Es vicepresidente | Cesar como vicepresidente | Aviso de que los siguientes suben un puesto |
  | Varios titulares | (cualquier nombramiento) | Selector de persona en el diálogo |

- **S5** La columna «Titular» muestra una etiqueta con el cargo vigente («Presidente», «Vicepresidente 1º»).
- **S6** «Mueve la opción de historicio al botón de acciones de la finca. Dale un nombre que sea autodescriptivo» (L2). Nombre propuesto: **«Historial de cargos»**, con la ayuda «Presidentes y vicepresidentes, con sus fechas». Disponible en el menú de la cabecera de la ficha y en el «⋯» del listado de fincas; desde el listado abre la ficha con `?action=office-history`, que se borra de la URL tras usarse (mismo patrón que `import-catastro`). Abre un diálogo de solo lectura con las columnas Cargo, Titular, Propiedad, Desde y Hasta («Vigente» si no tiene fin), ordenado del más reciente al más antiguo. Si está vacío: «Esta comunidad aún no tiene cargos registrados.»
- **S7** Fuera de alcance: secretario (art. 13.6, suele ser el administrador) y enlazar la firma del acta con los mandatos (hoy se resuelve por email).

## Tasks

| ID | Specs | Ruta | Estado | Commit |
|---|---|---|---|---|
| G1 | S3 | inline | hecho | 1a8c970, e6ee073 |
| G2 | S3, S5 | inline | hecho | 645f241 |
| G3 | S2, S4, S5 | inline | hecho | 8adbafc, f0e1c3f |
| G4 | S6 | inline | hecho | c23b3c8, 3ec3421 |
| G5 | S1 | inline | hecho | 86d286b |
| G6 | todas | verificador independiente (riesgo 1 y 3) | hecho | sin bloqueantes |

- **G1 Backend.** `role` (PRESIDENT | VICE_PRESIDENT) en el DTO y el servicio (hoy `PRESIDENT` está fijo en `estate-governance.service.ts:90-96`), campo `rank` para vicepresidentes, migración con la columna y la exclusión de solapamiento por (finca, rol, puesto), regla de un cargo por persona, cese de la vicepresidencia al ascender, reordenación al cesar un vicepresidente. Endpoint de cese reutilizado. Tests unitarios y de integración. El informe `presidents` no debe cambiar.
- **G2 Servicio del frontend.** Tipos con rol y puesto y cálculo de los cargos vigentes por propiedad.
- **G3 Listado de propiedades.** Etiqueta en la columna Titular, opciones del menú de la fila y diálogo con los avisos de S4, gestionado dentro de `properties-tab` (como «Añadir titular»).
- **G4 Historial de cargos.** Nueva acción `office-history` en `estate-actions-menu` (tipo `EstateAction`, salida y elemento), cableada en la cabecera de la ficha, en el listado de fincas (`dashboard-b`, navegación con `?action=`) y en `applyQueryParamDeepLink`. Diálogo de solo lectura.
- **G5 Retirada.** Borrar `estate-governance.component.*`, quitarlo de `estate-detail` y limpiar los stubs de `/office-terms` en `estate-detail.component.spec.ts:189` y `estate-detail-page.component.spec.ts:58-62`.
- **G6 Verificación.** Suite completa, `ng build`, e2e de fincas y navegador en tema claro y oscuro, escritorio y móvil.

Riesgo: item 1 (migración) e item 3 (cambia el contrato de `POST office-terms`).

## Log

- **L1** (2026-10-21, usuario): «Traza un plan para eliminar el componente de Organo de Gobierno dentro del módulo de Propiedades. La funcionalidad va a quedar representada a través del listado de propiedades. Desde ahí el administrador de la comunidad tendrá una nueva opción en el menú "Acciones" a través de la cual podrá marcar a un vecino como presidente o vicepresidente. Funcionalmente analiza si es posible que haya uno o varios presidentes o vicepresidentes para tratar de definir el comportamiento del botón y mensajes de confirmación advertencia. Tengo dudas de como lo hacen otras herramientas del sector. Si marcas uno se desmarca el resto?»
- Análisis: el backend solo implementa PRESIDENT (enum con VICE_PRESIDENT y SECRETARY sin uso; restricción de solapamiento solo para presidente). La LPH fija presidente único y vicepresidentes opcionales, varios y ordenados. No se ha comprobado cómo lo resuelven otras herramientas del sector.
- **L2** (2026-10-21, usuario): «Mueve la opción de historicio al botón de acciones de la finca. Dale un nombre que sea autodescriptivo»
- **L3** (2026-10-21): plan G1-G6 aplicado en `feat/office-holders`.
  - Decisión: sin columna `rank`; el orden de los vicepresidentes se deriva de la fecha de nombramiento (`startsAt`, luego `createdAt`), así al cesar uno los siguientes suben sin reescribir el histórico (S3.2, S3.5). La migración `20261021100000_office_term_holder_no_overlap` solo añade la exclusión «un cargo por persona a la vez»; `role` es opcional en `POST office-terms` (por defecto PRESIDENT, contrato compatible).
  - Verificación: backend 2313 tests + 150 de `estates`/`reporting` contra Postgres; frontend 2643 (el `NG0205` de `layout` ya existía); `ng build` sin errores; navegador en oscuro, claro y móvil contra `domora_demo_inst`. RED observado en los 4 tests de integración nuevos y en el 409 de fechas anteriores; los specs del frontend se escribieron junto a la implementación.
  - Verificador independiente: S1-S7 cumplidos, sin bloqueantes. Corregidos tras su informe y la prueba en navegador: 500 en lugar de 409 cuando la exclusión salta con fechas anteriores (e6ee073), aviso de sucesión el mismo día que el servidor rechaza (ahora bloquea, f0e1c3f), historial estrecho y con desplazamiento en móvil (f0e1c3f, 3ec3421).
  - Pendiente de decisión del usuario: (1) reelegir al presidente vigente ya no es posible (409); (2) un presidente antiguo sin propiedad asociada no se puede cesar desde la interfaz, solo sustituir; (3) los diálogos no devuelven el foco al botón al cerrar.
  - Risk: item 1 (migración) e item 3 (contrato de `POST office-terms`, ampliado de forma compatible).
