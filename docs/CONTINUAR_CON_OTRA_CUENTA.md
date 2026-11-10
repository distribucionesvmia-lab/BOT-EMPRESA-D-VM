# Seguir el proyecto con otra cuenta (o a mano)

Este documento sirve para retomar el trabajo si Claude falla o hay que cambiar de cuenta. No contiene claves ni datos reales.

## 1. Dónde está el código

Repositorio `distribucionesvmia-lab/BOT-EMPRESA-D-VM`, rama **`claude/eager-hamilton-gknalq`**: es la rama principal y **ya incluye el trabajo de las otras dos** (fusionadas el 05/11/2026):

- Rama de control de calidad (`claude/dreamy-newton-ul75g0`): pedido recibido con su referencia, descuento visible en la fila, buscador que perdona erratas, textos y móvil, informes en `bot-whatsapp/qa/`.
- Rama del extractor de a3ERP (`claude/modest-newton-pe28a2`): `extraer-a3erp.js` y `preparar-artefacto.js`.

Las dos ramas antiguas se pueden dejar como están; no hace falta trabajar en ellas.

## 2. Cómo empezar

```bash
git clone https://github.com/distribucionesvmia-lab/BOT-EMPRESA-D-VM.git && cd BOT-EMPRESA-D-VM
git checkout claude/eager-hamilton-gknalq
cd bot-whatsapp          # necesita Node 22 (usa node:sqlite); no hay dependencias que instalar
npm test                 # 233 pruebas
npm run demo             # servidor de demostración con datos ficticios (cliente de prueba: 123456)
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

Entrada con los 6 primeros dígitos del DNI/CIF (decisión del 05/11) · "Hoy" solo antes de las 10:00 y solo municipio 47085 · el «Dto %» de la tarifa es descuento para el cliente · IVA `SRE` = 4 % · los productos de familias nuevas sin categoría van a «Otros productos» · lo que no esté en el Excel de artículos se quita · el chat solo responde a pedir, último pedido, histórico y repetir (todo lo demás: «No estoy diseñado para responderte a eso»).

## 6. Pendiente

Elegir dónde alojar el programa (Render, servidor de la empresa, etc.), revisar los 21 precios que cambian más de un 25 %, prueba en un móvil real y revisión humana antes de abrirlo a clientes.

## Clientes falsos de prueba (Pablo y Enrique) en la demo
`node prueba-a-json.js prueba.json "T0818:PABLO MARTIN CASTAÑEDA:81818181A:historial-pablo.xlsx" "T5900:ENRIQUE MARTIN GALLEGO:59005900B:historial-enrique.xlsx"` y al compilar `PRUEBA_JSON=prueba.json node demo-web/build.mjs`. Entran con 818181 (Pablo) y 590059 (Enrique). Los ids llevan «T» para no pisar a clientes reales con el mismo código. Ese JSON no se sube a GitHub.

## Fotos creadas con IA
Si el ZIP de fotos trae su Excel de control (columnas `codigo` y `tipo`, con `IA` en las generadas), al aplicarlo se guarda `fotos-ia.json` junto a las fotos y el catálogo muestra «Foto orientativa creada con IA» bajo el producto. Una foto real posterior para ese código quita el aviso. En la demo: `FOTOS_IA_JSON=lista.json node demo-web/build.mjs` (lista de códigos).
