"""
Valida las muestras de XML contra los esquemas oficiales de la AEAT.

Es el equivalente, para el XML, de lo que los tres vectores oficiales de huella
son para `verifactu-hash.ts`: el criterio de conformidad. Las pruebas de jest
comprueban la estructura, pero solo un validador de esquemas demuestra que el
documento sería aceptado.

Uso:
    python -m venv .venv && .venv/Scripts/pip install lxml
    .venv/Scripts/python validate.py

Regenerar las muestras tras tocar el serializador:
    npx ts-node -e "..."  # ver README.md
"""

import glob
import os
import sys

from lxml import etree

os.chdir(os.path.dirname(os.path.abspath(__file__)))

schema = etree.XMLSchema(etree.parse("SuministroLR.xsd"))

fallos = 0
for fichero in sorted(glob.glob("*.xml")):
    documento = etree.parse(fichero)
    if schema.validate(documento):
        print(f"OK        {fichero}")
    else:
        fallos += 1
        print(f"INVALIDO  {fichero}")
        for error in schema.error_log:
            print(f"          L{error.line}: {error.message}")

print()
print(f"{len(glob.glob('*.xml')) - fallos} validas, {fallos} invalidas")
sys.exit(1 if fallos else 0)
