# Mensajes: bandeja y selector de comunidades

## Objetivo y alcance
Mensajes se integra en el shell de `bru_sidemenu` en lugar de tener un diseño propio: el selector de comunidades va en el slot `heading` del topbar con `community-heading`/`_community-control`, como Informes y Tareas; el título, el subtítulo y «Nuevo mensaje» usan `page-intro`; los filtros usan `<select>` con la directiva compartida de desplegables; y todos los colores salen de los tokens del tema (`--color-*`), sin paleta propia. La pantalla es una tarjeta con borde (lista de conversaciones + hilo) bajo una barra de búsqueda y filtros, y en móvil el hilo ocupa la pantalla y oculta el título y los filtros.

Se conservan los datos reales, la privacidad de nombres, la mensajería B/C, los enlaces `?with=` y el hilo de Domo. La API actual no incluye asuntos, teléfono ni correo de contacto: no se inventan estos datos. La búsqueda cubre remitente y último mensaje; los filtros son todos/sin leer (pastilla con contador), un rango de fechas y el orden. No hay filtro de estado (pendiente/respondido). El rango se elige con `app-date-range-picker` (`shared/components/date-range-picker`): calendario mensual propio, sin dependencias, con atajos (hoy, 7 y 30 días), navegación por teclado y días inclusivos en hora local; filtra por el día del último mensaje de cada conversación. Fijar conversaciones es una preferencia local de cada usuario.

El usuario pidió expresamente adjuntos: hasta cinco archivos de 10 MB por mensaje, tipos ya admitidos por `StorageService`, selección, retirada antes del envío y descarga privada. Se usa la infraestructura de almacenamiento existente y una tabla aditiva `direct_message_attachments`. La base de datos y los archivos se vinculan a un único mensaje; se limpian los archivos si falla la persistencia. Nunca se devuelven claves de almacenamiento. Las descargas comprueban la participación y se sirven como adjuntos, con `nosniff` y sin caché compartida.

## Renovación de la bandeja (`bru_renovacion_mensajes`)
- **Lista:** avatar de 44 px, nombre y hora y vista previa; las fijadas llevan una estrella a la izquierda (se fija pasando el ratón por la fila o desde el menú del hilo). El orden está en la cabecera de «Conversaciones» y la búsqueda (remitente y último mensaje) va sola arriba.
- **Hilo:** los recibidos llevan avatar, nombre y hora; los propios, nombre y hora a la derecha, un tinte dorado y un check (✓ enviado, ✓✓ leído cuando el otro abre la conversación). El campo de escribir lleva dentro adjuntar archivos, imágenes y documentos.
- **Menú ⋮ de cada mensaje propio:** «Editar mensaje» (edición en el propio globo; Enter guarda, Esc cancela; el mensaje pasa a mostrar «editado») y «Borrar mensaje» (pide confirmación; el hilo muestra *Este mensaje ha sido borrado* en cursiva, la bandeja lo avisa y no cuenta como no leído). No hay menú en los mensajes recibidos: nadie puede modificar los de otro.
- **API:** `PATCH /direct-messages/messages/:id` `{ text }` y `DELETE /direct-messages/messages/:id`, solo para el autor y dentro de una conversación en la que participa. El borrado es lógico: se vacía el texto, se marca `deleted_at`, se eliminan los adjuntos (filas y archivos) y el mensaje sigue en su sitio del hilo. La edición marca `edited_at` solo si el texto cambia. La lectura de mensajes añade `readByRecipient` a los propios.
- **Base de datos (migración aditiva `20261018120000_direct_message_edit_delete`):** `direct_messages.edited_at` y `direct_messages.deleted_at`, ambas opcionales.

## Contratos y límites
`GET /direct-messages/conversations` y `/contacts` aceptan `estateId` opcional validado como UUID y restringido a las comunidades del usuario. Sin parámetro mantienen su comportamiento. Los resúmenes incorporan `estateId` y `lastMessageSenderId`, sin exponer datos personales nuevos. `POST /direct-messages/messages/with-attachments` recibe `files` en multipart y `GET /direct-messages/attachments/:id/file` descarga tras autorización. No se añaden dependencias ni se cambia autenticación o despliegue.

El selector filtra conversaciones y contactos en el servidor. Domo requiere una comunidad concreta: abrirlo selecciona la primera comunidad disponible si el ámbito era todas; elegir todas vuelve a la bandeja. Los historiales siguen separados por comunidad.

## Código y verificación
Angular 21, señales, componentes standalone y SCSS con tokens del tema existente. Ejemplo de contrato: `listConversations(estateId?: string): Promise<ConversationSummary[]>`.

- Frontend: `npx ng test --watch=false`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run build`.
- Backend: `npx jest direct-messages-scope.spec.ts --runInBand`, `npx tsc --noEmit`.
- Navegador: pruebas Playwright aisladas de Mensajes a 320, 768 y 1440 px, temas claro/oscuro, selector, búsqueda, no leídos y editor. Se reutiliza la sesión de prueba del repositorio.

Éxito: mismo aspecto que el resto de pantallas de `bru_sidemenu`, selector idéntico al suyo, filtros y envío funcionales, errores visibles, ausencia de desbordamiento horizontal y separación de ámbitos incluso con peticiones concurrentes. No se cambia `main`; se entrega en `bru_messages` y se sirve localmente.

## Validación realizada
- Tipos de frontend y compilación de producción correctos.
- Frontend con TZ=UTC (como CI): 1526 pruebas superadas y una omitida existente. Con la hora local tras medianoche fallan dos pruebas de fecha de SEPA ajenas al cambio; sus archivos están intactos.
- Backend de mensajería: 26 pruebas superadas, incluida persistencia y descarga real de adjuntos con limpieza de registros y archivos temporales.
- Navegador: diseño revisado en claro/oscuro a 320, 768 y 1440 px. Los casos de escritorio Chromium/Firefox/WebKit y de diseño móvil pasaron; el último caso de adjuntos en Safari móvil quedó bloqueado por HTTP 429 del login de pruebas. Los adjuntos pasaron en los otros navegadores.
- El build mantiene avisos de estilos del proyecto; Mensajes ocupa 18,49 kB de estilos, dentro del límite máximo de 28 kB.
- Migración aditiva aplicada exclusivamente en PostgreSQL local. API local compilada y reiniciada. No hay despliegue remoto.