// Información de protección de datos (RGPD, art. 13) que se enseña en la pantalla de acceso y en la solicitud de alta.
// Es un texto estándar: la empresa debe completar su CIF y su correo de contacto (PRIVACY_CIF, PRIVACY_EMAIL, PRIVACY_TITULAR, PRIVACY_DIRECCION)
// y conviene que lo revise su gestoría.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function privacidadHtml({ titular = "Distribuciones Valentín Martín", cif = "", direccion = "Medina del Campo (Valladolid)", email = "" } = {}) {
  const contacto = email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : "el establecimiento (datos de contacto en tu factura)";
  return `<details class="priv" style="font-size:13px;line-height:1.5;color:var(--text-2,#555);margin:12px 0"><summary style="cursor:pointer;font-weight:600">Información sobre privacidad (protección de datos)</summary>
<ul style="margin:8px 0 0;padding-left:18px">
<li><b>Responsable:</b> ${esc(titular)}${cif ? ` · CIF ${esc(cif)}` : ""} · ${esc(direccion)} · Contacto: ${contacto}.</li>
<li><b>Para qué usamos tus datos:</b> gestionar tu acceso, tus pedidos, su entrega y facturación, y atender tu solicitud de alta como cliente.</li>
<li><b>Por qué podemos hacerlo:</b> es necesario para la relación comercial contigo (art. 6.1.b RGPD) y para cumplir obligaciones legales como la facturación (art. 6.1.c).</li>
<li><b>Qué datos:</b> nombre del negocio, teléfono, correo, dirección de entrega e historial de compras. <b>Tu DNI/CIF no se guarda</b> de forma permanente: solo una huella cifrada de sus 6 primeros dígitos para comprobar tu acceso. Si pides el alta como cliente nuevo, se guarda en tu solicitud únicamente hasta que la empresa la resuelve y entonces se borra. Tu código de entrada se guarda solo transformado con una función de cifrado irreversible (un «hash» con sal propia): nadie, ni siquiera la empresa, puede leerlo, y nunca se guarda en texto legible.</li>
<li><b>Cuánto tiempo:</b> mientras seas cliente y, después, durante los plazos que exige la ley (fiscales y mercantiles). Si eliminas tu cuenta, se borran tu acceso, tu teléfono y correo de la aplicación y tus favoritos; los pedidos y facturas ya hechos se conservan bloqueados el tiempo que obliga la ley.</li>
<li><b>A quién se comunican:</b> a nadie, salvo obligación legal. Usamos proveedores técnicos (correo, copias de seguridad) que tratan los datos por encargo nuestro y bajo contrato.</li>
<li><b>Cookies:</b> solo una cookie técnica imprescindible para mantener tu sesión iniciada. No usamos cookies de publicidad ni de seguimiento.</li>
<li><b>Tus derechos:</b> acceder a tus datos, rectificarlos, suprimirlos, oponerte, limitar su uso y pedir su portabilidad. <b>Puedes ejercerlos tú mismo dentro de la aplicación</b> (menú ⋮ → «Mis datos y privacidad»): descargar todos tus datos, pedirnos que los corrijamos, limitemos o dejemos de usarlos, y eliminar tu cuenta. Te contestaremos en el plazo máximo de un mes. También puedes escribir a ${contacto}. Si crees que no tratamos bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es" target="_blank" rel="noopener">aepd.es</a>).</li>
</ul></details>`;
}

/** Aviso legal (datos del titular que exige la ley de servicios de la sociedad de la información, art. 10 LSSI). Texto estándar: conviene que lo revise la gestoría. */
export function avisoLegalHtml({ titular = "Distribuciones Valentín Martín", cif = "", direccion = "Medina del Campo (Valladolid)", email = "" } = {}) {
  const contacto = email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : "el establecimiento (datos de contacto en tu factura)";
  return `<details class="priv" style="font-size:13px;line-height:1.5;color:var(--text-2,#555);margin:12px 0"><summary style="cursor:pointer;font-weight:600">Aviso legal</summary>
<ul style="margin:8px 0 0;padding-left:18px">
<li><b>Titular:</b> ${esc(titular)}${cif ? ` · CIF ${esc(cif)}` : ""} · Domicilio: ${esc(direccion)} · Contacto: ${contacto}.</li>
<li><b>Qué es esta aplicación:</b> un servicio para que nuestros clientes consulten el catálogo y hagan sus pedidos. El acceso es personal y no se debe compartir.</li>
<li><b>Precios y pedidos:</b> los precios mostrados son informativos y se confirman en la factura. Un pedido hecho aquí lo revisa y prepara la empresa; el PDF del pedido no es una factura.</li>
<li><b>Contenidos:</b> las marcas, fotos y textos pertenecen a sus titulares. No se pueden copiar ni usar con fines comerciales sin permiso.</li>
<li><b>Responsabilidad:</b> hacemos lo posible por que la información sea correcta y esté al día, pero puede haber errores o interrupciones puntuales del servicio.</li>
<li><b>Ley aplicable:</b> la legislación española. Para cualquier duda, llámanos o escribe a ${contacto}.</li>
</ul></details>`;
}
