# Juntas e Incidencias globales

Referencia: las tres imágenes de `Desktop/juntas e incidencias`. Dos entradas propias de Gestión para B, selector de comunidad, indicadores reales, búsqueda, filtros, lista y detalle adaptable. Se mantienen los componentes y acciones de gestión existentes. No se añaden estados de borrador ni porcentajes ficticios.

El selector de comunidad de ambas secciones está en el encabezado global, mediante el slot contextual de Topbar, igual que Fincas y Contabilidad. Conserva el filtro de todas las comunidades o una concreta y se adapta al header móvil.

Los listados usan `GET /operations/meetings` y `GET /operations/issues`, solo rol B. Parámetros: `estateId` opcional, `search`, `filter`, `sort` (`newest`/`oldest`), `page`, `pageSize` (máximo 100). Respuesta: `items`, `total`, `page`, `pageSize`, `summary`. Los indicadores corresponden al ámbito y búsqueda completos, antes del filtro de estado y de paginar. El ámbito siempre intersecta los IDs del JWT y el administrador; ninguna entrada del cliente amplía permisos. No hay cambios de esquema ni migraciones.

Las pestañas Juntas e Incidencias desaparecen de los grupos de Fincas. Los enlaces históricos se conservan mediante redirección a las nuevas secciones con su comunidad y entidad. Las solicitudes de vecinos conservan su sección existente; no se mezclan entidades distintas por la referencia visual.

Validación: pruebas de ámbito y paginación del backend, navegación y estados del frontend, builds, pruebas de navegador con datos reales y capturas en escritorio/móvil y claro/oscuro. Los cambios quedan sin commit ni push hasta autorización explícita.

Se conservan convocatoria, asistencia, votaciones, acta, panel de anfitrión, cierre/cancelación con confirmación e histórico de participación por comunidad. Una junta enlazada fuera de la página actual se consulta mediante los endpoints autorizados existentes; si no está disponible se muestra un error, sin sustituirla por otra junta. Las respuestas antiguas del listado y del histórico no sobrescriben el estado actual.

Verificación final (2026-10-17): 5 pruebas backend, 209 frontend y 13 E2E Chromium aprobadas. Los E2E cubren los roles A/C, Fincas, ambas secciones globales, formularios reales, enlaces antiguos, histórico, cancelación y entidad fuera de página. Los últimos tres casos usan respuestas interceptadas exclusivamente en la prueba; no alteran la base de datos. La validación inicial se hizo con los listados locales vacíos. Capturas en `test-results/operations-final`, logs `test-results/operations-{unit,build,e2e}-final.log`.

Después, por petición del usuario, se añadieron a la base local de la gestora demo 3 comunidades identificadas como «Prueba», 9 propiedades, 6 juntas y 9 incidencias persistidas. Se conservaron los datos anteriores. Las juntas incluyen 3 convocadas, 2 celebradas y 1 cancelada; las incidencias cubren los cinco estados, con proveedores, presupuestos e historial. Las altas usan los endpoints existentes; los estados históricos de las juntas se cargan únicamente sobre estas comunidades de prueba, sin emitir avisos. Manifest local de IDs en `test-results/preview-data-manifest.json`; recorrido real y capturas en `test-results/operations-real-data`.

Los ajustes posteriores del selector en el header pasaron las 11 pruebas del componente y el recorrido real de ambas secciones. El estado vacío iguala la altura de las dos cajas mediante alineación de la rejilla; comprobado en navegador a 1440 y 1280 px, con ambas cajas de 272 px, y sin desbordamiento de página a 320 px.

Compilación backend y frontend correctas. El build frontend conserva ocho avisos anteriores de tamaño CSS y añade uno para el workspace, por encima del umbral de aviso de 8 kB y por debajo del límite de error. No se modifican los presupuestos de compilación. `git diff --check` correcto. Rama `bru_sidemenu`; los commits y la publicación requieren autorización explícita del usuario.
