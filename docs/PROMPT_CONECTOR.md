# Prompt: conector entre a3ERP y el sistema de pedidos de Distribuciones VM

Copia este texto completo en la IA que vaya a desarrollarlo (por ejemplo, Claude Code con el repositorio abierto).

---

## ROL Y OBJETIVO

Actúa como arquitecto de software y desarrollador senior. Vas a construir el **conector entre a3ERP (Wolters Kluwer) y el sistema de pedidos de Distribuciones VM** (distribuidora de Medina del Campo, Valladolid).

El sistema de pedidos ya existe en el repositorio `distribucionesvmia-lab/BOT-EMPRESA-D-VM`, rama `claude/eager-hamilton-gknalq`, carpeta `bot-whatsapp/` (Node 22, sin dependencias, SQLite). **Léelo antes de escribir nada**: `README.md`, `docs/PLAN.md`, `docs/A3ERP.md`, `bot.js`, `pricing.js`, `erp.js`, `db.js`, `catalogo-db.js`, `clientes-db.js`, `export-format.js`, `server.js` y los tests. Respeta su estilo (comentarios en español, funciones puras, tests con `node --test`).

**Decisión tomada: el sistema NO usa WhatsApp.** No añadas nada de WhatsApp/Meta. El cliente pedirá por una aplicación web (chat + mini-app) con enlace personal.

El conector debe permitir que:
1. Los **productos, precios, clientes e historial de compras** de a3ERP lleguen a nuestras bases (`catalogo.sqlite`, `clientes.sqlite`) de forma automática.
2. Los **pedidos confirmados** por los clientes se creen en a3ERP como **pedidos de venta**, sin que nadie los teclee, con control de duplicados y de errores.

## ARQUITECTURA (ya decidida, no la cambies)

```
SERVIDOR DE LA EMPRESA                         NUESTRA APLICACIÓN (Node)
┌────────────────────────┐  HTTPS, solo salida ┌───────────────────────────┐
│ a3ERP + SQL Server     │                     │ catalogo.sqlite           │
│   ▲ DLL (crear pedido) │ ─ 1. envía datos ─► │ clientes.sqlite           │
│   │ SELECT solo lectura│ ◄ 2. recoge pedidos │ pedidos.sqlite (cola)     │
│ CONECTOR (C#, servicio │ ─ 3. devuelve nº ─► │ API /api/conector/*       │
│ de Windows)            │                     └───────────────────────────┘
└────────────────────────┘
```

Reglas de arquitectura:
- **El conector siempre llama hacia fuera.** Nadie de internet puede entrar en el servidor de la empresa. Nada de puertos abiertos ni de túneles entrantes.
- **El chat/app nunca habla con a3ERP en tiempo real.** Usa sus propias bases; el conector las alimenta y recoge la cola de pedidos.
- **Escribir en a3ERP solo con la DLL/API oficial**, nunca con INSERT/UPDATE en SQL. Leer por SQL, siempre con usuario de solo lectura y consultas fijas.
- **Nunca generes SQL a partir de texto libre ni de la IA.** Operaciones cerradas y consultas parametrizadas.
- **Solo pedidos de venta.** Nada de apuntes contables, facturas ni cobros.
- El Excel de pedidos actual (`exportar.js`) se mantiene como **plan B**.

## LO QUE NO SABEMOS (no lo inventes)

No conocemos todavía: el esquema de tablas de la base de a3ERP, la API/DLL concreta para crear pedidos, la versión de a3ERP, ni si requiere licencia. **No inventes nombres de tablas, columnas, clases ni métodos de la DLL.** Donde falte información:
- Define la **interfaz** y entrega una **implementación simulada** que funcione y esté probada.
- Para la parte real, entrega una **plantilla con marcadores `TODO(a3ERP)`** y un fichero `docs/DATOS_NECESARIOS.md` que liste exactamente qué hay que averiguar (tablas, campos, métodos) y quién puede dar cada dato.
- Si algo es ambiguo y cambia el diseño, **detente y pregunta** antes de seguir.

## ENTREGABLES

### A. Nuestra aplicación (Node, en `bot-whatsapp/`)
1. **API del conector** bajo `/api/conector/`:
   - `POST /sync/productos` — cuerpo `{ sentAt, full, products:[{id,name,price,unitsPerBox,vat,discount,active}] }`; usa `upsertProducts` (con `deactivateMissing` solo si `full`).
   - `POST /sync/clientes` — cuerpo `{ sentAt, customers:[{id,name,phone,address,recargoEquivalencia,specialPrices,discounts,orders:[{doc,date,lines:[{productId,qty}]}]}] }`; usa `upsertCustomers`.
   - `GET /pedidos/pendientes?limit=20` — devuelve pedidos confirmados, no retenidos, con líneas (`id, qty, unit, boxes, units, note`), nota general y referencia `VM-AAAA-NNNNNN`. Los **reserva** (lease de 10 min) para que dos consultas no entreguen el mismo pedido.
   - `POST /pedidos/:ref/resultado` — `{ ok, erpNumber?, error?, shadow? }`.
   - `POST /latido` — `{ version, mode, lastSync }`; responde `{ writesEnabled }` (interruptor para parar la escritura desde aquí).
2. **Estados del pedido**: `pendiente → reservado → enviado(nº a3ERP) | error(motivo) | simulado`. Un pedido con error pasa a revisión; nunca se pierde ni se duplica. Ampliar `db.js` con migración compatible.
3. **Autenticación**: cabeceras `X-Connector-Id`, `X-Timestamp`, `X-Signature` = HMAC-SHA256(secreto, método + ruta + timestamp + SHA256(cuerpo)); rechazar fuera de ±5 min y repeticiones (nonce). Secretos por variable de entorno, rotables. Límite de peticiones y registro de cada llamada.
4. **Validación al recibir datos**: no aceptar una sincronización que borre más del 30 % de los productos o clientes (conservar la última versión válida y registrar incidencia); precios y cantidades válidos; todo o nada.
5. **Panel del distribuidor** (vista existente): estado del conector (último latido, última sincronización, modo), pedidos en error con el motivo y botón de reintentar, e interruptor de escritura.
6. **Conector simulado en Node** (`conector-simulado/`) que lea un a3ERP falso desde ficheros JSON y ejerza toda la API, para probar de extremo a extremo sin a3ERP.

### B. Conector real (C# .NET 8, servicio de Windows, carpeta `conector-a3erp/`)
1. Interfaces `IErpReader` (artículos, clientes, tarifas, descuentos, historial) e `IErpWriter` (crear pedido de venta, buscar pedido por referencia).
2. Implementaciones: `FakeErp` (ficheros JSON, con pruebas), `SqlErpReader` y `A3DllWriter` como plantillas con `TODO(a3ERP)` y consultas parametrizadas **de ejemplo marcadas como no verificadas**.
3. Tres modos: **Lectura** (solo sincroniza), **Sombra** (calcula y registra qué pedido crearía, sin crear nada) y **Real**. Por defecto, Lectura.
4. Antes de crear un pedido, comprobar por la referencia `VM-…` que no existe ya (idempotencia tras caídas).
5. Reintentos con espera creciente, registro a fichero rotativo, alerta si falla N veces seguidas, `appsettings.json` con la URL, el id y el secreto, y respeto del interruptor `writesEnabled`.
6. Instalador/instrucciones de servicio de Windows y de cuenta con **permisos mínimos** (usuario SQL de solo lectura; usuario de a3ERP solo con permiso de pedidos).

### C. Documentación
`docs/CONECTOR.md` (arquitectura, contrato de la API con ejemplos, seguridad, operación y recuperación de errores), `docs/DATOS_NECESARIOS.md`, `docs/PRUEBAS_ACEPTACION.md` y actualización de `README.md`.

## FASES (haz una, valida, haz commit y pasa a la siguiente)

| Fase | Contenido | Se da por buena cuando |
|---|---|---|
| 0 | Parte A completa + conector simulado | `npm test` en verde y una prueba de extremo a extremo que sincroniza, recoge un pedido y devuelve el resultado, incluidos duplicados, caída a mitad y firma inválida |
| 1 | `conector-a3erp` con `FakeErp` + modo Lectura | Pruebas de C# en verde y sincronización contra la API de la fase 0 |
| 2 | Modo Sombra | Registra el pedido que crearía, sin escribir nada |
| 3 | Plantillas reales (`SqlErpReader`, `A3DllWriter`) y guía de pruebas en una **empresa de pruebas** | Solo cuando alguien aporte esquema y DLL; hasta entonces permanecen como plantilla |
| 4 | Producción: lista de comprobación de puesta en marcha | Una semana en Sombra sin diferencias frente al Excel manual |

## RESTRICCIONES

- **Sin datos reales de clientes** en el código, las pruebas ni los commits. Solo datos ficticios.
- **No contrates ni despliegues nada** (servidores, dominios, licencias) ni uses credenciales reales. Prepara y documenta; la decisión es de la empresa.
- Nunca subas secretos ni ficheros `.env`.
- Prioriza código determinista, simple y mantenible. Sin IA generativa en el conector.
- No modifiques a3ERP ni su base de datos directamente. No toques contabilidad.
- Mantén separados los datos sincronizados de ERP (`catalogo`, `clientes`) de los pedidos nuevos (`pedidos`).
- Cumple RGPD: mínimos datos necesarios, sin datos personales en los registros, retención limitada.
- No rompas lo existente: todos los tests actuales deben seguir pasando.

## CÓMO TRABAJAR

1. Empieza resumiendo en 10 líneas lo que has entendido del repositorio y lo que vas a hacer en la fase 0. Pregunta lo que sea ambiguo.
2. Escribe primero los tests de cada pieza y después el código.
3. Un commit por fase, con mensaje claro. Empuja solo a la rama indicada y no abras pull requests salvo que te lo pidan.
4. Al terminar cada fase informa de: qué hiciste, cómo lo comprobaste, qué **no** pudiste comprobar y qué decisión necesitas de mi parte.
5. Si descubres un riesgo de seguridad o de pérdida de datos, avísame antes de seguir.

## DEFINICIÓN DE TERMINADO

- Todo pedido confirmado llega a a3ERP **una sola vez**, o queda visible en revisión con su motivo.
- Los productos, precios y clientes de a3ERP se actualizan solos y, si falla una sincronización, se conserva la última versión válida.
- El conector funciona en Lectura, Sombra y Real, con interruptor de escritura y alertas.
- Las pruebas de extremo a extremo pasan con el conector simulado; las plantillas reales están documentadas y listas para completarse.
- Nadie de fuera puede entrar en el servidor de la empresa, y ningún dato real aparece en el repositorio.
