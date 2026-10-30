# ADomo — Propuesta de Modelo de Datos

> Informe exhaustivo derivado del análisis completo de pantallas, tabs, paneles, modales y
> mock-data del proyecto Angular **ADomo / Domora**. El objetivo es proponer un modelo de
> datos persistente (relacional) capaz de almacenar toda la información que actualmente
> está distribuida entre `models.ts`, `mock-data.ts` y los signals locales de cada
> componente.

---

## 0. Resumen ejecutivo

La aplicación cubre tres roles concéntricos:

| Rol | Persona | Ámbito |
|-----|---------|--------|
| **A** | Super-admin de la plataforma | Gestiona las cuentas de los administradores de fincas (modelo SaaS B2B) |
| **B** | Administrador de fincas | Gestiona N fincas, propiedades, incidencias, contabilidad, remesas, morosidad |
| **C** | Propietario / Inquilino | Vinculado a 1..N propiedades; consulta recibos, incidencias, comunicados, reservas |

El modelo de datos debe soportar de forma simultánea:

1. **Multi-tenancy SaaS** — los datos del rol B viven bajo un `administrator_id` (tenant).
2. **Multi-rol por usuario** — un mismo `User` puede ser propietario de una finca y a la
   vez inquilino de otra; debe modelarse vía tabla de membresías.
3. **Trazabilidad temporal** — incidencias, gestiones de morosidad, actividad de admin y
   timeline de solicitudes requieren `created_at`, `actor_id`, append-only.
4. **Conciliación contable** — recibos ↔ remesas ↔ movimientos ↔ extracto bancario.
5. **Estados y workflows** — incidencias, recibos, remesas, morosidad tienen máquinas
   de estados explícitas que conviene modelar con enums + tablas de transición.

Convenciones de la propuesta:

- Todos los `id` son `UUID` v4 (excepto enums y `code` de plan de cuentas).
- `created_at` y `updated_at` `TIMESTAMPTZ` con default `now()` en todas las tablas
  transaccionales.
- Importes monetarios como `NUMERIC(12,2)` (euros con 2 decimales). Nunca `FLOAT`.
- Fechas "puras" como `DATE`; fechas con hora como `TIMESTAMPTZ`.
- Borrado lógico (`deleted_at TIMESTAMPTZ NULL`) en entidades con histórico relevante.
- Nombres de tabla en **plural snake_case** (`estates`, `issue_timeline_entries`).
- Enums se proponen como `CHECK` constraints o tipos `ENUM` (según motor).

---

## 1. Dominio plataforma (Rol A — SaaS)

### 1.1 `administrators` (tenant raíz)

Cada fila representa una gestora de fincas (cliente de pago de la plataforma).

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID PK | |
| `business_name` | TEXT | Nombre comercial / razón social mostrada |
| `cif` | TEXT UNIQUE | Identificador fiscal (CIF / NIF) |
| `contact_name` | TEXT | Persona de contacto |
| `contact_email` | TEXT | |
| `phone` | TEXT | |
| `plan_tier` | ENUM `plan_tier` | BASE / STANDARD / PREMIUM |
| `users_max` | INT | Cupo contratado (tramo) |
| `users_active` | INT | Recalculado por trigger sobre `users` |
| `mrr` | NUMERIC(10,2) | Importe mensual recurrente vigente |
| `status` | ENUM `admin_status` | Activa / Periodo de gracia / Vencida / Bloqueada |
| `block_reason` | TEXT NULL | Solo si status = Bloqueada |
| `discount_pct` | NUMERIC(5,2) NULL | Descuento vigente |
| `discount_reason` | TEXT NULL | |
| `discount_until` | DATE NULL | |
| `subscription_start` | DATE | |
| `subscription_end` | DATE | "endDate" en el mock |
| `notes` | TEXT NULL | Notas internas del super-admin |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

**Enums:**
- `plan_tier`: `BASE`, `STANDARD`, `PREMIUM`.
- `admin_status`: `Activa`, `PeriodoGracia`, `Vencida`, `Bloqueada`.

**Índices:** `(status)`, `(subscription_end)` para alertas de vencimiento.

### 1.2 `administrator_billing` (1:1 con `administrators`)

Separado por ciclo de vida distinto (cambia con frecuencia, no debe versionar al admin).

| Campo | Tipo |
|-------|------|
| `administrator_id` | UUID PK FK → administrators |
| `business_name` | TEXT |
| `cif` | TEXT |
| `address` | TEXT |
| `email` | TEXT |
| `payment_method` | ENUM (`Domiciliación`, `Tarjeta`, `Transferencia`) |
| `iban` | TEXT NULL |
| `updated_at` | TIMESTAMPTZ |

### 1.3 `administrator_invoices`

Facturas emitidas a la gestora.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `administrator_id` | UUID FK |
| `invoice_no` | TEXT UNIQUE | (mock: campo `no`) |
| `issue_date` | DATE |
| `amount` | NUMERIC(10,2) |
| `status` | ENUM (`Pagada`, `Pendiente`, `Vencida`) |
| `created_at` | TIMESTAMPTZ |

### 1.4 `administrator_activity` (log de auditoría rol A)

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `administrator_id` | UUID FK |
| `event_type` | ENUM (`login`, `plan_change`, `discount`, `invoice`, `signup`, `block`, `message`) |
| `title` | TEXT |
| `author` | TEXT | (referenciará `users.id` cuando se introduzca el modelo de usuarios) |
| `occurred_at` | TIMESTAMPTZ |

**Recomendación:** sustituir `author TEXT` por `author_user_id UUID FK → users` cuando
exista el modelo de usuarios reales.

### 1.5 Sistema de planes y suscripciones (extraído de `SuscripcionComponent`)

#### `plans`

Catálogo de planes vigentes (datos públicos, no por tenant).

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `tier` | ENUM `plan_tier` UNIQUE |
| `name` | TEXT |
| `price_monthly` | NUMERIC(10,2) |
| `price_annual` | NUMERIC(10,2) |
| `max_fincas` | INT |
| `max_props` | INT |
| `storage_gb` | INT |
| `feature_flags` | JSONB | Lista de features incluidas |
| `created_at` | TIMESTAMPTZ |

#### `plan_tiers_users` (tramos de usuarios)

Para escalar el precio según tamaño de la gestora.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `plan_id` | UUID FK |
| `users_max` | INT |
| `price_monthly` | NUMERIC(10,2) |

#### `addons` y `addon_subscriptions`

```
addons(id, code, name, unit, price, description)
addon_subscriptions(id, administrator_id, addon_id, active, started_at, ended_at)
```

Códigos vistos en el diseño: `storage`, `sms_pack`, `sla_support`, `white_label_portal`.

---

## 2. Identidad y acceso (modelo de usuarios — **falta crear**)

Actualmente no existe entidad `User`; los nombres se almacenan como strings sueltos
(`Issue.owner`, `Movement.supplier`, `GestionEntry.author`). Esto es la mayor deuda
estructural del modelo y se propone solventarla así:

### 2.1 `users`

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `email` | TEXT UNIQUE |
| `password_hash` | TEXT |
| `full_name` | TEXT |
| `nif` | TEXT NULL |
| `phone` | TEXT NULL |
| `colegiado` | TEXT NULL | Solo para rol B |
| `language` | TEXT DEFAULT 'es' |
| `timezone` | TEXT DEFAULT 'Europe/Madrid' |
| `currency` | TEXT DEFAULT 'EUR' |
| `date_format` | TEXT DEFAULT 'DD/MM/YYYY' |
| `two_fa_enabled` | BOOLEAN |
| `api_access` | BOOLEAN |
| `last_login_at` | TIMESTAMPTZ |
| `created_at` | TIMESTAMPTZ |
| `updated_at` | TIMESTAMPTZ |
| `deleted_at` | TIMESTAMPTZ NULL |

### 2.2 `user_sessions`

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `user_id` | UUID FK |
| `device` | TEXT |
| `location` | TEXT |
| `ip` | INET |
| `created_at` | TIMESTAMPTZ |
| `last_seen_at` | TIMESTAMPTZ |
| `revoked_at` | TIMESTAMPTZ NULL |

### 2.3 `roles` y `user_roles`

Un usuario puede tener varios roles a la vez (un admin de fincas puede a su vez ser
propietario de una vivienda en otra gestora).

```
roles(id, code ENUM('A','B','C'), name)
user_roles(user_id, role_id, administrator_id NULL, granted_at, revoked_at)
```

`administrator_id` se usa para acotar rol B/C al tenant correspondiente.

### 2.4 `user_notification_prefs`

Tabla normalizada (un fila por canal × categoría).

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `user_id` | UUID FK |
| `category` | ENUM (`impagos`, `adhesion`, `vencimientos`, `juntas`, `incidencias`, `documentos`, `pagos`, `comunicados`) |
| `channel` | ENUM (`email`, `push`, `sms`) |
| `enabled` | BOOLEAN |

### 2.5 `user_privacy_prefs` (solo rol C)

```
user_id PK FK,
data_share BOOLEAN,
commercial BOOLEAN
```

### 2.6 `integrations` (rol B)

```
integrations(id, administrator_id, code, status ENUM('connected','disconnected'),
            config JSONB, connected_at, updated_at)
```

Códigos del diseño: `sepa_banking`, `esign`, `external_doc_manager`, `owner_portal`.

---

## 3. Dominio espacial (Fincas y Propiedades)

Este es el núcleo geográfico. Hoy hay dos vistas paralelas (`Property` admin vs
`OwnerProperty` propietario) que conviene unificar en una sola tabla `properties`.

### 3.1 `estates` (fincas)

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `administrator_id` | UUID FK → administrators |
| `name` | TEXT |
| `type` | ENUM `estate_type` (`Edificio`, `Urbanización`, `Garaje`, `Trasteros`, `Local`) |
| `address` | TEXT |
| `location` | TEXT |
| `province` | TEXT |
| `country` | TEXT DEFAULT 'ES' |
| `postal_code` | TEXT NULL |
| `cif` | TEXT NULL | CIF de la comunidad de propietarios |
| `iban` | TEXT NULL |
| `accent_color` | TEXT NULL | Hex computado en UI; opcional persistir |
| `year_built` | INTEGER NULL | Año de construcción (1500–2100) |
| `main_use` | VARCHAR(50) NULL | Lista cerrada: `Residencial`, `Mixto`, `Comercial`, `Oficinas`, `Garajes y trasteros`, `Otro` |
| `internal_ref` | VARCHAR(50) NULL | Referencia interna de la gestora (ej. `FIN-0001`) |
| `tax_regime` | VARCHAR(150) NULL | Régimen fiscal de la comunidad |
| `applicable_law` | VARCHAR(150) NULL DEFAULT 'Ley de Propiedad Horizontal' | Normativa aplicable |
| `notes` | VARCHAR(2000) NULL | Observaciones internas de la gestora |
| `parcel_area_m2` | DECIMAL(10,2) NULL | Superficie de la parcela según el Catastro (no editable a mano) |
| `latitude`, `longitude` | DECIMAL(9,6) NULL | Ubicación WGS84 para el mapa; ambos o ninguno (CHECK) |
| `geo_source` | VARCHAR(20) NULL | `catastro`, `nominatim` o `seed` |
| `geo_resolved_at` | TIMESTAMPTZ NULL | Último intento de ubicarla, con o sin éxito |
| `created_at` | TIMESTAMPTZ |
| `updated_at` | TIMESTAMPTZ |
| `archived_at` | TIMESTAMPTZ NULL |

> **Campos derivados** (NO almacenar; calcularse en consulta o vista materializada):
> `properties_count`, `residents_count`, `pending_requests`, `occupancy_pct`.

> **Datos generales (pestaña de solo lectura del rol B).** Los campos de
> datos generales se editan en «Editar finca»; la pestaña los muestra junto a
> lo que se deriva en `GET estates/:id/general-overview` (nº de propiedades,
> coeficientes, superficie construida, ejercicio fiscal, cuenta bancaria por
> defecto con su subcuenta 572, administrador, cargos vigentes, contactos
> clave, documentos esenciales y pólizas vigentes).
>
> **Ubicación.** La calcula el backend (`EstateGeoService`) al crear la finca,
> al cambiar de verdad su dirección o referencia catastral y, para las fincas
> anteriores, la primera vez que se abre la pestaña: primero el Catastro
> (`Consulta_CPMRC` por la referencia de la parcela, y la superficie de
> parcela por el WFS INSPIRE de parcelas) y, si no, Nominatim por la
> dirección (1 petición/s, con User-Agent propio). `GEOCODING_ENABLED=false`
> y `CATASTRO_ENABLED=false` lo desactivan (DEMO_MODE fuerza ambos).

### 3.2 `properties` (unidades/propiedades dentro de una finca)

Unifica `Property` (admin) y `OwnerProperty` (propietario).

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `estate_id` | UUID FK NULL | NULL = propiedad sin finca vinculada (caso `Casa de verano` del mock) |
| `type` | ENUM `property_type` (`Piso`, `Casa`, `Parking`, `Trastero`, `Local`) |
| `ref` | TEXT | Código corto interno (ej. `1A`, `P-14`, `L-01`) |
| `label` | TEXT | Etiqueta libre que asigna el propietario (ej. `Vivienda habitual`) |
| `address` | TEXT NULL | Suele heredarse de la finca |
| `floor` | TEXT NULL |
| `door` | TEXT NULL |
| `staircase` | TEXT NULL |
| `quota_monthly` | NUMERIC(10,2) NULL | Cuota mensual de comunidad |
| `status` | ENUM `property_status` (`Ocupado`, `Vacío`, `Reservado`) |
| `iban` | TEXT NULL | Cuenta de cargo asociada a la unidad |
| `mandate_ref` | TEXT NULL | Referencia de mandato SEPA |
| `created_at` | TIMESTAMPTZ |
| `updated_at` | TIMESTAMPTZ |

**Índices:** `(estate_id)`, `(status)`, `(ref, estate_id)` UNIQUE.

### 3.3 `property_memberships` (relación N:M entre `users` y `properties`)

Una propiedad puede tener varios usuarios vinculados (propietario + inquilino +
representante). Un usuario puede estar en varias propiedades. Esto resuelve el problema
actual de `Property.owner` siendo un string.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `property_id` | UUID FK |
| `user_id` | UUID FK |
| `role_type` | ENUM (`Propietario`, `Inquilino`, `Representante`, `Otro`) |
| `linkage_status` | ENUM (`none`, `pending`, `linked`, `revoked`) |
| `requested_at` | TIMESTAMPTZ NULL |
| `approved_at` | TIMESTAMPTZ NULL |
| `approved_by` | UUID FK → users NULL |
| `revoked_at` | TIMESTAMPTZ NULL |
| `is_primary` | BOOLEAN | Marca el contacto principal de cobro |
| `is_key_contact` | BOOLEAN DEFAULT false | «Contacto clave» de la finca (lo marca la gestora en el listado de propiedades; también existe en `external_owners`) |

**Índices:** UNIQUE `(property_id, user_id, role_type)`.

> Reemplaza el actual `OwnerProperty.linked` + `linkageStatus` + `OwnerProperty.estate`
> string + `AdhesionRequest`.

### 3.4 `adhesion_requests` (solicitudes de adhesión)

Aunque la membresía con `linkage_status='pending'` ya cubre el caso, conviene una
entidad explícita por la metadata de validación.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `property_id` | UUID FK NULL | NULL si el usuario solicita alta de una propiedad inexistente |
| `estate_id` | UUID FK | Finca de destino |
| `user_id` | UUID FK | Quien solicita |
| `role_type` | ENUM | Rol al que aspira |
| `submitted_at` | TIMESTAMPTZ |
| `resolved_at` | TIMESTAMPTZ NULL |
| `resolved_by` | UUID FK NULL |
| `decision` | ENUM (`approved`, `rejected`) NULL |
| `notes` | TEXT NULL |

### 3.5 `property_events` (eventos asociados a una propiedad)

Reemplaza `OwnerProperty.nextEvent` (actualmente embebido). Permite tener histórico.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `estate_id` | UUID FK | Los eventos son de finca, no de propiedad |
| `title` | TEXT |
| `event_date` | DATE |
| `event_time` | TIME |
| `location` | TEXT |
| `room` | TEXT NULL |
| `kind` | ENUM (`junta_ordinaria`, `junta_extraordinaria`, `obras`, `mantenimiento`, `otro`) |
| `created_at` | TIMESTAMPTZ |

---

## 4. Incidencias

### 4.1 `issues`

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `ref` | TEXT UNIQUE | Formato `#INC-YYYY-NNN` |
| `property_id` | UUID FK |
| `estate_id` | UUID FK | Denormalizado para consultas rápidas a nivel finca |
| `type` | ENUM `issue_type` (`Avería`, `Ruido`, `Daño estructural`, `Fuga`, `Seguridad`, `Limpieza`, `Otro`) |
| `title` | TEXT |
| `description` | TEXT |
| `status` | ENUM `issue_status` (`Abierta`, `En reparación`, `Pendiente proveedor`, `Resuelta`, `Cerrada`) |
| `priority` | ENUM (`Normal`, `Urgente`) |
| `source` | ENUM (`Propietario`, `Comunidad`) |
| `reported_at` | TIMESTAMPTZ |
| `reported_by_user_id` | UUID FK → users |
| `resolved_at` | TIMESTAMPTZ NULL |
| `created_at` | TIMESTAMPTZ |
| `updated_at` | TIMESTAMPTZ |

### 4.2 `issue_photos`

```
id PK, issue_id FK, url TEXT, uploaded_at, uploaded_by_user_id FK
```

### 4.3 `issue_timeline_entries`

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `issue_id` | UUID FK |
| `author_user_id` | UUID FK → users |
| `author_role` | ENUM (`Propietario`, `Administrador`, `Sistema`) |
| `text` | TEXT |
| `kind` | ENUM (`comment`, `status_change`, `provider_assigned`, `budget_updated`, `notification_sent`, `system`) |
| `metadata` | JSONB NULL | Estado antiguo/nuevo, etc. |
| `created_at` | TIMESTAMPTZ |

### 4.4 `issue_providers` (asignación de proveedor a una incidencia)

Refactoriza los campos `provider`, `providerCategory`, `providerPhone`,
`providerResolutionDate` del modelo actual hacia una entidad reutilizable.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `issue_id` | UUID FK |
| `supplier_id` | UUID FK → suppliers NULL | Si el proveedor existe en el catálogo |
| `provider_name` | TEXT | Snapshot al momento de asignar |
| `category` | TEXT |
| `phone` | TEXT |
| `estimated_resolution_date` | DATE |
| `assigned_at` | TIMESTAMPTZ |
| `assigned_by_user_id` | UUID FK |

### 4.5 `issue_budgets`

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `issue_id` | UUID FK |
| `amount` | NUMERIC(10,2) |
| `description` | TEXT |
| `approved` | BOOLEAN |
| `approved_at` | TIMESTAMPTZ NULL |
| `approved_by_user_id` | UUID FK NULL |

### 4.6 `issue_notifications`

```
id PK, issue_id FK, sent_at TIMESTAMPTZ, recipients_count INT,
channel ENUM('email','push','sms'), sent_by_user_id FK
```

Permite histórico real (no solo `notifiedDate` + `notifiedCount`).

---

## 5. Comunicados, documentos y alertas

### 5.1 `communications` (comunicados a la comunidad)

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `estate_id` | UUID FK |
| `title` | TEXT |
| `body` | TEXT |
| `published_at` | TIMESTAMPTZ |
| `published_by_user_id` | UUID FK |
| `pinned` | BOOLEAN |

### 5.2 `communication_reads` (estado leído por usuario)

```
communication_id PK FK, user_id PK FK, read_at TIMESTAMPTZ
```

Reemplaza el `Communication.unread` global del mock.

### 5.3 `documents` y `document_folders` (biblioteca de la finca)

Plan y decisiones: `odd/tasks/documentos-finca.md`. Esquema real en `backend/prisma/schema.prisma`.

**`document_folders`**: árbol de carpetas por finca.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID PK | |
| `estate_id` | UUID FK | |
| `parent_id` | UUID FK NULL | NULL = carpeta raíz; nunca ella misma (CHECK) |
| `name` | VARCHAR(120) | no vacío (CHECK); único sin mayúsculas entre hermanas (servicio) |
| `visibility` | `DocumentVisibility` NULL | NULL = hereda del padre; nunca `PROPERTY` (CHECK) |
| `system_key` | VARCHAR(40) NULL | las 7 carpetas de plantilla; únicas por finca, no se borran ni se mueven |
| `sort_order` | INT | |
| `deleted_at` | TIMESTAMPTZ NULL | borrado lógico (solo carpetas vacías) |

**`documents`** (columnas de la biblioteca):

| Campo | Tipo | Notas |
|-------|------|-------|
| `folder_id` | UUID FK NULL | NULL = raíz de la biblioteca |
| `visibility` | `DocumentVisibility` NULL | propia («Visibilidad propia»); NULL = hereda de la carpeta |
| `effective_visibility` | `DocumentVisibility` | **desnormalizada**: la recalcula `LibraryService.recompute` en cada cambio; por defecto `MANAGER` |
| `target_property_id` | UUID FK NULL | obligatoria si la visibilidad es `PROPERTY` (CHECK) |
| `mime_type`, `size_bytes` | TEXT, INT | el contenido se valida por firma (magic bytes) al subir |
| `source`, `source_ref` | `DocumentSource`, VARCHAR(100) | `generated` + `meeting:<id>` para actas firmadas; único por finca |
| `visibility_review_pending` | BOOLEAN | documentos previos a la biblioteca que quedaron en `MANAGER` |
| `deleted_at` | TIMESTAMPTZ NULL | papelera |

`DocumentVisibility`: `MANAGER` (solo gestora) · `BOARD` (presidente y vicepresidentes vigentes,
de `EstateOfficeTerm`) · `OWNERS` (propietarios y representantes vinculados, nunca inquilinos) ·
`PROPERTY` (los de una propiedad). **Toda lectura** de documentos para un usuario pasa por
`documentVisibleWhere()` (`backend/src/documents/document-access.service.ts`); un spec guardián
falla si aparece una consulta nueva sin revisar. El ACL del asistente (RAG) se deriva de
`effective_visibility` con `ragAclFor`.

### 5.4 `document_reads`

```
document_id PK FK, user_id PK FK, read_at TIMESTAMPTZ
```

Reemplaza el `Document.isNew`.

### 5.5 `alerts` (notificaciones del rol C)

Las "alertas" actuales son una **vista derivada** de incidencias, recibos, comunicados,
documentos y juntas. Se proponen dos enfoques:

**Opción A — vista materializada `alerts_view`** (recomendada):
- Una `UNION ALL` sobre `issues`, `receipts`, `communications`, `documents`,
  `property_events` filtrada por `user_id` vía `property_memberships`.
- Estado leído en una tabla `alert_reads(user_id, source_type, source_id, read_at)`.

**Opción B — tabla `alerts` denormalizada** (si se necesita performance):
- `id, user_id, source_type, source_id, type, title, description, urgent, created_at, read_at`.
- Poblada por triggers o jobs.

---

## 6. Solicitudes / Tickets (rol C → rol B)

Pantalla `/c/requests` (`SolicitudesCComponent`). Entidad implícita que conviene
formalizar — distinta de `adhesion_requests` y de `issues`.

### 6.1 `tickets`

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `ref` | TEXT UNIQUE |
| `property_id` | UUID FK |
| `created_by_user_id` | UUID FK |
| `assigned_to_user_id` | UUID FK NULL | El admin que atiende |
| `type` | ENUM (`Incidencia`, `Documentación`, `Modificación`, `Consulta`, `Queja`) |
| `title` | TEXT |
| `description` | TEXT |
| `priority` | ENUM (`Normal`, `Urgente`) |
| `status` | ENUM (`Abierta`, `EnCurso`, `Resuelta`, `Cerrada`) |
| `created_at` | TIMESTAMPTZ |
| `closed_at` | TIMESTAMPTZ NULL |

### 6.2 `ticket_timeline_entries`

Misma forma que `issue_timeline_entries`.

> **Decisión de diseño:** mantener `tickets` y `issues` separados aunque sean parecidos
> — `issues` cubre el flujo de mantenimiento físico con proveedor/presupuesto, mientras
> que `tickets` es un canal genérico de consulta administrativa. Compartir un tronco
> común "abstract `requests`" se desaconseja por mezclar workflows.

---

## 7. Contabilidad

> **SUPERADO (2026-09-30).** Esta sección (7 y 8) es un diseño especulativo de
> antes de que existiera ninguna implementación — ni siquiera la de
> `Movement` (libro de caja de una sola cuenta), que a su vez se eliminó por
> completo en la fase 8 de la migración a partida doble. Hoy la contabilidad
> es un diario de partida doble real (`journal_entries`/`journal_lines`,
> `chart_accounts` con naturaleza y `system_role`, `receipts`/
> `supplier_invoices` con partida abierta verificada por triggers, `bank_
> accounts`/`bank_statements`, `fiscal_years`, saldos iniciales con asiento
> de apertura, intereses de demora, modelos fiscales 111/190/347, cierre de
> ejercicio real…). Las tablas de aquí abajo (`accounting_estates`,
> `movements`, `reconciliations`…) no existen en el esquema actual. Fuente
> de verdad: [`doc/contabilidad/roadmap-partida-doble.md`](../doc/contabilidad/roadmap-partida-doble.md)
> (detalle fase a fase, con los commits) y
> [`doc/contabilidad/adr-partida-doble.md`](../doc/contabilidad/adr-partida-doble.md)
> (decisiones D1-D23). Se deja esta sección tal cual, sin reescribir, como
> registro histórico de por dónde arrancó el diseño.

### 7.1 `accounting_estates` (suplemento contable de la finca)

> Alternativa: fusionar con `estates` añadiendo los campos. Se propone tabla aparte
> porque la finca puede existir antes de tener cuentas activas.

| Campo | Tipo |
|-------|------|
| `estate_id` | UUID PK FK |
| `iban` | TEXT |
| `reserve_target` | NUMERIC(12,2) | Objetivo del fondo de reserva |
| `fiscal_year_start` | DATE |
| `enabled` | BOOLEAN |

**Campos derivados (NO almacenar):** `balance`, `income`, `expenses`, `reserve`,
`delinquency`. Calcular sobre `movements` con `SUM(...) FILTER (...)`.

### 7.2 `chart_accounts` (plan contable)

Maestro (mismo para todos los tenants o por tenant según contrato).

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `administrator_id` | UUID FK NULL | NULL = catálogo global |
| `code` | TEXT |
| `name` | TEXT |
| `account_type` | ENUM (`income`, `expense`, `transfer`, `asset`, `liability`) |
| `parent_code` | TEXT NULL | Para jerarquía |

**Índice:** UNIQUE `(administrator_id, code)`.

### 7.3 `suppliers` (proveedores)

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `administrator_id` | UUID FK |
| `name` | TEXT |
| `category` | TEXT |
| `nif` | TEXT NULL |
| `email` | TEXT NULL |
| `phone` | TEXT NULL |
| `contact_name` | TEXT NULL | Persona de contacto en el proveedor |
| `iban` | TEXT NULL |
| `created_at` | TIMESTAMPTZ |

**Campos derivados:** `last_invoice_date`, `ytd_spend`, `pending_invoices_count`.

#### 7.3.1 `supplier_visits` (visitas de un proveedor a la finca)

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID PK | |
| `supplier_id` | UUID FK → suppliers | ON DELETE CASCADE |
| `estate_id` | UUID FK → estates | |
| `scheduled_at` | TIMESTAMPTZ | Fecha y hora previstas |
| `purpose` | VARCHAR(200) | Motivo (revisión, reparación, presupuesto…) |
| `status` | ENUM `supplier_visit_status` (`planificada`, `realizada`, `cancelada`) | Solo una `planificada` se edita o se cierra |
| `notes` | TEXT NULL | Las de cierre se añaden a las existentes |
| `asset_id` | UUID FK → assets NULL | Instalación (opcional); ON DELETE SET NULL |
| `issue_id` | UUID FK → issues NULL | Incidencia (opcional); ON DELETE SET NULL |
| `completed_at` | TIMESTAMPTZ NULL | Cuándo se marcó como realizada |
| `cancelled_at` | TIMESTAMPTZ NULL | Cuándo se canceló |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

**Índices:** `(supplier_id, scheduled_at)` y `(estate_id, scheduled_at)`.
**Derivados (panel de Proveedores):** «próxima visita» = la `planificada` más cercana desde hoy; «últimas intervenciones» = las `realizada` más recientes de la finca.

> **Contratos con proveedores (`supplier_contracts`).** Cada contrato guarda
> servicio, vigencia, renovación, coste y un `contract_number` opcional
> (VARCHAR(50)) con el nº de contrato o de póliza. Los **seguros de la
> comunidad** son contratos con un proveedor de categoría «Seguros» (la
> aseguradora): la pestaña «Datos generales» muestra los vigentes. No
> confundir con el tipo de documento de proveedor «Seguro», que es el seguro
> del propio proveedor.

### 7.4 `movements` (libro mayor)

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `estate_id` | UUID FK |
| `movement_date` | DATE |
| `concept` | TEXT |
| `account_id` | UUID FK → chart_accounts |
| `type` | ENUM (`income`, `expense`, `transfer`) |
| `amount` | NUMERIC(12,2) | Signo: positivo ingreso, negativo gasto |
| `running_balance` | NUMERIC(12,2) NULL | Calculado por trigger u offline |
| `supplier_id` | UUID FK NULL |
| `reference` | TEXT NULL | Nº factura, etc. |
| `notes` | TEXT NULL |
| `reversed_movement_id` | UUID FK NULL | Auto-FK para contrapartidas |
| `created_at` | TIMESTAMPTZ |
| `created_by_user_id` | UUID FK |

### 7.5 `bank_extract_entries`

Líneas de extracto bancario importadas.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `estate_id` | UUID FK |
| `extract_date` | DATE |
| `concept` | TEXT |
| `amount` | NUMERIC(12,2) |
| `bank_ref` | TEXT NULL |
| `imported_at` | TIMESTAMPTZ |
| `import_batch_id` | UUID NULL |

### 7.6 `reconciliations`

Empareja líneas de `bank_extract_entries` con `movements`.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `bank_entry_id` | UUID FK |
| `movement_id` | UUID FK |
| `matched_at` | TIMESTAMPTZ |
| `matched_by_user_id` | UUID FK |
| `match_method` | ENUM (`auto`, `manual`) |

**Constraint:** UNIQUE `(bank_entry_id)` y UNIQUE `(movement_id)` — un emparejamiento por lado.

### 7.7 `budget_periods` y `budget_items`

```
budget_periods(id, estate_id, fiscal_year INT, started_at, ended_at, status ENUM('draft','approved','closed'))
budget_items(id, budget_period_id FK, chart_account_id FK, category TEXT,
             budgeted NUMERIC(12,2), executed NUMERIC(12,2) DERIVED)
```

`executed` debe calcularse, NO almacenarse.

---

## 8. Recibos y periodos contables

> **SUPERADO** — ver el aviso al principio de la sección 7. `receipts` hoy
> tiene `kind`/`outstanding`/`origin_year`/asiento de emisión y ciclo de
> vida real; `accounting_periods` se mantiene, pero como trazabilidad de
> importaciones, no como control del ejercicio (eso es `fiscal_years`).

### 8.1 `accounting_periods`

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `estate_id` | UUID FK |
| `period_key` | TEXT | `YYYY-MM` |
| `label` | TEXT | "Mayo 2026" |
| `month_abbrev` | TEXT | "may" |
| `issued_at` | DATE NULL |
| `closed_at` | DATE NULL |

UNIQUE `(estate_id, period_key)`.

### 8.2 `receipts`

Unifica `Receipt` (simple, rol C) y `AccountingReceipt` (detallado, rol B). El rol C verá
una proyección filtrada.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `receipt_no` | TEXT |
| `period_id` | UUID FK |
| `property_id` | UUID FK |
| `owner_user_id` | UUID FK | Titular obligado al pago (snapshot del propietario primario) |
| `concept` | TEXT |
| `kind` | ENUM (`Cuota ordinaria`, `Derrama`, `Extra`) |
| `amount` | NUMERIC(10,2) |
| `iban` | TEXT NULL |
| `mandate_ref` | TEXT NULL |
| `due_date` | DATE |
| `status` | ENUM `receipt_status` (`Pagada`, `Pendiente`, `Devuelto`) |
| `payment_method` | ENUM `pay_method` (`Domiciliación`, `Transferencia`, `Efectivo`, `PagoEnOficina`, `Bizum`, `Devolución`, `Pendiente`) |
| `is_manual` | BOOLEAN | True si el admin lo creó a mano |
| `include_in_remesa` | BOOLEAN |
| `return_code` | TEXT NULL | "AM04", etc. |
| `return_reason` | TEXT NULL |
| `paid_at` | TIMESTAMPTZ NULL |
| `returned_at` | TIMESTAMPTZ NULL |
| `created_at` | TIMESTAMPTZ |

**Índices:** `(property_id)`, `(period_id, status)`, `(owner_user_id, status)`.

---

## 9. SEPA / Remesas

### 9.1 `remesas`

Cabecera de cada remesa SEPA.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `estate_id` | UUID FK |
| `period_id` | UUID FK NULL |
| `scheme` | ENUM (`CORE`, `B2B`) |
| `concept` | TEXT |
| `status` | ENUM `remesa_status` (`Borrador`, `Presentada`, `Cobrada`, `ConDevoluciones`) |
| `lines_count` | INT |
| `total_amount` | NUMERIC(12,2) |
| `presented_at` | DATE NULL |
| `charge_date` | DATE NULL |
| `created_at` | TIMESTAMPTZ |
| `created_by_user_id` | UUID FK |

**Campos derivados:** `charged_count`, `returned_count`, `pending_count`,
`returned_amount` → calcular sobre `remesa_lines`.

### 9.2 `remesa_lines`

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `remesa_id` | UUID FK |
| `receipt_id` | UUID FK | Vincula al recibo origen |
| `property_id` | UUID FK |
| `owner_user_id` | UUID FK |
| `iban` | TEXT |
| `mandate_ref` | TEXT |
| `mandate_seq` | ENUM (`FRST`, `RCUR`) |
| `amount` | NUMERIC(10,2) |
| `status` | ENUM (`Cobrado`, `Pendiente`, `Devuelto`) |
| `return_code` | TEXT NULL |
| `return_reason` | TEXT NULL |

UNIQUE `(remesa_id, receipt_id)`.

### 9.3 `mandates` (mandatos SEPA — nueva entidad)

Conviene formalizar el mandato para llevar la secuencia FRST/RCUR.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `property_id` | UUID FK |
| `owner_user_id` | UUID FK |
| `iban` | TEXT |
| `mandate_ref` | TEXT UNIQUE |
| `signed_at` | DATE |
| `first_use_at` | DATE NULL |
| `revoked_at` | TIMESTAMPTZ NULL |
| `status` | ENUM (`active`, `revoked`, `pending_signature`) |

Permite que `remesa_lines.mandate_seq` se calcule automáticamente:
si `first_use_at IS NULL` → FRST; si no → RCUR.

---

## 10. Morosidad

### 10.1 `debtors`

Aunque podría derivarse de `receipts` con `status='Pendiente'`, conviene una entidad
explícita por el workflow de reclamación.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `property_id` | UUID FK |
| `owner_user_id` | UUID FK |
| `estate_id` | UUID FK | Denormalizado |
| `principal_amount` | NUMERIC(12,2) | Suma de recibos pendientes |
| `interest_amount` | NUMERIC(12,2) |
| `months_overdue` | INT |
| `oldest_period_id` | UUID FK |
| `last_contact_at` | DATE NULL |
| `reminder_l1_sent` | BOOLEAN |
| `reminder_l2_sent` | BOOLEAN |
| `burofax_sent` | BOOLEAN |
| `step` | ENUM (`SinGestionar`, `AvisoEnviado`, `EnReclamación`, `SinRespuesta`, `AcciónJudicial`) |
| `updated_at` | TIMESTAMPTZ |

> **Recomendación:** mantener `debtors` como **vista materializada** refrescada por
> trigger sobre `receipts` para campos como `principal_amount`, `months_overdue`. Los
> campos workflow (`step`, `reminder_*`) sí son persistentes.

### 10.2 `debtor_actions` (= `GestionEntry`)

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `debtor_id` | UUID FK |
| `action_type` | ENUM (`Llamada`, `Email`, `CartaAmistosa`, `CartaFormal`, `Burofax`, `AcciónJudicial`) |
| `action_date` | DATE |
| `note` | TEXT |
| `result` | TEXT NULL |
| `next_action` | TEXT NULL |
| `next_action_at` | DATE NULL |
| `author_user_id` | UUID FK |
| `created_at` | TIMESTAMPTZ |

### 10.3 `payment_agreements` (acuerdos de pago)

Hoy se calcula dinámicamente; persistirlo permite cobrar conforme al plan.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `debtor_id` | UUID FK |
| `total_amount` | NUMERIC(12,2) |
| `down_payment_pct` | NUMERIC(5,2) |
| `installments_count` | INT |
| `first_due_date` | DATE |
| `status` | ENUM (`active`, `completed`, `breached`, `cancelled`) |
| `signed_at` | TIMESTAMPTZ |

### 10.4 `payment_agreement_installments`

```
id PK, agreement_id FK, seq INT, due_date DATE, amount NUMERIC(10,2),
paid_at TIMESTAMPTZ NULL, receipt_id FK NULL
```

### 10.5 `dunning_letters` (envíos en bulk)

```
id PK, batch_id, debtor_id FK, letter_type ENUM, channel ENUM,
message_template_id FK NULL, sent_at, sent_by_user_id FK
```

---

## 11. Reservas de zonas comunes

### 11.1 `amenities`

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `estate_id` | UUID FK | Las amenities son de finca, no de propiedad |
| `name` | TEXT |
| `icon` | TEXT |
| `color_hex` | TEXT |
| `color_bg_hex` | TEXT |
| `max_hours_per_booking` | INT |
| `capacity` | INT NULL | Aforo máximo |
| `rules` | TEXT |
| `seasonal` | BOOLEAN |
| `season_label` | TEXT NULL |
| `active` | BOOLEAN |
| `created_at` | TIMESTAMPTZ |

### 11.2 `amenity_slots`

Horarios disponibles (uno por slot semanal recurrente).

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `amenity_id` | UUID FK |
| `weekday` | INT 0-6 NULL | NULL = todos los días |
| `start_time` | TIME |
| `end_time` | TIME |
| `active` | BOOLEAN |

### 11.3 `bookings`

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `amenity_id` | UUID FK |
| `property_id` | UUID FK |
| `user_id` | UUID FK | Quien reserva |
| `booking_date` | DATE |
| `start_time` | TIME |
| `end_time` | TIME |
| `guests` | INT |
| `notes` | TEXT NULL |
| `status` | ENUM (`confirmed`, `completed`, `cancelled`, `no_show`) |
| `created_at` | TIMESTAMPTZ |
| `cancelled_at` | TIMESTAMPTZ NULL |
| `cancellation_reason` | TEXT NULL |

**Constraint clave:** garantizar no-solape:
```sql
EXCLUDE USING gist (
  amenity_id WITH =,
  tsrange(booking_date + start_time, booking_date + end_time) WITH &&
) WHERE (status = 'confirmed')
```

---

## 12. Actividad / Auditoría

### 12.1 `activity_log` (genérico)

Reemplaza `MOCK_ACTIVITIES` y unifica los feeds de actividad.

| Campo | Tipo |
|-------|------|
| `id` | UUID PK |
| `actor_user_id` | UUID FK NULL |
| `subject_type` | TEXT | "issue", "receipt", "communication", "document", "booking", "movement" |
| `subject_id` | UUID |
| `verb` | TEXT | "created", "updated", "deleted", "status_changed" |
| `summary` | TEXT |
| `metadata` | JSONB |
| `occurred_at` | TIMESTAMPTZ |
| `estate_id` | UUID FK NULL | Para particionar feeds |
| `property_id` | UUID FK NULL |

**Índices:** `(estate_id, occurred_at DESC)`, `(property_id, occurred_at DESC)`,
`(subject_type, subject_id)`.

> **Decisión:** mantener `administrator_activity` separada (es para rol A, lectura
> exclusiva del super-admin). El resto cae en `activity_log`.

---

## 13. Enumeraciones — resumen consolidado

| Enum | Valores |
|------|---------|
| `role` | A, B, C |
| `plan_tier` | BASE, STANDARD, PREMIUM |
| `admin_status` | Activa, PeriodoGracia, Vencida, Bloqueada |
| `admin_pay_method` | Domiciliación, Tarjeta, Transferencia |
| `admin_invoice_status` | Pagada, Pendiente, Vencida |
| `admin_activity_type` | login, plan_change, discount, invoice, signup, block, message |
| `estate_type` | Edificio, Urbanización, Garaje, Trasteros, Local |
| `property_type` | Piso, Casa, Parking, Trastero, Local |
| `property_status` | Ocupado, Vacío, Reservado |
| `membership_role_type` | Propietario, Inquilino, Representante, Otro |
| `linkage_status` | none, pending, linked, revoked |
| `issue_type` | Avería, Ruido, DañoEstructural, Fuga, Seguridad, Limpieza, Otro |
| `issue_status` | Abierta, EnReparación, PendienteProveedor, Resuelta, Cerrada |
| `issue_priority` | Normal, Urgente |
| `issue_source` | Propietario, Comunidad |
| `timeline_kind` | comment, status_change, provider_assigned, budget_updated, notification_sent, system |
| `ticket_type` | Incidencia, Documentación, Modificación, Consulta, Queja |
| `ticket_status` | Abierta, EnCurso, Resuelta, Cerrada |
| `receipt_status` | Pagada, Pendiente, Devuelto |
| `pay_method` | Domiciliación, Transferencia, Efectivo, PagoEnOficina, Bizum, Devolución, Pendiente |
| `receipt_kind` | CuotaOrdinaria, Derrama, Extra |
| `movement_type` | income, expense, transfer |
| `chart_account_type` | income, expense, transfer, asset, liability |
| `sepa_scheme` | CORE, B2B |
| `mandate_seq` | FRST, RCUR |
| `mandate_status` | active, revoked, pending_signature |
| `remesa_status` | Borrador, Presentada, Cobrada, ConDevoluciones |
| `remesa_line_status` | Cobrado, Pendiente, Devuelto |
| `debtor_step` | SinGestionar, AvisoEnviado, EnReclamación, SinRespuesta, AcciónJudicial |
| `gestion_type` | Llamada, Email, CartaAmistosa, CartaFormal, Burofax, AcciónJudicial |
| `agreement_status` | active, completed, breached, cancelled |
| `booking_status` | confirmed, completed, cancelled, no_show |
| `document_type` | acta, presupuesto, reglamento, contrato, factura, informe, otro |
| `document_visibility` | public, owners, admins |
| `notification_channel` | email, push, sms |
| `notification_category` | impagos, adhesion, vencimientos, juntas, incidencias, documentos, pagos, comunicados |
| `integration_code` | sepa_banking, esign, external_doc_manager, owner_portal |
| `event_kind` | junta_ordinaria, junta_extraordinaria, obras, mantenimiento, otro |

---

## 14. Diagrama relacional (texto)

```
                  ┌────────────────────┐
                  │ administrators (A) │ ◄────── plans
                  └─────────┬──────────┘
       ┌────────────────────┼──────────────────────────────────┐
       ▼                    ▼                                  ▼
 admin_billing      admin_invoices                       integrations
                                                              │
                                                              ▼
                                                        addon_subscriptions

  administrators (1) ──N── estates ──N── properties ──N── property_memberships ──N── users
                                │                                                      ▲
                                │                                                      │
                                ├──N── property_events                                 │
                                │                                                      │
                                ├──N── communications ──N── communication_reads ───────┤
                                │                                                      │
                                ├──N── documents ──N── document_reads ─────────────────┤
                                │                                                      │
                                ├──N── adhesion_requests ──────────────────────────────┤
                                │                                                      │
                                ├──N── amenities ──N── amenity_slots                   │
                                │              └──N── bookings ────────────────────────┤
                                │                                                      │
                                ├──N── accounting_periods ──N── receipts ──N── remesa_lines
                                │                                  │             │
                                │                                  │             ▼
                                ├──N── remesas ────────────────────┘          remesas
                                │
                                ├──N── movements ──N── reconciliations ──N── bank_extract_entries
                                │                                              ▲
                                │                                              │
                                ├──N── budget_periods ──N── budget_items       │
                                │                                              │
                                ├──N── chart_accounts ◄────────────────────────┘
                                │
                                ├──N── suppliers ◄── movements
                                │
                                └──N── debtors ──N── debtor_actions
                                                └──N── payment_agreements ──N── installments
                                                └──N── dunning_letters

  properties ──N── mandates (SEPA) ──N── remesa_lines
  properties ──N── issues ──N── issue_timeline_entries
                       └──N── issue_photos
                       └──N── issue_providers ──┐
                       └──N── issue_budgets     │
                       └──N── issue_notifications
                                                ▼
                                          suppliers

  properties ──N── tickets ──N── ticket_timeline_entries

  todos los flujos ──► activity_log (feed unificado)
  rol A ──► administrator_activity (separado)
```

---

## 15. Gaps detectados en el modelo actual → propuesta

| # | Problema actual | Propuesta |
|---|-----------------|-----------|
| 1 | No existe entidad `User`; nombres son strings | Tabla `users` + `user_roles` + `property_memberships` |
| 2 | `Property` (admin) y `OwnerProperty` (rol C) son entidades paralelas | Unificar en `properties` única + vista filtrada por rol |
| 3 | `OwnerProperty.estate` es string al nombre de la finca | FK `estate_id` UUID |
| 4 | `Issue.owner` / `Movement.supplier` son strings | FKs a `users` y `suppliers` |
| 5 | `AdhesionRequest` y `OwnerProperty.linkageStatus` solapados | Tabla `adhesion_requests` + `property_memberships.linkage_status` |
| 6 | `Solicitud` (rol C) definido inline en componente | Tabla `tickets` |
| 7 | `Alerta` (rol C) definido inline | Vista `alerts_view` + `alert_reads` |
| 8 | `Issue.notifiedDate`/`notifiedCount` solo un envío | Tabla `issue_notifications` con histórico |
| 9 | `Issue.provider*` campos planos | Tabla `issue_providers` + `suppliers` |
| 10 | Mandato SEPA solo es string `mandate` | Tabla `mandates` con secuencia FRST/RCUR auto |
| 11 | `Movement.account` = `"628 · Suministros"` (mezcla código y nombre) | FK `account_id` a `chart_accounts` |
| 12 | `Debtor.history` embebido | Tabla `debtor_actions` |
| 13 | `acuerdoPlan` solo se calcula, no se persiste | Tablas `payment_agreements` + `installments` |
| 14 | `Receipt` (simple) vs `AccountingReceipt` (detallado) duplicados | Tabla única `receipts` con proyección |
| 15 | `Booking` no garantiza no-solape | Exclusion constraint GIST |
| 16 | Campos derivados (`occupancy`, `delinquencyRate`, `mrr`) persistidos | Vistas o triggers, NUNCA columnas frías |
| 17 | Sin auditoría unificada de cambios | Tabla `activity_log` + triggers |
| 18 | `Communication.unread` global (no por usuario) | Tabla `communication_reads` |
| 19 | `Document.isNew` global (no por usuario) | Tabla `document_reads` |
| 20 | Sin separación multi-tenant explícita | `administrator_id` en todas las tablas raíz + RLS |

---

## 16. Multi-tenancy y seguridad

Toda tabla raíz (`estates`, `users` rol B/C, `suppliers`, `chart_accounts`, `tickets`,
`movements`, …) debe llevar `administrator_id` (o ser alcanzable por una cadena de
FKs hasta `administrator_id`). Sobre PostgreSQL se recomienda **Row Level Security**:

```sql
ALTER TABLE estates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON estates
  USING (administrator_id = current_setting('app.administrator_id')::uuid);
```

Para rol C, las policies se acotan vía `property_memberships`:

```sql
CREATE POLICY owner_can_read_issues ON issues
  USING (property_id IN (
    SELECT property_id FROM property_memberships
    WHERE user_id = current_setting('app.user_id')::uuid
      AND linkage_status = 'linked'
  ));
```

---

## 17. Índices clave recomendados

| Tabla | Índice | Justificación |
|-------|--------|---------------|
| `estates` | `(administrator_id, archived_at)` | Listado del rol B |
| `properties` | `(estate_id, status)` | Tabla de unidades |
| `property_memberships` | `(user_id, linkage_status)` | Dashboard del rol C |
| `issues` | `(estate_id, status, priority)` | Filtros + contadores activos |
| `issues` | `(property_id, created_at DESC)` | Vista de incidencias por unidad |
| `receipts` | `(period_id, status)` | KPIs por periodo |
| `receipts` | `(property_id, due_date)` | Vista propietario |
| `movements` | `(estate_id, movement_date DESC)` | Libro mayor cronológico |
| `bank_extract_entries` | `(estate_id, extract_date)` | Conciliación |
| `remesas` | `(estate_id, presented_at DESC)` | Histórico de remesas |
| `bookings` | `(amenity_id, booking_date)` | Calendario |
| `activity_log` | `(estate_id, occurred_at DESC)` | Feed rol B |
| `activity_log` | `(property_id, occurred_at DESC)` | Feed rol C |

---

## 18. Vistas y materialized views recomendadas

| Vista | Propósito |
|-------|-----------|
| `vw_estate_kpis` | `estate_id, properties_count, residents_count, pending_requests, occupancy_pct, balance, income, expenses, reserve_pct, delinquency_pct` |
| `vw_property_kpis` | `property_id, balance, pending_docs_count, open_issues_count, next_event_id` |
| `vw_receipt_kpis_by_period` | `period_id, total, cobrado, pendiente, devuelto, count_each` |
| `vw_remesa_kpis` | `remesa_id, charged_count, returned_count, pending_count, charged_amount, returned_amount` |
| `vw_debtor_aggregates` | Vista materializada de `debtors` desde `receipts` |
| `vw_supplier_aggregates` | `supplier_id, last_invoice_date, ytd_spend, pending_invoices_count` |
| `mvw_user_feed` | Feed unificado por usuario (incidencias + recibos + comunicados + documentos + eventos) |

---

## 19. Plan de migración desde el mock actual

1. **Fase 1 — Esqueleto**: `administrators`, `users`, `roles`, `user_roles`, `estates`,
   `properties`, `property_memberships`. Datos seed: convertir `MOCK_ESTATES`,
   `MOCK_OWNER_PROPERTIES` y `MOCK_PROPERTIES` (fusionando duplicados por `ref + estate`).
2. **Fase 2 — Workflows**: `issues`, `issue_*`, `tickets`, `ticket_*`, `adhesion_requests`,
   `documents`, `communications`. Migrar `ISSUE_CATALOG`.
3. **Fase 3 — Contabilidad**: `chart_accounts`, `suppliers`, `movements`,
   `bank_extract_entries`, `reconciliations`, `accounting_periods`, `receipts`.
   Migrar `MOCK_MOVEMENTS`, `BANK_EXTRACT`, `ACCT_PERIODS`, `ACCT_RECEIPTS`.
4. **Fase 4 — SEPA**: `mandates`, `remesas`, `remesa_lines`. Migrar `REMESA_CANDIDATES`,
   `REMESAS_HISTORY`, `REMESA_LINES_MAY`.
5. **Fase 5 — Morosidad**: `debtors`, `debtor_actions`, `payment_agreements`,
   `dunning_letters`. Migrar `MOCK_DEBTORS`.
6. **Fase 6 — Reservas**: `amenities`, `amenity_slots`, `bookings`. Migrar
   `AMENITY_CATALOG`, `OTHER_BOOKINGS`, `INITIAL_BOOKINGS`.
7. **Fase 7 — Plataforma rol A**: `plans`, `plan_tiers_users`, `addons`,
   `administrator_billing`, `administrator_invoices`, `administrator_activity`,
   `integrations`. Migrar `MOCK_ADMINS`.
8. **Fase 8 — Observabilidad**: `activity_log` + triggers, vistas materializadas, índices,
   RLS, jobs de refresco.

---

## 20. Anexo — tabla de correspondencia mock → modelo persistente

| Mock / Signal actual | Tabla destino | Notas |
|----------------------|---------------|-------|
| `MOCK_ADMINS` | `administrators` + tablas hijas | |
| `MOCK_ESTATES` | `estates` | Campos derivados se eliminan |
| `MOCK_PROPERTIES` | `properties` | Fusionar con MOCK_OWNER_PROPERTIES por `ref` |
| `MOCK_OWNER_PROPERTIES` | `properties` + `property_memberships` | |
| `MOCK_REQUESTS` | `adhesion_requests` | |
| `ISSUE_CATALOG` | `issues` + `issue_timeline_entries` | |
| `MOCK_ACTIVITIES` | `activity_log` | |
| `MOCK_RECEIPTS` | `receipts` (proyección rol C) | |
| `MOCK_COMMUNICATIONS` | `communications` | `unread` → `communication_reads` |
| `MOCK_DOCUMENTS` | `documents` | `isNew` → `document_reads` |
| `MOCK_ACCOUNTING_ESTATES` | `accounting_estates` + vistas | |
| `MOCK_MOVEMENTS` | `movements` | |
| `BANK_EXTRACT` | `bank_extract_entries` | |
| `CHART_ACCOUNTS` | `chart_accounts` | |
| `MOCK_SUPPLIERS` | `suppliers` | KPIs como vista |
| `MOCK_BUDGET` | `budget_items` + `budget_periods` | |
| `MOCK_DEBTORS` | `debtors` + `debtor_actions` | |
| `ACCT_PERIODS` | `accounting_periods` | |
| `ACCT_RECEIPTS` | `receipts` (detalle rol B) | |
| `REMESA_CANDIDATES` | Vista derivada sobre `receipts.include_in_remesa` | |
| `REMESAS_HISTORY` | `remesas` | |
| `REMESA_LINES_MAY` | `remesa_lines` | |
| `AMENITY_CATALOG` | `amenities` + `amenity_slots` | |
| `OTHER_BOOKINGS` | `bookings` con `status='confirmed'` (de otros usuarios) | |
| `INITIAL_BOOKINGS` | `bookings` | |
| `LINK_ESTATES` | Vista sobre `estates` filtrada por disponibilidad | |
| `state.selectedEstate / selectedProperty` | No persistir — estado de sesión | |
| `Solicitud[]` (inline) | `tickets` + `ticket_timeline_entries` | |
| `Alerta[]` (inline) | `alerts_view` + `alert_reads` | |

---

## 21. Decisiones de diseño abiertas (pendientes de confirmar con producto)

1. **¿`chart_accounts` global o por gestora?** El diseño actual sugiere un plan común,
   pero la regulación contable de comunidades en España no obliga uno único. Propuesta:
   tabla global + override por gestora.
2. **¿Permitir un usuario en varias gestoras (rol B)?** Sí: `user_roles` admite varias
   filas. La UI tendría que ofrecer un selector de tenant en login.
3. **¿`activity_log` como append-only inmutable o con borrado?** Recomendación:
   append-only, sin `UPDATE`/`DELETE` permitidos por policy.
4. **¿Histórico de recibos cuando cambia el titular de una propiedad?** El recibo
   guarda `owner_user_id` snapshot al emitirse; cambiar la membresía posteriormente no
   re-asigna recibos pasados.
5. **¿Soft delete vs hard delete?** Soft delete (`deleted_at`) en `estates`, `properties`,
   `users`, `suppliers`. Hard delete en logs/timeline (nunca).
6. **¿Cómo modelar votaciones de junta?** No hay diseño actual; se reserva entidad
   `assembly_votes` para futuras versiones.

---

*Generado a partir del análisis exhaustivo del proyecto. Última actualización: 2026-06-29.*

---

## Apéndice A — Separación multi-tenant (implementación in-app, gap #4 resuelto)

Como primer paso para resolver el gap más crítico (datos cruzados entre gestoras),
se ha introducido en la aplicación un modelo de tenant explícito **a nivel de UI y
de datos mock**, replicando en cliente lo que en una arquitectura real haría
PostgreSQL con Row Level Security.

### Cambios en el modelo (`src/app/core/models.ts`)

| Entidad | Campo nuevo | Tipo | Justificación |
|---------|-------------|------|---------------|
| `Administrator` | `id` | `string` | Identificador estable del tenant (antes solo `cif` distinguía registros). |
| `Estate` | `administratorId` | `string` | FK al tenant propietario de la finca. |
| `OwnerProperty` | `administratorId` | `string \| null` | Tenant de la finca vinculada; `null` si la propiedad no está vinculada todavía. |
| `OwnerProperty` | `estateId` | `string \| null` | FK directa a `Estate.id` (sustituye el string `estate`). |
| `AccountingEstate` | `administratorId` | `string` | Tenant de la finca contable. |
| `Supplier` | `administratorId` | `string` | Tenant propietario del proveedor. |
| `Debtor` | `administratorId` | `string` | Tenant propietario del moroso. |
| `Debtor` | `estateId` | `string` | Finca a la que pertenece el moroso. |

> Los campos `estate` y `admin` heredados como string se mantienen como
> compatibilidad de presentación (etiquetas mostradas al usuario rol C que aún no
> entienden el id). Se eliminarán en una refactorización posterior cuando la
> migración a backend persista los nombres en una proyección.

### Constantes de tenant (`src/app/core/mock-data.ts`)

Identificadores estables para evitar comparaciones por nombre:

```ts
ADMIN_ID_MEDITERRANEA = 'adm-mediterranea'
ADMIN_ID_NORIEGA      = 'adm-noriega'    // tenant por defecto (rol B)
ADMIN_ID_TORRES       = 'adm-torres'
ADMIN_ID_BALCELLS     = 'adm-balcells'
ADMIN_ID_RIPOLL       = 'adm-ripoll'
```

Distribución de fincas demo entre tenants:

| Finca | Tenant |
|-------|--------|
| `e1` Edificio Eixample Centro | `ADMIN_ID_NORIEGA` |
| `e2` Urbanización Les Alzines | `ADMIN_ID_NORIEGA` |
| `e3` Garaje Plaça Catalunya | **`ADMIN_ID_BALCELLS`** (demostración de aislamiento) |
| `e4` Trasteros Diagonal Mar | `ADMIN_ID_NORIEGA` |

### Capa de seguridad (3 servicios nuevos)

1. **`TenantContextService`** (`src/app/core/tenant-context.service.ts`)
   - Mantiene el signal `currentAdministratorId` con la gestora activa.
   - Expone `canAccess(resourceAdministratorId)` y `assertAccess(...)`.
   - `switchAdministrator(id)` rechaza saltos a tenants no accesibles para el rol
     actual (lanza `TenantAccessDeniedError`).
   - `bootstrapFromRole(role)` reinicializa el tenant al cambiar de rol (login).

2. **`DataService`** (`src/app/core/data.service.ts`)
   - Repositorio único: todo acceso a `MOCK_*` de tablas tenant-sensitive pasa
     por aquí.
   - Métodos `listEstates`, `listAccountingEstates`, `listSuppliers`,
     `listDebtors`, etc. devuelven SOLO los recursos del tenant activo.
   - `findEstateById(id)`, `findAccountingEstateById(id)` lanzan
     `TenantAccessDeniedError` si el id existe pero pertenece a otro tenant.
   - `createEstate(...)` asigna automáticamente el `administratorId` actual,
     impidiendo crear datos para otro tenant aunque la UI lo intentara.

3. **Guards de ruta** (`src/app/core/tenant.guard.ts`)
   - `tenantEstateGuard` protege `/b/estates/:id`.
   - `tenantAccountingGuard` protege `/b/accounting/:id`.
   - Ambos verifican el `id` de la URL antes de cargar el componente y redirigen
     a la lista correspondiente si pertenece a otro tenant. Esto impide
     cross-tenant access por **manipulación de URL** (caso típico de fuga de
     datos en SPAs).

### Defensa en profundidad

Cada acceso queda cubierto por **tres capas**:

1. **Filtro silencioso** en `DataService.list*()` — el componente ni siquiera ve
   datos ajenos al tenant.
2. **Aserción explícita** en `DataService.findById()` — si un componente recibe
   un id por URL, falla rápido.
3. **Guard de ruta** — si la URL apunta a otro tenant, ni siquiera se carga el
   componente.

Pendiente (en backend real):

- Replicar `administrator_id` en TODAS las tablas raíz a nivel SQL.
- Habilitar PostgreSQL Row Level Security con `current_setting('app.administrator_id')`.
- El JWT del usuario debe firmar el `administrator_id` para que el back no
  confíe en el header del cliente.

### Componentes migrados

- `DashboardBComponent` (lista de fincas + creación de finca)
- `EstateDetailComponent` (detalle de finca + incidencias)
- `AccountingDashboardComponent` (consolidado contable)
- `AccountingDetailComponent` (detalle de contabilidad de finca)
- `MorosidadTabComponent` (morosos)
- `ProveedoresTabComponent` (proveedores, incluye alta nueva con tenant auto)
- `SuscripcionComponent` (KPIs de uso del plan)
- `AddPropertyComponent` (nueva propiedad de rol C, con `estateId` y `administratorId`)
- `DashboardAComponent` (alta de nuevo admin con `id` UUID-like)

---

## Apéndice B — Modelo de usuarios (gap #1 resuelto)

Segundo gap crítico abordado: introducir una entidad `User` única global que
sustituya los strings sueltos (`owner`, `author`, `supplier`, …) dispersos por el
modelo. Las decisiones de diseño aplicadas:

### Decisiones de diseño

| # | Decisión | Aplicación |
|---|---------|------------|
| 1 | User = persona física global, una sola identidad cross-tenant. | Tabla `users` (mock: `MOCK_USERS`). |
| 2 | **UUID como PK** + `email NOT NULL UNIQUE` + `(taxIdCountry, taxId) UNIQUE`. | `User.id` UUID-like; los campos `email` y `taxId` son restricciones de integridad, no PK. |
| 3 | Suppliers separados de users. VAT añadido como campo opcional B2B. | `Supplier.vatNumber?`, `Supplier.taxIdCountry?`, `Supplier.taxId?`. |
| 4 | Tabla intermedia `property_memberships` N:M con `isPrimaryContact`. | `PropertyMembership` (mock: `MOCK_PROPERTY_MEMBERSHIPS`). |
| 5 | **FK viva + snapshot inmutable** en documentos fiscales/legales. | Campos `ownerUserId` + `ownerNameSnapshot` + `ownerTaxIdSnapshot` + `ibanSnapshot` en `Receipt`, `AccountingReceipt`, `RemesaLine`. |
| A | NIF obligatorio solo cuando la membresía lo requiera (regla A.3). | Mock: Roser Llopis con `taxId: null` (sin membresía primaria todavía). |
| B | Soportar tax IDs de la UE (no VAT, que solo aplica a empresas). | Enum `TaxIdCountry` con ES, PT, FR, DE, IT, AD, NL, BE, OTHER. |
| C | Representación legal modelada con `UserRepresentation`. | Mock: Carlos Rodríguez representa a Laura Puig vía `apoderamiento_general`. |

### ¿Por qué tax ID nacional y no VAT?

VAT (IVA comunitario) **solo lo tienen empresas y autónomos** registrados en VIES.
Un particular propietario de una vivienda **no tiene VAT**. Como en ADomo el ~95%
de los titulares son personas físicas, usar VAT como identificador fallaría desde
el primer alta.

La solución correcta es el **tax ID nacional** de cada país de la UE, que tiene
formato distinto pero todos los ciudadanos tienen uno:

| País | Identificador | Formato |
|------|---------------|---------|
| ES | NIF / NIE | 9 caracteres con letra |
| PT | NIF / NIPC | 9 dígitos |
| FR | NIR (personas) / SIREN (empresas) | 13-15 / 9 dígitos |
| DE | Steuer-ID | 11 dígitos |
| IT | Codice Fiscale | 16 alfanumérico |

`(taxIdCountry, taxId) UNIQUE` permite que un mismo `12345678Z` ES no choque con
un Codice Fiscale italiano que coincida casualmente.

VAT queda como campo opcional adicional en `Supplier` para el caso B2B
cross-border donde la gestora compra a un proveedor de fuera de España y necesita
declarar el VAT comunitario.

### Patrón FK viva + snapshot

Para documentos con valor legal (recibos, remesas SEPA, burofaxes, mandatos), un
solo registro guarda DOS referencias al titular:

1. **FK viva** (`ownerUserId`): apunta a `users.id`. Si el usuario cambia de
   nombre, el rol C verá los recibos actualizados en su panel.
2. **Snapshot inmutable** (`ownerNameSnapshot`, `ownerTaxIdSnapshot`,
   `ibanSnapshot`): se congela al emitir. El PDF regenerado del recibo de 2024
   muestra el nombre/NIF/IBAN tal y como estaban en 2024, cumpliendo la
   exigencia legal de que un documento contable sea regenerable idéntico.

**Aplicado en:**
- `Receipt`, `AccountingReceipt` (recibos contables)
- `RemesaLine` (líneas de remesa SEPA, ya enviadas al banco en XML pain.008)
- `Mandate` (mandato SEPA firmado)
- *Pendiente en backend real:* `DunningLetter`, `PaymentAgreement`,
  `AdministratorInvoice`.

**NO aplicado en datos "vivos"** (la FK basta y el cambio se refleja al instante):
incidencias, timeline, comentarios, alertas, comunicados, solicitudes.

### Auditoría con representación

Las `IssueTimelineEntry` y `GestionEntry` llevan dos campos opcionales nuevos:

```ts
authorUserId?: string;          // FK al actor real
onBehalfOfUserId?: string | null; // si actuó en nombre de otro usuario
```

Cuando Carlos Rodríguez ejecute una gestión por su representada Laura Puig, la
fila quedará:

```
authorUserId      = usr-carlos-rodriguez
onBehalfOfUserId  = usr-laura-puig
```

El servicio `DataService.canActOnBehalfOf(actor, represented, {estateId, propertyId})`
verifica que la representación esté activa, dentro del periodo de validez, y
alcance la finca/propiedad relevante antes de permitir la acción.

### Mandatos SEPA formalizados

El mandato SEPA estaba antes como string libre en `RemesaCandidate.mandate` y
`AccountingReceipt.mandate`. Ahora hay tabla `Mandate` (`MOCK_MANDATES`):

```ts
Mandate { id, ref, propertyId, titularUserId, iban, signedAt,
          firstUseAt?, revokedAt?, status }
```

La secuencia FRST/RCUR del XML pain.008 se calcula automáticamente:
`DataService.computeMandateSeq(mandateId)` devuelve `FRST` si `firstUseAt` es
null (mandato no usado todavía) y `RCUR` en caso contrario. Esto evita el error
clásico de enviar como FRST un mandato ya cobrado.

### Distribución geográfica de los datos de prueba

Como parte de este cambio se neutralizó el sesgo a Barcelona en el mock:

| Finca | Antes | Ahora |
|-------|-------|-------|
| `e1` Edificio Castellana 145 | Barcelona | **Madrid** |
| `e2` Urbanización Los Pinares | Castelldefels | **Valencia** |
| `e3` Garaje Plaza Mayor | Barcelona | **Sevilla** |
| `e4` Trasteros Abandoibarra | Barcelona | **Bilbao** |
| `p3` Casa de verano (rol C) | Sitges | **Marbella** |

### Nuevas entidades introducidas en `models.ts`

| Interface | Propósito |
|-----------|-----------|
| `User` | Persona física global con email y tax ID nacional. |
| `TaxIdCountry` | Enum ISO 3166-1 (ES, PT, FR, DE, IT, AD, NL, BE, OTHER). |
| `PropertyMembership` | N:M user ↔ property con `isPrimaryContact`, `roleType` y estado del vínculo. |
| `MembershipRoleType` | Propietario, Inquilino, Representante, Ocupante, Otro. |
| `UserRepresentation` | Representación legal entre usuarios (alcance, validez, tipo legal). |
| `RepresentationType` | tutela, curatela, apoderamiento_general, apoderamiento_especifico, herencia_yacente, representacion_legal. |
| `Mandate` | Mandato SEPA con `titularUserId` y `firstUseAt` para cálculo FRST/RCUR. |
| `MandateStatus` | active, revoked, pending_signature. |

### Campos añadidos a entidades existentes

| Entidad | Campos añadidos |
|---------|-----------------|
| `Administrator` | `primaryUserId?`, `vatNumber?` |
| `Supplier` | `taxIdCountry?`, `taxId?`, `vatNumber?` |
| `OwnerProperty` | `primaryUserId?` |
| `Debtor` | `userId?` |
| `Receipt` | `ownerUserId?`, `ownerNameSnapshot?`, `ownerTaxIdSnapshot?`, `ownerTaxIdCountrySnapshot?` |
| `AccountingReceipt` | `ownerUserId?`, `mandateId?`, `ownerNameSnapshot?`, `ownerTaxIdSnapshot?`, `ownerTaxIdCountrySnapshot?`, `ibanSnapshot?` |
| `RemesaLine` | `ownerUserId?`, `mandateId?`, `receiptId?`, `ownerNameSnapshot?`, `ownerTaxIdSnapshot?`, `ownerTaxIdCountrySnapshot?`, `ibanSnapshot?` |
| `IssueTimelineEntry` | `authorUserId?`, `onBehalfOfUserId?` |
| `GestionEntry` | `authorUserId?`, `onBehalfOfUserId?` |

> Los campos string legacy (`owner`, `author`, `supplier`, …) se mantienen como
> opcionales para no romper componentes ya migrados. Se eliminarán en una
> refactorización posterior cuando los componentes lean exclusivamente vía
> `DataService.resolveUserName(userId)`.

### Nuevos métodos en `DataService`

```ts
findUserById(id)
findUserByEmail(email)
findUserByTaxId(country, taxId)
resolveUserName(userId, fallback?)        // nombre vivo

listMembershipsByProperty(propertyId)
listMembershipsByUser(userId)
findPrimaryContact(propertyId)             // titular para cobros/comunicaciones

listActiveRepresentationsFor(userId, at?)
canActOnBehalfOf(actor, represented, {estateId?, propertyId?, at?})

findMandateById(id)
listActiveMandatesForProperty(propertyId)
computeMandateSeq(mandateId)              // 'FRST' | 'RCUR' automático
```

---

## Apéndice C — Unificación de `Property` y `OwnerProperty` (gap #2 resuelto)

Tercer gap crítico abordado: las dos entidades paralelas (admin DTO `Property`
y propietario DTO `OwnerProperty`) que duplicaban la información de la misma
unidad se han fusionado en una **entidad canónica única** con identificación
catastral completa.

### Decisiones aplicadas

| # | Decisión | Aplicación |
|---|---------|------------|
| 1 | Direccionamiento descompuesto alineado con la **DGC (Catastro)**. | Campos `viaType`, `viaName`, `streetNumber`, `streetNumberSuffix`, `block`, `staircase`, `floor`, `door`, `postalCode`, `municipality`, `province`, `country`, `cadastralReference`. |
| 2 | Nickname per usuario, no per propiedad. | Campo `nickname` en `PropertyMembership`. |
| 3 | Titulares no usuarios → tabla `external_owners`. | Interfaz `ExternalOwner`, mock `MOCK_EXTERNAL_OWNERS`, helper `DataService.findExternalOwner()`. |
| 4 | Casas privadas sin gestora permitidas. | `estateId NULL` y `administratorId NULL` válidos. Demo: `p3` Casa de verano de Laura, Marbella. |
| 5 | Rehecho mock completo para coherencia titularidad/membresía. | 15 propiedades repartidas entre 4 fincas + 1 privada; 15 membresías; 1 titular externo (Tienda El Sol S.L.). |
| 6 | KPIs (balance, openIssues, pendingDocs) calculados al vuelo en backend; en el mock se rellenan a mano. | Documentado como expectativa futura. |

### Por qué los campos catastrales

La Dirección General del Catastro identifica un inmueble inequívocamente mediante:

- **Referencia catastral** (`cadastralReference`): 20 caracteres alfanuméricos
  únicos asignados por la DGC. Es la PK natural de cualquier inmueble en España.
- **Descomposición postal** (vía, número, escalera, planta, puerta…): redundante
  con la referencia pero indispensable para:
  - Ordenar la tabla de propiedades de un edificio (1A, 1B, 2A, 2B…).
  - Generar el cuerpo de notificaciones, burofaxes y recibos PDF con el formato
    administrativo estándar.
  - Migrar datos desde herramientas que no usan referencia catastral.

Tener ambas formas hace el modelo compatible con AEAT, DGC, Registro de la
Propiedad y herramientas de terceros (Sage Despachos, Glasof, IDEALdomus, etc.).

### Cambios estructurales

#### Eliminada

- ❌ Antigua interfaz `Property` (DTO admin con `type/ref/floor/door/staircase/owner/roleType/status`).
- ❌ Antiguo mock `MOCK_PROPERTIES` (6 filas paralelas a OwnerProperty con datos incoherentes).

#### Renombrado conceptualmente

- ✅ `OwnerProperty` queda como entidad canónica de propiedad.
- ✅ Alias `type Property = OwnerProperty` para no romper imports legacy mientras
  se completa la migración de los componentes.
- ✅ Alias `export const MOCK_OWNER_PROPERTIES = MOCK_PROPERTIES` por la misma razón.

#### Campos añadidos a `OwnerProperty`

| Categoría | Campos |
|-----------|--------|
| Identificación catastral | `viaType`, `viaName`, `streetNumber`, `streetNumberSuffix`, `block`, `staircase`, `floor`, `door`, `postalCode`, `municipality`, `province`, `country`, `cadastralReference` |
| Referencia corta | `ref` |
| Ocupación | `status` (Ocupado/Vacío/Reservado) |

#### Campos marcados `@deprecated` en `OwnerProperty`

| Campo | Sustituto |
|-------|-----------|
| `address` (string plano) | `viaType + viaName + streetNumber + floor + door` |
| `location` | `municipality` |
| `roleType` | derivado de `PropertyMembership` para el usuario logueado |
| `linked`, `linkageStatus` | `PropertyMembership.status` |
| `estate` (string) | JOIN a `Estate.name` |
| `admin` (string) | JOIN a `Administrator.name` |
| `adminContact` | JOIN a `Administrator.primaryUserId → User.fullName` |
| `label` | `PropertyMembership.nickname` (per-usuario) |

### Nueva entidad `ExternalOwner`

Permite al admin registrar titulares conocidos que no son usuarios de la plataforma:

```ts
ExternalOwner {
  id, propertyId, fullName, taxIdCountry?, taxId?, email?, phone?,
  postalAddress?, roleType?, notes?,
  createdAt, createdByUserId,
  promotedToUserId? // se rellena cuando la persona se da finalmente de alta
}
```

Casos cubiertos:

- **Persona jurídica** (Tienda El Sol S.L. en `p11`): empresa propietaria/inquilina
  cuya entidad jurídica no es persona física → no entra como User.
- **Heredero pendiente**: titular real desconocido o pendiente de reparto sucesorio.
- **Banco propietario** tras embargo.

Cuando esa persona finalmente firma alta como User, se crea la membresía y se
marca `promotedToUserId` en el ExternalOwner — queda como histórico de
"así estaba antes del alta".

### Demo data — universo completo coherente

`MOCK_PROPERTIES` ahora contiene **15 unidades**:

| Id | Tipo | Ref | Finca | Titular | Notas |
|----|------|-----|-------|---------|-------|
| p1 | Piso | 2B | e1 Castellana 145 | María García | + Pere ocupante |
| p2 | Parking | P-14 | e1 | María García | Misma titular que p1 |
| p3 | Casa | — | NULL (privada) | Laura Puig | + Carlos representante legal |
| p4 | Piso | 1A | e1 | Juan Martínez | |
| p5 | Piso | 3C | e1 | — | **Vacío** |
| p6 | Piso | 4A | e1 | Carlos Rodríguez | |
| p7 | Piso | 5D | e1 | Laura Puig | |
| p8 | Piso | 6A | e1 | Miguel Vidal | |
| p9 | Piso | 6B | e1 | Roser Llopis | **Adhesión pendiente** |
| p10 | Piso | 7A | e1 | Núria Bonet | |
| p11 | Local | L-01 | e1 | (Tienda El Sol S.L.) | **External owner** |
| p12 | Piso | 3C-1 | e1 | Pere Soldevila | Moroso d1 |
| p13 | Parking | P-04 | e1 | Ana Pujol | |
| p14 | Parking | P-08 | e2 Los Pinares | Marc Esteve | Moroso d4 |
| p15 | Piso | 1B | e3 Plaza Mayor | Dolors Ferrer | Moroso d5, tenant Balcells |

Demuestra simultáneamente:
- 1 user → N propiedades (María con `p1`+`p2`).
- N usuarios → 1 propiedad (María titular + Pere ocupante en `p1`).
- Representación legal (Carlos representa a Laura en `p3`).
- Propiedad **vacía** sin titular (`p5`).
- Propiedad **privada** sin gestora (`p3`).
- Titular **externo** persona jurídica (`p11` Tienda El Sol S.L.).
- Adhesión **pendiente** (Roser en `p9`).
- Multi-tenant: `p15` pertenece a otra gestora (Balcells) — invisible para Noriega.

### KPIs derivados — calcular al vuelo

Como decidido, los campos `balance`, `pendingDocs`, `openIssues`, `nextEvent` se
calcularán al vuelo en backend:

```sql
SELECT p.*,
       COALESCE(-SUM(r.amount) FILTER (WHERE r.status = 'Pendiente'), 0) AS balance,
       COUNT(d.id) FILTER (WHERE d.read_at IS NULL) AS pending_docs,
       COUNT(i.id) FILTER (WHERE i.status IN ('Abierta','En reparación','Pendiente proveedor')) AS open_issues
FROM properties p
LEFT JOIN receipts r ON r.property_id = p.id
LEFT JOIN documents d ON d.property_id = p.id
LEFT JOIN issues i ON i.property_id = p.id
WHERE p.id = :propertyId
GROUP BY p.id
```

Si el rendimiento lo exige más adelante, se promociona a vista materializada
`vw_property_kpis` refrescada por triggers en `receipts`/`issues`/`documents`.
En el mock siguen rellenándose a mano para no romper la UI actual.

### Nuevos métodos en `DataService`

```ts
listPropertiesByEstate(estateId)           // todas las unidades de una finca (rol B)
findPropertyById(id)                       // con validación de tenant
findExternalOwner(propertyId)              // titular no-User si existe
listExternalOwnersByEstate(estateId)
```

### Componentes migrados

- `EstateDetailComponent` (pestaña Propiedades): ya no lee `MOCK_PROPERTIES`
  legacy; usa `data.listPropertiesByEstate(estate.id)` con tenant check. La
  columna "Titular" resuelve via `propertyTitular(p)` que devuelve el
  `User.fullName` del titular principal, o el `ExternalOwner.fullName`, o `—`.
  La columna "Modalidad" usa `propertyRoleType(p)` análogamente.
- `AddPropertyComponent`: añade campo `status: 'Ocupado'` al crear.

---

## Apéndice D — Eliminación de campos legacy string (gap #3 resuelto)

Cuarto gap crítico abordado: los strings `OwnerProperty.estate`,
`OwnerProperty.admin`, `OwnerProperty.adminContact`, `OwnerProperty.label`,
`OwnerProperty.address`, `OwnerProperty.location`, `OwnerProperty.roleType`,
`OwnerProperty.linked`, `OwnerProperty.linkageStatus` estaban denormalizados —
un rename en `MOCK_ESTATES.name` no se propagaba y las 15 filas del mock
podían quedar con datos obsoletos.

### Solución aplicada

1. **Introducida la interfaz `PropertyView`**: proyección resuelta con JOINs
   equivalente a lo que sería una VIEW en la BBDD.

   ```ts
   PropertyView {
     property: OwnerProperty,       // entidad canónica
     estate: Estate | null,         // JOIN por estateId
     admin: Administrator | null,   // JOIN por administratorId
     adminContact: User | null,     // JOIN por administrators.primaryUserId
     membership: PropertyMembership | null, // membresía del viewer
     // Campos vivos (nunca strings sueltos):
     estateName, adminName, adminContactName,
     nickname,           // ← membership.nickname (per-user)
     viewerRoleType,     // ← membership.roleType para el viewer
     isLinked,           // ← membership.status === 'linked'
     linkageStatus,      // ← membership.status
     addressFull,        // ← DataService.formatPostalAddress()
   }
   ```

2. **Nuevo `DataService.resolvePropertyView(propertyId, viewerUserId?)`**: única
   fuente de verdad para el "display" de una propiedad. Los componentes lo
   invocan una vez y ya no vuelven a tocar los strings.

3. **Componentes migrados**:
   - `DashboardCComponent` (sustituido después por `CommunityCComponent`, «Mi comunidad», en `features/community-c`): la lista "Mis propiedades" se construye a partir de
     `listMembershipsByUser(LOGGED_IN_USER_ID_C).map(m => resolvePropertyView(m.propertyId, userId))`.
     Cada tarjeta lee `view.nickname`, `view.estateName`, `view.addressFull`,
     `view.isLinked`, etc. — no más strings.
   - `PropertyDetailComponent`: nuevo getter `propertyView` que se usa en el
     `<app-topbar>`, cabecera, banner de vinculación, panel de datos, panel
     del administrador y modal de vinculación (7 accesos migrados). Añadida
     fila "Ref. catastral" que muestra `property.cadastralReference`.
   - `EstateDetailComponent`: `propertyAddressLine(p)` para el select de nueva
     incidencia; `propertyLabel` en la creación deriva de `type + ref`.

4. **Constante `LOGGED_IN_USER_ID_C`**: introducida en `mock-data.ts` para
   simular el usuario logueado del rol C (`usr-maria-garcia`). En backend
   real vendría del JWT.

5. **Campos legacy eliminados** de `OwnerProperty`:
   - ❌ `address`, `location`, `roleType`, `linked`, `linkageStatus`, `estate`,
     `admin`, `adminContact`, `label`.
   - ✅ Su información ahora se resuelve dinámicamente vía `PropertyView`.

6. **Mock limpio**: las 15 filas de `MOCK_PROPERTIES` ya no tienen bloque
   `// legacy` — solo campos canónicos catastrales + FKs.

### Propiedad de "rename automático"

Con el gap resuelto, un cambio en `MOCK_ESTATES` (por ejemplo, renombrar
`e1` a "Edificio Paseo 145 Norte") se propaga automáticamente a:

- Nombre de la finca en la tarjeta del rol C (vía `view.estateName`).
- Banner "Vinculada a…" en la pantalla de detalle.
- Panel "Comunidad" en el bloque de datos del inmueble.
- Cualquier futura pantalla que consuma `PropertyView`.

Ninguna fila del mock necesita actualizarse — la FK `estateId` sigue siendo
válida y `resolvePropertyView` re-lee el nombre en cada render.

### Método auxiliar

`DataService.formatPostalAddress(p)` genera la dirección postal española
estándar a partir de los campos DGC:

```
"Paseo de la Castellana, 145, esc. 1 2º B"
```

Es la única función que sabe cómo componer la dirección para display;
cualquier futuro cambio de formato se hace en un solo sitio.

---

## Apéndice E — Adhesiones, Tickets y Alertas (gaps #5, #6, #7 resueltos)

Tres gaps atacados en el mismo bloque porque comparten la misma raíz:
entidades inline en componentes / mock plano sin FKs.

### Gap #5 — `AdhesionRequest` ↔ `PropertyMembership` (opción A confirmada)

**Modelo aplicado:** el vínculo real vive en `PropertyMembership`; la
`AdhesionRequest` guarda solo la metadata de validación (quién solicitó,
quién resolvió, cuándo, decisión, motivo).

**Regla de coherencia:**
- Al crear una solicitud → membresía `pending` (visible para rol C).
- Al aprobar → adhesion_request.decision='approved', membership.status='linked'.
- Al rechazar → adhesion_request.decision='rejected', membership.status='revoked'.

**Efecto en la cuota del plan (rol B):** las membresías `pending` **NO
computan** en el conteo de usuarios activos del administrator. Solo las
`linked`. Método nuevo `DataService.countActiveUsersForAdministrator(id)`
implementa esta regla; `Administrator.usersActive` queda `@deprecated`
como campo persistente y debe calcularse en la BBDD via
`vw_admin_users_active(administrator_id, active_users)`.

**Nueva interfaz `AdhesionRequest`:**

```ts
AdhesionRequest {
  id, estateId, propertyId | null, userId, roleType,
  submittedAt, status: 'pending' | 'approved' | 'rejected',
  resolvedAt?, resolvedByUserId?, decision?, notes?
}
```

**Métodos en `DataService`:**

```ts
listAdhesionRequestsByEstate(estateId)
listPendingAdhesionRequestsByEstate(estateId)
approveAdhesion(requestId, byUserId)   // promueve membership → linked
rejectAdhesion(requestId, byUserId, notes?)  // membership → revoked
countActiveUsersForAdministrator(adminId)
```

Ambas mutaciones (aprobar/rechazar) actualizan atómicamente **tanto** la
`adhesion_request` **como** la `property_membership` — evita el estado
inconsistente entre las dos representaciones.

**Mock coherente:**
- `req1`: Roser Llopis pide `p9` con status='pending' → se corresponde con
  `pm10` de status='pending'.
- `req2`: Ana Pujol aprobada históricamente para `p13` (estado 'approved',
  membresía `pm13` linked).

### Gap #6 — `Ticket` (antes `Solicitud` inline)

**Entidad promovida** de definición inline a `models.ts`:

```ts
Ticket {
  id, ref, propertyId, createdByUserId, assignedToUserId?,
  type: 'Incidencia'|'Documentación'|'Modificación'|'Consulta'|'Queja',
  title, description, priority, status,
  createdAt, closedAt?,
  timeline: TicketTimelineEntry[]
}

TicketTimelineEntry {
  date, authorUserId, authorRole, text, kind?
}
```

**Diferencia con `Issue`:** un `Ticket` es un canal genérico rol C → rol B
(consulta, petición de documentación, permiso para modificación, queja).
Un `Issue` es el flujo formal de mantenimiento con proveedor + presupuesto
+ notificación a comunidad. Un ticket de tipo `Incidencia` puede
promoverse a Issue por el admin.

**Métodos en `DataService`:**

```ts
listTicketsByUser(userId)
findTicketById(id)
createTicket(input)          // asigna ref, status='Abierta', timeline inicial
updateTicketStatus(id, status, byUserId)  // registra en timeline como system
addTicketMessage(ticketId, entry)
```

**Componente migrado:** `SolicitudesCComponent` ya no lleva mock inline;
consume `data.listTicketsByUser(LOGGED_IN_USER_ID_C)` y proyecta a un
DTO `TicketRow` con nombres y etiquetas resueltos vía JOIN (nickname de
la membresía, nombre del autor via `resolveUserName`, etc.).

**Mock coherente** (4 tickets de María):
- tic1 (Incidencia, En curso, Urgente): puerta parking en `p2`.
- tic2 (Documentación, Resuelta): certificado corriente pago en `p1`.
- tic3 (Modificación, Abierta): permiso instalación toldo en `p1`.
- tic4 (Consulta, Resuelta): horario piscina en `p1`.

### Gap #7 — Alertas como vista derivada

**Modelo aplicado:** no hay tabla `alerts`. Las alertas son una PROYECCIÓN
(UNION ALL con discriminador `sourceType`) sobre las fuentes reales:

| sourceType | Origen | Tipo | Reglas de "urgente" |
|------------|--------|------|---------------------|
| `receipt` | recibos pendientes / cobrados | `pago` | Pendiente con `dueDate` < hoy |
| `issue` | incidencias del propietario | `incidencia` | Activa Y `priority='Urgente'` |
| `event` | eventos de la finca | `junta` | Próximo evento en < 3 días |
| `document` | documentos con `isNew=true` | `documento` | nunca |
| `communication` | comunicados de la finca | `comunidad` | nunca |

**Orden:** urgentes primero, luego por fecha descendente.

**Persistencia:** solo el estado leído/no-leído por usuario × recurso vive
en la tabla `alert_reads(userId, sourceType, sourceId, readAt)`. Cuando
el rol C marca leída una alerta, se inserta una fila; `listAlertsForUser`
resuelve el flag `read` en cada llamada.

**Interfaces nuevas:**

```ts
AlertItem {
  id, sourceType, sourceId, userId, type,
  title, description, date, urgent, propertyId?, propertyLabel?, read
}

AlertRead {
  userId, sourceType, sourceId, readAt
}
```

**Métodos en `DataService`:**

```ts
listAlertsForUser(userId)   // proyección con UNION ALL + orden
isAlertRead(userId, sourceType, sourceId)
markAlertRead(userId, sourceType, sourceId)
markAllAlertsRead(userId)
```

**Componente migrado:** `AlertasCComponent` ya no lleva mock inline;
consume `data.listAlertsForUser(LOGGED_IN_USER_ID_C)` en un `computed()`
versionado (se re-calcula al marcar leídas).

**Ventaja del enfoque:** cualquier cambio en el estado subyacente
(nuevo recibo, nueva incidencia, nuevo documento) genera automáticamente
la alerta correspondiente sin necesidad de sincronización manual.

---

## Apéndice F — Mandatos SEPA y generación pain.008 (gap #8 resuelto)

### Análisis normativo aplicado

- **Rulebook**: EPC016-06 (SDD Core) y EPC131-08 (SDD B2B).
- **Reglamento UE 260/2012** (obligación SEPA desde 01-nov-2016).
- **Cuaderno 19.14 AEB** — norma española para pain.008.001.02.
- **ISO 20022 pain.008.001.02** — esquema XML del envío al banco.
- **ISO 7064 mod 97-10** — dígitos de control del CID español.

### Errores detectados en el estado previo

1. **CID mal formado**. `NuevaRemesaComponent.creditorId` generaba:
   ```
   'ES76ZZZ' + CIF_de_la_gestora
   ```
   Problemas:
   - `76` no es un dígito de control válido — se calcula sobre el resto vía
     ISO 7064.
   - El CIF de la gestora **no** es el acreedor SEPA de las cuotas: el
     acreedor es la **comunidad de propietarios**, cada finca tiene su CID
     propio emitido por el banco de cobro.

2. **Enum `MandateSeq` incompleto**: solo FRST/RCUR — faltaban:
   - `OOFF` (one-off, mandato de uso único — típico en derramas).
   - `FNAL` (última remesa antes de cerrar el mandato).

3. **Estado del mandato mal modelado**: solo `active`/`revoked`/`pending_signature`.
   Faltaba:
   - `dormant`: sin uso ≥ 36 meses (regla SEPA de vencimiento por inactividad).
   - `expired`: firmado pero nunca usado tras 36 meses → requiere re-firma.

4. **Falta CID, IBAN receptor y BIC receptor** de la comunidad (`Estate`).

5. **Falta modelo de amendments**: si el IBAN del deudor cambia, la
   siguiente remesa debe llevar `<AmdmntInd>true</AmdmntInd>` con los datos
   originales en `<OrgnlDbtrAcct>`. No había estructura para llevarlo.

6. **Falta BIC del deudor** en el mandato (obligatorio en B2B, opcional
   pero recomendado en CORE).

7. **UMR mal dimensionado**: `MND-0012` es válido pero el modelo no
   verificaba el límite de 35 caracteres.

8. **No había generador pain.008** — la app decía generarlo pero solo
   mostraba el label de esquema.

### Cambios aplicados

#### Entidad `Estate` — datos de acreedor SEPA

```ts
Estate {
  ...
  cif?: string;
  creditorId?: string;                // CID validado ISO 7064
  creditorIban?: string;              // IBAN receptor de la comunidad
  creditorBic?: string;
  creditorPostalAddress?: string;
}
```

Los CIDs del mock se calcularon con checks válidos (H12345674 → check 81,
H98765432 → check 63, H55667788 → check 07, H11223344 → check 94). El
propio validador de la app los verifica en runtime.

#### Entidad `Mandate` — reescrita

```ts
Mandate {
  id: string;
  umr: string;                       // Unique Mandate Reference ≤35 chars
  creditorEstateId: string;          // FK a la COMUNIDAD (no a la gestora)
  propertyId: string;
  titularUserId: string;
  scheme: SepaScheme;                // CORE | B2B — fijado al firmar
  paymentType: 'recurrent' | 'oneOff';
  debtorIban: string;
  debtorBic?: string;
  signedAt: string;
  firstUseAt?: string | null;        // null → próxima seq = FRST
  lastUseAt?: string | null;         // para regla 36 meses
  revokedAt?: string | null;
  revokedReason?: string;
  status: 'active' | 'dormant' | 'revoked' | 'pending_signature' | 'expired';
}
```

#### Nueva entidad `MandateAmendment`

Rastrea cambios post-firma que la próxima remesa debe transportar en el
XML con `AmdmntInd=true`:

```ts
MandateAmendment {
  id, mandateId,
  field: 'debtor_iban' | 'debtor_bic' | 'debtor_name' | 'debtor_tax_id' | 'creditor_id' | 'umr',
  oldValue, newValue, changedAt, changedByUserId,
  pendingInFirstNextRemesa: boolean,
}
```

#### `MandateSeq` completo

```ts
type MandateSeq = 'FRST' | 'RCUR' | 'OOFF' | 'FNAL';
```

#### Nuevos métodos en `DataService`

```ts
computeMandateSeq(mandateId): MandateSeq | null
  // FRST/RCUR/OOFF según firstUseAt y paymentType.
  // Devuelve null si dormant/expired/revoked.

refreshMandateLifecycle(mandateId, today?): Mandate
  // Aplica la regla de 36 meses (Rulebook §4.6):
  //   sin uso + firmado hace ≥36 meses → expired
  //   con uso + último cobro hace ≥36 meses → dormant

getCreditorIdForEstate(estateId): string | null
  // Reemplaza el 'ES76ZZZ' + hardcoded CIF anterior.

isValidSpanishCreditorId(cid): boolean
  // Valida:
  //   - longitud 16
  //   - prefijo 'ES'
  //   - formato: ES + 2 dígitos + 3 chars + NIF válido (letra+7dig+letra/dig)
  //   - dígitos de control ISO 7064 mod 97-10
```

#### Nuevo servicio `SepaPain008Service`

Genera XML pain.008.001.02 cumpliendo con:

- **Agrupación por secuencia**: un `<PmtInf>` por combinación
  (SeqTp, RequiredCollectionDate) — obligatorio cuando conviven FRST y RCUR
  en la misma remesa.
- **Snapshot inmutable**: `debtorNameSnapshot`, `debtorIbanSnapshot`,
  `debtorBicSnapshot` — nunca se re-hidratan del User; una regeneración
  del XML produce el mismo resultado byte-a-byte.
- **Amendments**: `<AmdmntInd>` + `<AmdmntInfDtls>` con
  `<OrgnlMndtId>` / `<OrgnlDbtrAcct>` cuando aplica.
- **Validaciones pre-envío**:
  - Longitud MsgId ≤35, PaymentInfoId ≤35, EndToEndId ≤35, UMR ≤35,
    nombre deudor ≤70.
  - CID SEPA válido antes de emitir (rechaza envío si no lo es).
  - IBAN sin espacios.
  - Importes con `.` decimal y exactamente 2 decimales.
- **Escapado XML** de todos los campos texto.

#### Correcciones en `NuevaRemesaComponent`

- `creditorId` lee de `Estate.creditorId` (via `estateEntity`), no lo genera
  a partir del CIF de la gestora.
- Nueva propiedad `creditorIdIsValid` que valida ISO 7064 en runtime.
- Nueva propiedad `chargeDateIsValid` que exige `chargeDate` a D-1
  como mínimo (Rulebook CORE).
- Nuevo `canGenerate` que combina las precondiciones — el botón "Generar"
  solo se habilita si todas se cumplen.
- `estateIban` ahora lee de `Estate.creditorIban` (comunidad), no del
  fallback hardcoded.

### Validación del mock

Los 4 CIDs del mock han sido verificados con el propio `isValidSpanishCreditorId()`
de la app:

```
ES81ZZZH12345674  →  valid  (Edificio Castellana 145, Madrid)
ES63ZZZH98765432  →  valid  (Urbanización Los Pinares, Valencia)
ES07ZZZH55667788  →  valid  (Garaje Plaza Mayor, Sevilla)
ES94ZZZH11223344  →  valid  (Trasteros Abandoibarra, Bilbao)
```

Se demostró que el XML pain.008 generado por `SepaPain008Service` produce
la estructura correcta con:

- Un `<PmtInf>` por secuencia (FRST y RCUR separados).
- `<GrpHdr>/<CtrlSum>` igual a la suma total (175.00 = 87.50 × 2).
- Cada `<PmtInf>/<CtrlSum>` igual a la suma de su bloque.
- `<CdtrSchmeId>` con el CID validado.

### Regla de 36 meses aplicada al mock

El mandato `md8` (Ana Pujol, propiedad p13) se creó explícitamente con
`lastUseAt: '2023-01-05'` y `status: 'dormant'` para demostrar la regla.
`computeMandateSeq('md8')` devuelve `null` — la app **impide** incluirlo
en una nueva remesa hasta obtener firma nueva.

---

## Apéndice G — Gaps del backlog (contabilidad, incidencias, morosidad)

Se aplican los últimos cinco gaps que quedaban del análisis inicial. Todos
comparten un mismo síndrome: campos denormalizados / arrays embebidos que
no permiten historial ni JOINs.

> **Gap #9 SUPERADO (2026-09-30):** `Movement` (y por tanto este gap
> concreto) ya no existe — se eliminó entero en la fase 8 de la migración a
> partida doble. Se deja el gap tal cual, como registro histórico de un
> problema real que motivó parte del rediseño; ver
> [`doc/contabilidad/roadmap-partida-doble.md`](../doc/contabilidad/roadmap-partida-doble.md).

### Gap #9 — `Movement.account` → FK a chart_accounts

**Antes**:
```ts
Movement { account: string }   // '628 · Suministros'
```
Mezclaba código + nombre. Un rename en `chart_accounts` no se propagaba
al histórico de movimientos.

**Ahora**:
```ts
Movement { accountCode: string; supplierId?: string }
ChartAccount { code, name, shortName?, type }
```
- `accountCode` es FK al `code` (PK natural del plan contable, más estable
  que un UUID sintético).
- `supplierId` sustituye el string `supplier` con FK real.
- `DataService.resolveAccountLabel(code)` genera `'628 · Suministros'`
  para el display — la etiqueta se lee del catálogo en cada render.
- `MovimientosTabComponent` y `AccountingDetailComponent` usan
  `accountLabelFor(m)` y `supplierNameFor(m)`; el modal captura `code`
  (option value) y `supplierId`.

### Gap #10 — Unificación `Receipt` (rol C) ↔ `AccountingReceipt` (rol B)

Los dos representaban el mismo objeto de dominio con proyecciones distintas.

**Antes**: dos interfaces paralelas — la del rol C con 5 campos, la del
rol B con 15+. `MOCK_RECEIPTS` (rol C) inventaba recibos ficticios que no
correspondían a los `ACCT_RECEIPTS` reales.

**Ahora**:
- Interfaz `Receipt` (simple) eliminada.
- `AccountingReceipt` es la entidad canónica única; añadido `dueDate?`,
  `propertyId?` para cubrir los casos que la simple aportaba.
- Alias `type Receipt = AccountingReceipt` para no romper imports.
- `MOCK_RECEIPTS` ahora es **una vista derivada** —
  `ACCT_RECEIPTS.filter(r => r.ownerUserId === USER_ID_MARIA).slice(0, 4)`.
  Los mismos datos que ve el rol B en la finca aparecen en el dashboard
  del rol C.
- `DataService.listReceiptsForUser(userId)` es la vía recomendada.

### Gap #11 — `Issue.notifiedDate` / `notifiedCount` → tabla `issue_notifications`

**Antes**: dos campos flat que solo guardaban el ÚLTIMO envío; reenviar
sobrescribía sin dejar histórico.

**Ahora**:
```ts
IssueNotification { id, issueId, sentAt, recipientsCount, channel, sentByUserId, subject?, body? }
```
Cada envío es una fila. `DataService`:
- `listIssueNotifications(issueId)` histórico completo.
- `lastIssueNotification(issueId)` para el widget de detalle.
- `countIssueNotifications(issueId)` para el badge "N envíos totales".
- `sendIssueNotification(...)` añade fila.

El widget del `EstateDetailComponent` ahora muestra la fecha del último
envío + un contador de reenvíos totales cuando hay más de uno.

### Gap #12 — `Issue.provider*` → tabla `issue_providers`

**Antes**: 4 campos flat (`provider`, `providerCategory`, `providerPhone`,
`providerResolutionDate`) sin FK a `suppliers` y sin histórico.

**Ahora**:
```ts
IssueProviderAssignment {
  id, issueId,
  supplierId?: string | null,       // FK opcional (null = ad-hoc)
  providerNameSnapshot: string,      // snapshot al asignar
  categorySnapshot?, phoneSnapshot?, estimatedResolutionDate?,
  assignedAt, assignedByUserId,
  unassignedAt?: string | null       // null = asignación vigente
}
```
- `supplierId` **opcional** porque muchas asignaciones son ad-hoc
  (proveedor no catalogado).
- Cuando existe `supplierId`, el snapshot (`providerNameSnapshot`) queda
  congelado al momento de asignar — un rename posterior en `suppliers`
  no altera el histórico.
- `DataService.assignIssueProvider(...)` cierra automáticamente la
  asignación anterior con `unassignedAt` y crea la nueva. El histórico
  queda preservado.

Mock: `ipa1` (i2 → Schindler, con FK a supplier s3), `ipa2` (i3 →
Fontanería Ribera, ad-hoc sin FK).

### Gap #13 — `Debtor.history` embebido → tabla `debtor_actions`

**Antes**: array embebido dentro del `Debtor`. Sin paginación, sin
consultas cross-debtor para KPIs del admin, sin ordenación.

**Ahora**:
```ts
DebtorAction { id, debtorId, type, date, note, result, author, authorUserId?, onBehalfOfUserId? }
```
Renombrada de `GestionEntry` a `DebtorAction` (más claro); alias
`type GestionEntry = DebtorAction` por compat. `DataService`:
- `listActionsForDebtor(debtorId)` ordenado por fecha desc.
- `addDebtorAction(...)` inserta fila.

Mock: `MOCK_DEBTOR_ACTIONS` con 7 gestiones (misma data que había en los
arrays `Debtor.history`, ahora en una sola tabla plana).

### Cardinalidad y JOINs — resumen

Tras estos cinco gaps, las relaciones quedan:

```
Movement                N:1 → ChartAccount (via accountCode)
Movement                N:1 → Supplier      (via supplierId)
Issue                   1:N → IssueProviderAssignment
IssueProviderAssignment N:1 → Supplier (opcional)
Issue                   1:N → IssueNotification
Debtor                  1:N → DebtorAction
Receipt (canonical)     ← proyecciones per-rol via filter
```

---

## Apéndice H — Payment agreements, lectura por usuario y activity log (gaps #13, #18, #19, #17 resueltos)

Cuatro gaps del backlog, resueltos con decisiones de diseño explícitas
(presentadas como alternativas al usuario antes de implementar).

### Gap #13 — `acuerdoPlan` persistido en `payment_agreements` + `installments`

**Bug funcional detectado además del gap de modelo**: el botón "Confirmar
acuerdo" del drawer de morosidad llamaba por error a `saveGestion()` — el
mismo método que registra una gestión genérica — así que el plan de
cuotas calculado en los sliders (`acuerdoPlan`) **nunca se guardaba**. Al
cerrar el drawer, el "acuerdo" desaparecía sin dejar rastro.

**Alternativas evaluadas:**
| Opción | Descripción | Elegida |
|---|---|---|
| A | `PaymentAgreement` + `PaymentAgreementInstallment` (tabla hija, cuotas cobrables individualmente) | ✅ |
| B | `PaymentAgreement` con array `installments[]` embebido | ❌ mismo anti-patrón corregido en gaps anteriores |
| C | Solo persistir términos, sin tabla de cuotas | ❌ no permite "cobrar conforme al plan" cuota a cuota |

**Modelo aplicado:**
```ts
PaymentAgreement {
  id, debtorId, totalAmount, downPaymentAmount, installmentsCount,
  firstDueDate, status: 'active'|'completed'|'breached'|'cancelled',
  signedAt, createdByUserId, cancelledAt?, cancelledReason?
}
PaymentAgreementInstallment {
  id, agreementId, seq, dueDate, amount, paidAt?, receiptId?
}
```

**`DataService`:**
```ts
findActiveAgreementForDebtor(debtorId)
listInstallmentsForAgreement(agreementId)
createPaymentAgreement({debtorId, totalAmount, downPaymentAmount, installmentsCount, firstDueDate, createdByUserId})
  // genera TODAS las cuotas de una vez; el último plazo absorbe el
  // redondeo para que la suma cuadre exacta con totalAmount - downPayment.
markInstallmentPaid(installmentId, receiptId?)
  // si todas las cuotas quedan pagadas, el acuerdo pasa a 'completed'.
cancelPaymentAgreement(agreementId, reason?)
```

**Componente**: `MorosidadTabComponent` — `acuerdoPlan` (computed) se
mantiene como VISTA PREVIA mientras el admin mueve los sliders, sin
persistir nada. El botón **"Confirmar acuerdo"** ahora llama a
`confirmAcuerdo()` (no a `saveGestion()`), que persiste el acuerdo +
cuotas y registra una `DebtorAction` de auditoría. Si ya existe un
acuerdo activo para el deudor, la pestaña "Acuerdo de pago" muestra sus
cuotas reales (con botón "Marcar cobrada" por fila) en vez de los
sliders — no se puede crear un segundo acuerdo mientras el primero siga
activo.

**Mock**: `pa1` (Pere Soldevila, 3 cuotas de ~153,13 €, primera ya
cobrada) demuestra el ciclo completo.

### Gaps #18 y #19 — `Communication.unread` / `Document.isNew` → lectura por usuario

**Alternativas evaluadas:**
| Opción | Descripción | Elegida |
|---|---|---|
| A | Reutilizar la tabla `AlertRead` ya existente (renombrada `ResourceRead`), genérica por `sourceType` | ✅ |
| B | Dos tablas nuevas `communication_reads` + `document_reads` | ❌ duplica el mismo mecanismo, riesgo de desincronía con Alertas |
| C | Array `readByUserIds[]` embebido en la entidad | ❌ mismo anti-patrón de arrays embebidos ya corregido |

**Razón de la Opción A**: `AlertRead` (creada en el gap de Alertas) ya
modelaba exactamente "¿ha leído este usuario este recurso?" con
`sourceType` incluyendo `'communication'` y `'document'`. Crear tablas
nuevas habría triplicado el mismo mecanismo y desincronizado el estado
"leído en Alertas" del estado "leído en Comunicados/Documentos" — con
la reutilización, marcar como leído en cualquiera de las dos pantallas
actualiza ambas.

**Cambios en el modelo:**
```ts
// Renombrada:
export interface ResourceRead { userId, sourceType, sourceId, readAt }
/** @deprecated */ export type AlertRead = ResourceRead;

// Communication.unread ELIMINADO — era boolean global.
// Document.isNew ELIMINADO — era boolean global.
// Ambas entidades ganan estateId? para poder filtrar por finca.
```

**`DataService`** (métodos genéricos + wrappers legibles):
```ts
isResourceRead(userId, sourceType, sourceId)
markResourceRead(userId, sourceType, sourceId)
isCommunicationRead(userId, communicationId)
markCommunicationRead(userId, communicationId)
isDocumentUnseen(userId, documentId)   // "nuevo" = no marcado como leído
markDocumentRead(userId, documentId)
```

`isAlertRead`/`markAlertRead` quedan como alias `@deprecated` que
delegan en los genéricos, para no romper `listAlertsForUser`.

**Componente**: `PropertyDetailComponent` — la pestaña Comunicados ahora
marca como leído al hacer click en una tarjeta (`markCommRead`) y tiene
un botón "Marcar como leídos" funcional (`markAllCommunicationsRead`,
antes sin `(click)`). La pestaña Documentos marca como visto al hacer
click en la fila o en "Descargar" (`markDocRead`); el badge "Nuevo" se
calcula con `isDocUnseen(doc.id)`.

**Mock**: `MOCK_RESOURCE_READS` (antes `MOCK_ALERT_READS`) seedea a
María como habiendo leído `c1`/`c2` (comunicados) y `d2`/`d3`
(documentos) — `c0` y `d1` quedan sin leer para poder ver el estado
"no leído"/"nuevo" en la demo.

### Gap #17 — Activity log unificado

**Alternativas evaluadas:**
| Opción | Descripción | Elegida |
|---|---|---|
| A | `ActivityItem` 100% derivado (mismo patrón que `AlertItem`), sin tabla nueva | parcial |
| B | `activity_log` global único que sustituye TODOS los timelines (Issue, Ticket, Debtor, Admin) | ❌ demasiada superficie de cambio de una vez |
| C | Híbrida: derivar de las fuentes reales + tabla ligera `ActivityLogEntry` solo para eventos sin timeline propio | ✅ |

**Razón de la Opción C**: `IssueTimelineEntry`, `TicketTimelineEntry` y
`DebtorAction` ya fueron normalizados en gaps anteriores y funcionan
bien con sus campos específicos de dominio (autor+rol, tipo de gestión,
resultado…) — forzarlos a un esquema único les haría perder esos campos
sin ganar nada. En cambio, el feed "Actividad reciente" del rol C
(`MOCK_ACTIVITIES`) era **100% estático** y nunca reflejaba datos
reales — ese es el problema concreto a resolver, con el menor riesgo.

**Modelo aplicado:**
```ts
ActivityLogEntry {
  id, actorUserId?, subjectType: 'issue'|'receipt'|'communication'|'document'|'ticket'|'membership',
  verb: 'created'|'updated'|'status_changed'|'paid'|'published'|'uploaded',
  summary, occurredAt, estateId?, propertyId?
}
ActivityType += 'solicitud'   // nuevo tipo para eventos de membership
```

**`DataService.listActivityForUser(userId, limit=10)`**: hace UNION
sobre incidencias, recibos, comunicados y documentos de las propiedades
del usuario (derivado, sin tabla) **más** las entradas de
`MOCK_ACTIVITY_LOG` relevantes (derivado + persistido), ordenado por
fecha desc y acotado a `limit`.

**Conexión real, no solo seed estático**: `approveAdhesion` y
`rejectAdhesion` (ya existentes desde el gap de solicitudes de
adhesión) ahora llaman a `DataService.logActivity(...)` — cada
aprobación/rechazo de una solicitud genera una entrada real en el log,
demostrando que la tabla crece con la actividad de la aplicación y no
es solo un mock fijo.

**Componente** (`DashboardCComponent`, ya sustituido por `CommunityCComponent`): `activities` pasa de
`MOCK_ACTIVITIES` (array estático) a
`this.data.listActivityForUser(LOGGED_IN_USER_ID_C)` (una sola
llamada, evaluada en la inicialización del componente). `activityColor`/
`activityIcon` ganan el caso `'solicitud'`.

**`MOCK_ACTIVITIES` eliminado** — quedó sin ningún consumidor tras la
migración; se retiró en vez de dejarlo como código muerto.

