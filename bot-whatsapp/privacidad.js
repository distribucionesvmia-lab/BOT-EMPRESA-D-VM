// Información de protección de datos (RGPD, art. 13) que se enseña en la pantalla de acceso y en la solicitud de alta.
// Es un texto estándar: la empresa debe completar su CIF y su correo de contacto (PRIVACY_CIF, PRIVACY_EMAIL, PRIVACY_TITULAR, PRIVACY_DIRECCION)
// y conviene que lo revise su gestoría.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function privacidadHtml({ titular = "Distribuciones Valentín Martín", cif = "", direccion = "Medina del Campo (Valladolid)", email = "" } = {}) {
  const contacto = email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : "el establecimiento (datos de contacto en tu factura)";
  return `<details class="priv" style="font-size:13px;line-height:1.5;color:#555;margin:12px 0"><summary style="cursor:pointer;font-weight:600">Información sobre privacidad (protección de datos)</summary>
<ul style="margin:8px 0 0;padding-left:18px">
<li><b>Responsable:</b> ${esc(titular)}${cif ? ` · CIF ${esc(cif)}` : ""} · ${esc(direccion)} · Contacto: ${contacto}.</li>
<li><b>Para qué usamos tus datos:</b> gestionar tu acceso, tus pedidos, su entrega y facturación, y atender tu solicitud de alta como cliente.</li>
<li><b>Por qué podemos hacerlo:</b> es necesario para la relación comercial contigo (art. 6.1.b RGPD) y para cumplir obligaciones legales como la facturación (art. 6.1.c).</li>
<li><b>Qué datos:</b> nombre del negocio, teléfono, correo, dirección de entrega e historial de compras. <b>Tu DNI/CIF no se guarda</b>: solo una huella cifrada de sus 6 primeros dígitos para comprobar tu acceso. Tampoco guardamos tu PIN en claro.</li>
<li><b>Cuánto tiempo:</b> mientras seas cliente y, después, durante los plazos que exige la ley (fiscales y mercantiles).</li>
<li><b>A quién se comunican:</b> a nadie, salvo obligación legal. Usamos proveedores técnicos (correo, copias de seguridad) que tratan los datos por encargo nuestro y bajo contrato.</li>
<li><b>Cookies:</b> solo una cookie técnica imprescindible para mantener tu sesión iniciada. No usamos cookies de publicidad ni de seguimiento.</li>
<li><b>Tus derechos:</b> acceder a tus datos, rectificarlos, suprimirlos, oponerte, limitar su uso y pedir su portabilidad, escribiendo a ${contacto}. Si crees que no tratamos bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es" target="_blank" rel="noopener">aepd.es</a>).</li>
</ul></details>`;
}
