// Freno al copiado del catálogo: una persona abre el catálogo unas pocas veces; un programa que se lo lleva entero (para copiar la tarifa) lo pide a un ritmo de máquina.
// Por cuenta de cliente: tope de peticiones de datos en 10 minutos y de PDF en una hora. Al pasarse se contesta «espera» y se anota; a la tercera vez en una hora la cuenta queda
// frenada durante una hora. Todo en memoria (se reinicia con el programa). Nunca bloquea el inicio de sesión ni los pedidos: solo la descarga de datos y documentos.
import { rateLimiter } from "./auth.js";

export const TEXTO_FRENO = "Estás pidiendo datos demasiado deprisa. Espera unos minutos y vuelve a intentarlo. Si lo necesitas, llámanos.";

export function crearFrenoCopia({ datos = 40, pdf = 60, ventanaDatos = 600_000, ventanaPdf = 3_600_000, bloqueoMs = 3_600_000, infracciones = 3, ahora = () => Date.now(), evento = () => {} } = {}) {
  const limiteDatos = rateLimiter(datos, ventanaDatos), limitePdf = rateLimiter(pdf, ventanaPdf), faltas = new Map(), frenadas = new Map();
  /** Devuelve "" si puede seguir, o el texto a enseñar si hay que frenar. `recurso`: "datos" | "pdf". */
  return (cuentaId, recurso = "datos") => {
    const id = String(cuentaId), n = ahora(), hasta = frenadas.get(id);
    if (hasta && hasta > n) return TEXTO_FRENO;
    if (hasta) frenadas.delete(id);
    if ((recurso === "pdf" ? limitePdf : limiteDatos)(id, n)) return "";
    evento("catalogo-a-ritmo-de-maquina", `cuenta ${id} (${recurso})`);
    const f = [...(faltas.get(id) ?? []).filter((t) => n - t < bloqueoMs), n]; faltas.set(id, f);
    if (f.length >= infracciones) { frenadas.set(id, n + bloqueoMs); faltas.delete(id); evento("catalogo-cuenta-frenada", `cuenta ${id}: frenada 1 hora`); }
    return TEXTO_FRENO;
  };
}
