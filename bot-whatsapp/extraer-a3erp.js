#!/usr/bin/env node
// Extractor de a3ERP: lee la base de la empresa (una copia restaurada en SQL Server, SOLO LECTURA) y deja los tres Excel que lee la web
// desde la carpeta «datos» de Drive: clientes.xlsx, productos.xlsx y historial-ventas.xlsx (ver docs/GOOGLE_DRIVE.md).
//
// Uso:   node extraer-a3erp.js --db VALENTIN --salida ./salida-datos [--meses 12]
// Conexión (variable SQLCMD_JSON = comando de sqlcmd como lista JSON, sin -d ni -Q). Ejemplos:
//   Servidor con SQL Server:  SQLCMD_JSON='["sqlcmd","-S",".\\A3ERP","-E","-C"]'
//   SQL Server en Docker:     SQLCMD_JSON='["docker","exec","-i","sql","/opt/mssql-tools18/bin/sqlcmd","-C","-S","localhost","-U","sa","-P","…"]'
//
// Solo se ejecutan SELECT fijos (nada de SQL generado a partir de texto externo). Los Excel contienen datos de clientes (incluido el NIF):
// la carpeta de salida NO debe subirse a GitHub.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildXlsx } from "./xlsx.js";

// Texto limpio: sin espacios sobrantes, sin NULL y sin saltos de línea ni tabuladores (que romperían el formato de salida).
const T = (x) => `REPLACE(REPLACE(REPLACE(ISNULL(LTRIM(RTRIM(${x})),''),CHAR(9),' '),CHAR(13),' '),CHAR(10),' ')`;
const SI_NO = (cond) => `CASE WHEN ${cond} THEN 'Sí' ELSE 'No' END`;

export const CONSULTAS = {
  clientes: {
    cabecera: ["Cód. cliente", "Organización", "Razón social / Nombre fiscal de la organización", "Población", "Cód. municipio", "Dirección fiscal", "Teléfono", "E-Mail", "NIF", "Bloqueado", "Obsoleto"],
    sql: () => `SELECT ${T("c.CODCLI")}, ${T("o.NOMBRE")}, ${T("o.NOMFISCAL")}, ${T("ISNULL(NULLIF(LTRIM(RTRIM(o.POBLACION)),''),o.MUNICIPIO)")},
      ${T("ISNULL(NULLIF(LTRIM(RTRIM(o.CODMUNICIPIO)),''),o.CODMUNICIPIOFISCAL)")}, ${T("o.DIRFISCAL")},
      ${T("CONCAT_WS(' / ',NULLIF(LTRIM(RTRIM(o.TELEFONO)),''),NULLIF(LTRIM(RTRIM(o.TELEFONO2)),''),NULLIF(LTRIM(RTRIM(o.TELEFONOFISCAL)),''))")},
      ${T("CONCAT_WS(' ; ',NULLIF(LTRIM(RTRIM(o.E_MAIL)),''),NULLIF(LTRIM(RTRIM(o.EMAILFISCAL)),''))")}, ${T("o.NIF")},
      ${SI_NO("c.BLOQUEADO='T' OR o.BLOQUEADO_ORG='T'")}, ${SI_NO("o.OBSOLETO='T'")}
      FROM __CLIENTES c JOIN __ORGANIZACION o ON o.IDORG=c.IDORG ORDER BY c.CODCLI`,
    // Todos los textos; ninguno es número
    numericas: [],
  },
  // Precio = el de la ficha (la «Tarifa al por mayor» que usan todos los clientes); unidades por caja = «unidades por paquete de venta»;
  // IVA: ORD21 = 21 %, RED10 = 10 %, SRE (superreducido) = 4 %.
  productos: {
    cabecera: ["Código", "Descripción", "Precio", "Uds. por caja", "% IVA", "Dto.", "Bloqueado", "Obsoleto"],
    sql: () => `SELECT ${T("CODART")}, ${T("DESCART")}, CAST(ROUND(ISNULL(PRCVENTA,0),4) AS varchar(30)),
      CASE WHEN ISNULL(UNIPAQV,0)>0 THEN CAST(UNIPAQV AS varchar(30)) ELSE '' END,
      CASE LTRIM(RTRIM(TIPIVA)) WHEN 'ORD21' THEN '21' WHEN 'RED10' THEN '10' WHEN 'SRE' THEN '4' ELSE '' END,
      CAST(ROUND(ISNULL(DESC1,0),4) AS varchar(30)),
      ${SI_NO("BLOQUEADO='T' OR ESVENTA='F'")}, ${SI_NO("OBSOLETO='T'")}
      FROM ARTICULO WHERE ISNULL(LTRIM(RTRIM(CODART)),'')<>'' ORDER BY CODART`,
    numericas: [2, 3, 4, 5],
  },
  // Líneas de factura de venta de los últimos N meses (contados desde la última factura de la copia); los abonos (cantidad negativa) no entran.
  historial: {
    cabecera: ["Cód. cliente", "Fecha", "Documento", "Cód. artículo", "Cantidad"],
    sql: (meses) => `SELECT ${T("c.CODCLI")}, CONVERT(varchar(10),c.FECHA,23), ${T("CONCAT(NULLIF(LTRIM(RTRIM(c.SERIE)),'')+'-',CAST(CAST(c.NUMDOC AS bigint) AS varchar(20)))")}, ${T("l.CODART")}, CAST(l.UNIDADES AS varchar(30))
      FROM LINEFACT l JOIN CABEFACV c ON c.IDFACV=l.IDFACV
      WHERE c.FECHA>=DATEADD(MONTH,-${Number(meses) | 0},(SELECT MAX(FECHA) FROM CABEFACV)) AND l.UNIDADES>0 AND ISNULL(LTRIM(RTRIM(l.CODART)),'')<>''
      ORDER BY c.CODCLI, c.FECHA, c.NUMDOC`,
    numericas: [4],
  },
};

/** Ejecuta un SELECT y devuelve las filas (arrays de texto). Falla con un mensaje claro si sqlcmd da error. */
export function consultar(cmd, db, sql) {
  const [bin, ...args] = cmd;
  const r = spawnSync(bin, [...args, "-d", db, "-h", "-1", "-W", "-w", "65535", "-s", "\t"], {
    input: `SET NOCOUNT ON;\n${sql}\nGO\n`, encoding: "utf8", maxBuffer: 1 << 30,
  });
  if (r.error) throw new Error(`No se pudo ejecutar ${bin}: ${r.error.message}`);
  if (r.status !== 0 || /^Msg \d+, Level \d+/m.test(r.stdout)) throw new Error(`Error de SQL Server: ${(r.stdout || r.stderr).split("\n").slice(0, 4).join(" ")}`);
  return r.stdout.split(/\r?\n/).filter((l) => l.length).map((l) => l.split("\t"));
}

/** Excel de un conjunto: cabecera en negrita y las columnas numéricas como número. */
export function aExcel(def, filas, nombre) {
  const num = new Set(def.numericas);
  const rows = [def.cabecera, ...filas.map((f) => f.map((v, i) => (num.has(i) && v !== "" && Number.isFinite(Number(v)) ? Number(v) : v)))];
  return buildXlsx(rows, { sheetName: nombre, widths: def.cabecera.map(() => 18) });
}

function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const db = arg("db", "VALENTIN");
  const salida = arg("salida", "./salida-datos");
  const meses = Number(arg("meses", "12"));
  const cmd = JSON.parse(process.env.SQLCMD_JSON ?? '["sqlcmd","-S",".","-E","-C"]');
  fs.mkdirSync(salida, { recursive: true });
  const ficheros = { clientes: "clientes.xlsx", productos: "productos.xlsx", historial: "historial-ventas.xlsx" };
  for (const [tipo, def] of Object.entries(CONSULTAS)) {
    const filas = consultar(cmd, db, def.sql(meses));
    const mal = filas.filter((f) => f.length !== def.cabecera.length);
    if (mal.length) throw new Error(`${tipo}: ${mal.length} filas con un número de columnas distinto de ${def.cabecera.length} (ej.: ${JSON.stringify(mal[0]).slice(0, 200)})`);
    if (!filas.length) throw new Error(`${tipo}: la consulta no devolvió ninguna fila`);
    // Escritura atómica: un corte no deja un Excel a medias en la carpeta que lee la web
    const destino = path.join(salida, ficheros[tipo]);
    fs.writeFileSync(destino + ".tmp", aExcel(def, filas, tipo));
    fs.renameSync(destino + ".tmp", destino);
    console.log(`${ficheros[tipo]}: ${filas.length} filas`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch (e) { console.error("ERROR:", e.message); process.exit(1); }
}
