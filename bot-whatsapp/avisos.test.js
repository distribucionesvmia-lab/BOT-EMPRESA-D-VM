import test from "node:test";
import assert from "node:assert/strict";
import { contactoValido, origenPublico, crearAvisos } from "./avisos.js";
import { openAccountsDb } from "./cuentas-db.js";

test("AVISOS: el contacto que se manda a Apple/Google tiene que ser real (https público o correo), no localhost ni ejemplos", () => {
  for (const ok of ["https://distribucionesvm-pedidos.tailc4a490.ts.net", "https://pedidos.empresa.es/", "mailto:pedidos@empresa.es"]) assert.equal(contactoValido(ok), true, ok);
  for (const mal of ["http://localhost:3001", "https://localhost", "http://pedidos.empresa.es", "https://127.0.0.1:3000", "https://192.168.1.5", "mailto:avisos@invalid.example", "mailto:a@example.com", "https://tienda.example", "pedidos@empresa.es", "", null, undefined]) assert.equal(contactoValido(mal), false, String(mal));
});

test("AVISOS: la dirección pública se saca de la petición (detrás de Tailscale llega en las cabeceras)", () => {
  assert.equal(origenPublico({ headers: { host: "127.0.0.1:3000", "x-forwarded-host": "pedidos.empresa.es" } }), "https://pedidos.empresa.es");
  assert.equal(origenPublico({ headers: { host: "pedidos.empresa.es" } }), "https://pedidos.empresa.es");
  assert.equal(origenPublico({ headers: { host: "localhost:3000" } }), null);
  assert.equal(origenPublico({ headers: { host: "192.168.1.5:3000" } }), null);
});

test("AVISOS: la aplicación de la empresa (PUBLIC_URL=localhost) usa el contacto que dejó la del cliente", () => {
  const db = openAccountsDb(":memory:"), antes = { P: process.env.PUBLIC_URL, V: process.env.VAPID_SUB };
  try {
    delete process.env.VAPID_SUB; process.env.PUBLIC_URL = "http://localhost:3001";
    const empresa = crearAvisos({ accountsDb: db });
    assert.equal(empresa.contacto(), null); // sin nada válido: se sabrá en el panel
    process.env.PUBLIC_URL = "https://pedidos.empresa.es"; crearAvisos({ accountsDb: db }); // la aplicación del cliente arranca y lo deja guardado
    process.env.PUBLIC_URL = "http://localhost:3001";
    assert.equal(crearAvisos({ accountsDb: db }).contacto(), "https://pedidos.empresa.es");
    process.env.VAPID_SUB = "mailto:avisos@empresa.es"; assert.equal(crearAvisos({ accountsDb: db }).contacto(), "mailto:avisos@empresa.es"); // el administrador manda
    // si el cliente entra por otra dirección pública, se recuerda esa
    delete process.env.VAPID_SUB; const av = crearAvisos({ accountsDb: db });
    assert.equal(av.recordarOrigen({ headers: { "x-forwarded-host": "otra.empresa.es", host: "127.0.0.1:3000" } }), true); assert.equal(av.contacto(), "https://otra.empresa.es");
    assert.equal(av.recordarOrigen({ headers: { host: "127.0.0.1:3000" } }), false); assert.equal(av.contacto(), "https://otra.empresa.es"); // una petición local no lo pisa
  } finally { if (antes.P === undefined) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = antes.P; if (antes.V === undefined) delete process.env.VAPID_SUB; else process.env.VAPID_SUB = antes.V; }
});
