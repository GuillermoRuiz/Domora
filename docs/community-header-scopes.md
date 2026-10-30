# Selector de comunidades en Informes y Tareas

Informes (centro, categorías y visor) y Tareas utilizan el slot contextual de Topbar para seleccionar comunidades. Se retira el selector de la configuración interior de los informes y de la barra de filtros de tareas.

En Informes se conservan la selección múltiple, Todas y los informes que exigen una comunidad única. `scopeMode` y `estateIds` viajan en los enlaces de categorías, informes y regreso. Las selecciones vacías siguen siendo explícitas; no se amplían a Todas. Abrir un informe individual con varias comunidades requiere elegir una en el header. Cambiar de ámbito invalida vista previa, exportación y opciones de propiedad/proveedor. Las opciones de una petición anterior no reemplazan las del ámbito actual, incluida la carga inicial.

Tareas utiliza la consulta común del calendario, tabla y kanban. Limpiar los filtros internos mantiene la comunidad del header y este ámbito preselecciona Nueva tarea. Los campos de comunidad del formulario y del detalle asignan la tarea; no son filtros y conservan su función.

No hay cambios de backend, permisos ni base de datos en este ajuste. Los endpoints mantienen su autorización existente.

Validación: 157 pruebas iniciales en 12 archivos frontend; la prueba adicional de cambio de comunidad durante la carga inicial y las otras 9 del visor pasan después de la corrección. Los cinco recorridos existentes de Informes y los dos nuevos de headers pasan, incluidos PDF/Excel reales, navegación con ámbito y limpieza de filtros. Comprobación de ambas apariencias en 1440, 900, 640 y 320 px. Evidencias en `test-results/header-scopes*` y `test-results/header-scope-loading*`. Revisión sin hallazgos Required/Critical pendientes.

Compilación de producción correcta, con avisos de tamaño CSS (incluido Tareas, por encima del umbral de aviso y por debajo del de error). Los presupuestos no se modifican. El control de Tareas se verifica a 44 px de alto en todos los anchos probados y utiliza la directiva compartida de desplegables. `git diff --check` correcto. Publicación en `bru_sidemenu` autorizada el 17/10/2026 junto a la revisión de alineación del header.

## Comunidad compartida entre pantallas

La comunidad elegida en el selector del header se recuerda al cambiar de pantalla (Fincas, Juntas, Incidencias, Tareas, Contabilidad, Mensajes e Informes). La guarda `CommunityScopeService` (`src/app/core/community-scope.service.ts`) por usuario en `sessionStorage`; `null` es «Todas mis comunidades». Solo devuelve una comunidad a la que el usuario sigue teniendo acceso.

- Fincas y Contabilidad: entrar en la ficha `/b/estates/:id` o `/b/accounting/:id` fija la comunidad compartida. Con una comunidad elegida, abrir la lista (`/b/estates`, `/b/accounting`) lleva a su ficha; «Todas» / «Ver todas las fincas» la limpian antes de volver a la lista.
- Juntas e Incidencias: sin `estateId` en la URL parten de la comunidad compartida; cambiarla o limpiar filtros la actualiza.
- Tareas y Mensajes: el selector arranca con la comunidad compartida y la actualiza al cambiar. En Mensajes, la comunidad que se fija sola al redactar sin ninguna elegida no se comparte.
- Informes: sin parámetros de ámbito en la URL parte de la comunidad compartida. Una sola comunidad se comparte; **Todas o varias (pero no todas) se comparten como «Todas»**, de modo que al salir de Informes el selector de las demás pantallas muestra todas. Una selección vacía no cambia la compartida. Dentro de Informes la selección múltiple sigue viajando en `scopeMode`/`estateIds`.
