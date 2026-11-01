# Hallazgos

## Tarea 1 (abrir /demo y saludar) — OK
- Página carga (200), sin errores de consola. El saludo pide el nombre del negocio o código y ofrece «nuevo». Correcto.
- Base: `npm test` 206/206 pasan.
- Observación menor: el «hola» aparece ya escrito en el chat al abrir (lo envía la propia demo).

## Tarea 2 (identificación fallida) — 3 observaciones
- OK: nombre inexistente («Panadería Fantasma 123») → «No encuentro ese nombre», sin errores de consola.
- OK: «bar» a secas no identifica a nadie (según README). A los 3 fallos avisa a una persona.
- ⚠️ F2-1 (media) Tras avisar a una persona, el bot sigue en modo identificación: «xx» y «asdf qwerty» devuelven otra vez «No encuentro ese nombre…». El cliente acaba de leer «te responderá una persona» y el bot sigue pidiéndole el nombre, sin estado de «derivado a persona».
- ⚠️ F2-2 (baja) «bar» (nombre demasiado genérico) da el mismo mensaje que un nombre inexistente; no explica que es ambiguo/corto. Cuenta como fallo y acerca al cliente al bloqueo de 3.
- ⚠️ F2-3 (a confirmar) «nuevo» muestra el mismo «Bienvenido» del cliente conocido y no pide ningún dato (nombre, NIF, dirección). Un cliente nuevo queda sin registrar/aviso a la empresa que el usuario vea. ¿Es intencionado?

### Arreglados (identificación, F2-1/F2-2/F2-3)
- F2-1: tras derivar a una persona el bot ya no vuelve a pedir el nombre (estado «derivado»; «menu» reinicia).
- F2-2: «bar», «cafetería», «S.L.»… responden «demasiado general, escribe el nombre completo» y no cuentan como fallo.
- F2-3: «nuevo» avisa a una persona (handoff) y explica que su pedido se revisará; sigue pudiendo ver productos y pedir.
- Tests: 207/207. Verificado a mano contra la demo.

## Tarea 3 (identificación correcta) — 2 observaciones
- OK: «Bar El Ejemplo», «bar el ejemplo», «BAR EL EJEMPLO (FICTICIO)», «soy el bar el ejemplo», «Bar Ejemplo» y el código «9001» identifican al cliente correcto. Sin errores de consola.
- ⚠️ F3-1 (ALTA, privacidad) Quien escriba el nombre de un negocio desde cualquier teléfono ve su «histórico de productos» (qué compra y cuántas unidades). `identifiedIntro` (bot.js) muestra `habitualBlock` siempre; `holdUnverified` solo retiene el pedido, no oculta el historial. Contradice la idea del README de que un cliente nunca ve datos de otro. Propuesta: si el teléfono no coincide con el del cliente (en producción), no mostrar el histórico (solo saludo y catálogo) hasta verificar.
- ⚠️ F3-2 (baja) «ejemplo» o «el ejemplo» (solo la palabra distintiva) no identifica: cobertura 50 % < 60 % porque «bar» cuenta. Es una decisión de seguridad, pero el mensaje no sugiere añadir más palabras; con «Bar Ejemplo» sí funciona.

## Tarea 4 (pedido por el chat) — flujo completo OK, 3 observaciones
Flujo probado: identificar → lista → artículo → cajas/unidades → cantidad → «nota: servir el jueves» → Finalizar → Confirmar → día de entrega («mañana») → pedido guardado (VM-2026-000001, entrega 2026-11-02, nota guardada). Cajas bien convertidas (3 cajas = 18 uds).
- ⚠️ F4-1 (media) El chat enseña el precio de tarifa y no el especial del cliente: Cola 0,55 € (tarifa) vs 0,50 € (precio especial del cliente 9001, el que se guarda). Total mostrado 10,86 € / total guardado 10,56 €. El aviso «orientativos, sin IVA ni descuentos» no cubre los precios especiales; el cliente ve un importe distinto del que se le cobrará.
- ⚠️ F4-2 (baja) El mensaje final «¡Pedido recibido!» no muestra la referencia (VM-2026-000001), ni el resumen ni el total; el cliente no tiene número para reclamar.
- ⚠️ F4-3 (baja) Tras «Cambiar»/escribir un texto no reconocido (probé un id de botón erróneo, mi error) el bot responde «No he reconocido ese artículo» sin mostrar el pedido actual: no es fallo, pero conviene recordar el carrito en ese mensaje.
