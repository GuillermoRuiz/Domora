# Conformidad del XML de Verifactu con los esquemas de la AEAT

Los tests de jest (`src/verifactu/verifactu-xml.spec.ts`) comprueban la
estructura del XML, pero no pueden demostrar conformidad: jest no lleva un
validador de esquemas y añadir uno nativo solo para esto no compensa. Esa
demostración vive aquí.

## Qué hay

| Fichero | Origen |
|---|---|
| `SistemaFacturacion.wsdl` | Oficial AEAT — endpoints y operaciones |
| `SuministroLR.xsd` | Oficial AEAT — envoltorio del suministro |
| `SuministroInformacion.xsd` | Oficial AEAT — tipos comunes |
| `RespuestaSuministro.xsd` | Oficial AEAT — esquema de respuesta |
| `*.xml` | Muestras generadas por nuestro serializador |
| `validate.py` | Valida las muestras contra el esquema |
| `negative.py` | Comprueba que el validador rechaza errores |

Los esquemas se descargaron de:

```
https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/
```

Están versionados en el repositorio a propósito: la AEAT los actualiza sin
aviso y necesitamos saber contra **qué versión exacta** se validó el código que
está en producción.

## Cómo ejecutarlo

```bash
python -m venv .venv
.venv/Scripts/pip install lxml      # Linux/macOS: .venv/bin/pip
.venv/Scripts/python validate.py
.venv/Scripts/python negative.py
```

`negative.py` es tan importante como `validate.py`. Un validador que acepta
todo da una falsa sensación de seguridad; el control negativo comprueba que
rechaza enumerados inválidos, elementos fuera de orden, namespaces mal puestos,
NIF de longitud incorrecta, importes con tres decimales y campos obligatorios
ausentes.

## Regenerar las muestras

Tras tocar `verifactu-xml.ts`, hay que regenerar los `.xml` y volver a validar.
Las muestras cubren los cuatro casos que importan: primer registro de la cadena,
alta encadenada, anulación, y envío en nombre de un tercero (`Representante`)
con lote de dos registros.

## Endpoints del servicio

Del `soap:address` del WSDL. **Las entradas están segregadas por tipo de
certificado**, y equivocarse hace fallar el handshake TLS, no el XML:

| Entorno | Certificado normal | Certificado de sello |
|---|---|---|
| Producción | `www1.agenciatributaria.gob.es` | `www10.agenciatributaria.gob.es` |
| Preproducción | `prewww1.aeat.es` | `prewww10.aeat.es` |

Ruta común: `/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP`
