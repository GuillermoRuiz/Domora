"""
Control negativo del validador.

Un validador que acepta cualquier cosa da una falsa sensación de seguridad, y
es peor que no tener ninguno. Este script introduce a propósito los errores que
más probablemente cometeríamos y comprueba que el esquema los RECHAZA. Si
alguna mutación pasa como válida, es el validador lo que está roto, no el XML.

Uso: .venv/Scripts/python negative.py
"""

import os
import re
import sys

from lxml import etree

os.chdir(os.path.dirname(os.path.abspath(__file__)))

schema = etree.XMLSchema(etree.parse("SuministroLR.xsd"))
base = open("alta-primero.xml", encoding="utf-8").read()

mutaciones = {
    "enumerado invalido (TipoFactura=F9)": base.replace(
        "<sf:TipoFactura>F1<", "<sf:TipoFactura>F9<"
    ),
    "elemento desconocido intercalado": base.replace(
        "<sf:TipoHuella>01</sf:TipoHuella>",
        "<sf:Huella2>x</sf:Huella2><sf:TipoHuella>01</sf:TipoHuella>",
    ),
    # El error de namespace es el mas caro: ambos esquemas son
    # elementFormDefault="qualified", pero Cabecera vive en SuministroLR y sus
    # hijos en SuministroInformacion.
    "namespace incorrecto en hijo de Cabecera": base.replace(
        "<sf:ObligadoEmision>", "<sfLR:ObligadoEmision>"
    ).replace("</sf:ObligadoEmision>", "</sfLR:ObligadoEmision>"),
    "NIF de 8 caracteres (NIFType exige 9)": base.replace("B12345678", "B1234567"),
    "importe con 3 decimales": base.replace(
        "<sf:ImporteTotal>132.68<", "<sf:ImporteTotal>132.680<"
    ),
    "campo obligatorio ausente (Desglose)": re.sub(
        r"<sf:Desglose>.*?</sf:Desglose>", "", base
    ),
    # RechazoPrevio/SinRegistroPrevio solo admiten S/N: valen igual que
    # cualquier otro SiNoType para probar que el esquema los conoce.
    "RechazoPrevio con valor fuera del enumerado (Quizas)": base.replace(
        "<sf:TipoFactura>F1<",
        "<sf:RechazoPrevio>Quizas</sf:RechazoPrevio><sf:TipoFactura>F1<",
    ),
    # Bien formado, pero el schema exige RechazoPrevio ANTES de TipoFactura.
    "RechazoPrevio fuera de orden (después de TipoFactura)": base.replace(
        "</sf:TipoFactura>",
        "</sf:TipoFactura><sf:RechazoPrevio>S</sf:RechazoPrevio>",
    ),
}

aceptadas = 0
for nombre, xml in mutaciones.items():
    try:
        valido = schema.validate(etree.fromstring(xml.encode("utf-8")))
    except etree.XMLSyntaxError:
        print(f"RECHAZADO (mal formado)  {nombre}")
        continue
    if valido:
        aceptadas += 1
        print(f"!! ACEPTADO !!           {nombre}")
    else:
        print(f"RECHAZADO                {nombre}")

print()
if aceptadas:
    print(f"El validador acepto {aceptadas} documentos invalidos: NO es fiable.")
    sys.exit(1)
print(f"Las {len(mutaciones)} mutaciones fueron rechazadas: el validador es fiable.")
