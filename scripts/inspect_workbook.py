"""Read-only OOXML inspection. No Excel automation or workbook writes."""

import zipfile, xml.etree.ElementTree as ET, json, hashlib
from pathlib import Path

p = Path("Japan expenses.xlsx")
ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(p) as z:
    strings = [
        "".join(x.itertext()) for x in ET.fromstring(z.read("xl/sharedStrings.xml"))
    ]
    cells = {}
    for c in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).findall(
        ".//m:sheetData/m:row/m:c", ns
    ):
        v = c.find("m:v", ns)
        f = c.find("m:f", ns)
        raw = v.text if v is not None else None
        value = strings[int(raw)] if c.get("t") == "s" and raw is not None else raw
        if value is not None or f is not None:
            cells[c.attrib["r"]] = {
                "value": value,
                "raw": raw,
                "type": c.get("t", "n"),
                "formula": f.text if f is not None else None,
                "style": c.get("s"),
            }
    out = {
        "file": p.name,
        "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
        "sheet": "Sheet1",
        "cells": cells,
    }
Path("workbook-inspection.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
)


def col(n):
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


for n in range(1, 112):
    c = col(n)
    if (
        cells.get(c + "4", {}).get("formula", "")
        and "sum(" in cells[c + "4"]["formula"].lower()
    ):
        vals = [
            (a, x)
            for a, x in cells.items()
            if a.rstrip("0123456789") == col(n + 1) and int(a[len(col(n + 1)) :]) >= 5
        ]
        desc = [
            (a, x)
            for a, x in cells.items()
            if a.rstrip("0123456789") == c and int(a[len(c) :]) >= 5
        ]
        missing = [
            (a, x["value"]) for a, x in desc if col(n + 1) + a[len(c) :] not in cells
        ]
        print(c, col(n + 1), len(vals), "subtotal", cells[c + "4"], "missing", missing)
print("Non arithmetic entry formulas:")
for a, x in cells.items():
    if (
        x["formula"]
        and int(a.lstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZ")) >= 5
        and any(t in x["formula"].lower() for t in ["sum", "average"])
    ):
        print(a, x)
