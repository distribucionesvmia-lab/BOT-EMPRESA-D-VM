// Datos iniciales de las bases de la demo (productos y clientes), a partir de ejemplo/historial-ficticio.json.
// Función pura: la usan la demo del navegador y el script que carga los datos compartidos.
// Cuentas de prueba (teléfono + PIN), solo para la demo: el hash es sha256("teléfono:PIN")
import { demoNifKeys } from "./nif-demo.js";

export const DEMO_ACCOUNTS = [
  { id: "a9001", customerId: "9001", phone: "600000001", email: "bar@ejemplo.es", pinHash: "ed5f95840ded20551c14473c4cef2b6df3855e7f6887c9023c3f4202010ef9c0", status: "active", verified: true, createdAt: "2026-10-01T09:00:00.000Z", pin: "111111" },
  { id: "a9002", customerId: "9002", phone: "600000002", email: "tienda@ejemplo.es", pinHash: "e168867a25748c072771828e9808530756950991800a4609826b1eb5148caa37", status: "active", verified: true, createdAt: "2026-10-01T09:00:00.000Z", pin: "222222" },
];

export function seedDocs(data) {
  return {
    accounts: DEMO_ACCOUNTS.map(({ pin, ...a }) => a),
    products: data.products.map((p) => ({
      id: String(p.id), name: p.name, price: p.price, unitsPerBox: p.unitsPerBox ?? null, vat: p.vat ?? 21, discount: p.discount ?? 0, updatedAt: null, changes: [],
    })),
    customers: data.customers.map((c) => ({
      id: String(c.id), name: c.name, legalName: c.legalName ?? "", city: c.city ?? "", municipio: c.municipio ?? "", phone: c.phone ?? "", phones: [String(c.phone ?? "").replace(/\D/g, "").slice(-9)].filter((p) => p.length === 9), emails: c.emails ?? [], active: c.active !== false,
      address: c.address ?? "", recargoEquivalencia: !!c.recargoEquivalencia,
      specialPrices: c.specialPrices ?? {}, discounts: c.discounts ?? {}, orders: c.orders ?? [],
      nifKeys: c.nifKeys ?? (c.nif ? demoNifKeys(String(c.id), c.nif) : []),
    })),
  };
}
