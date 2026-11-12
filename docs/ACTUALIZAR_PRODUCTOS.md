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

- `--descuentos-de lista.json`: completa el descuento con el de otra lista (por ejemplo la que saca el extractor de a3ERP) solo en los productos que no tienen. El cliente confirmó que el «Dto %» de la tarifa (20-30 % en Pascual y vinos) es descuento para el cliente: ese manda; en 8 productos hay descuento en las dos listas y distinto (gana el de la tarifa).
- `--iva SRE=4`: el tipo de IVA de `SRE` coincide con la copia de a3ERP (4 %): en los 1.651 productos que están en las dos listas el IVA es idéntico.

## Familias nuevas

Si llegan productos de una familia que aún no tiene categoría, edita `familias-categorias.json` (`"14.0": { "category": "…", "subcategory": "…" }`) o vuelve a aprenderlas de los productos ya clasificados:
`node familias-aprender.js ARTICULOS.xlsx lista-actual.json familias-categorias.json`.

## Actualizar desde la aplicación de la empresa (sin comandos)

En la aplicación de la empresa, pestaña **Clientes › Actualizar datos desde Excel**: se elige el tipo (productos, clientes o histórico), se sube el Excel y **«Ver cambios»** enseña qué se añade, qué cambia (antes → después) y qué se quita, sin escribir nada. **«Aplicar cambios»** escribe solo las diferencias.

- **Productos**: añade, modifica y pasa a inactivos los que ya no están; guarda las fotos nuevas o cambiadas del Excel en `IMG_DIR`; hace copia de la base antes. Rechaza un Excel con menos de la mitad de los productos activos (casi seguro incompleto) y los nuevos con IVA sin porcentaje conocido.
- **Clientes**: crea los nuevos y actualiza solo los que cambian (nombre, razón social, dirección, teléfonos, correos, baja). Un dato vacío en el Excel no borra el que hay. Los que no vienen en el Excel **no se dan de baja solos** (se avisa). Cada cliente activo nuevo recibe su cuenta.
- **Histórico**: solo se reescribe el histórico de los clientes cuyo historial cambia; los códigos que no existen se ignoran (sube antes los clientes).
- Cada aplicación queda anotada en `actualizaciones.log` (junto a la base de clientes). La aplicación del cliente (`APP_MODE=cliente`) no tiene estas rutas: responden 404 aunque se envíe la clave.

### Fotos de productos (ZIP)
En la misma pestaña, elige **«Fotos de productos (ZIP)»** y sube un ZIP con las fotos: cada archivo se llama como el código del producto (`11098.jpg`, `.png` o `.webp`) y puede estar dentro de carpetas. «Ver cambios» cuenta las nuevas, las que sustituyen a una foto existente y las que se ignoran (código que no está en el catálogo u otros archivos). Al aplicar, se guardan en la carpeta de fotos (`IMG_DIR`, por defecto `imagenes/`); un producto solo tiene una foto. Máximo 80 MB por ZIP. Las fotos no se suben a GitHub.

### Categorías por tipo de producto
Las categorías y subcategorías del catálogo se ordenan por **tipo de producto** (lo que el cliente busca), no por marca: Café, Pascual, Aguas, Bebidas, Vinos, Despensa, Refrigerados, Congelados, Hostelería y menaje, Otros. Cada producto se clasifica con (1) reglas por el nombre para casos concretos (el azúcar es despensa aunque venga de la familia del café), (2) el código de familia de a3ERP con `familias-categorias.json` (afinado por el nombre cuando la familia es muy amplia) y (3) palabras del nombre si no hay familia. Está en `categorias.js`. Al subir el Excel de productos en «Actualizar datos», «Ver cambios» enseña los productos cuya categoría cambia («Categoría: A → B») y «Aplicar» los mueve.

### IVA y recargo de equivalencia (confirmado por la gestoría)
Tipos: 4 %, 10 % y 21 %. El código «SRE» de a3ERP es el superreducido (4 %); «RED10» es el 10 % y «ORD21» el 21 %. Con recargo de equivalencia se suma 0,5 % (sobre el 4 %), 1,4 % (sobre el 10 %) o 5,2 % (sobre el 21 %), siempre **sobre la base** y sin acumularse con el IVA.

### Calidad de las fotos
El Excel de la tarifa de a3ERP trae las fotos como **miniaturas de 64 píxeles**: ampliadas se ven borrosas. Por eso las fotos del Excel solo se guardan si el producto aún no tiene foto (nunca sustituyen a una foto buena ya subida) y «Ver cambios» avisa de cuántas son de baja resolución (< 200 px). Para que se vea bien lo que se compra, hay que subir fotos grandes en un ZIP («Fotos de productos (ZIP)»): las de ~1000 px se ven nítidas. En la demo del artefacto las miniaturas se recortan, se amplían con filtro Lanczos y se enfocan (build: ver docs/CONTINUAR_CON_OTRA_CUENTA.md).


## Modo de venta
Si el Excel trae la columna **MODO DE VENTA** (2 = solo caja, 3 = caja o unidad), se importa y se enseña en la vista previa como «Modo de venta». Los artículos de solo caja (con más de 1 unidad por caja) se piden únicamente por cajas enteras; los de «caja o unidad» dejan elegir. Los artículos con «Bloqueado» u «Obsoleto» = si se quitan del catálogo.

## Altas a mano y clientes nuevos
- **El sistema reconoce solo qué es cada Excel** (productos o artículos de a3ERP, tarifa, clientes, historial de compras, ZIP de fotos). Si subes uno en la tarjeta equivocada, avisa «este archivo parece un Excel de clientes…, súbelo en la tarjeta…» y no toca nada.
- **Añadir un producto a mano:** pestaña «Datos y Excel» → «Añadir un producto a mano» (código, nombre, precio sin IVA, IVA 4/10/21, unidades por caja, modo de venta, descuento y categoría opcionales). Si el código ya existe, pregunta antes de actualizarlo.
- **Añadir un cliente a mano:** pestaña «Clientes» → «Añadir un cliente a mano». Sin código de a3ERP se le da uno provisional (P00001…); sus pedidos quedan retenidos hasta que tenga el definitivo. Con DNI/CIF entra con sus 6 primeros dígitos (no se guarda el número, solo una huella).
- **Un cliente nuevo se registra por el bot:** en «Solicitudes de alta» pulsa «Es cliente nuevo: crear su ficha». Se rellena con lo que escribió (nombre, DNI/CIF, dirección) y lo completas (código, razón social, población, municipio, recargo). Al aceptar se crea su ficha en la base de clientes con teléfono y correo, su cuenta queda activa y el DNI/CIF se borra de la solicitud.
