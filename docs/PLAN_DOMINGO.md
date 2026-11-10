# Plan hasta el domingo (instalación en el ordenador de la oficina)

Estado a 10/11: código al día (247 pruebas pasan), demo en el artefacto con los paneles nuevos.

## Hecho
- App del cliente y app de la empresa separadas (`APP_MODE`), acceso por 6 primeros dígitos del DNI/CIF.
- Subida de Excel con vista previa (productos, clientes, historial) y solo diferencias.
- Repetir pedido + añadir productos del catálogo completo.
- Vigilancia: estado, avisos y informe diario por correo (`docs/VIGILANCIA.md`).

## Se hace antes del domingo
- [ ] Revisar con datos reales: 21 saltos de precio, 280 productos sin precio, 43 Pascual sin código, ~319 fotos que faltan.
- [ ] Guion de instalación en Windows para la oficina (ver `docs/INSTALACION_WINDOWS.md`): Node 22, arranque automático, copias, correo.
- [ ] Decidir cómo entran los clientes desde internet al ordenador de la oficina (túnel de Cloudflare: sin abrir puertos del router).
- [ ] Cuenta de correo SMTP (IONOS) y `MAIL_TO` para los avisos.
- [ ] Pruebas de punta a punta en un móvil real.

## El domingo
1. Instalar según la guía, cargar clientes → productos → historial desde la app de la empresa.
2. Probar un pedido de verdad y su Excel de exportación.
3. Activar el túnel y comprobar el acceso desde el móvil con datos móviles.
4. Crear la tarea de Claude que lee los informes.
