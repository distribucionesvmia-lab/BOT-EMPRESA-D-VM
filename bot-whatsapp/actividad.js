// Registro de actividad del panel de la empresa: qué se ha hecho, cuándo y desde qué dirección. Solo POST (lo que cambia algo); las vistas previas y pruebas no se apuntan.
// No se guardan datos de clientes ni el contenido de lo enviado: solo la acción en palabras y la ruta.
const ETIQUETAS = [
  [/\/(vista|vista-previa|audiencia|prueba|comprobar|exportar\/vista)(\/|$)/, null], // solo mirar: no se apunta
  [/^\/api\/admin\/aplicar\/(\w+)$/, (m) => `Aplicó una actualización de ${{ productos: "productos", clientes: "clientes", historial: "historial", fotos: "fotos" }[m[1]] ?? m[1]}`],
  [/^\/api\/admin\/articulos\/[^/]+\/precio$/, () => "Cambió el precio de un artículo"],
  [/^\/api\/admin\/articulos\/[^/]+\/oferta$/, () => "Puso o quitó una oferta"],
  [/^\/api\/admin\/articulos\/[^/]+\/avisar$/, () => "Avisó a los clientes de un artículo"],
  [/^\/api\/admin\/articulos\/[^/]+\/foto$/, () => "Cambió la foto de un artículo"],
  [/^\/api\/admin\/articulos\/[\w.-]+\/foto-mini$/, null], // las miniaturas se preparan de una en una (cientos): no se apuntan una a una
  [/^\/api\/admin\/fotos\/zip\/aplicar$/, () => "Puso fotos desde un ZIP"],
  [/^\/api\/admin\/pedidos\/borrar$/, () => "Borró pedidos"],
  [/^\/api\/admin\/pedidos\/[\w-]+\/aprobar$/, () => "Aprobó un pedido retenido"],
  [/^\/api\/admin\/exportar$/, () => "Exportó pedidos a Excel"],
  [/^\/api\/admin\/clientes\/[^/]+\/invitacion$/, () => "Creó un enlace de acceso"],
  [/^\/api\/admin\/invitaciones\/persona-nueva$/, () => "Creó un enlace para una persona nueva"],
  [/^\/api\/admin\/invitaciones\/\d+\/anular$/, () => "Anuló un enlace de acceso"],
  [/^\/api\/admin\/cliente\/[\w-]{1,20}\/aparatos\/olvidar$/, () => "Olvidó los aparatos de confianza de un cliente"],
  [/^\/api\/admin\/cliente\/[\w-]{1,20}\/password\/restablecer$/, () => "Restableció la contraseña de un cliente"],
  [/^\/api\/admin\/2fa\/activar$/, () => "Activó el segundo factor del panel"],
  [/^\/api\/admin\/2fa\/desactivar$/, () => "Desactivó el segundo factor del panel"],
  [/^\/api\/admin\/pausa$/, () => "Cambió la pausa de emergencia"],
  [/^\/api\/admin\/accesos\/\d+\/aprobar$/, () => "Aprobó la entrada de un cliente"],
  [/^\/api\/admin\/accesos\/\d+\/rechazar$/, () => "Rechazó la entrada de alguien"],
  [/^\/api\/admin\/accesos\/\d+\/codigo$/, () => "Dio un código de entrada a un cliente"],
  [/^\/api\/admin\/invitaciones\/plantilla$/, () => "Cambió el texto del enlace de WhatsApp"],
  [/^\/api\/admin\/cliente\/[\w-]+\/ficha$/, () => "Editó la ficha de un cliente"],
  [/^\/api\/admin\/clientes\/importar$/, () => "Importó clientes"],
  [/^\/api\/admin\/avisos\/enviar$/, () => "Envió un aviso al móvil de los clientes"],
  [/^\/api\/admin\/avisos\/programar$/, () => "Programó un aviso"],
  [/^\/api\/admin\/avisos\/programados\/\d+\/cancelar$/, () => "Canceló un aviso programado"],
  [/^\/api\/admin\/correos\/programar$/, () => "Programó o envió un correo a clientes"],
  [/^\/api\/admin\/correos\/\d+\/cancelar$/, () => "Canceló un correo programado"],
  [/^\/api\/admin\/(solicitudes|cuentas)\/\d+\/(aprobar|rechazar|pin|bloquear|confirmar)$/, (m) => `${{ aprobar: "Aprobó", rechazar: "Rechazó", pin: "Cambió el código de entrada de", bloquear: "Bloqueó o desbloqueó", confirmar: "Confirmó" }[m[2]]} ${m[1] === "cuentas" ? "una cuenta" : "una solicitud de alta"}`],
  [/^\/api\/admin\/derechos\/\d+\/atender$/, () => "Atendió una solicitud de datos"],
  [/^\/api\/admin\/estadisticas\/(reiniciar|deshacer|excluidos)$/, (m) => ({ reiniciar: "Reinició las estadísticas", deshacer: "Deshizo el reinicio de estadísticas", excluidos: "Cambió los pedidos de prueba" })[m[1]]],
  [/^\/api\/admin\/(actualizar|sincronizacion\/ahora)$/, () => "Pidió actualizar el programa o sincronizar"],
  [/^\/api\/admin\/entrada\/archivar$/, () => "Archivó un archivo de la bandeja de entrada"],
];
/** Frase de lo que hace esa petición, o null si no hay que apuntarla (solo mirar). */
export function etiquetaAccion(metodo, ruta) {
  if (metodo === "GET" || metodo === "HEAD" || metodo === "OPTIONS") return null;
  for (const [re, f] of ETIQUETAS) { const m = re.exec(ruta); if (m) return f ? f(m) : null; }
  return "Acción en el panel";
}
