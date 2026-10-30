# Obligaciones fiscales de la comunidad de propietarios

> Marco que sigue la contabilidad por partida doble (`doc/contabilidad/adr-partida-doble.md`, decisiones D10–D12 y D23). La comunidad es el obligado tributario y la gestora prepara los datos. Domora genera los informes; la presentación ante la AEAT la hace la gestora.

## 1. IVA

- La comunidad no deduce el IVA soportado. El IVA de cada factura forma parte del gasto (6xx).
- **Fuera de alcance en esta versión:** los ingresos sujetos a IVA de la propia comunidad, como el arrendamiento de una azotea a una operadora, y el modelo 303 que conllevan.

## 2. Retenciones de IRPF — modelos 111 y 190

- La comunidad retiene a los profesionales que le facturan, como el administrador o un arquitecto. El tipo general es el 15 %.
- También retiene a sus trabajadores, como el portero. Sus nóminas se registran a mano en la contabilidad.
- **Modelo 111:** trimestral, del 1 al 20 de abril, julio, octubre y enero. Domora lo calcula por fecha de pago y prorratea la retención en los pagos parciales.
- **Modelo 190:** resumen anual del 111 por perceptor (NIF) y clave. La clave A es rendimientos del trabajo y la G, actividades profesionales.
- **Contabilidad:**
  - al registrar la factura, la retención se abona a la 4751;
  - al ingresarla en Hacienda, se carga la 4751 contra el banco.

## 3. Modelo 347 — operaciones con terceros

- Se declaran las adquisiciones a cada tercero que superen **3.005,06 € al año, IVA incluido**, desglosadas por trimestres.
- **No se incluyen:**
  - lo que ya se declara en el 190, es decir, las operaciones con retención;
  - por el **art. 33.5 del RD 1065/2007**, los suministros de energía eléctrica y combustibles para uso común, los suministros de agua para uso común y los seguros de los elementos comunes.
- En Domora, cada proveedor lleva la marca "Excluido del 347 (art. 33.5 RGAT)". Se sugiere según su categoría y la gestora puede cambiarla.
- **Decisión de producto (ADR, D12):** el 347 también recoge los ingresos de cada tercero por encima del umbral, como el alquiler de una azotea o un local común.
- Se presenta en febrero del año siguiente.

## 4. Qué entrega Domora

| Informe | Formato | Estado |
|---|---|---|
| Modelo 111 por trimestre | Pantalla, Excel y PDF | Disponible (fase 7b) |
| Modelo 190 anual | Pantalla, Excel y PDF | Disponible (fase 7b) |
| Modelo 347 anual | Pantalla, Excel y PDF | Disponible (fase 7b) |
| Ficheros BOE para la presentación telemática | Texto de ancho fijo | Opcional |

- En el 347 solo entran por ahora las adquisiciones (clave A). Los ingresos de terceros (D12) se añadirán cuando la tesorería registre el tercero de cada cobro (fase 8).
- Las retenciones con clave "otra" no se suman al 111: si son de un alquiler se declaran en el 115, que queda fuera de esta versión.

## Fuentes

- RD 439/2007, Reglamento del IRPF: obligación de retener y plazos de ingreso.
- RD 1065/2007, Reglamento General de Gestión Tributaria, arts. 31 a 35 y, en particular, el 33.5 para las comunidades.
- Las órdenes ministeriales que aprueban los diseños de los modelos 111, 190 y 347 se revisarán antes de generar ficheros BOE, que son opcionales.
