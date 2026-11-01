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
