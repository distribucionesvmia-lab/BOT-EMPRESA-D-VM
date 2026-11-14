// Solo para las pruebas: pide al sistema un puerto que esté libre (antes se sorteaban en rangos pequeños y a veces dos pruebas chocaban,
// lo que hacía fallar decenas de pruebas «porque sí»; en el ordenador de la oficina eso haría volver atrás una actualización buena).
import net from "node:net";
export const libre = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
});
