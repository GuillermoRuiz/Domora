# Navegación de Fincas

El detalle de una finca usa el selector y la cápsula dorada de la navegación de
Contabilidad como referencia visual. Ambas navegaciones están integradas en
`bru_fincas`, con sus contextos independientes en el sidebar y el header
compartidos. No se añaden dependencias.

| Apartado lateral | Opciones horizontales |
| --- | --- |
| Administración de la finca | Propiedades, Solicitudes de adhesión, Facturación SEPA |
| Comunidad y comunicación | Solicitudes de vecinos, Documentos, Juntas, Comunicados |
| Mantenimiento y servicios | Incidencias, Instalaciones, Inspecciones, Proveedores y Personal |

Los tres apartados aparecen dentro del chevron de Fincas cuando se carga una finca.
Se despliegan automáticamente y pueden plegarse manualmente. Cambiar de subopción
no anula el plegado manual; cambiar de finca vuelve a desplegarlos.

El selector muestra el nombre en dorado, busca por nombre o dirección y filtra por
los permisos de `TenantContextService`. Usa `EstatesService.listEstates()` y las
rutas existentes. Cambiar de finca conserva la subopción mediante `?tab=`.
«Ver todas las fincas» lleva a `/b/estates`. Se cierra al seleccionar, pulsar fuera
o usar Escape; incluye navegación con flechas y restauración de foco.

`EstateNavigationService` comparte únicamente el contexto del detalle con el
sidebar. `EstateDetailPageComponent` recrea el detalle al cambiar el identificador
de ruta para reiniciar los formularios y los componentes que cargan en `ngOnInit`.
El detalle descarta respuestas de su carga inicial tras destruirse y libera su
contexto al salir. Los guards existentes se mantienen.

Se conservan los contadores, las cargas diferidas de SEPA e Instalaciones, los
enlaces directos con `tab`, `entity` y `action`, y los accesos de edición, Catastro,
nueva propiedad y puesta en marcha. El selector sustituye el título duplicado,
el botón Volver y la línea dorada del antiguo subheader. Los módulos conservan
sus componentes, servicios y acciones.

Domora Intelligence aparece encima de la tabla en la subopción Propiedades,
cuando termina la carga de la finca. Usa el identificador de la comunidad actual
y conserva su componente, resumen semanal, tarjetas y acciones existentes.
Los enlaces de sus tarjetas actualizan la subopción en el detalle actual,
sin recargar los datos de la finca; volver a Propiedades recupera el panel.

Pruebas: selector (permisos, búsqueda, errores y teclado), navegación por grupos,
sidebar (expansión y plegado), detalle y cambio real entre rutas, incluida una
respuesta tardía, y alternancia entre Fincas y Contabilidad sin perder apartados
ni conservar el contexto del módulo anterior.
