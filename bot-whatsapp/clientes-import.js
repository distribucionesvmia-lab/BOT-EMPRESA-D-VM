// Importación de la lista de clientes que exporta a3ERP (Excel): código, nombre comercial, razón social, población,
// dirección, teléfono(s), correo(s), bloqueado y obsoleto. NO se guarda el NIF (no hace falta para atender pedidos).
import { readXlsx } from "./xlsx-read.js";

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Todos los teléfonos (9 dígitos) que aparecen en una celda: "983 81 23 29 / 674088618 IRENE" → ["983812329","674088618"]. */
export function extractPhones(cell) {
  const compact = String(cell ?? "").replace(/(?<=\d)[\s.-]+(?=\d)/g, ""); // "983 81 23 29" → "983812329"
  const out = new Set();
  for (const m of compact.matchAll(/(?<!\d)(?:(?:\+|00)?34)?([6-9]\d{8})(?!\d)/g)) out.add(m[1]);
  return [...out];
}
/** Correos de una celda (separados por ; , o espacios), en minúsculas y sin repetir. */
export function extractEmails(cell) {
  const out = new Set();
  for (const e of String(cell ?? "").split(/[;,\s]+/)) if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) out.add(e.toLowerCase());
  return [...out];
}
const yes = (v) => /^(si|sí|s|true|1|x)$/i.test(String(v ?? "").trim());

const FIELDS = [
  ["code", /^cod/], ["name", /^organizacion/], ["legal", /^razon social/], ["city", /^poblacion/], ["address", /^direccion/],
  ["phone", /^telefono/], ["email", /^e ?mail|^correo/], ["blocked", /^bloqueado/], ["obsolete", /^obsoleto/], ["section", /^seccion/],
];

/** Filas del Excel → { customers, stats }. La primera fila con «Cód» y «Organización» es la cabecera. */
export function parseClientes(rows) {
  const hi = rows.findIndex((r) => r.some((c) => /^cod/.test(norm(c))) && r.some((c) => /^organizacion/.test(norm(c))));
  if (hi < 0) throw new Error("No encuentro la cabecera: el Excel debe tener las columnas «Cód. cliente» y «Organización».");
  const col = {};
  rows[hi].forEach((h, i) => { for (const [k, re] of FIELDS) if (!(k in col) && re.test(norm(h))) col[k] = i; });
  const get = (r, k) => String(r[col[k]] ?? "").trim();
  const customers = [];
  const seen = new Set();
  const stats = { filas: 0, importados: 0, sinTelefono: 0, sinCorreo: 0, inactivos: 0, duplicados: 0, descartadas: 0 };
  for (const r of rows.slice(hi + 1)) {
    if (!r.some((c) => String(c).trim())) continue;
    stats.filas++;
    const id = get(r, "code"), name = get(r, "name");
    if (!id || !name) { stats.descartadas++; continue; }
    if (seen.has(id)) { stats.duplicados++; continue; }
    seen.add(id);
    const phones = extractPhones(get(r, "phone")), emails = extractEmails(get(r, "email"));
    const active = !(yes(get(r, "blocked")) || yes(get(r, "obsolete")));
    const legal = get(r, "legal");
    customers.push({ id, name, legalName: legal && norm(legal) !== norm(name) ? legal : "", city: get(r, "city"), address: [get(r, "address"), get(r, "city")].filter(Boolean).join(", "), phones, emails, phone: phones[0] ?? "", active });
    stats.importados++;
    if (!phones.length) stats.sinTelefono++;
    if (!emails.length) stats.sinCorreo++;
    if (!active) stats.inactivos++;
  }
  return { customers, stats };
}

/** Lee el Excel (Buffer) y devuelve { customers, stats }. */
export const parseClientesXlsx = (buf) => parseClientes(readXlsx(buf));
