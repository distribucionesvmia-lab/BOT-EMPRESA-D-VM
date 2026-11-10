# Copias de seguridad, restauración y exactitud de los precios

## Copias de seguridad
- Cada noche (03:00) el programa guarda una copia de las 4 bases (pedidos, cuentas, clientes, catálogo) en `BACKUP_DIR` (por defecto `C:\vm\datos\respaldos`; mejor una carpeta que sincronice Google Drive). Se guardan las 14 últimas de cada una.
- Antes de aplicar un Excel de productos también se hace una copia del catálogo.

## Restaurar (ensayado)
`restaurar.bat` (clic derecho → «Ejecutar como administrador», en `C:\vm\bot\bot-whatsapp\deploy\windows`):
1. Enseña las copias disponibles y cuántos datos tiene cada una (pedidos, cuentas, clientes, productos) **sin tocar nada**.
2. Pide que escribas SI. Para el programa, **guarda lo que hay ahora** en `antes-de-restaurar-<fecha>` (junto a las bases), comprueba cada copia (que se abre y no está dañada) y la restaura. Una copia dañada o que no es de esa base **no se restaura** y esa base se queda como está.
3. Vuelve a arrancar el programa.
Por línea de comandos: `node restaurar.js --ver` · `node restaurar.js --restaurar [--fecha 20261110] [--solo pedidos,clientes]`.
Hay un ensayo automático (`restaurar.test.js`): se llenan las 4 bases, se hace la copia, se borran los ficheros, se restaura y se comprueba que pedidos, cuentas, clientes, precios y numeración de pedidos quedan exactamente igual.

## Cálculo de precios (exacto)
- Todo el dinero se calcula con **enteros (céntimos)**, no con decimales de coma flotante: antes 300 × 2,286 × 0,875 = 600,075 salía 600,07 y ahora sale 600,08 (la mitad de un céntimo sube). Está en `pricing.js` y es el mismo cálculo en el servidor, el chat y la página del cliente (`pedido.html`).
- Importe de línea = unidades × precio × (1 − descuento %). Precio por unidad; si pide cajas, unidades = cajas × unidades por caja. Precios a 4 decimales, descuentos a 2.
- Por cada tipo de IVA (4, 10, 21): base = suma de importes; IVA = base × tipo; recargo de equivalencia (si el cliente lo tiene) = base × 0,5 / 1,4 / 5,2 %. IVA y recargo salen de la misma base (no se acumulan). Total = base + IVA + recargo.
- `precios.test.js` compara 100.000 importes y 20.000 totales al azar con una referencia exacta, y comprueba que `pedido.html` calcula lo mismo que el servidor.

## Excel de productos: lectura segura
- Se enseña **qué columna se ha leído como precio, IVA, uds/caja…** y los 3 primeros productos tal como han quedado, para comprobarlo de un vistazo.
- **No se importan** productos con precio disparatado (> 5.000 € por unidad) ni con un IVA que no existe (solo 4, 10 y 21). Se avisa de descuentos imposibles y de unidades por caja raras.
- Los números se leen igual en formato español y en inglés (`1.234,56` y `1,234.56`); los precios con ruido (`4,9950000000000001`) se guardan como 4,995.
- **Hay que confirmar antes de aplicar** si algún precio cambia más de un 25 %, si se quitan muchos productos (≥ 5 y más del 10 %) o si hay datos raros. Sin confirmar no se escribe nada.
- Un Excel con menos de la mitad de los productos actuales se rechaza. Solo se escriben las diferencias y cada cambio queda registrado.
