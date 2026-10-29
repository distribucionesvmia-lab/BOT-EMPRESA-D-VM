// Carga datos { products, customers } (el formato de historial-demo.json y de ejemplo/historial-ficticio.json)
// en las bases de datos de productos y de clientes.
export function importData(data, catalogDb, customersDb) {
  const out = {};
  if (data.products) out.products = catalogDb.upsertProducts(data.products);
  if (data.customers) out.customers = customersDb.upsertCustomers(data.customers);
  return out;
}
