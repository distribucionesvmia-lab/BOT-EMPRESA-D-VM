# Cómo entregar el bot al cliente y ver tú la aplicación de la empresa

## La idea

Son **dos aplicaciones distintas** que usan las mismas bases de datos:

| | Qué es | Quién la ve | Dónde está |
|---|---|---|---|
| **Aplicación del cliente** | acceso con teléfono + PIN, chat, catálogo | tus clientes | **publicada en internet** (`https://pedidos.tuempresa.es`) |
| **Aplicación de la empresa** | pedidos, exportación a Excel, solicitudes de alta, cuentas | solo tú y tu equipo | **no publicada**: escucha únicamente dentro del servidor |

Así, al entregar el bot **solo existe lo del cliente en internet**. La aplicación de la empresa ni siquiera tiene dirección pública, y la aplicación del cliente no tiene ninguna ruta de administración ni conoce la clave (comprobado con pruebas automáticas).

## Poner en marcha las dos (servidor propio con Docker)

```bash
cd bot-whatsapp
cp .env.example .env     # rellena PUBLIC_URL y ADMIN_TOKEN (una clave larga y secreta)
docker compose up -d --build
```

- `cliente` queda en el puerto 3000 (ponle delante HTTPS con `deploy/Caddyfile`).
- `empresa` queda **solo en `127.0.0.1:3001`**: desde fuera del servidor no se puede ni intentar entrar.

## Cómo entras tú a la aplicación de la empresa (sin que el cliente pueda)

Elige una:

1. **Túnel SSH (la más sencilla).** Desde tu ordenador:
   ```bash
   ssh -L 3001:127.0.0.1:3001 usuario@IP-DEL-SERVIDOR
   ```
   Deja esa ventana abierta y abre `http://localhost:3001/empresa` en tu navegador. Entras con tu clave. Al cerrar la ventana, se corta el acceso.
2. **Tailscale o una VPN (la más cómoda).** Instalas Tailscale en el servidor y en tu ordenador o móvil: la aplicación de la empresa se abre desde cualquier sitio, pero solo desde tus dispositivos. Se publica con `tailscale serve` apuntando al puerto 3001.
3. **Red de la oficina.** Si el servidor está en la oficina, puedes dejar la aplicación de la empresa accesible solo en la red local (cambiando `127.0.0.1:3001` por la IP interna del servidor) y bloqueando ese puerto en el cortafuegos hacia fuera.

**No recomendado:** publicar `/empresa` en internet. Si algún día hace falta, protégela con un acceso aparte (por ejemplo Cloudflare Access con tu correo) además de la clave.

## Probarlo en tu ordenador (sin Docker)

Abre dos terminales en la carpeta `bot-whatsapp`:

```bash
DEMO=1 PORT=3000 APP_MODE=cliente node server.js
```
```bash
DEMO=1 PORT=3001 APP_MODE=empresa node server.js
```

- Cliente: `http://localhost:3000/cliente`
- Empresa: `http://localhost:3001/empresa` (clave de la demo: `demo`)

La aplicación del cliente, aunque se pruebe con la clave `demo`, responde `404` en `/empresa` y en todo `/api/admin`.

## Seguridad de la aplicación de la empresa

- Clave larga en `ADMIN_TOKEN` (más de 20 caracteres, aleatoria). Solo la recibe el contenedor `empresa`.
- Máximo 10 claves erróneas cada 10 minutos por IP: superado el límite, esa IP queda bloqueada aunque acierte.
- Copias de seguridad: la base se copia cada noche en `/data/respaldos`; descárgalas fuera del servidor con regularidad.
- Si sospechas que la clave se ha filtrado: cámbiala en `.env` y reinicia `empresa` (`docker compose up -d`).
