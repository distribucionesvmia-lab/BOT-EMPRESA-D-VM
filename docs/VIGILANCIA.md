# Vigilancia del sistema (Claude como vigilante)

El programa del ordenador de la oficina se vigila **sin abrir nada hacia fuera**: él manda correos y Claude los lee.

## Qué hace el programa (ya construido)
- `GET /api/admin/estado` (con la clave de la empresa): pedidos pendientes y retenidos, altas sin resolver, última sincronización, última copia de seguridad, disco libre, correo y una lista de **problemas** (`problemas[]`).
- **Aviso por correo** cuando aparece un problema nuevo (se repite cada 6 h si sigue). **Informe diario** a las 08:30 (`REPORT_TIME`). Se apaga con `VIGILANCIA=0`. Necesita el correo configurado (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_TO`).
- Problemas que detecta: pedidos sin exportar > 12 h, retenidos > 3 h, solicitudes de alta sin resolver > 24 h (se prometió 24-48 h), sincronización con Drive fallida o parada, correo de avisos caído, sin copia de seguridad o con más de 30 h, disco con menos de 1 GB.

## Qué hará Claude (tarea programada, se crea al instalar)
1. Cada pocas horas lee en Gmail los correos `[VM informe]` y `[VM vigilancia]`.
2. Si hay avisos, resume qué pasa y qué hacer (o avisa si no llega el informe diario: significa que el programa está parado).
3. Revisa en Drive que el Excel subido está en la carpeta `datos` y que la sincronización lo aplicó.
4. **Claude no toca los datos**: solo avisa. Las actualizaciones las aplicas tú desde la pestaña «Actualizar datos desde Excel» o dejando el Excel en Drive.
