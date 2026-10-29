// Dónde se guardan las bases de datos de la demo (productos, clientes, pedidos, exportaciones):
//  - makeDbBackend: la base compartida de Claude (capacidad "db"): persiste y se ve en directo desde otros dispositivos.
//  - makeLocalBackend: respaldo en el navegador (localStorage), para quien no tenga la base compartida.
// Los dos ofrecen lo mismo: subscribe(colección, callback), set, update, remove y reset.
const clone = (o) => JSON.parse(JSON.stringify(o));

export function makeDbBackend(db) {
  return {
    kind: "shared",
    subscribe: (coll, cb, err) => db.collection(coll).onSnapshot((snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }))), err),
    set: (coll, id, data) => db.doc(`${coll}/${id}`).set(clone({ ...data, id })),
    update: (coll, id, patch) => db.doc(`${coll}/${id}`).update(clone(patch)),
    remove: (coll, id) => db.doc(`${coll}/${id}`).delete(),
    /** Borra pedidos y exportaciones y restaura productos y clientes. */
    async reset(seed) {
      for (const coll of ["orders", "exports"]) for (const d of (await db.collection(coll).get()).docs) await db.doc(`${coll}/${d.id}`).delete();
      for (const coll of ["products", "customers"]) for (const doc of seed[coll]) await db.doc(`${coll}/${doc.id}`).set(clone(doc));
    },
  };
}

const KEY = "vmdemo:v2";
export function makeLocalBackend(seed) {
  const byId = (list) => Object.fromEntries(list.map((d) => [d.id, clone(d)]));
  const fresh = (s) => ({ products: byId(s.products), customers: byId(s.customers), orders: {}, exports: {} });
  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      return s && s.products && s.orders ? s : null;
    } catch {
      return null;
    }
  };
  let state = load() ?? fresh(seed);
  const subs = {};
  const rows = (coll) => Object.values(state[coll]);
  const notify = (coll) => (subs[coll] ?? new Set()).forEach((cb) => cb(clone(rows(coll))));
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  };
  // otra pestaña del mismo navegador cambió los datos: se actualiza en directo
  try {
    window.addEventListener("storage", (e) => {
      if (e.key !== KEY) return;
      const s = load();
      if (s) {
        state = s;
        Object.keys(subs).forEach(notify);
      }
    });
  } catch {}
  return {
    kind: "local",
    subscribe(coll, cb) {
      (subs[coll] ??= new Set()).add(cb);
      queueMicrotask(() => cb(clone(rows(coll))));
      return () => subs[coll].delete(cb);
    },
    async set(coll, id, data) {
      state[coll][id] = clone({ ...data, id });
      save();
      notify(coll);
    },
    async update(coll, id, patch) {
      if (!state[coll][id]) throw new Error(`No existe ${coll}/${id}`);
      state[coll][id] = { ...state[coll][id], ...clone(patch) };
      save();
      notify(coll);
    },
    async remove(coll, id) {
      delete state[coll][id];
      save();
      notify(coll);
    },
    async reset(s) {
      state = fresh(s);
      save();
      Object.keys(subs).forEach(notify);
    },
  };
}
