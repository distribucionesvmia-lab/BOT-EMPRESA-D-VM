// Pega este código en Google Apps Script (ver README, sección "Base de datos de pedidos").
// Cada pedido del bot se añade como una fila nueva en la hoja.

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || data.secret !== secret) return ContentService.createTextOutput("forbidden");

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Fecha", "Teléfono", "Código cliente", "Nombre","Dirección", "Pedido (texto del cliente)", "Interpretado", "Total", "Estado"]);
  }
  const interpretado = (data.items || []).map((i) => i.qty + " × " + i.name).join(", ");
  sheet.appendRow([
    new Date(data.at),
    "+" + data.phone,
    data.customerId || "cliente nuevo",
    data.name,
    data.address,
    data.text,
    interpretado,
    data.total == null ? "por revisar" : data.total,
    data.review ? "Nuevo · REVISAR" : "Nuevo",
  ]);
  return ContentService.createTextOutput("ok");
}
