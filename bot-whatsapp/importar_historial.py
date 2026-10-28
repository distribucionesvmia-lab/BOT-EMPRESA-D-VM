#!/usr/bin/env python3
"""Convierte una exportación de líneas de venta del ERP (Excel .xlsx) en historial-demo.json,
que es lo que lee el bot (erp.js) para reconocer al cliente y proponerle repetir pedidos.

Uso:
  python3 importar_historial.py enrique.xlsx --nombre "Bar Alegría" \
      --telefono "+34 600 111 222" --direccion "Plaza Mayor 3"

Columnas esperadas (por su cabecera): Artículo, Descripción, Unidades, Fecha, Precio,
Nº Documento, Cliente. No necesita librerías externas. NO se copian costes ni márgenes.
"""
import argparse, collections, datetime, json, re, statistics, sys, zipfile
import xml.etree.ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
Q = "{%s}" % NS["m"]


def read_rows(path):
    z = zipfile.ZipFile(path)
    strings = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            strings.append("".join(t.text or "" for t in si.iter(Q + "t")))
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for r in sheet.iter(Q + "row"):
        row = {}
        for c in r.findall("m:c", NS):
            v = c.find("m:v", NS)
            if v is None:
                continue
            row[re.sub(r"\d", "", c.get("r"))] = strings[int(v.text)] if c.get("t") == "s" else v.text
        if row:
            rows.append(row)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--nombre", required=True, help="Nombre con el que el bot saludará al cliente")
    ap.add_argument("--telefono", required=True, help="Teléfono del cliente (con prefijo)")
    ap.add_argument("--direccion", default="")
    ap.add_argument("--codigo", help="Código de cliente del ERP (por defecto, el que aparece en el fichero)")
    ap.add_argument("--salida", default="historial-demo.json")
    a = ap.parse_args()

    rows = read_rows(a.xlsx)
    header = {col: str(v).strip().lower() for col, v in rows[0].items()}
    col = {name: next(c for c, h in header.items() if h.startswith(name)) for name in
           ["artículo", "descripción", "unidades", "fecha", "precio", "nº documento", "cliente"]}

    lines = []
    for r in rows[1:]:
        try:
            code = r[col["artículo"]].strip()
            doc = r[col["nº documento"]].strip()
            qty = int(float(r[col["unidades"]]))
            price = round(float(r[col["precio"]]), 2)
            date = datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(r[col["fecha"]])))
        except (KeyError, ValueError):
            continue  # filas vacías o de totales
        name = re.sub(r"\s+", " ", r[col["descripción"]].replace('"', "")).strip()
        if code in ("", "0") or qty <= 0 or price <= 0:
            continue  # notas, regalos a 0 € y abonos
        lines.append({"customer": r[col["cliente"]].strip(), "doc": doc, "date": date,
                      "code": code, "name": name, "qty": qty, "price": price})

    if not lines:
        sys.exit("No se encontraron líneas de venta válidas en el fichero.")
    customer_code = a.codigo or collections.Counter(l["customer"] for l in lines).most_common(1)[0][0]
    lines = [l for l in lines if l["customer"] == customer_code]

    # Catálogo: último precio conocido de cada artículo
    products = {}
    for l in sorted(lines, key=lambda x: x["date"]):
        products[l["code"]] = {"id": l["code"], "name": l["name"], "price": l["price"]}

    # Pedidos (un documento = un pedido), del más reciente al más antiguo
    docs = collections.defaultdict(list)
    for l in lines:
        docs[(l["doc"], l["date"])].append(l)
    orders = [{"doc": d, "date": dt.isoformat(), "lines": [{"productId": l["code"], "qty": l["qty"]} for l in ls]}
              for (d, dt), ls in sorted(docs.items(), key=lambda kv: kv[0][1], reverse=True)]

    # Habituales: artículos comprados en 2 o más pedidos distintos
    by_product = collections.defaultdict(list)
    for o in orders:
        for l in o["lines"]:
            by_product[l["productId"]].append(l["qty"])
    frequent = sorted(((p, q) for p, q in by_product.items() if len(q) >= 2), key=lambda x: -len(x[1]))[:6]

    out = {
        "products": list(products.values()),
        "customers": [{
            "id": customer_code, "name": a.nombre, "phone": a.telefono, "address": a.direccion,
            "orders": orders,
            "frequent": [{"productId": p, "qty": int(statistics.median(q))} for p, q in frequent],
        }],
    }
    with open(a.salida, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"{a.salida}: cliente {customer_code} ({a.nombre}), {len(orders)} pedidos, "
          f"{len(products)} artículos, {len(frequent)} habituales")


main()
