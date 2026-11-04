# Seguir el proyecto con otra cuenta (o a mano)

Este documento sirve para retomar el trabajo si Claude falla o hay que cambiar de cuenta. No contiene claves ni datos reales.

## 1. Dónde está el código

Repositorio `distribucionesvmia-lab/BOT-EMPRESA-D-VM`. Hay **tres ramas** con trabajo, de agentes distintos, y de momento **no están fusionadas**:

| Rama | Qué tiene |
|---|---|
| `claude/eager-hamilton-gknalq` (principal) | Bot, catálogo, chat, Excel de pedidos, sincronización con Drive, correos, copias de seguridad, despliegue, **actualización de productos por diferencias**, cargador `#cargar-datos` de la demo |
| `claude/dreamy-newton-ul75g0` | Arreglos de control de calidad: pedido recibido con su referencia, descuento visible en la fila, buscador que perdona erratas, textos y móvil. Choca en `bot.js` con la rama principal |
| `claude/modest-newton-pe28a2` | Extractor de la copia de a3ERP (`extraer-a3erp.js`) y `preparar-artefacto.js`. No choca con la rama principal |

Antes de dar nada por cerrado, fusionar las otras dos ramas en la principal (la de calidad requiere resolver el choque de `bot.js`).

## 2. Cómo empezar

```bash
git clone https://github.com/distribucionesvmia-lab/BOT-EMPRESA-D-VM.git && cd BOT-EMPRESA-D-VM
git checkout claude/eager-hamilton-gknalq
cd bot-whatsapp          # necesita Node 22 (usa node:sqlite); no hay dependencias que instalar
npm test                 # 217 pruebas
npm run demo             # servidor de demostración con datos ficticios (cliente de prueba: 00001R)
```

Para saber qué está hecho y qué falta: `docs/CATALOGO_TRABAJO_PROGRESO.md`. Guías: `docs/ACTUALIZAR_PRODUCTOS.md`, `docs/GOOGLE_DRIVE.md`, `docs/DESPLIEGUE.md`, `docs/CATALOGO_REVISION_FINAL.md`.

## 3. Lo que NO está en GitHub (a propósito) y dónde conseguirlo

| Qué | Por qué no está | Dónde está / cómo recuperarlo |
|---|---|---|
| Excel de clientes, de la tarifa y de artículos (`ARTICULOS_29-10-26.xlsx`) | Datos reales de la empresa | Los ficheros que pasó la empresa; la copia de a3ERP (`.bak`) en su servidor |
| Fotos de producto (unas 1.340) | Son del Excel de artículos | Salen del propio Excel: `node actualizar-productos.js ARTICULOS.xlsx --fotos imagenes` |
| Lista de productos con precios y la demo compilada con precios (`demo-web/dist-privado/`) | Precios reales | Se regeneran con el Excel de artículos (ver `docs/ACTUALIZAR_PRODUCTOS.md`) |
| `.env` con `ADMIN_TOKEN`, `LINK_SECRET`, `NIF_PEPPER`, correo y clave de Google | Secretos | Solo los tiene la empresa. **`NIF_PEPPER` no puede cambiar nunca** o nadie podrá entrar con su NIF |
| Bases `*.sqlite` (pedidos, cuentas, favoritos…) | Datos de clientes | En el servidor; hay copias en `respaldos/` |
| La demo publicada (artefacto de Claude) y su base de datos | Vive en la cuenta de Claude de la empresa | Su código sale de `bot-whatsapp/demo-web/` (`node demo-web/build.mjs`); su base (clientes, pedidos de prueba) solo existe allí |

## 4. Regenerar la demo con productos reales

```bash
cd bot-whatsapp
node actualizar-productos.js ARTICULOS.xlsx --actual lista-anterior.json --iva SRE=4 --salida-json lista-nueva.json --artefacto salida --fotos imagenes --aplicar
TARIFA_JSON=lista-nueva.json FOTOS_DIR=imagenes node demo-web/build.mjs      # deja demo-web/dist/artifact.html (NO subir a GitHub con precios reales)
```

## 5. Decisiones del cliente ya tomadas (no preguntar de nuevo)

Entrada con los 6 últimos del NIF · "Hoy" solo antes de las 10:00 y solo municipio 47085 · el «Dto %» de la tarifa es descuento para el cliente · IVA `SRE` = 4 % · los productos de familias nuevas sin categoría van a «Otros productos» · lo que no esté en el Excel de artículos se quita · el chat solo responde a pedir, último pedido, histórico y repetir (todo lo demás: «No estoy diseñado para responderte a eso»).

## 6. Pendiente

Elegir dónde alojar el programa (Render, servidor de la empresa, etc.), revisar los 21 precios que cambian más de un 25 %, prueba en un móvil real y revisión humana antes de abrirlo a clientes.
