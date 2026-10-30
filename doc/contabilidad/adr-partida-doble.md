# ADR — Contabilidad por partida doble

- **Estado:** aceptado el 2026-09-24. El responsable de producto validó D1–D23 con sus valores por defecto, con estas precisiones:
  - D7: tipo por defecto = interés legal del dinero;
  - D12: el 347 **también** declara los ingresos de terceros;
  - D22: la cantidad afecta cuenta solo el principal.
- **Fecha:** 2026-09-24.
- **Sustituye a:** el libro de caja de una sola cuenta (`Movement`), descrito en `docs/data-model.md` §7.4 y en `doc/backend-execution-plan.md`, Fase 5.

## 1. Contexto

La contabilidad actual no refleja lo que pasa en la finca. Se ha comprobado en el código:

- **`Movement` es un libro de caja con saldo corrido.**
  - Cada movimiento tiene una única cuenta, y la contrapartida implícita es el banco.
  - `createMovement` calcula el saldo a partir del último movimiento y no bloquea nada. Dos altas simultáneas leen el mismo saldo.
  - Un movimiento con fecha atrasada rompe la cadena.
  - Solo se puede editar el último movimiento. Los campos de retrocesión existen, pero nada los usa.
- **Ningún documento contabiliza.** No generan apunte:
  - emitir, cobrar o devolver recibos;
  - las remesas (el cobro de una remesa ni siquiera existe como flujo);
  - las cuotas de los planes de pago;
  - las facturas de proveedores y sus pagos.
  
  La gestora tiene que apuntar el dinero dos veces, y nada obliga a que cuadre.
- **Fondo de reserva.** Se da por hecho que es el saldo del banco (`reserve = balance`).
- **Intereses de demora.** `Debtor.interest` es un campo que nadie calcula.
- **Cierre de ejercicio.** Solo cambia un estado. No hay regularización, cierre ni apertura, y no se bloquea contabilizar en un año cerrado.
- **Saldos iniciales.** No existen. La importación de movimientos arranca el saldo en 0.

La ley no obliga a una comunidad a llevar el Plan General Contable. El art. 20 LPH solo exige que el administrador lleve la contabilidad. Aun así, el sector español trabaja con partida doble: Fincasoft, eFincas y Fynkus lo hacen, y la gestora que migra espera cargar un asiento de apertura y sacar un balance de situación.

Todos los datos actuales son de prueba y no hay ninguna gestora esperando para migrar. No hay coste de migración.

## 2. Decisión

1. **El libro diario es la única fuente de verdad.** `JournalEntry` y `JournalLine` sustituyen a `Movement`.
2. **Cada documento contabiliza en su propia transacción.** Recibos, cobros, remesas, devoluciones, facturas, pagos, intereses, nóminas y liquidaciones de impuestos generan su asiento en la misma transacción que el cambio del documento.
3. **Subcuentas como dimensiones de línea.** La línea lleva propiedad, proveedor, recibo, factura y centro de coste, en lugar de miles de subcuentas.
   - La 430 y la 400 funcionan como libros de partidas abiertas.
   - El código de 7 dígitos (4300010) se deriva para mostrarlo.
4. **Inmutabilidad.** Lo contabilizado no se edita: se corrige con un contraasiento.
5. **Las garantías viven en PostgreSQL.** Los triggers y CHECK están descritos en el plan de implementación. El servicio no es la única barrera.
6. **Despliegue aditivo.** El diario convive con `Movement` hasta que se cambian todos los lectores. Después `Movement` se elimina.

## 3. Consecuencias

**A favor**
- La tesorería, la deuda de cada propietario y la deuda con cada proveedor no pueden descuadrarse por olvidar un apunte.
- Salen directamente del diario:
  - el balance de situación y la cuenta de resultados;
  - la liquidación para la junta;
  - el extracto por propiedad;
  - el fondo de reserva real.
- Los saldos iniciales son el asiento de apertura: el mismo mecanismo que la apertura de cada año tras el cierre.
- El certificado de deuda del art. 9.1.e sale de las partidas abiertas, con el año de origen de cada deuda.

**En contra**
- Es un cambio grande: recibos, SEPA, proveedores, morosidad, importación, presupuestos, conciliación y seis pestañas del frontend.
- Una regla de contabilización mal diseñada afecta a todo. Por eso las decisiones de la sección 4 se validan antes de programar.
- Las garantías en triggers no se ven desde Prisma. Un spec comprueba que existen.

## 4. Decisiones que hay que validar

Cada una lleva su valor por defecto recomendado y el motivo. Las marcadas con ⚖ tienen base legal verificada. Las marcadas con ❓ piden confirmación expresa.

### Criterio y plan de cuentas

**D1. Criterio de devengo.** Emitir un recibo carga la 430 y abona el ingreso. Cobrarlo carga el banco y abona la 430.
- Fecha del asiento de emisión: el primer día del periodo del recibo, o la fecha de corte si es posterior. No se usa el día en que la gestora pulsa "Generar".
- *Motivo:* es la práctica del sector. Además, la liquidación por criterio de caja que se presenta a la junta sale igual del diario.

**D2. Plan de cuentas de la plantilla.** ❓

| Grupo | Cuentas |
|---|---|
| 1 | 117 Fondo de reserva · 120 Remanente · 121 Resultados negativos de ejercicios anteriores · 129 Resultado del ejercicio |
| 4 | 400 Proveedores · 410 Acreedores · 430 Propietarios · 465 Remuneraciones pendientes de pago · 4751 HP acreedora por retenciones · 476 Seguridad Social acreedora |
| 5 | 555 Partidas pendientes de aplicación · 570 Caja · 572 Bancos |
| 6 | 621 Arrendamientos · 622 Reparaciones y conservación · 623 Servicios profesionales (administración) · 625 Seguros · 626 Servicios bancarios · 628 Suministros · 629 Otros servicios · 631 Tributos · 640 Sueldos · 642 Seguridad Social a cargo de la comunidad · 650 Pérdidas de créditos incobrables · 669 Otros gastos financieros · 678 Gastos excepcionales |
| 7 | 700 Cuotas ordinarias · 701 Derramas · 746 Fondo de reserva aplicado · 752 Ingresos por arrendamientos · 759 Ingresos por servicios diversos · 769 Intereses · 778 Ingresos excepcionales |

Hay que confirmar:
- 700 o 705 para las cuotas;
- 701 para las derramas;
- 746 para la reserva aplicada;
- si hace falta una 1171 "Fondo para obras" aparte de la 117 para derramas de varios años.

Cada finca puede añadir subcuentas.

### Fondo de reserva

**D3. Dotación configurable por finca y por ejercicio.**
- **Modo A:** una parte de cada recibo va directamente a la 117. El porcentaje se sugiere desde el presupuesto como reserva / (ordinario + reserva).
- **Modo B:** dotación al cerrar el año, de la 129 a la 117, con una de tres reglas:
  - importe fijo;
  - porcentaje del resultado;
  - completar hasta el mínimo legal.
- **Ambos modos a la vez:** A durante el año, más un complemento al mínimo al cerrar.
- ⚖ Se comprueba el mínimo del art. 9.1.f LPH: el 10 % del último presupuesto ordinario.
- **Por defecto:** modo A.

**D4. Uso de la reserva.**
- La obra se contabiliza como gasto normal (6xx).
- La reserva se libera de la 117 a la 746 por el mismo importe, así que el resultado del año no se distorsiona.
- Nunca se paga directamente de la 117 contra el banco.
- **D4 ampliada (2026-09-30):** el fondo tiene "una finalidad totalmente
  independiente" del presupuesto ordinario (art. 9.1.f LPH) — solo obras de
  conservación, reparación y rehabilitación, accesibilidad, eficiencia
  energética, un seguro de daños o un contrato de mantenimiento permanente.
  Por eso la liberación (`ReserveFundApplication`, `ReserveFundPostingService`)
  exige un motivo de esa lista tasada y la referencia al acta que aprobó la
  obra o el contrato — a diferencia de `LatePaymentInterestPolicy.
  meetingReference`, que es opcional, acá es obligatorio: es la traza de
  cumplimiento legal, no un dato de conveniencia. Vínculo opcional a la
  factura de proveedor o la nómina que motivó el gasto real (para cuando
  existe un documento concreto detrás; sin vínculo sigue siendo válido, p.
  ej. un contrato de mantenimiento pagado fuera de Domora). Nunca se edita:
  se deshace con un contraasiento (DM110/DM111), igual que el resto de
  asientos administrativos (impuestos, nóminas).

### Cobros y deuda

**D5. Anticipos y pagos sin identificar.**
- Lo que un propietario paga de más queda como saldo acreedor de la 430 de su propiedad. En el balance se presenta como "Anticipos de propietarios".
- Un ingreso cuyo pagador no se identifica va a la 555 hasta que se aplica.

**D6. Orden de imputación de un cobro.** ⚖
- Primero los intereses y después el principal (art. 1173 del Código Civil).
- Dentro del principal, primero lo más antiguo (art. 1174 CC).
- La gestora puede elegir otra imputación de forma explícita.
- *Motivo:* imputar primero lo más antiguo hace que la deuda que queda viva esté dentro del periodo del art. 9.1.e.

**D7. Intereses de demora.** ❓
- Solo si la junta los ha aprobado. La política guarda la referencia al acta.
- Cálculo:
  - interés simple, días reales / 365;
  - desde el vencimiento más los días de gracia;
  - con tramos si el tipo cambia;
  - nunca intereses sobre intereses.
- Se liquidan bajo demanda (el botón "Liquidar intereses"), no con un proceso diario. Cada liquidación genera un recibo de intereses y un asiento 430/769.
- **Validado:** el tipo por defecto es el interés legal del dinero del año, editable por la gestora.

**D8. Comisión por recibo devuelto.** ❓
- La comisión del banco siempre es gasto de la comunidad (626).
- Repercutirla al propietario está desactivado por defecto. Solo se activa por finca si los estatutos o la junta lo permiten, y en ese caso genera un recibo propio (759).

### Proveedores e impuestos

**D9. Cuenta de proveedores.** 400 por defecto, con la 410 disponible para acreedores de servicios.

**D10. IVA.**
- La comunidad no deduce el IVA, así que forma parte del gasto.
- Quedan fuera de esta versión los ingresos con IVA propio, como el alquiler de la azotea a una operadora, y el modelo 303.

**D11. Retenciones de IRPF y modelo 111.** ⚖
- La comunidad retiene a los profesionales, 15 % por defecto y editable por factura.
- La retención se abona a la 4751 al registrar la factura.
- El modelo 111 trimestral se calcula por fecha de pago, que es cuando nace la obligación de retener. En un pago parcial la retención se prorratea.

**D12. Modelos 190 y 347.** ⚖
- 190: resumen anual del 111, por perceptor y clave (G profesionales, A trabajo).
- 347: terceros con más de 3.005,06 € al año, IVA incluido, desglosados por trimestres.
  - Se excluye lo que ya va en el 190.
  - Por el art. 33.5 del RD 1065/2007, las comunidades **no** declaran los suministros de electricidad, combustibles y agua para uso común ni los seguros de los elementos comunes.
  - El proveedor tendrá la marca "Excluido del 347 (art. 33.5 RGAT)", sugerida según su categoría.
- **Validado:** el 347 declara las adquisiciones **y** los ingresos de cada tercero (alquileres de azotea, locales, etc.) por encima del umbral.

**D23. Nóminas.**
- Se registran a mano, sin cálculo de nómina: bruto, IRPF, Seguridad Social del trabajador y de la comunidad, y neto.
- Sin ellas, el 111 y el 190 quedan incompletos en las fincas con portero.

### Ejercicio y cierre

**D13. Ejercicio natural,** del 1 de enero al 31 de diciembre.

**D14. Condiciones para cerrar el ejercicio.**
- **Impiden el cierre:**
  - el ejercicio anterior está abierto;
  - falla el cuadre entre recibos y la 430, o entre facturas y la 400;
  - hay saldos iniciales en borrador;
  - hay una remesa generada sin cobrar.
- **Avisan y exigen confirmar:**
  - apuntes bancarios sin conciliar;
  - saldo en la 555;
  - cuentas sin aprobar en junta;
  - reserva por debajo del mínimo;
  - intereses sin liquidar.
- **Reabrir:** gestora o Domora, con motivo obligatorio, solo si el año siguiente no está cerrado, y queda auditado.

**D15. Aplicación del resultado,** tras aprobarse en junta.
- Por defecto va a remanente (120).
- Alternativas: al fondo de reserva, o devolución a los propietarios según su coeficiente.

**D16. Numeración de asientos.** Correlativa y sin huecos por finca y año, en orden de registro. Nunca se renumera. El libro diario se imprime por fecha y número.

### Saldos iniciales y correcciones

**D17. Diferencia del asiento de apertura.**
- Si los saldos introducidos no cuadran, se propone llevar la diferencia al fondo de reserva (117), como en el ejemplo de Fincasoft, o a remanente (120).
- La gestora siempre tiene que aceptarla expresamente.

**D18. Incobrables.** Pasar una deuda a pérdidas (650) solo se hace con un asiento manual en esta versión. La deuda sigue ligada a la propiedad.

**D19. Corrección de recibos y facturas.** Nunca se editan. Se deshace el cobro o el pago, se anula el documento y se emite de nuevo.

**D20. Centros de coste.** Solo en líneas de gastos e ingresos (grupos 6 y 7).

### Propietario y certificado

**D21. Qué ve el propietario (rol C).** El extracto y el certificado de deuda de su propiedad, desde la fecha de corte contable. No ve la contabilidad de la finca.

**D22. Certificado de deuda.** ⚖ ❓
- PDF borrador para que firme el secretario, con el visto bueno del presidente.
- Separa la deuda del año en curso y los tres años naturales anteriores (art. 9.1.e LPH) del resto.
- Muestra principal e intereses por separado.
- **Validado:** los intereses se muestran desglosados, pero la cantidad de la que responde el inmueble cuenta solo el principal.

## 5. Base normativa

- **Ley 49/1960 de Propiedad Horizontal:**
  - art. 9.1.e: responsabilidad del inmueble y certificado de deuda;
  - art. 9.1.f: fondo de reserva;
  - art. 14: la junta aprueba presupuestos y cuentas;
  - art. 20: el administrador lleva la contabilidad.
- **Código Civil,** arts. 1173 y 1174: imputación de pagos.
- **RD 439/2007 (Reglamento del IRPF):** retenciones.
- **RD 1065/2007 (RGAT),** art. 33.5: exclusiones del 347 para las comunidades.
- **Práctica del sector:** el ejemplo de balance inicial de Fincasoft (572, 570, 430 por piso, 400 por proveedor, 555, 117, y la diferencia al fondo de reserva).

El plan de implementación por fases, con el estado real de cada una, está en
[roadmap-partida-doble.md](./roadmap-partida-doble.md).
