// Base de datos de PRODUCTOS (catálogo): precios, unidades por caja, IVA y descuento general de cada artículo.
// Es una base aparte de la de pedidos y de la de clientes. Se actualiza con upsertProducts() (por ejemplo cuando
// se sincronice con a3ERP) o con update() para un solo artículo; cada cambio queda registrado en product_changes.

import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  price         REAL NOT NULL CHECK (price >= 0),
  units_per_box INTEGER CHECK (units_per_box IS NULL OR units_per_box >= 1),
  vat           REAL NOT NULL DEFAULT 21,
  discount      REAL NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= 100),
  active        INTEGER NOT NULL DEFAULT 1,
  updated_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_changes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  field      TEXT NOT NULL,
  old_value  TEXT,
  new_value  TEXT,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changes_product ON product_changes(product_id, id);
`;

const FIELDS = { name: "name", price: "price", unitsPerBox: "units_per_box", vat: "vat", discount: "discount", active: "active", category: "category", subcategory: "subcategory" };

function normalize(p) {
  const id = String(p?.id ?? "").trim();
  if (!id) throw new Error("Un producto necesita código (id)");
  const name = String(p.name ?? "").trim();
  if (!name) throw new Error(`El producto ${id} necesita nombre`);
  const price = Number(p.price);
  if (!Number.isFinite(price) || price < 0) throw new Error(`Precio no válido en el producto ${id}`);
  const upb = p.unitsPerBox == null ? null : Number(p.unitsPerBox);
  if (upb !== null && (!Number.isInteger(upb) || upb < 1)) throw new Error(`Unidades por caja no válidas en el producto ${id}`);
  const vat = p.vat == null ? 21 : Number(p.vat);
  const discount = p.discount == null ? 0 : Number(p.discount);
  if (!Number.isFinite(vat) || vat < 0 || !Number.isFinite(discount) || discount < 0 || discount > 100) throw new Error(`IVA o descuento no válidos en el producto ${id}`);
  // Categoría y subcategoría (opcionales): las de la ficha de a3ERP; si faltan, se deducen del nombre (categorias.js)
  const clean = (v) => (String(v ?? "").trim().slice(0, 60) || null);
  return { id, name, price, unitsPerBox: upb, vat, discount, active: p.active === false ? 0 : 1, category: clean(p.category), subcategory: clean(p.subcategory) };
}

/** Producto tal como lo usa el bot: { id, name, price, unitsPerBox?, vat, discount } */
const toCatalog = (r) => ({ id: r.id, name: r.name, price: r.price, ...(r.units_per_box ? { unitsPerBox: r.units_per_box } : {}), vat: r.vat, discount: r.discount, ...(r.category ? { category: r.category } : {}), ...(r.subcategory ? { subcategory: r.subcategory } : {}) });

export function openCatalogDb(path = process.env.CATALOG_DB ?? "catalogo.sqlite") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  for (const col of ["category", "subcategory"]) if (!db.prepare("PRAGMA table_info(products)").all().some((x) => x.name === col)) db.exec(`ALTER TABLE products ADD COLUMN ${col} TEXT`);
  const get = db.prepare("SELECT * FROM products WHERE id = ?");
  const insert = db.prepare("INSERT INTO products (id, name, price, units_per_box, vat, discount, active, category, subcategory, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const logChange = db.prepare("INSERT INTO product_changes (product_id, field, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?)");

  // Aplica un producto ya normalizado: lo crea o actualiza solo lo que cambia, registrando cada cambio
  function apply(n, now) {
    const old = get.get(n.id);
    if (!old) {
      insert.run(n.id, n.name, n.price, n.unitsPerBox, n.vat, n.discount, n.active, n.category, n.subcategory, now);
      logChange.run(n.id, "alta", null, n.name, now);
      return "added";
    }
    const changed = Object.entries(FIELDS).filter(([k, col]) => String(old[col] ?? "") !== String(n[k] ?? ""));
    if (!changed.length) return "unchanged";
    for (const [k, col] of changed) logChange.run(n.id, k, old[col] == null ? null : String(old[col]), n[k] == null ? null : String(n[k]), now);
    db.prepare(`UPDATE products SET ${changed.map(([, col]) => `${col} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...changed.map(([k]) => n[k]), now, n.id);
    return "updated";
  }

  const atomic = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };

  return {
    /**
     * Crea o actualiza productos (todo o nada). Solo se tocan y registran los campos que cambian.
     * deactivateMissing: los que no vengan en la lista se marcan como inactivos (para sincronizar un catálogo completo).
     */
    upsertProducts(list, { deactivateMissing = false, now = new Date().toISOString() } = {}) {
      const items = list.map(normalize);
      return atomic(() => {
        const out = { added: 0, updated: 0, unchanged: 0, deactivated: 0 };
        for (const n of items) out[apply(n, now)]++;
        if (deactivateMissing) {
          const keep = new Set(items.map((n) => n.id));
          for (const r of db.prepare("SELECT * FROM products WHERE active = 1").all()) {
            if (keep.has(r.id)) continue;
            apply(normalize({ ...toCatalog(r), active: false }), now);
            out.deactivated++;
          }
        }
        return out;
      });
    },

    /** Cambia campos de un producto existente: update("1001", { price: 2.5 }). Devuelve "updated" o "unchanged". */
    update(id, fields, now = new Date().toISOString()) {
      const r = get.get(String(id));
      if (!r) throw new Error(`No existe el producto ${id}`);
      return atomic(() => apply(normalize({ ...toCatalog(r), active: !!r.active, ...fields, id: r.id }), now));
    },

    get: (id) => (get.get(String(id)) ? toCatalog(get.get(String(id))) : null),
    /** Catálogo para el bot (solo activos). */
    list: ({ activeOnly = true } = {}) =>
      db.prepare(`SELECT * FROM products ${activeOnly ? "WHERE active = 1" : ""} ORDER BY name`).all().map((r) => ({ ...toCatalog(r), active: !!r.active, updatedAt: r.updated_at })),
    count: () => db.prepare("SELECT COUNT(*) AS n FROM products").get().n,
    /** Cambia cuando se modifica el catálogo: sirve para que el bot recargue los precios sin reiniciar. */
    version: () => db.prepare("SELECT COUNT(*) || '-' || COALESCE(MAX(updated_at), '') AS v FROM products").get().v,
    history: (id, limit = 50) => db.prepare("SELECT field, old_value AS oldValue, new_value AS newValue, changed_at AS changedAt FROM product_changes WHERE product_id = ? ORDER BY id DESC LIMIT ?").all(String(id), limit),
    close: () => db.close(),
  };
}
