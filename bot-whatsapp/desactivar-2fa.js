#!/usr/bin/env node
// Quita el segundo factor del PANEL (si se perdió el móvil y los códigos de emergencia, o si se cambió ADMIN_TOKEN). Hay que ejecutarlo EN el ordenador de la oficina:
//   node --env-file=C:\vm\config\empresa.env desactivar-2fa.js        (o deploy\windows\desactivar-2fa.bat)
// Después se puede volver a activar desde el panel.
import { openAccountsDb } from "./cuentas-db.js";
const a = openAccountsDb();
for (const k of ["totp_activo", "totp_secreto", "totp_pendiente", "totp_ultimo", "totp_recuperacion"]) a.ajusteGuardar(k, "");
console.log("Segundo factor del panel DESACTIVADO. Entra con la clave de siempre y vuelve a activarlo desde «Cuentas de clientes».");
