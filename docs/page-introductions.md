# Títulos, subtítulos y acciones de página

Trabajo en `bru_sidemenu`. Commit y push autorizados por el usuario.

La referencia medida en Juntas era: título 28 px, subtítulo 14 px, inicio del
título 24 px por debajo del header y a 24 px del borde del contenido. El botón
medía 36 px de alto, quedaba a 24 px del borde derecho y a 37,5 px del header.
Fincas tenía 32/15 px y empezaba 4 px más arriba. Otras pantallas solo tenían un
título pequeño dentro del header.

`shared/styles/_page-intro.scss` define un bloque de introducción común para las
pantallas de los roles A/B/C. Hay un único h1 principal de 28 px y un subtítulo
de 14 px; los textos contextuales del topbar mantienen su función de navegación.
En escritorio la acción principal tiene una posición fija respecto al header,
independiente de las líneas que ocupe el texto. En móvil los márgenes son 16 px
y la acción va debajo del texto, alineada a la derecha y con al menos 44 px de
alto. Los títulos largos pueden partir líneas sin recortarse ni invadir botones.

Las acciones de creación o apertura de formularios de las subsecciones de finca
y contabilidad utilizan `PageActionDirective`. El registro pertenece a cada
página de detalle, y el outlet de su cabecera presenta el template del apartado
activo. Se mantienen el contexto original, los handlers, estados disabled y las
condiciones de existencia. El cambio de pestaña retira la acción anterior y no
puede borrar la nueva; una pestaña destruida antes de registrarse no publica
nada. Fuera de una página con registro, el botón conserva su ubicación inline.
Los filtros y las acciones de formularios o registros individuales conservan su
contexto, incluidos los submits que dependen de su formulario.

Se trasladan también las acciones principales de Administradores, Propiedades,
Mensajes, Solicitudes, Notificaciones, Tareas y los visores de Informes. Los
detalles muestran el título del apartado activo y conservan la comunidad o la
dirección como subtítulo. Mensajes descuenta el bloque nuevo de su alto disponible
para conservar visible el editor en escritorio.

## Verificación

- Build de producción aprobado; permanecen los avisos de presupuesto CSS previos.
- 158 suites / 1611 tests frontend aprobados, incluidas las pruebas del registro,
  bindings, disabled, acción inline y destrucción antes de la microtask.
- La comparación Fincas/Juntas mide exactamente la misma fuente y geometría.
- Los formularios de Juntas/Incidencias y ocho subsecciones se abren desde el
  botón reubicado; se verifica que no esté duplicado y que el cambio de pestaña
  conserve el handler correcto. No se envían formularios ni se crean datos de negocio.
- Mensajes se prueba con una conversación simulada y el editor dentro del viewport.
- Revisión independiente sin Required/Critical pendientes.

La auditoría de rutas descubre el router, las pestañas de finca y contabilidad y
el catálogo real de Informes; mide las fuentes, el origen del título, el borde
izquierdo del subtítulo y la posición/tamaño de la acción en dos temas y seis
anchos. El asistente de importación a pantalla completa y las páginas públicas
mantienen sus estructuras propias, sin el header global.

La pasada final de Chromium aprobó los tres roles: 117 pantallas y variantes,
1392 comprobaciones de título/subtítulo/acción y 18 mediciones extra de avisos
de suscripción. Se observaron únicamente 28/14 px, márgenes de 24/16 px según
ancho y origen vertical de la acción de 37,5 px en escritorio. El header y el
logo mantienen diferencia de alineación de 0 px. El resumen de las ejecuciones
está en `docs/page-introductions-validation.json`. Otra ejecución de Playwright
limpió su directorio temporal por defecto; las capturas y medidas de C se
conservan por separado en `tmp/page-intro-qa/`, que está ignorado por Git.
El estado combinado con el cambio paralelo de header fijo se volvió a verificar:
158 suites / 1611 tests aprobados y recorrido C completo, incluido el scroll.
