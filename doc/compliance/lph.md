# Obligaciones del administrador de fincas — LPH y normativa conexa

> Fase 14 del plan de ejecución. Marco: Ley 49/1960 de Propiedad
> Horizontal (LPH, con sus reformas), Ley 10/2010 (PBC/FT), RD 1619/2012
> (facturación).

> **Cambio en curso (24/09/2026):** la contabilidad pasa a partida doble
> (`doc/contabilidad/adr-partida-doble.md`). Los apartados 1 y 2 describen
> el estado actual y el objetivo.

## 1. Fondo de reserva (art. 9.1.f LPH) — implementado, en revisión

Mínimo legal: **10% del último presupuesto ordinario**. El resumen
contable (`GET /estates/:id/accounting/summary`) expone
`reserveLegalMinimum` (10% del presupuesto del ejercicio corriente) y
`reserveBelowLegalMinimum`. Si no hay presupuesto cargado, el mínimo es
`null` — no se afirma cumplimiento sin datos. El frontend debe mostrar el
aviso cuando `reserveBelowLegalMinimum === true`.

**Limitación actual:** la reserva que se compara es el saldo del banco
(`reserve = balance`), no un fondo real.

**Objetivo (ADR, D3 y D4):**
- La reserva es el saldo de la cuenta 117.
- Se dota por finca y año con un porcentaje de cada recibo, con una
  dotación al cerrar el ejercicio o con ambas cosas.
- Se aplica liberando la 117 contra la 746.
- El mínimo se compara con el último presupuesto ordinario **aprobado**.

## 2. Certificado de deudas en transmisiones (art. 9.1.e LPH) — implementado, en revisión

**Objetivo (ADR, D6 y D22):**
- El inmueble responde de la parte vencida del año en curso y de los
  **tres años naturales anteriores**.
- El certificado separa esa deuda del resto, usando el año de origen de
  cada recibo (`originYear`). También separa principal e intereses.
- Los saldos iniciales se cargan como recibos "saldo anterior" con su año,
  nunca como una cantidad global. Si no, el certificado no podría saber
  qué parte es exigible al comprador.
- Los cobros se imputan primero a los intereses y después a lo más
  antiguo (arts. 1173 y 1174 CC).
- El certificado sale en PDF para la firma del secretario, con el visto
  bueno del presidente.

**Estado actual:**

`GET /properties/:id/debt-certificate` (roles A/B, acceso auditado):
estado de deudas de la propiedad derivado en el momento de emisión —
recibos pendientes/devueltos por periodo, principal, intereses del
expediente de morosidad, acuerdo de pago activo si existe, y flag
`isDebtFree`. Es el documento que el secretario-administrador firma para
el otorgamiento de escrituras. Pendiente: render a PDF con firma (usa la
Fase 12 para el fichero).

## 3. Juntas y actas (arts. 16 y 19 LPH) — proceso documentado

- **Convocatoria (art. 16)**: plazos (6 días ordinaria mínimo), orden del
  día, y la **relación de propietarios con deudas pendientes** — la única
  difusión legítima de morosidad a terceros (ver
  `doc/compliance/rgpd.md` §7). Los datos ya existen
  (`GET /estates/:id/debtors`); la generación del documento de
  convocatoria queda como trabajo de frontend/plantilla.
- **Acta (art. 19)**: requisitos de contenido y firma; el libro de actas
  se materializa como documentos inmutables de la Fase 12 (tipo 'Acta',
  ficheros con clave opaca, sin endpoint de edición/borrado). Los eventos
  de junta viven en `property_events`.

## 4. Prevención de blanqueo (Ley 10/2010)

Los administradores de fincas son sujetos obligados cuando gestionan
fondos de terceros. Medidas en la plataforma:
- **Titularidad real**: `ExternalOwner` (titulares persona jurídica sin
  cuenta) admite `notes` para el registro de titularidad real; la
  diligencia debida documental es proceso de la gestora.
- Los movimientos de fondos quedan trazados (movements + remesas +
  data_access_log), lo que soporta el deber de conservación documental
  (10 años, art. 25 Ley 10/2010 — por encima de los 6 mercantiles).

## 5. Facturación de honorarios (RD 1619/2012) — implementado

`POST /admins/:id/invoices` (rol A): numeración **correlativa por año sin
huecos** (`DOM-YYYY-NNNN`, calculada dentro de la transacción), base
imponible = MRR vigente, IVA 21%. Cada emisión deja su entrada en el
registro de actividad de la gestora. Pendiente: retenciones IRPF cuando
la gestora sea persona física, y render PDF.

## 6. Seguro RC / colegiación

No hay exigencia legal universal de colegiación, pero sí de seguro de
responsabilidad civil en varias CCAA. Se registra como dato documental de
la gestora (campo `notes` de `Administrator` hoy; campo propio si se
formaliza en el modelo).
