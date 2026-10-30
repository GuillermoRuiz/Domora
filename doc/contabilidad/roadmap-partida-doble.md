# Roadmap — Contabilidad por partida doble

Desglose por fases del plan aprobado en la sesión del 2026-09-24 (referenciado en la
[ADR](./adr-partida-doble.md), que hasta ahora solo lo resumía en una línea). Este
documento es la fuente de verdad del avance: se actualiza al cerrar cada fase, y el
[MVP Tracker](../MVP%20interno%20-%20MVP%20Tracker.csv) enlaza aquí en vez de repetir
el detalle (IDs 15, 16, 26, 30, 39, 41, 42).

**Última actualización:** 2026-09-30. Fases 0-13 CERRADAS — migración a partida doble completa.

## Resumen

| Fase | Qué hace | Estado | Commits |
|---|---|---|---|
| 0 | Decisiones y ADR (documentación, D1-D23) | ✅ Cerrada | `f93047b`, `1ee58eb` |
| 1 | Base de tests y CI contra Postgres real | ✅ Cerrada | `e8673d1` |
| 2 | Núcleo del diario (JournalEntry/JournalLine, garantías en base de datos) | ✅ Cerrada | `c41fac0` |
| 3 | Plan de cuentas, cuentas bancarias, fecha de corte | ✅ Cerrada | `dc07f7b`, `74c8acc` |
| 4 | Los recibos contabilizan su emisión, cobro, devolución y anulación | ✅ Cerrada | `ba94ac6` |
| 5 | Cobros, anticipos, 555, devoluciones manuales, cobro de remesa, planes de pago | ✅ Cerrada | `c2b55e8`, `cbd8a17` |
| 6 | Ficheros de devolución bancaria (pain.002 / camt.054) | ✅ Cerrada | `b25ceb8`, `863672f` |
| 7 | Proveedores (IVA/retención), modelos 111/190/347, nóminas | ✅ Cerrada | `292f8ac`/`e45caf4`, `2f509fb`/`a98720c`, `d87176a` |
| 8 | Tesorería, asiento manual, conciliación, cambio de lectores, **eliminación de `Movement`** | ✅ Cerrada | `194568d` → `1014a5b` |
| 9 | Saldos iniciales y su importación | ✅ Cerrada | `d257079`, `88eb4d1`, `ebb5a76`, `e946b97`, `90c7b40` |
| 10 | Intereses de demora | ✅ Cerrada | `dce33ae`, `0c5cdc9`, `96b12aa` |
| 11 | Cierre de ejercicio real (regularización, apertura del año siguiente, aplicación del resultado) | ✅ Cerrada | `74cd377`, `b0ff9ed`, `c7b6f21`, `eecbed3` |
| 12 | Informes en pantalla, PDF y Excel | ✅ Cerrada | `abf4966`, `ad09191`, `a1557b6`, `71381a5`, `2dd9066`, `c97769b`, `e77e158` |
| 13 | Escenario de año completo, endpoint de integridad, documentación final | ✅ Cerrada | `61de002`, `e67d873`, `3ffa380` |

Orden previsto en el plan: 0→1→2→3→4→5→6→7→8→9→10→11→12→13, con las fases 6, 7b/7c
y 10 pensadas para poder ir en paralelo con la 5 o la 7a. En la práctica se hicieron
en orden secuencial igual.

## Fases cerradas (0-12)

### Fase 0 — Decisiones y ADR
Documento de decisiones (D1-D23) validado por el responsable de producto el 24/09,
con tres precisiones sobre los valores por defecto (D7: interés legal del dinero;
D12: el 347 también declara ingresos de terceros; D22: la cantidad afecta cuenta
solo el principal). Ver [ADR](./adr-partida-doble.md) y
[fiscal-comunidades.md](../compliance/fiscal-comunidades.md).

### Fase 1 — Base de tests y CI
CI de GitHub con Postgres real (antes las 23 specs de integración no se ejecutaban
en CI) y fixtures compartidos (`backend/src/testing/db-fixtures.ts`:
`createAdministrator`, `createLedgerEstate`, `createProperty`, `purgeEstate`...).

### Fase 2 — Núcleo del diario
`JournalEntry`/`JournalLine` con débito y crédito, numerados sin huecos por finca y
ejercicio. Garantías que la base de datos hace cumplir sola, no solo el servicio:
**36 códigos de error dedicados (DM001-DM080)** y **59 tests** que rompen cada
garantía a propósito contra Postgres real (`ledger/db-guarantees.spec.ts`) — un
asiento descuadrado no se graba, uno ya contabilizado no se edita ni se borra (solo
se revierte con un contraasiento), una línea de propietario exige su propiedad, un
ejercicio cerrado bloquea nuevas contabilizaciones.

### Fase 3 — Plan de cuentas, bancos y configuración
Plan de cuentas jerárquico (`ChartAccount` con padre/nivel/naturaleza deudora o
acreedora, no una lista plana), varias cuentas bancarias por finca (`BankAccount`,
IBAN cifrado en reposo), fecha de corte contable configurable.

### Fase 4 — Los recibos contabilizan
`AccountingReceipt` genera su asiento al emitirse, cobrarse, devolverse y anularse.
Antes ningún documento contabilizaba nada.

### Fase 5 — Cobros, anticipos y remesas
Imputación legal de pagos parciales (art. 1173-1174 CC: primero intereses, después
lo más antiguo), anticipos y partidas pendientes de aplicación (555), devoluciones
manuales, y **el cobro de una remesa SEPA pasó a existir como flujo** (antes no
generaba ningún asiento).

### Fase 6 — Ficheros de devolución bancaria
Import de pain.002 y camt.054 con aplicación automática de las devoluciones a sus
recibos.

### Fase 7 — Proveedores, impuestos y nóminas
Facturas de proveedor con IVA y retención de IRPF repartidos por línea,
contabilizadas al registrarse y al pagarse. Modelos 111 (trimestral, por fecha de
pago), 190 (resumen anual) y 347 (terceros >3.005,06€, con las exclusiones del art.
33.5 RGAT para comunidades). Nóminas registradas a mano y contabilizadas.

### Fase 8 — Tesorería, cambio de lectores y eliminación de `Movement`
Tesorería rápida (cobro/pago suelto, traspasos), asiento manual, libro diario
navegable con filtros, conciliación bancaria multi-cuenta N:M sobre el diario
(detector automático de delimitador en CSV, deduplicación por hash de fichero).
**`Movement` — el libro de caja de una sola cuenta que sustentaba la contabilidad
hasta ahora — se eliminó por completo** del backend, del frontend y de la base de
datos (`20260926230000_drop_cash_book`). Cierre de la fase: aviso de anticipo sin
aplicar en el panel del propietario y en morosidad, separado de la deuda (nunca se
compensan automáticamente — aplicarlo sigue siendo una acción explícita de la
gestora).

13 migraciones de Prisma en total para las fases 2-8 (`backend/prisma/migrations/`,
prefijo `ledger_` más `drop_cash_book`).

### Fase 9 — Saldos iniciales y su importación
Cerraba el hueco que ya avisaba la tarjeta de puesta en marcha de la finca (MVP
Tracker ID 25: "los saldos arrancan en 0" — el aviso se retiró).

**9a. Backend del asiento de apertura** (`d257079`): `OpeningBalanceSet` con sus 5
tipos de fila hija (bancos, deudas de propiedad por año de origen, anticipos,
facturas de proveedor pendientes, otros saldos). "Un documento = un asiento" se
respetó también aquí: en vez de un asiento único con una línea de ajuste, cada
deuda genera su propio recibo `saldo_anterior` con su propio asiento, y cada
factura pendiente su propia `SupplierInvoice` con el suyo — la diferencia aceptada
(117 o 120, D17 de la ADR) se reparte exactamente entre todos ellos.
`post()`/`repost()` como único punto de escritura, con el mismo patrón "revertir y
volver a contabilizar" que el cierre de ejercicio (fase 11). 12/12 tests propios,
suite completa 967/967.

**9b. Puesta en marcha** (`88eb4d1`): paso "Saldos iniciales" en
`EstateSetupService`, hecho con una apertura contabilizada O con "sin saldos
previos" confirmado.

**9c. Importación** (`ebb5a76`): dos entidades nuevas en el asistente de
migración, `opening-balance` y `supplier-invoice` — a diferencia del resto de
entidades, estas dos NO contabilizan nada por sí mismas: solo rellenan el
borrador de `OpeningBalanceSet` (se lee el borrador actual, se le suman las filas
del fichero, se guarda una vez). `rollback()` las bloquea explícitamente: sus
filas no dejan `ImportedRecord` que revertir.

**9d. Frontend** (`e946b97`, `90c7b40`): pestaña "Saldos iniciales" en el detalle
de contabilidad con sus 5 secciones, cálculo de diferencia en vivo, contabilizar o
corregir un asiento ya contabilizado, y confirmar "sin saldos previos". Suite
completa 97 ficheros, 1110/1110 tests.

### Fase 10 — Intereses de demora
Interés simple, días reales/365 fijo, sin anatocismo (D7 de la ADR). Se liquidan
bajo demanda — nunca con un proceso automático diario.

**Backend** (`dce33ae`): `LatePaymentInterestPolicy` (tipo vigente por finca, con
días de gracia y referencia al acta) y `ReceiptInterestAccrual` (cada tramo ya
liquidado). Dos garantías nuevas: un EXCLUDE gist para que dos vigencias, o dos
tramos de la misma deuda, nunca se solapen (T11), y un trigger (DM100) que impide
liquidar interés sobre un recibo que ya es de intereses. `interest.rules.ts`
(función pura) calcula un tramo por cada cambio de tipo o de principal dentro del
periodo — cubre cobro parcial a mitad de tramo y año bisiesto (el 29 de febrero
cuenta como día real, el divisor sigue siendo 365). `LateInterestService.preview()`
(no persiste nada) y `.accrue()` (contabiliza un recibo `intereses_demora` real,
430/769, reusando `ReceiptPostingService.issue()`). `debtors.service.ts` dejó de
leer `Debtor.interest` (campo muerto — nada lo escribía en producción): el saldo y
el certificado de deuda calculan el interés real desde los recibos liquidados, con
el año de origen de la DEUDA, no el de la emisión del recibo de intereses. 25 tests
de integración contra Postgres real + 10 del módulo puro. Suite completa 90
suites, 1013/1013.

**Frontend** (`0c5cdc9`, `96b12aa`): el botón "Aplicar recargos" de morosidad —
antes desactivado, "próximamente", solo mutaba un número en memoria — se
reemplaza por "Liquidar intereses" real: calcula por cada deudor seleccionado (o
todos) el interés de cada recibo pendiente hasta la fecha elegida, y al confirmar
lo contabiliza de verdad. Suite completa 97 ficheros, 1111/1111 tests.

### Fase 11 — Cierre de ejercicio real
Antes, cerrar un ejercicio (`FiscalYearsService.closeFiscalYear`) solo ponía la
marca `Cerrado` — el trigger de base de datos SÍ bloqueaba contabilizar en un año
cerrado, pero no había regularización de resultado, ni dotación de reserva en modo
B, ni apertura real del año siguiente, ni aplicación del resultado, ni reapertura.

**Backend** (`74cd377`): `YearCloseService.close()` en una única transacción —
regularización (6xx/7xx del año a cero, diferencia a la 129), dotación de reserva
si el modo es `year_end_allocation`/`both` (`fixed_amount`, `pct_of_result` o
`top_up_to_legal_minimum` — nunca dota con pérdidas ni más de lo que da el
resultado), cierre por dimensión (una línea por cada partida abierta de
430/400/410, agregada para el resto de cuentas de balance) y apertura espejo del
año N+1. Cierre y apertura van en la MISMA transacción a propósito: los triggers
diferidos de recibos y facturas suman TODAS las líneas del documento sin filtrar
por tipo de asiento, así que cerrar sin reabrir en el acto dejaría cualquier
documento con un pendiente que no cuadra. `year-close.rules.ts` aísla la parte
pura (`closingLine`/`openingLine`, mismo signo para cualquier naturaleza de
cuenta) para poder probarla exhaustivamente sin base de datos. `reopen()`
revierte en orden inverso vía `journal.reverse()` — y reabre el ejercicio ANTES
de revertir, porque los contraasientos van fechados el mismo día que el original
y el trigger de asientos rechaza contabilizar en un año que siga marcado como
Cerrado. Solo si N+1 no está cerrado. `applyResult()` reclasifica la 129 a
remanente o reserva tras la aprobación en junta (devolución por coeficiente,
fuera de alcance). Migración `20260929100000_ledger_year_close`: solo los dos
campos nuevos de la dotación (regla y valor) más auditoría de cierre/reapertura —
el cierre en sí reutiliza T1-T10 ya existentes, sin garantías nuevas en base de
datos. 12 tests de integración contra Postgres real. Suite completa 92 suites,
1034/1034 (más `b0ff9ed`, que expone la regla de dotación en la API — se había
quedado sin endpoint que la escribiera — y `c7b6f21`, que corrige `applyResult()`
para devolver euros y no céntimos internos: 92 suites, 1037/1037).

**Frontend** (`eecbed3`): pestaña "Cierre" nueva — checklist de precondiciones
(bloqueos en rojo, avisos en amarillo, desde `close-preconditions`), cerrar con
confirmación, reabrir con motivo obligatorio y aplicar el resultado a remanente o
fondo de reserva; sustituye al botón "Cerrar ejercicio" ingenuo que vivía en
Presupuesto. Ajustes contables gana la configuración de la dotación al cierre
(regla e importe, por ejercicio y por defecto) — sin esto la fase 11 backend no
tenía forma de activarse desde la interfaz. Suite completa 98 ficheros,
1118/1118 tests.

### Fase 12 — Informes en pantalla, PDF y Excel
Hasta acá nada de esto existía en PDF o Excel: balance de situación, cuenta de
resultados, mayor por cuenta, liquidación por criterio de caja para la junta,
extracto por propiedad, certificado de deuda del art. 9.1.e.

**Backend** (`abf4966`, `ad09191`, `a1557b6`, `c97769b`): `ledger/reports/
LedgerReportsService` — sumas y saldos, mayor (filtrable por cuenta/propiedad/
proveedor/fecha), balance de situación (reclasifica la 430 en "Deudores
propietarios"/"Anticipos de propietarios" SIN compensar, derivando el anticipo por
RESTA del agregado para que Activo y Pasivo+Patrimonio cuadren siempre por
construcción) y resultados frente a presupuesto, todos en
`GET estates/:estateId/reports/{informe}?...&format=json|pdf|xlsx`, reutilizando el
`TableReport` genérico de la fase 7b. Liquidación por criterio de caja
(`cashSettlement`) distingue cobro/pago real de una simple reclasificación
exigiendo que la MISMA journal_entry tenga también una línea bank/cash, y reparte
un cobro/pago parcial entre las cuentas de un recibo/factura multi-línea con
`splitByWeights()`. Extracto por propiedad (`GET properties/:propertyId/
ledger-extract`) es el primer informe accesible también al rol C — de ahí salió
`71381a5`/`2dd9066`: `EstateAccessService` es por FINCA (el rol C tiene en su JWT
todas las fincas donde tiene alguna propiedad), así que un extracto o certificado
por finca se filtraría entre vecinos; se extrajo `PropertyAccessService` como
única implementación del chequeo por propiedad (antes duplicada en
`PropertiesService`, y a punto de triplicarse), y `71381a5` corrigió con el mismo
criterio una fuga ya existente en `GET properties/:id`. Certificado de deuda en
PDF (art. 9.1.e LPH, `DebtCertificatePdfService`) separa la deuda que afecta a la
transmisión (año en curso + 3 naturales anteriores) de la anterior, con principal
e intereses desglosados — la cantidad de la que responde el inmueble es solo
principal —, y firmas en blanco (Domora no modela secretario/presidente como
cuentas reales). Suite completa 95 suites, 1073/1073.

**Frontend** (`e77e158`): `mayor-tab` (selector de cuenta + filtros de propiedad/proveedor/
fecha), `balance-tab` (sumas y saldos y balance de situación como dos vistas de la
misma pestaña, con aviso si no cuadra), `resultados-tab` (presupuesto vs.
ejecutado) y `liquidacion-tab` (cobrado/pagado real del periodo) en
`accounting-detail`, todos con exportación a Excel/PDF; nuevo `app-report-table`
(`shared/components/`) como renderizador genérico de secciones con totales,
reutilizado por las cuatro pestañas en vez de repetir el marcado de tabla cuatro
veces. `property-detail` (única pantalla que ya usa el rol C) gana "Descargar
extracto" (PDF/Excel) y "Descargar certificado de deuda" (PDF) — no se duplicó en
`dashboard-c` porque ese componente ya navega a `property-detail`, que es donde
vive la descarga real. Suite completa 104 ficheros, 1140/1140 tests.

### Fase 13 — Escenario de año completo y cierre del proyecto

**Backend** (`61de002` invariantes + endpoint de integridad; `e67d873` fix de
cierre; `3ffa380` escenario): `InvariantsService` gana las invariantes 2-4
(pendiente cacheado de recibos/facturas contra sus líneas en el diario,
anticipos que nunca deben) como errores duros — se suman a `check()`, la red
de seguridad que ya usaban decenas de specs de fases anteriores — y 5/7/8
(extracto bancario, reserva legal mínima, 555 sin aplicar) como avisos de
negocio en `checkWarnings()`, separados a propósito para no romper esas
specs con falsos positivos. `checkAll()` junta las dos y las expone en
`GET estates/:estateId/ledger/integrity`, `@Roles('A','B')`.

`ledger/scenario/full-year.integration.spec.ts`: un ejercicio entero de una
finca real — 4 propiedades, apertura con deuda de dos años (2022 y 2024,
para ejercitar los dos tramos del certificado del art. 9.1.e) + anticipo +
factura pendiente, 12 emisiones y remesas, 2 devoluciones (una recobrada en
efectivo), una derrama, 6 facturas de proveedor (2 con IRPF, una pagada solo
a medias), los 4 modelos 111 trimestrales, 190, 347, una nómina, intereses
de demora, uso del fondo de reserva y cierre con complemento en modo B —
verificado con las invariantes de fase 13 a cada paso, no solo al final. 97
suites, 1109/1109 tests.

Dos hallazgos reales del escenario, no ajustes de test:
- **Bug de producción corregido** (`e67d873`): el cierre de ejercicio no
  cerraba nunca los anticipos (línea de la 430 sin `receiptId`) por
  dimensión — ni el bucle de partidas abiertas de recibos los toca (no son
  de ningún recibo) ni el bloque genérico (excluye `owners_receivable` a
  propósito). Cualquier finca con un anticipo sin aplicar no podía cerrar
  el ejercicio: el asiento de cierre quedaba descuadrado exactamente por
  ese importe.
- **Hueco confirmado el 30/09, cerrado el mismo día** (fuera de las 14 fases
  del plan original, a pedido del usuario tras analizar la base legal —
  art. 9.1.f LPH — y lo poco que publica el sector sobre esto): "Uso del
  fondo de reserva" (117 → 746) no tenía ningún servicio de aplicación
  dedicado — `TreasuryPostingService.quickEntry` rechaza la 117 por no ser
  de naturaleza ingreso/gasto. `ReserveFundPostingService` +
  `ReserveFundApplication` (migración `20260930120000_ledger_reserve_fund`,
  DM110/DM111): motivo (de la lista tasada por la ley: conservación,
  reparación, rehabilitación, accesibilidad, eficiencia energética, seguro
  de daños, mantenimiento permanente, otro) y referencia al acta
  OBLIGATORIOS — a diferencia de `meetingReference` en la política de
  intereses, que es opcional — porque el fondo tiene "una finalidad
  totalmente independiente" de los gastos ordinarios y la ley no da un
  trámite propio para disponer de él, así que la traza de cumplimiento va
  en el propio dato. Vínculo opcional a la factura o nómina que motivó el
  gasto real. Nunca se edita, se deshace con contraasiento. El escenario de
  año completo ya usa el servicio real, no el `JournalService.post` directo
  documentado antes. Ver D4 ampliada en la ADR.

`scripts/smoke-e2e.sh` gana la integridad y sumas y saldos. `docs/data-
model.md` (§7-8 y Apéndice G) y `doc/backend-execution-plan.md` marcados
como superados, con puntero a este roadmap — describían el libro de caja de
una sola cuenta que se eliminó en la fase 8. `doc/analisis-competitivo.md`
corregido: derramas, libro mayor/balance/resultados, liquidación y cierre,
y nóminas ya no son huecos.

## Invariantes del sistema (fase 13, expuestas en `GET .../ledger/integrity`)

1. Sumas iguales de debe y haber por finca y año. Error.
2. El pendiente de cada recibo coincide con la suma de sus líneas en la 430. Error
   (confirmado imposible de violar hoy: el trigger diferido DM031 lo impide).
3. Un anticipo (430 sin recibo) nunca tiene saldo deudor neto. Error.
4. Lo mismo que 2, para facturas de proveedor y la 400/410 (DM051). Error.
5. Numeración de asientos sin huecos por finca y ejercicio. Error.
6. El saldo de cada cuenta bancaria coincide con el extracto, salvo lo sin conciliar.
   Aviso.
7. El fondo de reserva no baja del 10 % del presupuesto ordinario (art. 9.1.f LPH).
   Aviso.
8. La 555 (partidas sin aplicar) distinta de cero. Aviso.

## Qué NO entra en esta versión (decisión ya tomada, no hueco técnico)

- IVA deducible de la comunidad y modelo 303 (D10).
- Firma electrónica cualificada del certificado de deuda (eIDAS/notarial).
- Conexión en vivo con el banco (open banking/PSD2) — todo el import es de fichero.
- Más de un preset de origen para la migración de histórico (hoy solo Gesfincas.net).
