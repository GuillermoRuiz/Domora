# Panel de contratos de la finca para el administrador de fincas (rol B)

ESTADO: CERRADO (L14). K1–K10 hechas y verificadas contra el objetivo (ver «Verificación final»). Decisiones D1–D13 aplicadas (propuesta del asistente aprobada por el usuario en bloque).

**ALCANCE — LÍMITE EXPLÍCITO (L4):** la barra superior del mockup (tiempo «18°C Madrid», fecha, selector «Últimos 12 meses», buscador global «Buscar comunidades, propietarios, incidencias…» y su selector de comunidad) NO ENTRA en este trabajo, ni ningún cambio de la barra superior real de la aplicación. Tampoco entra el menú lateral reagrupado del mockup. Solo se trabaja el CONTENIDO de la pestaña Contratos de la ficha de finca; la cabecera de la ficha se queda como está.
CORRECCIÓN (L3): el panel y su menú son SOLO del administrador de fincas (rol B). La primera versión de este plan lo trataba como pantalla de propietario (rol C) y quedó anulada: no hay endpoint, menú ni visibilidad para rol C. (El nombre del fichero conserva el sufijo `-c` por historia; el contenido es de rol B.)
Rama: main. Estrategia de entrega: ask-on-risk. Test runner: Vitest (front) y Jest (back).

## Lo que pide el usuario (verbatim)

L1: "Analiza la imagen y teniendo en cuenta las funcionalidades actuales de la aplicación, traza un plan pormenorizado que ayude a ir creando cada uno de los componentes que se deberían crear para el panel de contratos de una finca para un propietario (rol C). Si tienes dudas no inventes, analiza y expón todas las dudas para poder generar un plan con garantías. Trata de mantener la máxima similitud con el mockup pero respetando la paleta de colores de la aplicación."

L3: "Corrige todo el plan. El menú solo está disponible para el rol administrador de fincas (rol B)"

## Qué muestra el mockup

Ficha de finca (volver a todas las fincas, foto, nombre, dirección, estado «Activa», botones Editar / Importar del catastro / Nueva propiedad) con las pestañas Resumen · Propiedades · Instalaciones · Proveedores · **Contratos** · Datos generales. Dentro de Contratos:
- Buscador («Buscar contratos, proveedor o servicio…») y 6 filtros: Vigencia, Proveedor, Renovación, Categoría, Fechas (rango), Ordenar por («Vencimiento (más próximo)»).
- 4 fichas: Contratos activos («12 de 14 contratos»), Vencen pronto («3 en los próximos 90 días», en rojo), Renovaciones automáticas («5 contratos con renovación»), Importe anual («24.580,00 € en contratos activos»).
- Tabla: Contrato/Servicio (con su categoría debajo), Proveedor (con logo), Inicio, Vencimiento (ordenable, en rojo/ámbar según cercanía), Renovación (Automática/Manual y periodicidad), Importe (anual y mensual), Estado (Activo), Alerta («Vence en 11 meses», «Vence en 1 año»), Acción (botón Ver y menú «⋯»).
- Dos paneles inferiores: «Próximos vencimientos» (contrato, vencimiento, días restantes con punto de color, importe, Ver; enlace «Ver todos») y «Últimas renovaciones» (contrato, fecha, nuevo vencimiento, importe, tipo; enlace «Ver histórico»).
- Fuera del panel y FUERA DE ALCANCE (D12): barra superior (tiempo, fecha, selector de periodo, buscador global) y menú lateral reagrupado «General / Operaciones / Sistema».

## Lo que existe hoy (investigación 2026-10-19, verificada)

- La pestaña **Contratos ya existe** en la ficha del rol B y el orden de pestañas coincide con el del mockup (`ESTATE_TABS` en `core/estate-navigation.service.ts`). Componente `features/estate-detail/contracts-tab/` (solo lectura): 4 fichas (Vigentes, Por vencer 30 d, Vencidos, Cancelados), bloque «Requieren atención» y una tabla (Proveedor, Servicio, Inicio, Fin, Renovación, Estado, Plazo). Sin buscador, filtros, orden, importes, acciones ni paneles inferiores. Su botón «Gestionar en Proveedores» salta a la pestaña Proveedores.
- **La gestión de contratos vive en Proveedores** (alta, edición, cancelación, documentos por proveedor): `features/estate-detail/suppliers-panel/*` y `features/accounting/proveedores-tab/*`; servicio `core/suppliers-staff.service.ts` (`create/update/cancelSupplierContract`).
- **Backend ya listo para la lista**: `GET /estates/:estateId/contracts` (`@Roles('A','B')`) devuelve cada contrato completo (serviceType, startDate, endDate, renewalType, costAmount, costFrequency, currency, reviewFrequency, notes) + proveedor `{id,name,category}` + estado derivado + `daysLeft`, ya ordenado. Documentos: endpoints por proveedor/contrato (listar, subir, descargar, borrar).
- Reglas existentes en `backend/src/suppliers/contract-rules.ts`: estado derivado (Programado / Activo / PorVencer ≤30 d / Vencido / Cancelado) y `annualizedContractCost` (mensual×12, trimestral×4, semestral×2, anual×1; puntual y «otro» no se anualizan).
- **No existe**: historial de renovaciones (la renovación «tácita» es solo una marca; nada renueva ni registra), logo de proveedor, título del contrato distinto del tipo de servicio, IVA, umbral de alerta por contrato (30 días fijo), ni una agregación de importes en el backend.
- Los datos demo actuales crean contratos sin importe ni periodicidad de coste: el panel saldría vacío en importes hasta ampliar el seed.

## Viabilidad del mockup con los datos actuales

| Elemento | Estado |
|---|---|
| Buscador y filtros Vigencia / Proveedor / Renovación / Categoría / Orden | Posible en cliente (lista pequeña por finca) |
| Filtro Fechas | Posible; sobre la fecha de vencimiento (D8) |
| Ficha activos / renovaciones automáticas | Posible |
| Ficha vencen pronto (90 d) | Posible; el backend usa 30 d para el estado (D4) |
| Ficha importe anual | Posible con la regla de anualización; contratos puntuales/«otro»/sin importe no cuentan; IVA desconocido (D5) |
| Tabla completa con importe anual y mensual, estado, alerta | Posible |
| Acción Ver / «⋯» | Reutilizando lo de Proveedores (detalle, editar, cancelar, documentos); falta decidir el alcance (D1) |
| Próximos vencimientos | Posible (por fecha de fin) |
| **Últimas renovaciones** | **Sin datos**: no hay historial (D3) |
| Logo de proveedor | No existe: iniciales o icono por categoría (D6) |
| Categoría bajo el contrato | Existe (categoría del proveedor, texto libre) |

## Decisiones (L4: propuesta del asistente aprobada por el usuario)

- **D1 Acciones de fila.** «Ver» abre un detalle lateral con los datos del contrato, el proveedor y los documentos descargables. «⋯» ofrece Editar, Renovar, Cancelar y Ver proveedor. La pestaña pasa a ser el sitio para gestionar contratos existentes, reutilizando los formularios de Proveedores (en K8 se comprueba si hay que extraerlos a un componente compartido).
- **D2 Alta.** Botón «Nuevo contrato» junto a los filtros, eligiendo proveedor. Si la finca no tiene proveedores, el estado vacío lleva a crearlos en Proveedores.
- **D3 «Últimas renovaciones».** Opción (b) acotada: modelo de renovaciones nuevo (migración aditiva) y acción «Renovar» en «⋯», que amplía el vencimiento y deja registro. NO se automatiza la renovación tácita (se deja para una fase posterior, porque cambiaría datos sin que el gestor lo vea). El panel muestra el histórico y, si está vacío, lo explica. El seed lo rellena para la demo.
- **D4 Umbrales y alertas.** 90 días SOLO en este panel (ficha «Vencen pronto», columna Alerta y «Próximos vencimientos»). Los 30 días del estado «Por vencer» y de «Pendientes de hoy» NO se tocan. Alerta: vencido → rojo («Vencido hace N días»); ≤30 días → rojo («Vence en N días»); 31–90 → ámbar; más lejos → neutro («Vence en N meses / años»); sin fecha de fin → «Sin vencimiento»; cancelado → «Cancelado».
- **D5 Importe anual.** Suma solo contratos vigentes (Activo y Por vencer); no cuenta programados, vencidos ni cancelados. Los puntuales, de periodicidad «otro» o sin importe no se anualizan y se avisan en la ficha («+N sin importe anual»). No se añade IVA ahora: leyenda «importes según contrato» (el IVA queda como mejora futura). Si hubiera moneda distinta del euro, no se suma y se avisa.
- **D6 Logo de proveedor.** Iniciales sobre un color estable derivado de la categoría, con el componente de avatar existente. No hay subida de logos.
- **D7 «12 de 14».** Activos = Activo + Por vencer. El total (14) = todos los contratos registrados de la finca, incluidos vencidos y cancelados.
- **D8 Filtros.** Vigencia: Todos, Activos, Por vencer, Vencidos, Programados, Cancelados. Fechas: un rango sobre el vencimiento. Categoría: sale de las categorías reales de los proveedores. Ordenar por: vencimiento (más próximo / más lejano), importe anual, proveedor A-Z, inicio. Los filtros van en la URL (como el `?tab=` actual).
- **D9 «Requieren atención».** Se elimina (lo cubren la columna Alerta y «Próximos vencimientos»). La ficha «Vencen pronto» añade una línea «N vencidos». Las cuatro fichas son clicables como atajo de filtro.
- **D10 «Ver todos» y «Ver histórico».** «Ver todos» aplica el orden por vencimiento y baja a la tabla. «Ver histórico» abre el listado completo de renovaciones de la finca.
- **D11 Sin fecha de fin y cancelados.** Sin fin: «Indefinido» en Vencimiento, alerta «Sin vencimiento», no entra en «Próximos vencimientos». Cancelados: al final de la tabla, en gris y con «Cancelado el dd/mm»; quedan fuera de fichas y paneles.
- **D12 Fuera de alcance (LÍMITE).** NO entran: la barra superior (tiempo, fecha, selector de periodo de 12 meses, buscador global y su selector de comunidad) ni el menú lateral reagrupado. La cabecera de la ficha de finca se queda como está. No se modifica ningún componente de layout (`layout/topbar`, `layout/sidebar`).
- **D13 Móvil.** Tabla con scroll horizontal en tablet y tarjetas por contrato en móvil (≤640 px).
- **Opcionales, FUERA del primer corte (anotados para más adelante):** exportar la lista a Excel; indicador de documentos adjuntos con su caducidad en cada fila; renovación tácita automática; IVA en el importe.

## Plan de unidades (orden de ejecución)

Cada unidad con tests, commit y entrada en el Log; sin push.

| Orden | ID | Unidad | Decisiones |
|---|---|---|---|
| 1 | K1 | Backend: modelo de renovaciones (migración aditiva), registro al renovar (nuevo vencimiento, fecha, importe, tipo manual) y endpoints de renovar y de listar por finca; `@Roles('A','B')` y `EstateScopeGuard` como el resto | D3, D10 — HECHA (L5) |
| 2 | K2 | Backend: `GET /estates/:id/contracts` devuelve además coste anual y mensual calculados con `annualizedContractCost` y nº de documentos (sin duplicar la regla en el front) | D5 — HECHA (L6) |
| 3 | K3 | Seed demo: contratos con importe, periodicidad, fechas y estados variados (activo, por vencer, vencido, programado, cancelado, sin fin, tácita/manual), documentos e historial de renovaciones | D3, D5, D11 — HECHA (L7) |
| 4 | K4 | Front: modelo y funciones puras (filtrar, ordenar, fichas, umbral y texto de alerta, importe anual con avisos) con tests exhaustivos | D4, D5, D7, D8, D11 — HECHA (L8) |
| 5 | K5 | Front: fichas (Contratos activos, Vencen pronto con línea «N vencidos», Renovaciones automáticas, Importe anual), clicables como filtro; sustituyen las 4 actuales y el bloque «Requieren atención» | D4, D5, D7, D9 — HECHA (L9) |
| 6 | K6 | Front: buscador y filtros (Vigencia, Proveedor, Renovación, Categoría, Fechas, Ordenar por) con estado en la URL | D8 — HECHA (L10) |
| 7 | K7 | Front: tabla con las columnas del mockup (proveedor con iniciales, importe anual y mensual, estado, alerta), estados de carga/vacío/error, scroll en tablet y tarjetas en móvil | D6, D11, D13 — HECHA (L11) |
| 8 | K8 | Front: detalle lateral («Ver»), acciones «⋯» (Editar, Renovar, Cancelar, Ver proveedor) y «Nuevo contrato», reutilizando los formularios de Proveedores | D1, D2 — HECHA (L12) |
| 9 | K9 | Front: paneles «Próximos vencimientos» (con «Ver todos») y «Últimas renovaciones» (con «Ver histórico») | D3, D4, D10 — HECHA (L13) |
| 10 | K10 | Cierre: responsive, claro/oscuro, verificación en navegador, e2e, documentación y Risk line | — — HECHA (L14) |

Notas: (1) paleta de la aplicación (tokens `--color-*`), no la del mockup; (2) se mantiene el acceso actual (`@Roles('A','B')`), sin endpoints para otros roles; (3) las piezas grandes son K7 y K8; (4) no se toca el menú lateral ni la barra superior (D12): la pestaña ya está en la ficha de finca; (5) K1 incluye una migración que el usuario debe aplicar con `prisma migrate deploy`.

## Log

- L1 (2026-10-19): petición original (arriba, verbatim).
- L2 (2026-10-19): primera versión del plan, planteada para rol C. ANULADA por L3.
- L3 (2026-10-19): corrección del usuario (arriba, verbatim): el panel es solo de rol B. Plan reescrito: la pestaña Contratos ya existe y se evoluciona; desaparecen las dudas de privacidad y visibilidad y las unidades de endpoint para propietarios; se añaden dudas de acciones, alta, alertas, filtros y seed. Investigación verificada: la gestión de contratos vive en Proveedores, la lista backend ya trae importes y periodicidad, no existe historial de renovaciones y el seed no tiene importes.
- L4 (2026-10-19): el usuario aprueba la propuesta del asistente para las 13 dudas y pide aplicarla al plan. Verbatim: "Aplica al plan todas esas decisiones que has tomado. Ten especial cuidado en que la barra superior no entra dentro del alcance". Aplicado: sección de decisiones D1–D13 (D12 recoge el límite de alcance y se repite en la cabecera del documento), unidades reordenadas K1–K10 (backend de renovaciones primero, seed después, front al final) y dudas cerradas.
- L5 (2026-10-19): K1 HECHA. Migración aditiva `20261019100000_supplier_contract_renewals` (tabla `supplier_contract_renewals`; el usuario debe aplicarla con `prisma migrate deploy`). `POST /estates/:e/suppliers/:s/contracts/:c/renew` (nuevo vencimiento obligatorio, importe y periodicidad opcionales) amplía el vencimiento y deja el registro (vencimiento anterior, nuevo, importe vigente, tipo manual, quién); no se renueva un cancelado ni un contrato sin fecha de fin, y el nuevo vencimiento debe ser posterior al actual y a hoy. Queda en la actividad del gestor. `GET /estates/:e/contracts/renewals?limit=` lista las renovaciones de la finca (más reciente primero) con contrato, proveedor e importe anualizado. Tests 30/30 (renovaciones + suites de proveedores).
- L6 (2026-10-19): K2 HECHA. `GET /estates/:e/contracts` devuelve ahora, por contrato, `annualCost` y `monthlyCost` (calculados con `annualizedContractCost`, la regla única; null si es puntual, «otro» o sin importe) y `documentCount`. Sin cambios en estado ni orden. Tests 39/39 en proveedores.
- L7 (2026-10-19): K3 HECHA. Nueva fase `f5-contracts.ts` (ejecutada la última): todos los contratos con importe y periodicidad (según servicio), historial de renovaciones coherente con el vencimiento actual (tácitas y manuales; ≥20 filas), documentos con PDF real en la mitad de los contratos, y contratos extra en la cartera (programado en Los Olivos; puntual y cancelado en Parque Norte; sin fecha de fin en Vallehermoso). Hay vigentes, por vencer y vencidos. Aserciones de cifras dentro del seed y bloque (m) en el test (43/43).
- L8 (2026-10-19): K4 HECHA. Modelo y servicio del front (`EstateContract` con coste anual/mensual y nº de documentos, `ContractRenewal`, `listEstateRenewals`, `renewSupplierContract`) y `contracts-model.ts`: funciones puras para alerta (D4: umbral 90 días solo aquí), fichas (D5, D7), filtros, orden (cancelados siempre al final), próximos vencimientos, opciones de desplegable y estado en la URL. Tests 33/33.
- L9 (2026-10-19): K5 HECHA. Nuevo `ContractsKpisComponent` con las 4 fichas del mockup (Contratos activos «12 de 14 contratos», Vencen pronto en rojo con «en los próximos 90 días» y línea «N vencidos», Renovaciones automáticas, Importe anual en euros con «importes según contrato» y avisos «+N sin importe anual / en otra moneda»); cada una es un botón que aplica un atajo de filtro (D9) y se marca si coincide con los filtros; pulsarla otra vez lo quita. El contenedor ya tiene el estado de filtros y alimenta la tabla; desaparecen las 4 fichas antiguas y el bloque «Requieren atención». Tests de la pestaña 41/41 y de la ficha de finca 578/578.
- L10 (2026-10-19): K6 HECHA. Nuevo `ContractsToolbarComponent`: buscador («Buscar contratos, proveedor o servicio…», sin acentos) y filtros Vigencia, Proveedor, Renovación, Categoría, rango de vencimiento y Ordenar por (5 criterios), con las opciones salidas de los contratos reales de la finca y «Quitar filtros» (conserva el orden). El estado vive en la URL (`q`, `vig`, `prov`, `ren`, `cat`, `desde`, `hasta`, `orden`): se lee al abrir y se escribe con `replaceUrl` y `merge` (no pisa `tab`), agrupando las pulsaciones con un retardo de 250 ms. Tests de la ficha de finca 589/589.
- L11 (2026-10-19): K7 HECHA. Nuevo `ContractsTableComponent` con las columnas del mockup: contrato/servicio con su categoría debajo, proveedor con iniciales sobre color estable por categoría (D6), inicio, vencimiento (en rojo o ámbar según cercanía; «Indefinido» sin fin), renovación (Automática/Manual), importe anual con equivalente mensual (o «Pago único» / «—», D5), estado, alerta con icono y botón «Ver» (emite el contrato; el detalle llega en K8). Cancelados en gris y con «Cancelado el dd/mm/aaaa» (D11). Tablet: scroll horizontal; móvil (≤640 px): cada fila es una tarjeta con rótulos (`data-label`). El contenedor deja de tener la tarjeta con título «Contratos con proveedores» y el enlace «Gestionar en Proveedores» (D1: la gestión vive aquí); el estado vacío ofrece «Ir a Proveedores». Modelo ampliado (`formatDate`, `amountText`, `categoryColor`, estado). Tests de la ficha de finca 598/598.
- L12 (2026-10-19): K8 HECHA. Gestión desde la pestaña (D1, D2): detalle lateral «Ver» (datos, importe anual y mensual, alerta, documentos del contrato con descarga y renovaciones registradas, con las acciones que admite el estado), menú «⋯» accesible (Editar, Renovar, Cancelar contrato, Ver proveedor; un cancelado solo permite ver al proveedor y uno indefinido no se renueva; flechas, Escape y fuera lo cierran), «Nuevo contrato» en la barra de filtros con elección de proveedor, y tres diálogos nuevos: formulario de alta/edición (mismas reglas que Proveedores; vaciar la fecha de fin la quita), renovar (propone un año más; solo envía lo que cambia; valida posterior al actual y a hoy) y cancelar (motivo opcional, sustituye al `confirm` del navegador). Tras guardar se recarga la lista y el histórico y aparece un aviso. `suggestedReviewFrequency` pasa a `core/contract-hints.ts` (la usan Proveedores y el formulario nuevo); la pestaña Proveedores no cambia. Tests: ficha de finca + proveedores + core 1156/1156.
- L13 (2026-10-19): K9 HECHA. Nuevo `ContractsPanelsComponent` con los dos paneles del mockup: «Próximos vencimientos» (los 5 vigentes que vencen antes; contrato y proveedor, vencimiento, días restantes con punto de color según D4, importe anual y «Ver»; «Ver todos» filtra los vigentes y los ordena por vencimiento y baja a la tabla) y «Últimas renovaciones» (las 5 más recientes: contrato, fecha, nuevo vencimiento, importe y tipo; si no hay, explica cómo aparecen). «Ver histórico» abre el nuevo `ContractRenewalsHistoryComponent` con todas las renovaciones (vencimiento anterior y nuevo, importe anual, tipo y notas). Los vencidos, cancelados y contratos sin fin no entran en «Próximos vencimientos» (D11). Tests de la ficha de finca 654/654.
- L14 (2026-10-19): K10 HECHA. Cierre. Verificado en navegador real (Playwright contra backend y BD demo) en oscuro, claro, tablet y móvil, sin errores de consola ni desborde horizontal. Correcciones salidas de esa verificación: barra de filtros en dos filas (se salía de la pantalla), columna «Tipo» del panel de renovaciones, desborde de la página por un texto oculto con posición absoluta, proveedor que se partía letra a letra en tablet, y los diálogos ahora llevan el foco dentro, se cierran con Escape y lo devuelven (`ContractDialogDirective`); la URL de los filtros incluye `tab=contracts` para que el enlace reabra la pestaña. e2e nuevo `e2e/smoke/contracts.spec.ts` (4 casos; el fixture admite `E2E_USER_EMAIL` y `E2E_USER_PASSWORD`). Resultado: frontend 229 ficheros / 2351 tests, `ng build` OK, backend 197 suites (seed 43/43 con el límite del test (d) subido a 15 min porque el seed completo ya tarda ~2 min y ese test lo ejecuta dos veces), 3/3 e2e probados contra el entorno demo y el resto por su propia ejecución. Pendiente del usuario: `prisma migrate deploy` (migración `20261019100000_supplier_contract_renewals`).

## Verificación final contra el objetivo (K10)

Objetivo (L1 + L3 + L4): el panel «Contratos» de la ficha de finca para el administrador de fincas (rol B), lo más parecido posible al mockup, con la paleta de la aplicación, con las decisiones D1–D13 y sin tocar la barra superior ni el menú lateral. Comprobado en navegador real (Playwright contra backend y BD demo) en oscuro, claro, tablet y móvil.

**Mockup → resultado**

| Elemento del mockup | Resultado |
|---|---|
| Pestaña «Contratos» entre Proveedores y Datos generales | Ya estaba en la ficha; sin cambios en la cabecera ni en las pestañas |
| Buscador «Buscar contratos, proveedor o servicio…» | Sí, sin acentos ni mayúsculas, en la URL |
| Filtros Vigencia, Proveedor, Renovación, Categoría, Fechas, Ordenar por | Sí (6), con opciones reales de la finca; fechas sobre el vencimiento |
| Ficha «Contratos activos · de N contratos» | Sí |
| Ficha «Vencen pronto · en los próximos 90 días» (en rojo) | Sí, con línea «N vencidos» |
| Ficha «Renovaciones automáticas» | Sí |
| Ficha «Importe anual» | Sí, con avisos de lo no sumado |
| Tabla: contrato y categoría, proveedor con logo, inicio, vencimiento, renovación, importe anual y mensual, estado, alerta, Ver y «⋯» | Sí; el logo son iniciales sobre color de categoría (D6) |
| Panel «Próximos vencimientos» con «Ver todos» | Sí |
| Panel «Últimas renovaciones» con «Ver histórico» | Sí, con datos reales (D3) |
| Barra superior (tiempo, periodo, buscador global) y menú lateral reagrupado | NO se tocan (D12): `layout/topbar` y `layout/sidebar` sin cambios en toda la tarea |
| Botones de cabecera (Editar, Importar, Nueva propiedad) | Se quedan como están hoy en la ficha |

**Decisiones D1–D13:** D1 detalle y «⋯» (Editar, Renovar, Cancelar, Ver proveedor) hechos y probados; D2 «Nuevo contrato» con elección de proveedor; D3 histórico de renovaciones real (modelo, «Renovar», panel, listado completo; sin renovación tácita automática); D4 90 días solo en este panel (el estado «Por vencer» de 30 días y «Pendientes de hoy» no se tocan); D5 importe anual solo de vigentes con avisos; D6 iniciales; D7 «12 de 14»; D8 filtros y orden, estado en la URL conservando `tab`; D9 sin «Requieren atención» y fichas clicables; D10 «Ver todos» y «Ver histórico»; D11 sin fin («Indefinido») y cancelados al final y en gris; D12 alcance; D13 tabla con scroll en tablet y tarjetas en móvil.

**Hallazgos de la verificación en navegador (corregidos):** barra de filtros que se salía de la pantalla (ahora dos filas), columna «Tipo» recortada en el panel de renovaciones, desborde horizontal de la página en tablet y móvil (un texto oculto «Acción» con posición absoluta escapaba del contenedor con scroll), proveedor que se partía letra a letra en tablet, y Escape que no cerraba los diálogos si el foco no estaba dentro (ahora los diálogos mueven el foco, se cierran con Escape y lo devuelven).

**Risk:** item 1 (migración aditiva `supplier_contract_renewals`; el usuario debe aplicarla con `prisma migrate deploy`) e item 3 (nuevos endpoints `POST .../contracts/:id/renew` y `GET .../contracts/renewals`, y campos nuevos `annualCost`, `monthlyCost` y `documentCount` en `GET .../contracts`: son adiciones, sin romper a quien ya consume la lista). Sin cambios de seguridad: los endpoints nuevos son `@Roles('A','B')` con `EstateScopeGuard`. `suggestedReviewFrequency` se movió a `core` y Proveedores sigue igual.
