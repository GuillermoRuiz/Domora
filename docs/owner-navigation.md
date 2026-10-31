# Navegación del propietario (rol C)

Mapa de lo que puede abrir un propietario, de cómo llegan los avisos a cada
pantalla y de qué enlaces antiguos se siguen aceptando. Las rutas viven en
`src/app/core/owner-routes.ts` (frontend) y `backend/src/common/owner-links.ts`
(enlaces de las notificaciones); si una cambia, cambia en los dos.

## Acceso por rol

`roleGuard` (`src/app/core/role.guard.ts`) limita cada rol a su área:

| Rol | Puede abrir | Si intenta otra área |
|---|---|---|
| A | `/a/*`; `/b/*` solo con una sesión de soporte activa del despacho elegido | sin sesión, vuelve a `/a/admins/:id?support=required`, que abre el diálogo del modo soporte |
| B | `/b/*` | `/b/overview` |
| C | `/c/*` | `/c/community` |

El servidor lo exige igualmente: `SupportAccessGuard` rechaza al rol A en
rutas de cliente (también las lecturas) sin `X-Support-Session`
(`odd/tasks/role-a-panel.md`, L51).

## Menús

**Barra lateral**

- GENERAL: Mi comunidad (`/c/community`).
- OPERACIONES: Incidencias (`/c/incidencias`), Documentación
  (`/c/documentacion`), Mensajes (`/c/messages`, con el contador de no
  leídos), Juntas (`/c/juntas`) y Recibos y pagos (`/c/recibos`).
- SISTEMA: Mi perfil (`/c/settings`).

**Barra superior**

- Mensajes (`/c/messages`, con contador).
- La campana: últimas alertas, con «Ver alertas» (`/c/alerts`) y
  «Ver avisos (n)» (`/c/notifications`).

**Menú de cuenta**

Mi perfil (`/c/settings`), tema, legal y cerrar sesión. El rol C no tiene una
«Configuración» aparte.

Las dos bandejas siguen separadas a propósito:

- **Alertas** (`/c/alerts`): feed derivado de recibos, juntas, documentos e
  incidencias.
- **Avisos** (`/c/notifications`): notificaciones del servidor (solicitudes,
  mensajes, juntas cerradas, comunicados urgentes, inspecciones…).

Cada bandeja enlaza con la otra.

**Pantallas secundarias**, sin entrada propia en el menú:

- Actividad (`/c/activity`): se abre desde «Ver todas» de la tarjeta de
  actividad de Mi comunidad; su breadcrumb es «Mi comunidad › Actividad».
- Ficha de una propiedad (`/c/properties/:id`): pestañas Resumen,
  Comunicados y, si la comunidad tiene instalaciones reservables, Reservas.

## Módulos y parámetros

| Ruta | Alcance | Parámetros |
|---|---|---|
| `/c/incidencias` | comunidad | `estateId`, `issue`, `new=1` |
| `/c/documentacion` | comunidad | `doc`, `onlyNew=1` |
| `/c/juntas` | propiedad (voto y delegación son de la propiedad) | `propertyId`, `estateId`, `meeting` |
| `/c/recibos` | propiedad | `propertyId`, `receipt` |
| `/c/properties/:id` | propiedad | `tab=summary\|communications\|reservas` |

El selector de la cabecera es el mismo en todos los módulos
(`OwnerScopeService`). «Todas mis propiedades» muestra todas a la vez.

## Enlaces de las notificaciones

| Aviso | Enlace del rol C |
|---|---|
| Recibo nuevo | `/c/recibos?propertyId=` |
| Recordatorio de recibo | `/c/recibos?propertyId=&receipt=` |
| Junta celebrada o cancelada | `/c/juntas?estateId=&meeting=` |
| Comunicado urgente o fehaciente | `/c/properties/:id?tab=communications` o, si es de toda la comunidad, `/c/community?tab=communications&estateId=` |
| Reserva cancelada por la gestora | `/c/properties/:id?tab=reservas` |
| Adhesión aprobada / rechazada | `/c/properties/:id` / `/c/community` |
| Incidencia | `/c/incidencias?issue=` |
| Documentos compartidos | `/c/documentacion?doc=` o `/c/documentacion` |
| Mensaje directo | `/c/messages` |
| Inspección programada | `/c/alerts` (no hay pantalla de revisiones) |

## Enlaces antiguos que se siguen aceptando

Las notificaciones guardan su enlace al crearse, así que estos se redirigen en
lugar de migrarse:

| Enlace antiguo | Destino |
|---|---|
| `/c/properties` | `/c/community`, conservando la query |
| `/c/requests` | `/c/incidencias` |
| `/c/community?issue=` o `?tab=issues` | `/c/incidencias` |
| `/c/community?tab=communications\|reservas` (y `/c/properties?tab=…`) | la ficha de la propiedad del propietario en esa finca (`estateId`), la indicada (`propertyId`), la elegida o la primera |
| `/c/community?tab=receipts\|juntas` | `/c/recibos` y `/c/juntas` |
| `/c/properties/:id?tab=issues\|documents` | `/c/incidencias` y `/c/documentacion` |
| `/c/properties/:id?tab=receipts\|juntas` | `/c/recibos?propertyId=:id` y `/c/juntas?propertyId=:id` |

## Pendiente

- Dentro de una sesión de soporte, `SupportAccessGuard` deja en la petición
  el despacho de la sesión (`@SupportDespacho()`). Los listados y búsquedas de
  fincas que cruzan despachos (`estates`, `estates/overview` y su export,
  `estates/setup-summary`, `estates/management-search`) se acotan a él cuando
  no llevan `?administratorId=`. El resto de lecturas cuyo despacho no se puede
  deducir se permiten dentro de la sesión y se auditan sin despacho: para
  acotarlas, cada una debería leer también `@SupportDespacho()`.
