import glob, sys
from lxml import etree
schema = etree.XMLSchema(etree.parse("pain.008.001.02.xsd"))
fail = 0
for f in sorted(glob.glob("*.xml")):
    doc = etree.parse(f)
    if schema.validate(doc):
        print(f"OK        {f}")
    else:
        fail += 1
        print(f"INVALIDO  {f}")
        for e in schema.error_log:
            print(f"          L{e.line}: {e.message}")
sys.exit(1 if fail else 0)
