# Alineación del header y del logo

Revisión del 17/10/2026 en `bru_sidemenu`.

## Causa y corrección

El logo calculaba su altura a partir del icono de 34 px, 36 px de padding y un
borde: 71 px. Fincas tenía un header flexible de 69 px y las cabeceras sencillas
medían 64 px. La prueba de navegador reprodujo los 2 px de diferencia de la
captura. En móvil la diferencia aumentaba porque el header distribuye sus
controles en más filas.

Topbar publica ahora la posición real de su borde inferior dentro del shell.
El bloque del logo utiliza esa misma medida y no se comprime. ResizeObserver
recoge cambios de tamaño del header y de los avisos de suscripción; un observer
limitado a los hijos directos del contenido detecta inserción/eliminación de esos
avisos. Los dos se desconectan al salir de la pantalla. La medición es independiente
del scroll y descuenta el desplazamiento del banner de demostración; no altera la altura del
header durante la medición ni escribe de nuevo un valor que no ha cambiado.

La barra superior usa `position: fixed`; su host reserva la misma altura en el
contenido para evitar saltos y solapamientos al entrar en una pantalla. Su ancho
y posición siguen el área visible de `.app-main`, excluyendo la barra de scroll,
mediante el mismo ResizeObserver. El aviso de suscripción permanece fijo encima
del header. El logo conserva su alineación incluso al hacer scroll hasta el pie
de página o cambiar el tamaño de la ventana mientras el contenido está desplazado.
El contenido reserva también el espacio del header al desplazar controles al foco.

`e2e/smoke/header-scroll.spec.ts` reproduce el fallo original y comprueba con
scroll de ratón que el header no cambia de posición al bajar, llegar al final y
volver arriba. Cubre Alertas, Fincas, Tareas, Contabilidad y Mensajes a 1440, 768,
390 y 320 px, además del aviso de suscripción y el cambio de ancho con scroll.

Además, el header comparte una única altura entre todas las pantallas y roles a
un mismo ancho: 72 px por encima de 768 px, 120 px entre 641 y 768 px, y 157 px
hasta 640 px. Se eliminan la altura automática de las variantes flexibles y la
excepción de Contabilidad de 112 px. En móvil todas las cabeceras reservan las
mismas filas para acciones globales y contenido contextual.

## Alcance del recorrido

El test `e2e/smoke/header-alignment.spec.ts` descubre las rutas A/B/C del router,
los apartados de Fincas y Contabilidad y el catálogo real de Informes. Comprueba
también las siete pestañas de la propiedad de C. Cada cabecera se mide en claro y
oscuro, a 320, 640, 768, 900, 1024 y 1440 px. El error permitido entre los dos
bordes es como máximo 0,1 px CSS. También verifica la altura común exacta y que
ningún botón, input o selector desborde la cabecera. El asistente de importación se comprueba como
overlay de pantalla completa, sin cabecera global; las páginas públicas tampoco
tienen ese par de bordes.

Los tres avisos de suscripción se prueban mediante respuestas de sesión simuladas
en el navegador; la suscripción real no se modifica. Una prueba unitaria cubre
inserción, cambio de altura y retirada del aviso sin recargar, scroll y liberación
de observers. Se conserva el tamaño de los controles y el comportamiento de los
selectores de comunidades de Informes/Tareas.

## Relación con el comentario de revisión

El comentario general de [PR #17](https://dev.azure.com/domora/Domora/_git/Domora/pullrequest/17)
indicaba que una entrega llamada «Sidemenu» mezclaba cuatro trabajos: menú/cuenta,
Juntas e Incidencias, desplegables e Informes con backend/base de datos/pipeline.
Pedía separar esas entregas, describir qué cambia y cómo probarlo, comprobar cada
rama y documentar el orden de integración si hay dependencias. No debía perderse
trabajo ni forzarse la rama original antes de abrir las sustitutas.

Se publicaron las revisiones [19](https://dev.azure.com/domora/Domora/_git/Domora/pullrequest/19),
[20](https://dev.azure.com/domora/Domora/_git/Domora/pullrequest/20),
[21](https://dev.azure.com/domora/Domora/_git/Domora/pullrequest/21) y
[22](https://dev.azure.com/domora/Domora/_git/Domora/pullrequest/22), en ese orden.
Las dos observaciones de actualización de base de datos se corrigieron allí:
preservar funciones de seguridad desconocidas y evitar reconstruir un enum solo
por su orden. Esos cambios de backend pertenecen a PR #19; este ajuste de
alineación y los selectores pendientes se publican en `bru_sidemenu`.

## Validación

- Build Angular de producción correcto, con avisos de tamaño CSS existentes.
- 157 suites / 1608 tests frontend aprobados; cobertura de desplegables aprobada.
- Revisión independiente de la alineación sin hallazgos Required/Critical.
- Cinco recorridos Chromium aprobados: los selectores de Informes/Tareas y los
  tres roles. Se revisaron 117 pantallas y variantes (A: 4, B: 99, C: 14), con
  1410 mediciones entre temas y tamaños. Diferencia máxima entre bordes: 0 px;
  alturas observadas: 72, 120 y 157 px, según el ancho. Capturas de escritorio
  y móvil revisadas visualmente.
- Evidencias finales del navegador: `test-results/header-unified-audit/` y su log;
  incluye medidas JSON y capturas por rol. La prueba de altura común falló antes
  del ajuste: Fincas medía 69 px en vez de los 72 px compartidos.

## Consistencia visual de los controles

La revisión posterior de las capturas encontró que el selector de Fincas tenía
icono dorado de 18 px y texto normal, mientras otros usaban icono gris de 16 px,
texto dorado en negrita y flechas de distinto tamaño. Los seis tipos de selector
del header comparten ahora `shared/styles/_community-control.scss`: superficie
de 44 px, edificio dorado de 18 px, texto de 13 px con peso 400 y color de texto
del tema, flecha gris de 14 px, borde, padding y foco comunes. Se conserva el
comportamiento de selección simple o múltiple de cada sección.

Los controles basados en select ocupan toda la superficie del campo; sus iconos
son decorativos y no interceptan el ratón ni el toque. El recorrido verifica
también la apertura desde la flecha con ratón y toque, apertura con teclado y
cierre con Escape en cada implementación. En todas las rutas se comprueban los
iconos globales de mensajes/notificaciones y los iconos del lateral, incluido su
estado activo. Las páginas públicas y el asistente de importación mantienen su
estructura propia sin header global.

Validación de este ajuste: build de producción y 1608 tests frontend aprobados;
cobertura de desplegables aprobada. Los recorridos A/C y los dos de ámbito
pasaron en `test-results/header-look-verified/`; B pasó completo en
`test-results/header-look-verified-B/`, tras respetar el límite de accesos del
login. En conjunto: 117 pantallas y variantes, 1392 comprobaciones de aspecto
en seis anchos/dos temas y 18 mediciones adicionales con avisos de suscripción,
sin diferencias de alineación. Capturas de las seis implementaciones del
selector revisadas visualmente. Revisión independiente sin Required/Critical
pendientes. El usuario ha autorizado publicar los cambios en `bru_sidemenu`.
