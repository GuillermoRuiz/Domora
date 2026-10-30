# Cumplimiento RGPD / LOPDGDD — Domora

> Fase 13 del plan de ejecución (`doc/backend-execution-plan.md`).
> Marco: Reglamento (UE) 2016/679 (RGPD) y Ley Orgánica 3/2018 (LOPDGDD).
> Este documento es el soporte operativo; las piezas de código están en
> `backend/src/gdpr/` y los accesos sensibles auditados en `data_access_log`.

## 1. Roles de tratamiento (art. 4 y 28 RGPD)

| Actor | Rol | Base contractual |
|---|---|---|
| **Comunidad de propietarios** (Estate) | **Responsable** del tratamiento — los datos de propietarios/inquilinos se tratan para la gestión de SU comunidad | Título constitutivo + LPH |
| **Gestora / administrador de fincas** (Administrator) | **Encargado** del tratamiento por cuenta de cada comunidad | Contrato de encargo (DPA, art. 28) comunidad↔gestora |
| **Domora (la plataforma)** | **Sub-encargado** | DPA gestora↔plataforma, con autorización del responsable |

**Plantilla de DPA disponible**: `doc/legal/contrato-encargado-tratamiento.md`
(tarea "Legal pages & consent", ID 32 del MVP Tracker). Sigue pendiente
adjuntarla de forma sistemática al onboarding de cada gestora — hoy es un
documento manual, sin flujo de firma electrónica en la plataforma.

## 2. Registro de actividades de tratamiento (art. 30)

| Tratamiento | Datos | Base jurídica | Interesados |
|---|---|---|---|
| Gestión de cuotas y recibos | Identificativos, NIF, IBAN (cifrado), importes | **Ejecución de la relación jurídica LPH / obligación legal** (no consentimiento) | Propietarios, inquilinos, titulares externos |
| Domiciliaciones SEPA / remesas | IBAN, mandatos, historial de cargos | Obligación legal + ejecución (Reglamento UE 260/2012) | Titulares de mandato |
| Gestión de morosidad | Deudas, gestiones, acuerdos de pago | Interés legítimo de la comunidad + LPH art. 9.1.e/21 | Propietarios deudores |
| Incidencias y tickets | Comunicaciones, fotos | Ejecución de la relación | Residentes |
| Reservas de zonas comunes | Reservas, aforos | Ejecución de la relación | Residentes |
| Comunicados y documentos | Lecturas por usuario | Ejecución de la relación | Residentes |
| Facturación SaaS a gestoras | Datos mercantiles de la gestora | Ejecución de contrato | Gestoras (B2B) |
| Datos de facturación editados por el propio despacho (`admin_billing`) | Razón social, NIF/CIF (validado con su dígito de control; viaja a la AEAT en el registro Verifactu de cada factura), domicilio fiscal, email de facturación, método de pago e IBAN cuando el pago es por domiciliación (la API solo lo devuelve enmascarado). Cada cambio queda en la actividad del despacho con su autor. Las facturas ya emitidas no cambian: guardan su propia copia de los datos del destinatario | Ejecución del contrato de suscripción (art. 6.1.b) y obligación legal de facturar (art. 6.1.c; RD 1619/2012 art. 6) | Despachos clientes; cuando el titular es un profesional persona física, sus datos identificativos |
| Mandatos SEPA de los despachos que pagan a Domora por domiciliación (`admin_sepa_mandates`) | Referencia única del mandato, identificador de acreedor de Domora, titular de la cuenta, IBAN cifrado en reposo (AES-256-GCM) y enmascarado para mostrarlo, fecha de firma, usuario que lo aceptó, texto exacto aceptado, estado y fecha y motivo de revocación. Sin dirección IP ni agente de usuario | Ejecución del contrato de suscripción (art. 6.1.b), con el mandato exigido por el Reglamento (UE) 260/2012 para el adeudo directo | Titulares de la cuenta de cargo de los despachos clientes; usuario del despacho que acepta el mandato |
| Métricas de uso de la plataforma (`user_daily_activity`) | Por usuario y día: módulos usados y número de peticiones; sin contenido de las peticiones ni direcciones IP. No se registra al personal de Domora (rol A) | Interés legítimo de Domora en mejorar el servicio y dar soporte (art. 6.1.f) — **pendiente de validar con asesoría legal (ponderación de intereses)** | Usuarios de gestoras y residentes |
| Auditoría de accesos del personal de Domora (`staff_audit_logs`, `support_sessions`) | Por cada acceso del personal de Domora (rol A) a datos de un despacho cliente: quién, cuándo, qué despacho y finca, método HTTP y plantilla de ruta (nunca la URL concreta, ids ni parámetros), resultado (consulta, escritura, denegado); sesiones de soporte con motivo y referencia de ticket. Solo lectura por defecto: modificar datos exige una sesión de soporte explícita (2 h) | Responsabilidad proactiva de Domora como encargada del tratamiento (art. 5.2 y 32 RGPD: rendir cuentas de los accesos de su personal a los datos de sus clientes) — **pendiente de validar con asesoría legal** | Personal de Domora; indirectamente, despachos clientes |
| Gestión comercial de clientes potenciales y despachos clientes (`leads`, `commercial_follow_ups`, `client_next_actions`) | Del despacho potencial: nombre, persona de contacto, email y teléfono de contacto, ciudad, origen, plan de interés, estado comercial, próxima acción y notas; seguimiento comercial (fecha, autor del equipo Domora y texto) de oportunidades y despachos clientes. Las oportunidades con origen «Solicitud de alta de comunidad» se crean a partir de la solicitud de un propietario (nombre y email del despacho que indicó; los datos del propietario solicitante no se copian, se leen de la solicitud) | Interés legítimo de Domora en la prospección y gestión comercial B2B (art. 6.1.f; para el envío de comunicaciones comerciales por medios electrónicos, art. 21 LSSI) — **pendiente de validar con asesoría legal (ponderación de intereses y deber de informar del art. 14 RGPD cuando los datos no se obtienen del interesado)** | Personas de contacto de despachos potenciales y clientes; personal de Domora (autoría del seguimiento) |

Consentimiento explícito SOLO para usos accesorios (p. ej. comunicaciones
comerciales) — hoy no existe ninguno en la plataforma.

## 3. Derechos de los interesados (arts. 15-22)

- **Acceso/Portabilidad**: `GET /gdpr/me/export` — JSON con todos los
  datos del usuario (perfil, membresías, representaciones, tickets,
  recibos, reservas, gestiones, lecturas, actividad diaria de uso).
- **Supresión**: `POST /gdpr/me/erasure` — anonimización irreversible del
  perfil (email/nombre/NIF/teléfono/contraseña), revocación de membresías
  y refresh tokens, borrado de lecturas y de la actividad diaria de uso, y **anulación de la FK viva** en
  recibos/líneas de remesa. Los **snapshots legales se conservan** hasta
  vencer su plazo (§5) — art. 17.3.b RGPD (obligación legal prima sobre
  el derecho de supresión).
  Las cuentas A/B requieren baja gestionada (409) — son la vía de
  administración del tenant.
- **Rectificación**: edición de perfil (pantallas de ajustes — pendiente
  de conectar en frontend; el modelo ya lo soporta).
- **Oposición/limitación**: gestionados vía soporte; sin tratamiento
  automatizado con efectos jurídicos (no aplica art. 22).

## 4. Seguridad (art. 32)

Ya implementado:
- Cifrado de IBAN en reposo (AES-256-GCM, clave fuera de la BD — Fase 6).
- Contraseñas bcrypt; refresh tokens hasheados (SHA-256) y rotados.
- Multi-tenancy aplicado en servidor (EstateAccessService/Guard).
- IBAN enmascarado en todas las APIs de listado.
- **Registro de accesos sensibles** (`data_access_log`, append-only):
  listado de mandatos, listado de morosidad, descarga de pain.008,
  export y supresión RGPD.

Pendiente (Fase 15): TLS extremo a extremo en despliegue, backups
cifrados y probados, secretos fuera de `.env`.

## 5. Plazos de conservación

| Dato | Plazo | Base | Al vencer |
|---|---|---|---|
| Recibos, líneas de remesa, XML pain.008 | 6 años | Art. 30 Código de Comercio | Seudonimizar snapshots (job de retención — pendiente de programar) |
| Facturas (gestora) | 4-6 años | LGT art. 66 / CCom | Ídem |
| Mandatos SEPA | Vigencia + 14 meses tras último cargo | Rulebook EPC | Borrado |
| Mandatos SEPA de despachos con Domora (`admin_sepa_mandates`) | Vigencia + 14 meses tras el último cargo (mismo criterio) | Rulebook EPC | Borrado (job pendiente de programar; hoy se conservan los revocados como prueba) |
| Actas y documentos de junta | Vida de la comunidad | LPH | — |
| Tickets/incidencias | 3 años tras cierre | Prescripción civil genérica | Anonimizar autor |
| Logs de acceso (`data_access_log`) | 2 años | Recomendación AEPD | Purga |
| Auditoría del personal de Domora (`staff_audit_logs`, `support_sessions`) | 2 años (propuesto, mismo criterio que `data_access_log`) — **pendiente de validar con asesoría legal** | Recomendación AEPD | Purga (job pendiente de programar) |
| Oportunidades comerciales no convertidas (`leads`) y su seguimiento | Propuesto: 2 años desde el último contacto — **pendiente de validar con asesoría legal** | Interés legítimo (prospección) | Borrado (job pendiente de programar); las convertidas siguen el plazo del contrato con el cliente |
| Cuentas suprimidas (fila anonimizada) | Indefinido (ya sin datos personales) | — | — |

## 6. Brechas de seguridad (arts. 33-34)

Procedimiento: (1) contención y evaluación de alcance con
`data_access_log` como primera fuente forense; (2) si hay riesgo para
derechos y libertades, **notificación a la AEPD en ≤72h** desde la
constancia (sede electrónica AEPD); (3) si el riesgo es alto (p. ej. fuga
de IBANs descifrados), comunicación a los interesados sin dilación;
(4) registro interno de la brecha aunque no sea notificable.

## 7. Morosidad y doctrina AEPD (comunidades de propietarios)

- La deuda se comunica **individualmente** al deudor; nunca en
  comunicados generales ni tablones de la app. El módulo de morosidad
  está restringido a roles A/B; el rol C no tiene ninguna vista de deuda
  ajena (ni propia, hoy — cuando se añada, solo la SUYA).
- La relación de deudores puede figurar en la **convocatoria de junta**
  en los términos del art. 16.2 LPH (voto privado del moroso) — es la
  única difusión legítima a terceros, y va en la Fase 14 (juntas).

## 8. Páginas legales públicas y consentimiento de alta

Tarea "Legal pages & consent" (ID 32 del MVP Tracker). Frontend:
`src/app/features/{privacidad,aviso-legal,cookies,terminos}` (rutas
públicas, sin guard), con un `app-legal-layout` compartido
(`src/app/shared/components/legal-layout/`) y un `app-footer`
(`src/app/shared/components/footer/`) con los 4 enlaces, montado también en
el shell autenticado para que sean accesibles de forma permanente (art. 10
LSSI-CE). Checkbox obligatorio "He leído y acepto..." en registro,
admin-invite y team-invite, con `User.termsAcceptedAt` (migración
`20260930130000_user_terms_acceptance`) estampado server-side en los 3
puntos de alta de `AuthService`.

**Pendiente antes de publicar en producción**: el Aviso Legal y el DPA
(`doc/legal/contrato-encargado-tratamiento.md`) llevan marcadores de
posición `[...]` para la razón social/NIF/domicilio real — no existen
hardcodeados en ningún sitio del repo (son parámetro de despliegue de
`infra/main.bicep`). Revisión por un abogado colegiado recomendada antes de
publicar, especialmente el DPA.
