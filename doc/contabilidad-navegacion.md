# Navegación de contabilidad

El listado contable usa un header superior con «Todas mis comunidades», selector
de comunidad y búsqueda por nombre o dirección. El panel reproduce el diseño
del listado de Fincas: título, resumen compacto, barra de herramientas, tabla y
tarjetas. Ambas vistas muestran saldo, fondo de reserva y morosidad desde los
resúmenes contables existentes. El resumen compacto muestra comunidades, saldo
consolidado y morosidad. La columna de comunidad es amplia y sus nombres no se
dividen en varias líneas. Las tarjetas marcan «Al corriente» en verde y no muestran
barra de reserva ni separador inferior. La dirección
y la fachada, cuando están disponibles, se añaden desde la lista de comunidades
ya cargada, sin peticiones adicionales. Si no hay fachada se muestra un edificio.
Los filtros por tipo y morosidad están en «Filtrar»; la búsqueda del header y la
barra local comparten su estado. La selección tabla/tarjetas se guarda en
`domora-accounting-view`, sin alterar las preferencias del módulo de Fincas.
La descarga genera un CSV compatible con Excel, con los resultados filtrados y
ordenados e importes con céntimos. Generar recibos conserva su flujo; el nombre en
la tabla o la tarjeta abre el detalle, sin un CTA adicional. Se incluyen estados de carga, vacío y error
con reintento. En pantallas estrechas el buscador pasa a una segunda fila.

El detalle contable usa el mismo selector con la comunidad actual y la sección
activa. No hay subheader, botón Volver, unidades, KPIs ni línea dorada horizontal.
La separación del header sigue siendo el borde gris sutil de `TopbarComponent`.
El selector se proyecta mediante su nuevo slot opcional `heading`, que no cambia
los títulos ni las migas del resto de pantallas.

`AccountingCommunitySelectorComponent` se monta en el listado sin una comunidad
seleccionada, y en el detalle cuando ha cargado su `AccountingEstate`. Desde el
listado abre el resumen contable de la comunidad elegida. No aparece en otros módulos.
Obtiene la lista al abrir mediante `EstatesService.listEstates()` (`GET /estates`),
la misma fuente del listado contable, y la filtra con `TenantContextService` usando
los permisos existentes. No se usa la búsqueda pública `/estates/search`.
Permite buscar localmente por nombre y dirección, marca la comunidad actual,
admite flechas, Tab y Enter, cierra con Escape o clic fuera y devuelve el foco
cuando corresponde. Incluye estados de carga, sin resultados y error con reintento.

Cambiar de comunidad navega a la ruta existente `/b/accounting/:id?tab=<activeTab>`.
El detalle observa la navegación completada y recarga los módulos con el id nuevo;
descarta respuestas de cargas anteriores mediante `switchMap` y desmonta los
componentes ligados a la finca anterior durante la transición. Conserva la opción
activa, y un `tab` inválido sigue usando el fallback existente, Resumen.
Todos los grupos actuales están disponibles para todas las comunidades accesibles;
no hay una regla adicional de disponibilidad por comunidad en el modelo actual.
«Ver todas las fincas» vuelve a `/b/accounting`. No se añade estado global ni rutas.
La lectura de rutas y el cierre de la suscripción siguen las APIs de
[Angular Router](https://angular.dev/guide/routing/read-route-state) y
[takeUntilDestroyed](https://angular.dev/api/core/rxjs-interop/takeUntilDestroyed).

El menú lateral de Contabilidad muestra Resumen y los cinco títulos siguientes,
sin submenús ni nombre de la comunidad. Al pulsar un título, sus opciones aparecen
en un menú horizontal centrado justo debajo del encabezado, siempre en la misma
posición independientemente de la conciliación.

Cuando hay una comunidad seleccionada, la fila Contabilidad lleva un chevron a
su derecha. Pulsar la fila despliega o contrae Resumen y los cinco títulos,
sin abandonar la comunidad ni cambiar la pantalla activa. El chevron apunta
a la derecha al contraer y gira hacia abajo al desplegar, con una transición
de altura y opacidad. Seleccionar una comunidad despliega automáticamente el menú;
después se puede contraer manualmente y cambiar de pestaña conserva ese estado. El botón
expone `aria-expanded`/`aria-controls` y los elementos contraídos quedan `inert`.
Sin una comunidad seleccionada, Contabilidad conserva su enlace al listado.

| Subsección | Opciones |
| --- | --- |
| Cobros y tesorería | Recibos, Remesas, Morosidad, Tesorería, Proveedores |
| Libros y cuentas | Diario, Mayor, Balance, Cuentas contables |
| Presupuesto y análisis | Presupuesto, Resultados, Análisis, Liquidación de caja |
| Nóminas e impuestos | Nóminas, Impuestos |
| Ejercicio y configuración | Saldos iniciales, Cierre, Centros de coste, Configuración |

Proveedores pertenece al menú horizontal de Cobros y tesorería y conserva su
destino en el detalle de la misma finca, con `?tab=providers`.
Los enlaces contables `?tab=` existentes mantienen sus
identificadores, incluido `movements`, que abre Tesorería.

La selección sigue siendo local al detalle: el lateral comparte su señal
`activeTab` mediante `AccountingNavigationService` y no cambia las rutas,
los componentes contables ni sus operaciones. El detalle registra su contexto
al entrar y lo retira al destruirse para evitar accesos a otra finca.
El grupo se deriva de la opción activa, de modo que los enlaces directos también
seleccionan el título lateral y muestran el menú horizontal correcto. Cambiar de
grupo abre su primera opción; pulsar el título del grupo activo conserva la opción
seleccionada. Resumen oculta el menú horizontal. Las opciones usan botones nativos
accesibles con el teclado y se distribuyen en varias filas si falta espacio.

Las opciones horizontales se agrupan en una cápsula centrada de fondo gris suave.
Una pastilla dorada, con borde y sombra sutiles, se desplaza hasta la opción activa
con una transición de 500 ms, conservando la paleta de Contabilidad. El indicador
se mide después del render mediante
[afterRenderEffect](https://angular.dev/api/core/afterRenderEffect) y se recoloca
al cambiar de tamaño o de fila mediante
[ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver).
La preferencia de movimiento reducido desactiva las transiciones. Esta adaptación
del ejemplo React usa Angular y SCSS, sin añadir React, Tailwind ni Framer Motion.

Las pruebas de `accounting-detail.component.spec.ts` verifican la agrupación,
la selección desde el lateral, los enlaces existentes y la retirada del contexto.
El mecanismo reactivo sigue el patrón de [señales de Angular](https://angular.dev/guide/signals).

La conciliación asistida completa aparece únicamente en Tesorería, antes del
módulo bancario. Resumen muestra un aviso compacto solo si la respuesta de
conciliación contiene propuestas pendientes (`total > 0`); su botón abre
Tesorería. El total cuenta propuestas, mientras que `counts.suggested` cuenta
movimientos bancarios propuestos. El resto de pantallas no monta el panel.
El modo compacto reutiliza la misma consulta; la paginación y las acciones
de aceptar/rechazar permanecen en el panel completo.
