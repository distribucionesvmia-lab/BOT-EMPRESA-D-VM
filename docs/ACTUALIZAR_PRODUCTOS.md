# Actualizar los productos con un Excel nuevo

No hace falta quitar todos los productos y volver a meterlos. Con el Excel nuevo de a3ERP (artículos) se compara lo que hay con lo que llega y se tocan **solo** los productos que han cambiado. Cada cambio queda registrado (producto, campo, valor antes y después, fecha).

## Paso 1. Ver qué cambia (no escribe nada)

```bash
cd bot-whatsapp
node actualizar-productos.js ARTICULOS_29-10-26.xlsx --informe informe.md
```

Enseña un resumen y el detalle:

| Apartado | Qué es |
|---|---|
| Añadidos | Productos del Excel que no estaban (con la categoría que se les asigna) |
| Quitados | Estaban y ya no vienen, o vienen bloqueados/obsoletos, o sin precio. Pasan a inactivos: no se borran, queda su historial |
| Modificados | Qué campo cambia en cada uno: nombre, precio, unidades por caja, IVA… con el valor de antes y de después |
| Precios que cambian mucho | Subidas o bajadas de más del 25 %: casi siempre es un error del Excel o algo que conviene mirar |
| Reactivados | Estaban inactivos y vuelven a estar activos |
| Sin precio | No se pueden vender (precio 0 o `#N/A`) |

## Paso 2. Aplicar los cambios

```bash
node actualizar-productos.js ARTICULOS_29-10-26.xlsx --aplicar            # a la base del servidor (catalogo.sqlite)
node actualizar-productos.js ARTICULOS_29-10-26.xlsx --aplicar --fotos imagenes   # y guardar las fotos nuevas o cambiadas
```

Antes de aplicar se hace una copia de seguridad de la base (`catalogo.sqlite.antes-FECHA.bak`).

## Reglas

- **Lo que el Excel no trae no se toca.** Si el Excel no tiene columna de descuento, categoría…, los que ya hay se conservan.
- **Los productos nuevos** se clasifican por su familia de a3ERP con `familias-categorias.json`. Las familias que no están ahí se clasifican por el nombre; el informe las lista para decidir su categoría (se añaden al JSON).
- **IVA con código** (`ORD21`, `RED10`): se convierten solos a 21 y 10. Códigos como `SRE` no se suponen: indica su tipo con `--iva SRE=4`. En la base del servidor, si hay productos nuevos con IVA desconocido no se aplica nada hasta indicarlo.
- La sincronización automática desde Google Drive también conserva lo que el Excel no trae.

## Con una lista en JSON (la demo)

```bash
node actualizar-productos.js ARTICULOS.xlsx --actual lista.json --salida-json lista-nueva.json --aplicar
```

## Para la demo en línea (artefacto de Claude): solo se escriben las diferencias

```bash
node actualizar-productos.js ARTICULOS.xlsx --actual lista-anterior.json --iva SRE=4 --artefacto carpeta --salida-json lista-nueva.json --fotos imagenes --aplicar
```

Deja `carpeta/datos/productos.json` en el formato que lee el cargador de la demo. Se publica como archivo del artefacto (`publish_files`, modo *patch*) y el propietario abre la dirección terminada en `#cargar-datos`: el cargador compara una huella de cada producto y escribe **solo** lo nuevo o modificado y retira lo que ya no está. El cargador vive en `bot-whatsapp/demo-web/page.html` (no hay que tocar nada más).

- `--descuentos-de lista.json`: el descuento de a3ERP manda. Toma el descuento de otra lista (por ejemplo la que saca el extractor de a3ERP) para los productos que estén en ella. En la primera carga con ARTICULOS_29-10-26 se usó la lista de la copia de a3ERP del 20/10: la columna «Dto %» de la tarifa de proveedores (20-30 % en Pascual y vinos) no coincidía con el descuento de a3ERP (0), y no se quiere mostrar al cliente un precio más bajo que el de la factura.
- `--iva SRE=4`: el tipo de IVA de `SRE` coincide con la copia de a3ERP (4 %): en los 1.651 productos que están en las dos listas el IVA es idéntico.

## Familias nuevas

Si llegan productos de una familia que aún no tiene categoría, edita `familias-categorias.json` (`"14.0": { "category": "…", "subcategory": "…" }`) o vuelve a aprenderlas de los productos ya clasificados:
`node familias-aprender.js ARTICULOS.xlsx lista-actual.json familias-categorias.json`.
