// Datos iniciales de las bases de la demo (productos y clientes), a partir de ejemplo/historial-ficticio.json.
// Función pura: la usan la demo del navegador y el script que carga los datos compartidos.
export function seedDocs(data) {
  return {
    products: data.products.map((p) => ({
      id: String(p.id), name: p.name, price: p.price, unitsPerBox: p.unitsPerBox ?? null, vat: p.vat ?? 21, discount: p.discount ?? 0, updatedAt: null, changes: [],
    })),
    customers: data.customers.map((c) => ({
      id: String(c.id), name: c.name, phone: c.phone ?? "", address: c.address ?? "", recargoEquivalencia: !!c.recargoEquivalencia,
      specialPrices: c.specialPrices ?? {}, discounts: c.discounts ?? {}, orders: c.orders ?? [],
    })),
  };
}
