# Plan técnico — Pedidos por WhatsApp (Distribuciones VM)

## 1. Dependencias críticas (se resuelven ANTES de programar la sincronización y la exportación)

| # | Incógnita | Por qué bloquea | Cómo se resuelve |
|---|-----------|-----------------|------------------|
| D1 | Nombre y versión del ERP | Define todo lo demás | Pantalla "Acerca de" / factura del proveedor |
| D2 | Formato de la copia en OneDrive (.bak SQL Server, .mdb/.accdb, SQLite, .zip de DBF/CSV, formato propietario cifrado) | Si es propietario/cifrado, la sincronización desde la copia **no es viable** | Un archivo de copia **real** inspeccionado por el responsable (extensión, tamaño, `file`, abrir con visor) |
| D3 | Formato de importación de pedidos (columnas, separadores, códigos, orden) | La exportación debe ser exacta | Plantilla de importación del propio ERP + un Excel de ejemplo que el ERP acepte |
| D4 | ¿El ERP ofrece importación automática, API o carpeta vigilada? | Define la Fase 5 | Documentación / soporte del proveedor |
| D5 | Teléfonos en el ERP: ¿formato, varios por cliente, compartidos? | Identificación | Muestra anonimizada de 20 clientes |

**Alternativas si D2 falla** (por orden de preferencia): (a) exportación programada del ERP a CSV/Excel a una carpeta de OneDrive; (b) informe/listado que el ERP pueda guardar automáticamente; (c) consulta ODBC/SQL de solo lectura si es un motor estándar; (d) carga manual semanal de un CSV mientras tanto. El diseño aísla esto detrás de una interfaz `ErpSource`, de modo que el resto del sistema no cambia.

## 2. Decisiones de arquitectura

- **Lenguaje**: Python 3.12. **API**: FastAPI. **BD**: PostgreSQL en producción (SQLite en prototipo, mismo ORM: SQLAlchemy + Alembic).
- **Máquina de estados determinista** para el chat (sin IA generativa). Análisis de texto con reglas + coincidencia aproximada (`rapidfuzz`) para "15 de A y 8 de B". IA solo como opción futura para texto libre ambiguo, nunca para decidir cantidades sin confirmación.
- **Botones/listas de WhatsApp** (máx. 3 botones, 10 filas por lista) para repetir pedido y confirmar; para catálogos grandes, **enlace a un formulario web** (WhatsApp Flows o página propia con token de un solo uso).
- **Separación de datos**: esquema `erp_*` (solo lectura, se reemplaza en cada sincronización dentro de una transacción) y esquema `orders_*` (propio, nunca tocado por la sincronización). Los pedidos guardan código de cliente y referencia como texto + una copia de descripción/precio en el momento (snapshot).
- **Idempotencia**: `wa_message_id` único (WhatsApp reintenta webhooks) y `confirmation_token` único por pedido → una doble confirmación no crea dos pedidos.
- **Alojamiento**: un VPS pequeño (≈5–10 €/mes) con Docker Compose; sin servicios gestionados en el inicio.

## 3. Estructura del proyecto

```
app/
  erp/            # interfaz ErpSource + lectores por formato (csv, bak, accdb…)
  sync/           # detección de copia nueva, validación, carga atómica, rollback
  db/             # modelos, migraciones
  chat/           # máquina de estados, parser de cantidades, plantillas de mensajes
  whatsapp/       # webhook, firma, envío (Cloud API) + simulador local
  orders/         # creación, confirmación idempotente, estados
  export/         # generador Excel (formato configurable por plantilla), historial
  admin/          # panel: pedidos, incidencias, sincronizaciones, descargas
  core/           # config, logging, seguridad
tests/            # unitarios, flujo de conversación, exportación contra plantilla
fixtures/         # datos FICTICIOS
docs/
```

## 4. Flujo de identificación (seguridad)

- Número conocido y único → saludo con nombre comercial (sin datos sensibles) y menú.
- Número compartido por varios clientes → preguntar a cuál se refiere y verificar con un dato que solo el cliente conoce (p. ej. últimos 4 dígitos del NIF/CIF o código de cliente).
- Número desconocido → no se muestra ninguna información comercial; se ofrece derivación a una persona y se registra el contacto.
- Historial y precios solo tras identificación; límite de intentos de verificación.
- Datos personales: RGPD (base legal contractual, minimización, retención limitada de chats, registro de accesos, cifrado en reposo y en tránsito, contrato de encargado con Meta/hosting).

## 5. Fases e hitos (con criterios de aceptación)

**Fase 0 – Análisis (1–2 semanas, sin código):** resolver D1–D5. *Hecho cuando* se tenga una copia real inspeccionada y la plantilla de importación.

**Fase 1 – Prototipo local (2–3 semanas):** datos ficticios, simulador de WhatsApp en consola/web, flujo completo (repetir, modificar, añadir, eliminar, confirmar), BD de pedidos, exportación Excel con plantilla provisional. *Hecho cuando* el flujo pasa los tests automáticos y no hay duplicados.

**Fase 2 – Sincronización (2–3 semanas, depende de D2):** lector del formato real, carga atómica, validaciones (n.º de filas mínimo, campos obligatorios), conservar la última versión válida, alertas por fallo. Acceso a OneDrive vía Microsoft Graph (permiso de solo lectura a una carpeta) o carpeta sincronizada en el servidor.

**Fase 3 – WhatsApp (2 semanas):** cuenta WhatsApp Business Platform (Cloud API), plantillas aprobadas, webhook con verificación de firma, pruebas con números autorizados.

**Fase 4 – Exportación real (1–2 semanas, depende de D3/D4):** formato exacto, prueba de importación en el ERP (entorno de pruebas o copia), historial de exportaciones con hash del archivo.

**Fase 5 – Panel y producción (2 semanas):** panel admin con login, incidencias, monitorización, copias de seguridad de la BD propia, piloto con pocos clientes.

## 6. Costes estimados (orientativos, a verificar)

| Concepto | Estimación |
|----------|-----------|
| Hosting VPS | 5–15 €/mes |
| WhatsApp Cloud API | Se cobra por conversación/plantilla (Meta); los mensajes iniciados por el cliente dentro de 24 h suelen ser gratuitos. Volumen bajo ≈ pocos €/mes |
| OneDrive / Graph | Incluido en la licencia Microsoft 365 existente |
| Dominio + TLS | ≈ 10 €/año |
| IA generativa | 0 € (no se usa en la versión base) |
| Desarrollo | Fases 1–5 ≈ 10–14 semanas de trabajo; la Fase 0 puede acortar o alargar el total |

## 7. Riesgos principales

1. Copia del ERP propietaria/cifrada (D2) → alternativa de exportación programada.
2. Formato de importación rígido o con códigos internos → pruebas contra el ERP antes de producción.
3. Teléfonos sucios o duplicados → normalización a E.164 y revisión de conflictos.
4. Copia del día desfasada (pedidos o clientes nuevos del mismo día) → aviso en el panel y validación de productos al exportar.
5. Aprobación de Meta y plantillas → iniciar el trámite pronto.
6. Catálogo grande → formulario web en vez de listas.

## 8. Pruebas necesarias

- Unitarias: parser de cantidades, normalización de teléfonos, máquina de estados.
- Idempotencia: webhook repetido y doble confirmación.
- Sincronización: archivo corrupto, vacío, truncado, formato nuevo → se conserva la versión anterior.
- Exportación: comparación celda a celda con la plantilla del ERP; sin duplicados al reexportar.
- Seguridad: número desconocido, número compartido, intentos de verificación.
- Piloto real con clientes autorizados y datos controlados.

## 9. Próximos pasos propuestos

1. El responsable aporta: nombre del ERP, **una copia de seguridad real** (o su extensión y tamaño), y **la plantilla de importación** de pedidos.
2. Mientras tanto, se construye la Fase 1 (prototipo con datos ficticios), que no depende de lo anterior.
