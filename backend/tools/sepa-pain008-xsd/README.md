# Conformidad del pain.008 con el esquema ISO 20022

Los tests de jest (`src/sepa/sepa-pain008.service.spec.ts`) comprueban la
estructura del XML por substring, pero no pueden demostrar conformidad real
con el esquema: jest no lleva un validador de esquemas XML. Esa demostración
vive aquí — mismo criterio que `tools/verifactu-xsd/` para el XML de la AEAT.

## Origen del XSD

`pain.008.001.02.xsd` es un espejo de comunidad (SWIFTStandards Workstation,
generado 2009), no descargado directamente de iso20022.org — su URL fija
histórica (`iso20022.org/documents/messages/pain/schemas/pain.008.001.02.zip`)
no respondía al comprobarlo. **A diferencia del XSD de Verifactu (obtenido
directamente de la AEAT), este es de segunda mano.** El namespace
(`urn:iso:std:iso:20022:tech:xsd:pain.008.001.02`) coincide exactamente con
el que produce nuestro código y con el usado por otras librerías SEPA de
código abierto, pero si algún día hay dudas sobre una discrepancia con lo que
acepta un banco concreto, conviene contrastar contra el original de EPC/ISO.

## Cómo ejecutarlo

```bash
python -m venv .venv
.venv/Scripts/pip install lxml      # Linux/macOS: .venv/bin/pip
.venv/Scripts/python validate.py
.venv/Scripts/python negative.py
```

`negative.py` es tan importante como `validate.py`: comprueba que el
validador RECHAZA errores reales (enumerado inválido, método de pago
incorrecto, campo obligatorio ausente, orden alterado, IBAN con espacios).
Sin él, un validador que aceptase cualquier cosa daría una falsa sensación de
seguridad.

**Nota de proceso**: la primera versión de `negative.py` marcaba `CtrlSum`
ausente como "obligatorio" y el validador lo aceptó — no era un fallo del
validador, es que `CtrlSum` es `minOccurs="0"` de verdad en el esquema oficial
(un banco lo recalcula él mismo). Se cambió la mutación a `NbOfTxs`, que sí es
obligatorio. Verificar SIEMPRE contra el propio XSD antes de asumir que una
mutación debería fallar.

## Hallazgo real de este ejercicio

La mutación "IBAN con espacios" no es un caso de laboratorio: reproduce
exactamente el bug que tenía `renderDebtorTx` en `originalDebtorIban` (el
IBAN de un mandato antes de una modificación) — no se le quitaban los
espacios antes de meterlo en `<IBAN>`, a diferencia del IBAN del deudor
actual. El esquema real rechaza ese XML. El fix ya está aplicado en
`sepa-pain008.service.ts`.

## Regenerar las muestras

Tras tocar `sepa-pain008.service.ts`, hay que regenerar los `.xml` y volver a
validar. Las tres muestras cubren: caso básico, lote mixto FRST/RCUR/OOFF en
`<PmtInf>` separados, y un caso con `AmdmntInd` (modificación de mandato).
