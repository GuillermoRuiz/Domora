import os, re
from lxml import etree
os.chdir(os.path.dirname(os.path.abspath(__file__)) or '.')
schema = etree.XMLSchema(etree.parse("pain.008.001.02.xsd"))
base = open("basico.xml", encoding="utf-8").read()

mutaciones = {
  "SeqTp con valor fuera del enumerado": base.replace("<SeqTp>RCUR</SeqTp>", "<SeqTp>QUIZAS</SeqTp>"),
  "PmtMtd distinto de DD": base.replace("<PmtMtd>DD</PmtMtd>", "<PmtMtd>TRF</PmtMtd>"),
  "elemento obligatorio ausente (NbOfTxs de cabecera)": re.sub(r"<NbOfTxs>[^<]*</NbOfTxs>", "", base, count=1),
  "orden alterado (PmtMtd tras NbOfTxs en vez de antes)":
      base.replace("<PmtMtd>DD</PmtMtd>\n      <NbOfTxs>1</NbOfTxs>",
                    "<NbOfTxs>1</NbOfTxs>\n      <PmtMtd>DD</PmtMtd>"),
  "IBAN con espacios (justo el bug que se acaba de arreglar)":
      base.replace("<IBAN>ES7621000813610123456789</IBAN>", "<IBAN>ES76 2100 0813 6101 2345 6789</IBAN>"),
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
print("FIABLE" if aceptadas == 0 else f"NO FIABLE: acepto {aceptadas}")
