# Domora — Inventario funcional y análisis competitivo

> El inventario sale de leer el código (155 endpoints, 55 modelos), no de
> memoria ni de documentación previa. Lo de la competencia sale de fuentes
> públicas citadas al final; donde no he podido verificar algo, lo digo.

---

## 1. Qué hace Domora hoy

### Plataforma y acceso

| Área | Estado |
|---|---|
| Multi-tenancy por gestora y por finca | Sólido — `estateIds` del JWT como única fuente de verdad |
| Tres roles (A plataforma / B administrador / C propietario) | Completo |
| Alta autoservicio de propietarios | Sí (`/register`) |
| Invitación de gestoras (rol A → B) | Sí, token de un solo uso |
| Invitación de compañeros de despacho (B → B) | Sí, autoservicio |
| Recuperación de contraseña por email | Sí, con mailer real |
| Suscripciones y planes | Sí (planes, facturación a la gestora, MRR) |

### Rol B — administrador de fincas

**Fincas y unidades**: alta y edición de fincas, propiedades con datos
catastrales y dirección postal estructurada, titulares y modalidad
(propietario/inquilino), propietarios externos, representaciones legales
(apoderamientos), solicitudes de adhesión de propietarios con aprobación o
rechazo, y solicitudes de alta de finca.

**Contabilidad**: cuentas contables por finca (plan contable propio),
movimientos con conciliación, importación de extractos bancarios con
conciliación automática, presupuesto por partidas con ejecución, periodos
contables, emisión masiva de recibos por periodo con snapshot inmutable del
titular, cambio de estado de recibos y justificante de pago adjunto.

**Cobros SEPA**: mandatos con estados y modificaciones post-firma, generación
de remesas con selección de candidatos, descarga del fichero, líneas de
remesa y registro de devoluciones bancarias con código de retorno.

**Morosidad**: listado de deudores, histórico de acciones de reclamación,
acuerdos de pago con cuotas calculadas y entrada, marcado de cuotas pagadas,
cancelación de acuerdos y **certificado de deudas (art. 9.1.e LPH)**.

**Incidencias**: alta por propiedad, tipos y prioridad, estados, historial
cronológico con autor, fotos adjuntas, asignación de proveedor con histórico,
presupuesto con aprobación y notificaciones a propietarios.

**Proveedores y personal**: proveedores por finca con facturas y adjuntos;
personal contratado (portero, seguridad, socorrista…) con tipo y fechas de
contrato, horario, coste mensual, documentos adjuntos y baja conservando el
histórico.

**Instalaciones**: catálogo de zonas comunes con franjas horarias, aforo,
normas, temporadas, periodos de mantenimiento y gestión de reservas.

**Comunicación y documentos**: comunicaciones a la finca, documentos con
privacidad por destinatario (toda la finca o un propietario concreto),
mensajería directa con propietarios, alertas y registro de actividad.

### Rol C — propietario

Vista de sus propiedades con saldo y cuota, vinculación a comunidad, recibos
con descarga y subida de justificante, incidencias propias, tickets de
soporte, reservas de instalaciones con calendario y disponibilidad,
documentos que le corresponden, comunicaciones, alertas, mensajería con la
gestora y **directorio de contacto del personal de la finca**.

### Cumplimiento y seguridad

Cifrado de IBAN en reposo (AES-256-GCM), registro de accesos a datos
sensibles (RGPD art. 32), exportación y supresión de datos del propio usuario
(arts. 20 y 17), retención legal en la supresión, y —tras la auditoría—
validación de secretos que impide arrancar mal configurado, CI con auditoría
de dependencias y 56 pruebas automatizadas.

---

## 2. Qué NO hace Domora

Comprobado sobre el modelo de datos, no supuesto:

| Ausente | Gravedad |
|---|---|
| **Juntas de propietarios** (convocatoria, orden del día, asistencia, delegaciones, votación, quórums, actas) | **Crítica** |
| **Verifactu / facturación verificable** | **Alta — obligatorio 1-ene-2027** |
| **Firma digital** de actas y documentos | Alta |
| Seguros y partes de siniestro | Media |
| PRL y coordinación de actividades empresariales (CAE) | Media |
| App móvil nativa y notificaciones push | Media |
| Lectura de contadores (agua, calefacción) | Baja |
| Agregador bancario automático (hoy es importación manual de extracto) | Media |

`Junta` solo existe como evento de calendario (`PropertyEvent`), y
`pending_signature` es un estado de mandato SEPA, no firma de documentos.

**Resuelto (2026-09-30):** derramas, libro mayor/balance/cuenta de
resultados formales (PDF y Excel), liquidación de ejercicio y cierre
contable, y nóminas del personal contratado — las cuatro filas que estaban
aquí salieron con la migración a partida doble (14 fases, 0-13, todas
cerradas). Ver [`doc/contabilidad/roadmap-partida-doble.md`](contabilidad/roadmap-partida-doble.md).

---

## 3. El mercado

### Fynkus

Solución **100% en la nube** con app móvil propia para administradores y
propietarios. Sus rasgos destacados: descarga y categorización **automática
de movimientos bancarios** de todas las comunidades —que su propio material
señala como la función más demandada por los administradores—, gestión ágil
de incidencias, canal de comunicación propio con los clientes (planteado como
alternativa a WhatsApp), gestión de convocatorias y reuniones, proveedores,
portal del propietario e importación de datos desde otros programas y Excel.

Comercialmente juega la carta del **freemium**: existe una versión gratuita
para administradores, además de planes de pago por volumen de comunidades y
un servicio contable adicional.

### Gesfincas (IESA)

El más completo de los dos y el de posicionamiento más "ERP". Arquitectura
**modular**, para que cada despacho monte lo que necesita:

- **Contabilidad** integrada con deudores y acreedores, y **facturación**.
- **Juntas**: gestión digital de convocatorias.
- **Incidencias** digitales.
- **Agregador financiero** con conciliación bancaria automatizada, y
  **Cuenta Digital** (funcionalidad bancaria dentro de la plataforma).
- **Morosidad** automatizada.
- **Gestión documental** y **firma digital**.
- **Cumplimiento normativo**: RGPD, **PRL**, **CAE**, certificado digital, 060.
- **App de vecinos**, **llave digital** (control de accesos), **lectura de
  contadores**.
- **CRM y centralita**, **plugin de Outlook**, Marketing Center, cuadro de
  mando y gestión inmobiliaria.

### Otros

**Netfincas** (25+ años, versión escritorio y nube, comunidades ilimitadas,
control bancario, **juntas online**), **TAAF** (ERP con énfasis en clientes y
contabilidad) y **Adcomunidad** (ERP en la nube). El sector está poblado y
maduro; hay listas de "los 10-12 mejores programas", lo que indica que la
diferenciación por funcionalidad básica es difícil.

---

## 4. Comparativa

Leyenda: ✅ disponible · ⚠️ parcial · ❌ ausente · ❓ no verificado

| Funcionalidad | Domora | Fynkus | Gesfincas |
|---|:--:|:--:|:--:|
| Contabilidad de comunidades | ✅ | ✅ | ✅ |
| Emisión de recibos y cuotas | ✅ | ✅ | ✅ |
| Remesas SEPA + devoluciones | ✅ | ❓ | ✅ |
| Conciliación bancaria | ⚠️ importación manual | ✅ automática | ✅ agregador |
| Morosidad y acuerdos de pago | ✅ | ❓ | ✅ |
| Certificado de deudas (9.1.e LPH) | ✅ | ❓ | ❓ |
| **Juntas: convocatoria, voto, actas** | ❌ | ✅ | ✅ |
| **Firma digital** | ❌ | ❓ | ✅ |
| **Verifactu / factura verificable** | ❌ | ❓ | ✅ |
| Incidencias con proveedor y presupuesto | ✅ | ✅ | ✅ |
| Gestión de proveedores | ✅ | ✅ | ✅ |
| **Personal contratado de la finca** | ✅ | ❓ | ⚠️ vía PRL/CAE |
| Documentos con privacidad por destinatario | ✅ | ❓ | ✅ |
| Comunicaciones y mensajería | ✅ | ✅ | ✅ |
| Portal del propietario | ✅ | ✅ | ✅ |
| **App móvil nativa** | ❌ | ✅ | ✅ |
| **Reserva de zonas comunes** | ✅ | ❓ | ❓ |
| Derramas | ❌ | ❓ | ❓ |
| PRL / CAE | ❌ | ❓ | ✅ |
| Lectura de contadores | ❌ | ❓ | ✅ |
| Control de accesos / llave digital | ❌ | ❌ | ✅ |
| CRM / centralita / Outlook | ❌ | ❌ | ✅ |
| RGPD: exportación y supresión | ✅ | ❓ | ✅ |
| Cifrado de IBAN en reposo | ✅ | ❓ | ❓ |

---

## 5. Los dos huecos que hay que cerrar sí o sí

### Juntas de propietarios

No es "una funcionalidad más": es **el acto jurídico central** de una
comunidad. Toda la contabilidad que Domora gestiona tan bien (presupuestos,
cuotas, derramas) nace de un acuerdo de junta, y el acta es el documento que
lo prueba. Un administrador no puede sustituir su programa actual por uno que
no gestione juntas, por bueno que sea el resto.

Además, la **reforma de la LPH de julio de 2025** dio cobertura legal expresa
a la **digitalización de juntas y notificaciones**, y cambió mayorías
(alquiler turístico por 3/5, autoconsumo solar) que afectan directamente al
cómputo de votaciones. Los competidores ya lo ofrecen; aquí ni existe el
modelo de datos.

Alcance mínimo: convocatoria con orden del día, asistencia y delegaciones de
voto, votación por puntos con los distintos regímenes de mayoría y cómputo por
cuotas de participación, generación de acta y notificación fehaciente.

### Verifactu

> **CORRECCIÓN (7-ago-2026).** La primera versión de este documento afirmaba
> que el plazo estaba vencido. **Era incorrecto**: se basó en artículos
> anteriores al aplazamiento. El **Real Decreto-ley 15/2025** (BOE de 3 de
> diciembre de 2025) retrasó Verifactu un año. Fechas reales: **1 de enero de
> 2027** para contribuyentes del Impuesto sobre Sociedades y **1 de julio de
> 2027** para el resto (autónomos en IRPF, no residentes con establecimiento
> permanente y entidades en atribución de rentas).

Sigue siendo prioritario —quedan meses, no años— pero **no hay incumplimiento
hoy**. Verifactu exige registros de facturación encadenados por huella
SHA-256, código QR de verificación y, o bien envío en tiempo real a la AEAT
(modo VERI\*FACTU), o bien firma electrónica y registro de eventos (modo no
VERI\*FACTU).

Un matiz de alcance que conviene tener claro y que reduce mucho el trabajo:
**las cuotas de comunidad no son facturas** —no retribuyen una operación
sujeta a IVA— así que los recibos de `AccountingReceipt` quedan fuera. Lo que
sí entra son las facturas que **Domora emite a las gestoras** (`AdminInvoice`,
que hoy carece de base imponible desglosada, NIF de las partes, huella y
encadenamiento) y, cuando exista, la facturación de honorarios de la gestora
a la comunidad.

Plan detallado en [verifactu-plan.md](verifactu-plan.md).

---

## 6. Dónde Domora ya juega bien

No todo son huecos. Hay cosas que el producto hace bien y que conviene no
perder de vista:

1. **Base técnica moderna.** Angular con señales y NestJS sobre PostgreSQL,
   frente a competidores con herencia de escritorio (Netfincas mantiene
   versión de escritorio; Gesfincas arrastra décadas de producto). Iterar
   aquí es más barato.
2. **Multi-tenancy serio.** El aislamiento por gestora y finca está resuelto
   en la capa de aplicación con el JWT como fuente de verdad, y ahora con
   tests que lo fijan.
3. **RGPD de diseño, no de parche.** Registro de accesos a datos sensibles,
   exportación y supresión con retención legal, IBAN cifrados con clave fuera
   de la base de datos, y documentos con privacidad por destinatario. En un
   sector que trata morosidad —dato especialmente delicado según la doctrina
   AEPD— esto es defendible comercialmente.
4. **Reservas de zonas comunes** con disponibilidad y mantenimiento: no la vi
   documentada en los dos referentes.
5. **Personal contratado** como entidad propia, distinta de proveedores. En
   Gesfincas esto aparece por la vía de PRL/CAE, no como ficha de empleado.

---

## 7. Recomendación

**Prioridad 1 — desbloquear la venta.** Juntas y Verifactu. Sin lo primero
no se puede sustituir al programa actual de un despacho; lo segundo es
exposición legal directa. Firma digital va con ambas (actas y facturas).

**Prioridad 2 — igualar lo esperado.** Agregador bancario automático (lo que
Fynkus vende como su función más demandada, y donde Domora se queda en
importación manual), derramas, y cierre contable con balance.

**Prioridad 3 — competir de verdad.** App móvil con push, y luego PRL/CAE y
contadores si se apunta a despachos grandes.

**Y una advertencia estratégica.** Gesfincas no compite solo en
funcionalidad: compite en **integración del despacho** (CRM, centralita,
Outlook, cuenta bancaria). Intentar igualar esa superficie es una guerra de
desgaste. Con la base técnica y de cumplimiento que ya tiene Domora, tiene
más sentido apostar por **la experiencia del propietario** —portal y app
realmente buenos, transparencia, reservas, comunicación— que es justo donde
el software heredado del sector flojea, y cerrar solo los huecos que impiden
la venta.

---

## Fuentes

- [Fynkus — sitio oficial](https://www.fynkus.es/)
- [Fynkus en SoftwareDoit](https://www.softwaredoit.es/fynkus/fynkus.html)
- [IESA — programas (Gesfincas)](https://iesa.es/programas/)
- [Gesfincas — solución integral (netelip)](https://www.netelip.com/blog/2024/07/gesfincas-conoce-la-solucion-integral-mas-potente-para-la-administracion-de-comunidades/)
- [IESA — Facturación electrónica y Verifactu en comunidades](https://iesa.es/la-voz-digital-del-sector/la-facturacion-electronica-y-verifactu-impacto-en-comunidades-de-propietarios-y-administradores)
- [Obligaciones fiscales administradores 2026 (CIAX)](https://www.ciax.es/blog/obligaciones-fiscales-administradores-2026/)
- [NovAdmin — Verifactu y la administración de fincas](https://www.novadmin.es/es/verifactu-y-la-administracion-de-fincas/)
- [Cambios legales 2026 en comunidades (Adminfergal)](https://adminfergal.es/blog/administracion-de-fincas/cinco-cambios-legales-en-las-comunidades-de-propietarios-que-todo-vecino-debe-conocer-en-2026/)
- [NetFincas](https://www.netfincas.com/programa-administracion-fincas.html)
- [Comparativas del sector (SoftwareDoit)](https://www.softwaredoit.es/software-de-administracion-de-fincas/index.html)
