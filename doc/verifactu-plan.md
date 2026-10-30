# Plan de adaptación a Verifactu

## 1. Punto de partida (y una corrección)

La primera versión del análisis competitivo daba el plazo por vencido. **Era
incorrecto.** El **Real Decreto-ley 15/2025** (BOE de 3 de diciembre de 2025,
en vigor el día 4) aplazó Verifactu un año:

| Obligado | Fecha límite |
|---|---|
| Contribuyentes del Impuesto sobre Sociedades | **1 de enero de 2027** |
| Autónomos (IRPF), no residentes con EP, entidades en atribución de rentas | **1 de julio de 2027** |

Hoy es agosto de 2026: quedan **unos cinco meses** para la primera fecha. No
hay incumplimiento, pero tampoco margen para dejarlo correr.

Verifactu (RD 1007/2023, desarrollado por la Orden HAC/1177/2024) regula los
**Sistemas Informáticos de Facturación (SIF)**. Exige que cada factura genere
un *registro de facturación* con huella SHA-256, encadenado con el anterior,
con código QR de verificación, e inalterable.

---

## 2. Alcance real — esto es lo que más trabajo ahorra

La conclusión más importante del análisis: **la mayor parte de lo que Domora
factura NO entra en Verifactu.**

| Concepto en Domora | ¿Es factura? | ¿Verifactu? |
|---|---|---|
| `AccountingReceipt` — recibos de cuota de comunidad | **No.** Las cuotas no retribuyen una operación sujeta a IVA | ❌ Fuera |
| `SupplierInvoice` — facturas de proveedores | Sí, pero **recibidas**, no emitidas | ❌ Fuera (Verifactu regula la emisión) |
| `AdminInvoice` — Domora factura a las gestoras | **Sí** | ✅ **Dentro** |
| Honorarios de la gestora a la comunidad | Sí | ✅ Dentro **cuando exista** (hoy no está implementado) |

Es decir: el trabajo obligatorio se concentra en **un único flujo**,
`AdminInvoice`, que hoy emite unas pocas facturas al mes. Eso convierte lo
que parecía un proyecto enorme en algo abordable — siempre que se diseñe
pensando en que el segundo flujo (honorarios) llegará después.

> ⚠️ **Esto debe confirmarlo una asesoría fiscal antes de escribir código.**
> El criterio de que las cuotas quedan fuera es el general, pero hay
> supuestos límite (comunidades que prestan servicios facturables, o
> propietarios que son empresas y exigen factura por su cuota). No soy quien
> para cerrar esa cuestión.

---

## 3. Estado actual de `AdminInvoice` y sus defectos

```prisma
model AdminInvoice {
  invoiceNo  String   @unique   // "DOM-2026-0001"
  issueDate  DateTime
  amount     Decimal            // total con IVA
  status     AdminInvoiceStatus
}
```

Lo que ya está bien: numeración correlativa por año y unicidad garantizada.

Lo que falta o falla:

1. **Sin desglose fiscal.** Solo guarda el total. Verifactu exige base
   imponible, tipo impositivo y cuota repercutida por cada tipo de IVA.
2. **Sin identificación de las partes.** Ni NIF del emisor (Domora no está
   modelada como entidad fiscal) ni datos del destinatario congelados en la
   factura. `AdminBilling` tiene el CIF y la dirección de la gestora, **pero
   se leen en vivo**: si mañana cambian, las facturas pasadas mostrarían
   datos distintos a los emitidos. Verifactu exige inalterabilidad, así que
   hay que aplicar el patrón de *snapshot* que el proyecto ya usa en
   `AccountingReceipt`.
3. **La numeración no es segura.** Se calcula con `count()` dentro de la
   transacción (`admins.service.ts:291`). Dos emisiones concurrentes pueden
   contar lo mismo y chocar contra el índice único; y si alguna vez se borra
   una factura, la serie genera huecos. Verifactu exige correlatividad sin
   huecos ni duplicados: hay que sustituirlo por una secuencia real.
4. **Sin concepto ni fecha de operación**, que son campos obligatorios de
   factura.
5. **Nada de Verifactu**: ni huella, ni encadenamiento, ni QR, ni registro de
   anulación.

---

## 4. Decisión de arquitectura: modo VERI\*FACTU

La norma permite dos caminos:

| | **VERI\*FACTU** (remisión) | **No VERI\*FACTU** (autónomo) |
|---|---|---|
| Envío a la AEAT | Cada registro, en tiempo real | No se envía |
| Firma electrónica de cada registro | **No necesaria** | **Obligatoria** (certificado cualificado) |
| Registro de eventos del sistema | No exigido | **Obligatorio** |
| Conservación | Menor carga (la AEAT tiene copia) | 4 años, íntegra, a cargo del obligado |
| Leyenda en factura | "VERI\*FACTU" | — |

**Recomendación: modo VERI\*FACTU.** Razones:

- Evita firmar electrónicamente cada registro, que en un SaaS desatendido
  obliga a custodiar un certificado en el servidor y gestionar su ciclo de
  vida y caducidad. Menos superficie de riesgo.
- Evita construir y conservar el registro de eventos del sistema.
- El volumen de Domora (facturación mensual a gestoras) hace irrelevante el
  coste del envío en tiempo real.
- Da una señal de transparencia fiscal que se puede usar comercialmente.

Contrapartida asumida: dependencia del servicio de la AEAT. Se mitiga con
cola de reintentos — la norma contempla que el envío pueda diferirse ante
indisponibilidad, sin bloquear la emisión de la factura.

---

## 5. Modelo de datos propuesto

### 5.1 Emisor fiscal

Los datos de Domora como emisora (razón social, NIF, domicilio) van a
configuración validada al arranque, junto a `JWT_SECRET`/`SEPA_ENC_KEY` en
`config/env.validation.ts`. No a base de datos: son constantes de la empresa
y así el arranque falla si faltan, igual que con los secretos.

### 5.2 `AdminInvoice`, ampliada

Campos nuevos: `series`, `sequence`, `operationDate`, `concept`,
`taxBase`, `taxRate`, `taxAmount`, `total`, y el *snapshot* del destinatario
(`recipientName`, `recipientTaxId`, `recipientAddress`) congelado en la
emisión. `amount` se mantiene por compatibilidad pero pasa a derivarse de
`total`.

### 5.3 `VerifactuRecord` — el registro de facturación

Tabla nueva, **estrictamente de solo-inserción** (jamás `UPDATE` ni
`DELETE`): es la cadena de integridad.

```prisma
model VerifactuRecord {
  id             String   @id @default(uuid()) @db.Uuid
  /// Posición en la cadena. Secuencia real de Postgres, sin huecos.
  chainSeq       BigInt   @unique
  type           VerifactuRecordType   // alta | anulacion
  invoiceId      String?  @db.Uuid     // null en anulaciones de facturas ya borradas del flujo
  /// Campos normativos serializados tal y como se enviaron: es lo que se firmó.
  payload        Json
  /// Huella SHA-256 de este registro (hex, 64 chars).
  hash           String   @unique @db.VarChar(64)
  /// Huella del registro inmediatamente anterior. Null solo en el primero.
  previousHash   String?  @db.VarChar(64)
  generatedAt    DateTime @db.Timestamptz
  /// Estado frente a la AEAT.
  submissionState VerifactuSubmissionState  // pendiente | aceptado | aceptado_con_errores | rechazado
  aeatCsv        String?  @db.VarChar(100)  // CSV devuelto por la AEAT
  aeatResponse   Json?
  submittedAt    DateTime?
  attempts       Int      @default(0)
  @@index([submissionState])
  @@map("verifactu_records")
}
```

La anulación **no borra**: se emite un registro de tipo `anulacion` que
referencia al de alta. Es el mismo criterio de "FK viva + snapshot inmutable"
que el proyecto ya aplica en contabilidad.

---

## 6. Huella y encadenamiento

- Algoritmo: **SHA-256** (ISO/IEC 10118-3:2018), representación hexadecimal
  en mayúsculas.
- Se calcula sobre una cadena formada por los campos normativos **en el orden
  exacto que fija la Orden HAC/1177/2024**, incluyendo la **huella del
  registro anterior**. Entre ellos: NIF del emisor, serie y número, fecha de
  expedición, tipo de factura, cuota total, importe total y fecha-hora de
  generación.
- La generación debe ser **serializada**: dos registros no pueden leer la
  misma "huella anterior". Se resuelve con un bloqueo a nivel de fila sobre
  el último registro de la cadena (`SELECT ... FOR UPDATE`) dentro de la
  transacción de emisión.

> Implementado y **verificado** contra la especificación oficial de la AEAT
> (v0.1.2, 27/08/2024), cuyos tres ejemplos se reproducen exactamente en
> `verifactu-hash.spec.ts`. Campos del alta, en orden: `IDEmisorFactura`,
> `NumSerieFactura`, `FechaExpedicionFactura`, `TipoFactura`, `CuotaTotal`,
> `ImporteTotal`, `Huella` (la del registro anterior) y
> `FechaHoraHusoGenRegistro`. Los de la anulación:
> `IDEmisorFacturaAnulada`, `NumSerieFacturaAnulada`,
> `FechaExpedicionFacturaAnulada`, `Huella` y `FechaHoraHusoGenRegistro`.

---

## 7. Código QR

Cada factura lleva un QR que apunta al servicio de cotejo de la sede de la
AEAT, con NIF del emisor, número de factura, fecha e importe total. En modo
VERI\*FACTU la factura debe incluir además la leyenda **"VERI\*FACTU"**.

Implicación práctica: hoy Domora **no genera un PDF de factura**. Habrá que
construirlo, y ahí es donde viven el QR y la leyenda.

---

## 8. Envío a la AEAT

- Servicio **SOAP** con XML validado contra el **XSD oficial**.
- Autenticación con **certificado electrónico** de Domora.
- Existe **entorno de preproducción**: todo se prueba ahí antes de emitir un
  solo registro real.
- Respuestas posibles: aceptado, aceptado con errores, rechazado. Cada una
  con tratamiento distinto — un rechazo no puede pasar inadvertido.
- El envío va **fuera de la transacción de emisión**: la factura se emite y
  encadena en local, y una cola con reintentos y *backoff* se encarga de
  remitirla. Si la AEAT no responde, no se bloquea la facturación.

---

## 9. Fases

**Fase 1 — Cimientos fiscales (sin Verifactu todavía). ✅ COMPLETADA.**

- `AdminInvoice` gana desglose fiscal (`taxBase`, `taxRate`, `taxAmount`,
  `total`, que sustituye al antiguo `amount`), `concept`, `operationDate`,
  `series`/`fiscalYear`/`sequence` y el snapshot del destinatario.
- Identidad fiscal del emisor en `config/env.validation.ts`, exigida en
  producción y con valores de desarrollo evidentemente falsos.
- Numeración: nueva tabla `InvoiceSeries` con
  `INSERT … ON CONFLICT DO UPDATE … RETURNING` **dentro** de la transacción
  de emisión. La cuota se redondea antes de sumarla al total, que es el
  criterio fiscal correcto (antes se redondeaba el total).
- No se puede emitir sin datos de facturación del destinatario: antes salía
  una factura sin destinatario identificado.

Verificado: 63 pruebas en verde, entre ellas 20 emisiones concurrentes que
obtienen números 1..20 sin repetir ni saltar, y una transacción fallida que
**libera** el número en vez de dejar hueco —lo que una `SEQUENCE` de Postgres
no haría—. Comprobado además contra la API real que al cambiar los datos
fiscales de la gestora la factura ya emitida conserva los suyos.

**Fase 2 — Cadena de registros, en local. ✅ COMPLETADA.**

Decisiones tomadas: modo **VERI\*FACTU**, cadena **multi-emisor desde el
diseño**, operaciones **alta + anulación**, e inmutabilidad **garantizada por
trigger** en base de datos.

Hallazgos que corrigieron el plan original:

- Los tipos de registro son **tres**, no dos: alta, **subsanación** y
  anulación. La subsanación corrige un registro ya remitido, así que se
  reserva para la Fase 4; el enum ya la contempla.
- El encadenamiento es **por SIF y NIF de obligado tributario**, no por serie,
  y los registros se enlazan **por fecha de generación** con independencia de
  la factura: una anulación encadena con el alta de otra factura. Verificado
  en la cadena real generada.
- El **registro de eventos solo es obligatorio en modo no VERI\*FACTU**, de
  modo que la decisión de modo afectaba a esta fase y no solo a la Fase 4.
  Al elegir VERI\*FACTU, queda fuera.
- **Anulación ≠ rectificativa**: la primera mata una factura que no debió
  existir; la segunda es una factura nueva de tipo rectificativo (otro
  registro de alta). Solo se implementa la anulación.

Implementado: `verifactu_chain` (cabeza por emisor, que además serializa),
`verifactu_records` (solo-inserción), módulo de huella en funciones puras,
`appendAlta`/`appendAnulacion` dentro de la transacción de la factura,
`verifyChain()` y la operación de anular factura, que no existía en el
producto.

Verificado con 85 pruebas: encadenamiento, cadenas independientes por emisor,
10 emisiones concurrentes sin bifurcar ni repetir posición, detección de un
importe manipulado, y el trigger rechazando borrados y cambios de huella o
payload mientras permite actualizar el estado de remisión.

> ✅ **Bloqueante resuelto (8-ago-2026).** El documento normativo de la AEAT
> («Detalle de las especificaciones técnicas para generación de la huella o
> hash de los registros de facturación», v0.1.2 de 27/08/2024) se extrajo con
> `pdftotext`, que ya venía en el entorno. **Los tres ejemplos oficiales del
> apartado 6 se reproducen exactamente** y viven en `verifactu-hash.spec.ts`
> como criterio de conformidad, no como test de comportamiento.
>
> La lectura del documento obligó además a una corrección: la huella se
> calcula sobre «la misma información contenida en el campo correspondiente
> del fichero XML», así que los importes van con **dos decimales, ceros
> incluidos** (`canonicalAmount`). La implementación anterior recortaba los
> ceros a la derecha —la norma reconoce que `123.1` ≡ `123.10`, pero eso
> obliga a confiar en que la AEAT normalice igual que nosotros; ahora la
> cadena hasheada es idéntica byte a byte al dato que se remitirá.
>
> Otros dos detalles que solo estaban en el documento: de los valores se
> quitan únicamente los espacios de los extremos —los interiores se
> conservan, con el ejemplo literal `" 12345678 / G33 "` → `"12345678 / G33"`—
> y existe un tercer subconjunto de campos para los **registros de evento**,
> que no aplica al haber elegido modo VERI\*FACTU.
>
> Consecuencia práctica de cara a la Fase 4: si la huella remitida no coincide
> con el recálculo de la AEAT, el registro se marca **«Aceptado con errores»**.

**Fase 3 — Factura presentable. ✅ COMPLETADA.**

PDF con los campos obligatorios del RD 1619/2012 (número y serie, fechas de
expedición y operación, identificación completa de ambas partes,
descripción, base, tipo y cuota), el QR de cotejo y la leyenda VERI\*FACTU.
Endpoint `GET /admins/invoices/:id/pdf` con el mismo alcance por rol que el
listado, y descarga real en el frontend, que hasta ahora era un aviso vacío.

Especificación del QR (cap. VIII Orden HAC/1177/2024), aislada en
`verifactu-qr.ts` igual que la huella: URL al servicio de cotejo con `nif`,
`numserie`, `fecha` (dd-mm-aaaa) e `importe`; corrección de errores M; lado
de 30 mm; zona de silencio de 2 mm; arriba y solo en la primera página. El
número de factura va escapado porque admite barras (`F-5730/2026`).

Dos decisiones que salieron de medir, no de suponer:

- **El QR se dibuja como vectores**, no como PNG incrustado. Codificar el PNG
  costaba ~3.700 ms frente a ~11 ms de la matriz de módulos, y además un QR
  vectorial sale nítido a cualquier resolución de impresión, que es lo que
  importa en un código pensado para escanearse en papel.
- **El PDF se comprime.** Se valoró dejarlo sin comprimir para poder
  inspeccionarlo, pero medido son ~3,6 KB frente a ~23 KB: un 532% más. La
  compresión se queda y las pruebas usan una opción `compress: false` que
  ejercita el mismo código de composición.

El PDF no se almacena: los datos fiscales ya están en la factura, que es
inmutable, así que el documento se reproduce idéntico siempre que haga falta.
Guardar una copia solo añadiría una fuente de verdad capaz de divergir.

Verificado con 97 pruebas y, de extremo a extremo contra la API, comparando
los **1.190 módulos** de la matriz esperada con los 1.190 rectángulos
realmente dibujados en el PDF: el QR impreso es el de esa factura y no otro.

**Fase 4 — Remisión a la AEAT.** *(en curso)*
Serialización XML contra el XSD, cliente SOAP, certificado, cola de envío con
reintentos y tratamiento de respuestas. Validación completa en preproducción.

**Hecho:** serializador XML (`verifactu-xml.ts`) escrito contra los esquemas
oficiales, con las cuatro muestras validadas con libxml2 contra
`SuministroLR.xsd` + `SuministroInformacion.xsd`, y control negativo que
confirma que el validador rechaza los errores que sí cometeríamos. Los
esquemas, las muestras y los scripts quedan versionados en
`backend/tools/verifactu-xsd/` porque la AEAT los actualiza sin aviso y hay
que poder saber contra qué versión exacta se validó lo que está en producción.

Tres hallazgos de la lectura de los esquemas que no se deducen del texto de la
norma:

1. **Los endpoints están segregados por tipo de certificado.** `www1`/`prewww1`
   para certificado normal (persona física o representante), `www10`/`prewww10`
   para certificado de sello de entidad. Equivocarse rompe el handshake TLS,
   no el XML, así que el síntoma no apunta a la causa. Las fuentes de segunda
   mano que consultamos solo mencionaban el de sello.
2. **`elementFormDefault="qualified"` en ambos esquemas**, con `Cabecera` y
   `RegistroFactura` en el namespace de `SuministroLR` y sus hijos en el de
   `SuministroInformacion`. Confundirlos invalida el envío entero.
3. **La `Cabecera` admite `Representante`** — *"a rellenar solo en caso de que
   los registros hayan sido generados por un representante/asesor del obligado
   tributario"*. Es decir: **la AEAT ya prevé de forma nativa que un tercero
   remita en nombre del obligado con su propio certificado.** Esto convierte la
   custodia de certificados ajenos de la Fase 5 en innecesaria, no solo en
   arriesgada. El serializador construye la cabecera con `Representante`
   opcional desde el principio, de modo que la Fase 5 sea configuración.

**Hecho también:** cliente SOAP con mTLS (`verifactu-soap.client.ts`), lectura
de respuesta (`verifactu-response.ts`) y cola de envío (`verifactu-submission.service.ts`,
`@Cron` cada minuto).

**Validado en vivo contra preproducción** (`prewww1.aeat.es`) con un
certificado personal — no solo con fixtures sintéticas:

1. El handshake TLS con el `.p12` funcionó al primer intento: endpoint y tipo
   de certificado correctos.
2. Se emitió una factura real de prueba (`DOM-2026-0001`, `issuerTaxId` =
   NIF del titular del certificado). El registro de Alta se remitió y la AEAT
   respondió con un rechazo **estructurado y bien formado**, no un error de
   transporte: `codigoError=1239`, *"El formato del NIF es incorrecto.
   NIF:B00000001"*. El motivo era real — el CIF de la gestora de datos
   semilla (`prisma/seed.ts`) no supera el dígito de control oficial del
   CIF español (el correcto para `B0000000` es `0`, no `1`). Confirma que
   **la AEAT valida el checksum del NIF**, algo que el XSD por sí solo no
   exige (solo longitud de 9 caracteres) y que ningún test sintético habría
   detectado.
3. Se anuló la factura (acción fiscalmente correcta ante un Alta con datos
   erróneos) para probar también el camino de anulación. La AEAT respondió
   `codigoError=3002`, *"No existe el registro de facturación"*: como el
   Alta nunca llegó a registrarse, tampoco hay nada que anular desde su
   lado. **Hallazgo real, no de lectura de la norma**: cuando un Alta se
   rechaza, la respuesta correcta no es una anulación normal sino, según el
   propio XSD, una anulación con `SinRegistroPrevio` — o, más simple, corregir
   y reenviar un Alta nueva. Es exactamente el caso que la subsanación
   pendiente tiene que resolver, y ahora con un ejemplo real de la AEAT en
   lugar de una suposición.
4. El parser leyó ambas respuestas campo a campo sin fallos: código, texto
   del error, identificación de la factura. La cadena local se mantuvo
   íntegra en ambos casos — la propiedad criptográfica es local y no depende
   de si la AEAT aceptó el registro, tal y como se diseñó.
5. Los dos registros (`rechazado`) son, por diseño, **inmutables e
   imborrables** (trigger de `verifactu_records`): quedaron como evidencia
   permanente del ensayo, que es justo el comportamiento exigido por la
   norma.

**Hecho también — subsanación:** `RechazoPrevio` (Alta) y `SinRegistroPrevio`
(Anulación) implementados en el XSD, en `VerifactuService`
(`appendAltaSubsanacion`, `appendAltaTrasRechazo`,
`appendAnulacionSinRegistroPrevio`) y propagados en la cola de envío. Ninguno
entra en el cálculo de la huella oficial (los vectores de la AEAT no los
incluyen); solo viajan en el XML y en el `payload` persistido.

Se corrigió además `voidInvoice`: ahora comprueba el estado real del último
Alta/Subsanación de la factura en la AEAT y usa `SinRegistroPrevio`
automáticamente cuando fue rechazada — antes usaba siempre la anulación
normal, que es justo lo que produjo el error 3002 descrito arriba.

**Validado en vivo por segunda vez**, cerrando el ciclo del hallazgo
anterior: se emitió otra factura de prueba (`DOM-2026-0002`, mismo CIF
semilla inválido a propósito), se esperó a que la AEAT rechazara su Alta
(`1239`, igual que antes) y se anuló con el `voidInvoice` ya corregido. El
`payload` guardado localmente confirmó `sinRegistroPrevio: true` antes de
enviarse, y la AEAT respondió esta vez con **`estado: Correcto` y un CSV
real** (`A-6R6TACPZRLL8T8`) — el Código Seguro de Verificación que solo se
emite cuando un envío se acepta de verdad. Antes del arreglo: rechazo 3002.
Con él: aceptado y registrado. La cadena y sus estados (dos alta rechazados,
dos anulaciones — una rechazada de la primera prueba, una aceptada de esta)
quedan como evidencia permanente, inmutable por el trigger de la Fase 2.

**Pendiente:** decidir si conviene una vía de negocio (endpoint, UI) para que
un administrador corrija y reenvíe un Alta rechazada usando
`appendAltaTrasRechazo`/`appendAltaSubsanacion` — hoy esos métodos existen y
están probados, pero nada los invoca todavía. No es una limitación técnica,
es una decisión de producto: qué datos puede editar el administrador y cómo
se le muestra que una factura quedó en ese estado.

**Fase 5 — Honorarios de la gestora a la comunidad.**
El segundo flujo de facturación, reutilizando todo lo anterior. **Ojo:** en
cuanto Domora permita a terceros emitir *sus* facturas, pasa a ser un SIF
comercializado y aparece la **declaración responsable del productor**, además
del problema de qué certificado se usa para remitir (cada gestora el suyo, o
figura de colaborador social). Es una decisión de producto y legal, no solo
técnica.

---

## 10. Verificación

- **Tests de la cadena**: que alterar un registro invalide todos los
  posteriores; que la anulación no borre; que dos emisiones concurrentes no
  compartan huella anterior ni número.
- **Tests de la numeración**: sin huecos ni duplicados bajo concurrencia — es
  justo lo que hoy no se cumple.
- **Vectores de prueba de la AEAT**: comparar la huella calculada con los
  ejemplos oficiales. Si no coinciden, todo lo demás sobra.
- **Preproducción de la AEAT**: ciclo completo de alta, anulación y
  respuestas de error antes de tocar producción.
- CI: estas pruebas entran en el pipeline ya existente.

---

## 11. Lo que no puedo decidir yo

1. **Confirmación fiscal del alcance** (que las cuotas quedan fuera y que no
   hay supuestos límite en el modelo de negocio de Domora).
2. **Certificado electrónico de PRODUCCIÓN**: cuál, a nombre de quién, y dónde
   se custodia. Recomendación: certificado de **sello electrónico** a nombre de
   Domora S.L. — a diferencia del de representante, no se revoca al cambiar el
   administrador de la sociedad, que es justo lo que rompería un servidor que
   remite de forma desatendida. Custodia mínima aceptable: gestor de secretos;
   lo correcto, clave en HSM/KMS con el mTLS terminado en un componente
   aislado.
   *Desbloqueado para desarrollo:* el trabajo de la Fase 4 y su validación en
   preproducción se hacen con un certificado de persona física ya disponible,
   contra `prewww1.aeat.es`. En preproducción el emisor de las facturas de
   prueba debe ser **el NIF del titular del certificado**, no el de Domora, o
   la AEAT rechaza por falta de representación. Como la cadena está indexada
   por `issuerTaxId`, esas pruebas generan su propia cadena y no contaminan la
   de producción.
3. **Modo VERI\*FACTU vs no VERI\*FACTU**: recomiendo el primero por lo
   argumentado, pero es una decisión con implicaciones fiscales.
4. **Declaración responsable del productor**, si se va a la Fase 5.
5. ~~**La especificación oficial**~~ — **resuelto**: la huella está
   implementada y verificada contra el documento oficial de la AEAT, con sus
   tres ejemplos como criterio de conformidad en el propio test. Sigue siendo
   cierto que este plan no es una especificación de referencia: para la Fase 4
   habrá que leer el XSD y la documentación del servicio web.

---

## Fuentes

- [RDL 15/2025 amplía plazos — Tax Alert KPMG (PDF)](https://assets.kpmg.com/content/dam/kpmgsites/es/pdf/2025/12/tax-alert-el-real-decreto-ley-15-2025-amplia-plazos-adaptacion-reglamento-verifactu.pdf.coredownload.inline.pdf)
- [ICAM — Se retrasa a 2027 la entrada en vigor de Verifactu](https://web.icam.es/se-retrasa-al-2027-la-entrada-en-vigor-de-verifactu-la-nueva-normativa-de-facturacion-electronica/)
- [Noticias Jurídicas — Nueva prórroga hasta 2027](https://noticias.juridicas.com/actualidad/noticias/20735-nueva-prorroga:-verifactu-no-sera-obligatorio-hasta-2027-para-sociedades-y-otros-contribuyentes/)
- [Verifactu — Guía técnica para desarrolladores](https://www.verifactu.com/verifactu-desarrolladores/)
- [Verifactu — Requisitos técnicos](https://www.verifactu.com/requisitos-verifactu/)
- [Verifactu — Código QR](https://www.verifactu.com/verifactu-qr/)
- [FAQs sobre el Reglamento Verifactu (RD 1007/2023)](https://www.planificacion-juridica.com/faqs-sobre-el-reglamento-verifactu-rd-1007-2023/)
- [Verifactu en cuotas y alquileres — alcance](https://leyfacturaelectronica.com/como-afecta-verifactu-a-la-facturacion-recurrente-suscripciones-igualas-alquileres/)
- [IESA — Facturación electrónica y Verifactu en comunidades](https://iesa.es/la-voz-digital-del-sector/la-facturacion-electronica-y-verifactu-impacto-en-comunidades-de-propietarios-y-administradores)
