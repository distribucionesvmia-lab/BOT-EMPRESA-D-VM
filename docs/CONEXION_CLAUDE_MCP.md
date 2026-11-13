# Llevar las promociones y los avisos hablando con Claude (conexión MCP)

Con esta conexión, un asistente de Claude (Claude Desktop o Claude Code) puede hacer por ti lo que haces en las pestañas «Artículos» y «Avisos a clientes» del panel. Le dices, por ejemplo:

- «Pon un 15 % de descuento al aceite hasta el viernes y avisa a todos los clientes.»
- «Envía a todos un aviso de que esta semana hay una promoción de cerveza.»
- «¿Cuántos clientes tienen los avisos activados? ¿Qué artículos tienen oferta ahora?»
- «Baja a 1,20 € el azúcar.»

## Qué puede hacer (las herramientas)
| Herramienta | Qué hace | Pide confirmación |
|---|---|---|
| `estado_avisos` | Cuántos clientes tienen avisos y cuáles fueron los últimos | No (solo mira) |
| `buscar_articulos` | Busca artículos, con su precio y oferta | No (solo mira) |
| `enviar_aviso` | Manda una notificación al móvil de todos los clientes (o de uno) | **Sí** |
| `poner_oferta` / `quitar_oferta` | Oferta en % o en € por unidad, con fecha de fin | **Sí** |
| `cambiar_precio` | Cambia el precio de un artículo | **Sí** |
| `avisar_oferta_articulo` | La «campana»: avisa de la oferta o la bajada de ese artículo | **Sí** |

**Seguridad:** las que cambian algo solo funcionan si el asistente declara que **tú has visto lo que va a hacer y has dicho que sí** (`confirmado_por_el_usuario`). Las instrucciones de la conexión le dicen que te enseñe antes el texto exacto. Un aviso enviado **no se puede deshacer** y el panel no deja pasar de 10 avisos por hora. La clave de la empresa nunca sale del ordenador ni se la enseña al asistente.

## Forma fácil: un doble clic
Cuando el programa esté actualizado en el ordenador de la oficina, haz **doble clic en `C:\vm\bot\bot-whatsapp\mcp\conectar-claude-desktop.bat`**. Busca el archivo de configuración de Claude Desktop (también el de la versión de la tienda de Windows), guarda una copia (`…antes-de-vm-pedidos.json`), añade la conexión **sin tocar nada más** y comprueba que queda bien. Si en un intento anterior se pegó a mano un bloque mal puesto (por ejemplo, sin la coma), lo retira y lo deja bien. Después **cierra Claude Desktop del todo y ábrelo**. Para quitar la conexión: `conectar-claude-desktop.bat --quitar`.

(No hagas doble clic en `vm-mcp.js`: Windows lo abre con otro programa y da un error. Ese archivo lo arranca Claude Desktop solo.)

La forma manual, por si hace falta:

## Cómo conectarlo a mano (en el ordenador de la oficina)
Es lo más sencillo y no abre nada a internet: el programa de la conexión habla con el panel desde el propio ordenador (`http://localhost:3001`). Necesitas tener instalada la aplicación **Claude Desktop** en ese ordenador (y Node.js, que ya está por el programa).

1. Abre Claude Desktop → **Ajustes → Desarrollador → Editar configuración**. Se abre el archivo `claude_desktop_config.json` (en `%APPDATA%\Claude`).
2. Añade la conexión. Si el archivo está vacío (`{}`), déjalo así:
```json
{
  "mcpServers": {
    "vm-pedidos": {
      "command": "node",
      "args": ["C:\\vm\\bot\\bot-whatsapp\\mcp\\vm-mcp.js"],
      "env": {
        "VM_URL": "http://localhost:3001",
        "VM_ENV_FILE": "C:\\vm\\config\\empresa.env"
      }
    }
  }
}
```
   Con `VM_ENV_FILE` la conexión lee **solo** la clave de la empresa (`ADMIN_TOKEN`) de ese archivo: no hay que copiarla a ningún sitio.
3. Guarda, **cierra Claude Desktop del todo y vuelve a abrirlo**. Si todo va bien, en la conversación aparece la herramienta «vm-pedidos».
4. Prueba pidiéndole: «¿Cuántos clientes tienen activados los avisos?»

Si usas **Claude Code** en lugar de Claude Desktop, una sola línea (en un cmd):
```
claude mcp add vm-pedidos -e VM_URL=http://localhost:3001 -e VM_ENV_FILE=C:\vm\config\empresa.env -- node C:\vm\bot\bot-whatsapp\mcp\vm-mcp.js
```

## Desde otro ordenador (con Tailscale)
Instala Tailscale en ese ordenador (la misma cuenta) y el programa (`git clone` + Node 22). En `env` pon `"VM_URL": "https://distribucionesvm-pedidos.tailc4a490.ts.net:8443"` (el panel por Tailscale, como en `INSTALACION_WINDOWS.md` 7.1) y la clave en `"VM_ADMIN_TOKEN": "…"` (ese archivo de configuración guarda la clave: protégelo como una contraseña).

## Lo que NO se puede
**Claude en el navegador (claude.ai) o en el móvil no puede conectarse a esto.** Esas versiones solo aceptan conexiones con una dirección pública de internet, y eso obligaría a publicar el panel de la empresa, que **no se publica nunca** (solo el puerto 3000 de los clientes). Por eso la conexión funciona con Claude Desktop o Claude Code instalados en un ordenador que llegue al panel.

## Si algo falla
- «No se puede conectar con el panel»: el programa «VM Empresa» no está arrancado (`http://localhost:3001/health`) o, desde otro ordenador, falta Tailscale.
- «El panel no ha aceptado la clave»: la clave de `empresa.env` no es la que usa el panel (o la ruta de `VM_ENV_FILE` está mal).
- El asistente dice que no existe la herramienta: no has reiniciado Claude Desktop, o la ruta de `node` o del archivo `vm-mcp.js` no es la correcta.
