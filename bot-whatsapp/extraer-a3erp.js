#!/usr/bin/env node
// Extractor de a3ERP: lee la base de la empresa (una copia restaurada en SQL Server, SOLO LECTURA) y deja los tres Excel que lee la web
// desde la carpeta «datos» de Drive: clientes.xlsx, productos.xlsx y historial-ventas.xlsx (ver docs/GOOGLE_DRIVE.md).
//
// Uso:   node extraer-a3erp.js --db VALENTIN --salida ./salida-datos [--meses 12]
// Conexión, de dos formas:
//  · Servidor de la oficina (Windows, lo normal): PowerShell + cliente de SQL Server que ya trae Windows. Variables de entorno:
//      A3_SQL_SERVER=SRVVALENTIN\A3ERP   (obligatoria)   A3_SQL_USER / A3_SQL_PASS (opcionales; sin ellas, la cuenta de Windows)
//  · sqlcmd (pruebas, Docker): SQLCMD_JSON = comando de sqlcmd como lista JSON, sin -d ni -Q. Ejemplos:
//      SQLCMD_JSON='["sqlcmd","-S",".\\A3ERP","-E","-C"]'
//      SQLCMD_JSON='["docker","exec","-i","sql","/opt/mssql-tools18/bin/sqlcmd","-C","-S","localhost","-U","sa","-P","…"]'
// Cada consulta se ejecuta en READ UNCOMMITTED: leer no bloquea a a3ERP mientras se trabaja.
//
// Solo se ejecutan SELECT fijos (nada de SQL generado a partir de texto externo). Los Excel contienen datos de clientes (incluido el NIF):
// la carpeta de salida NO debe subirse a GitHub.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildXlsx } from "./xlsx.js";

// Texto limpio: sin espacios sobrantes, sin NULL y sin saltos de línea, tabuladores ni «|» (que romperían el formato de salida).
const T = (x) => `REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(LTRIM(RTRIM(${x})),''),CHAR(9),' '),CHAR(13),' '),CHAR(10),' '),CHAR(124),' ')`; // también quita «|», el separador del texto de sqlcmd
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
      ORDER BY c.CODCLI, c.FECHA, c.IDFACV, l.IDLIN`,
    numericas: [4],
  },
};

/** Consulta lista para ejecutar con sqlcmd (-h -1 -W -s "|" -f 65001 -i fichero -o salida.csv): primera línea con los títulos y después las filas. */
export function sqlParaSqlcmd(tipo, meses = 12) {
  const def = CONSULTAS[tipo];
  return `SET NOCOUNT ON;\nSET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\nPRINT '${def.cabecera.join("|").replace(/'/g, "''")}';\n${def.sql(meses).replace(/\n\s+/g, "\n")};\n`;
}

const PS1 = path.join(path.dirname(fileURLToPath(import.meta.url)), "deploy", "windows", "consulta-sql.ps1");
const ANTES = "SET NOCOUNT ON;\nSET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\n";

/** Conexión a partir del entorno: PowerShell si hay A3_SQL_SERVER; si no, sqlcmd (SQLCMD_JSON o el de por defecto). */
export function conexionDeEntorno(env = process.env) {
  if (env.A3_SQL_SERVER) return { powershell: true, servidor: env.A3_SQL_SERVER, usuario: env.A3_SQL_USER ?? "", clave: env.A3_SQL_PASS ?? "" };
  return { sqlcmd: JSON.parse(env.SQLCMD_JSON ?? '["sqlcmd","-S",".","-E","-C"]') };
}

/** Ejecuta un SELECT y devuelve las filas (arrays de texto). `conexion` es la de conexionDeEntorno, o directamente la lista de sqlcmd. */
export function consultar(conexion, db, sql) {
  const c = Array.isArray(conexion) ? { sqlcmd: conexion } : conexion;
  let bin, args, input;
  if (c.powershell) {
    bin = process.env.POWERSHELL_BIN ?? (process.platform === "win32" ? "powershell" : "pwsh");
    args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", PS1, "-Servidor", c.servidor, "-Base", db];
    if (c.usuario) args.push("-Usuario", c.usuario, "-Clave", c.clave);
    input = ANTES + sql;
  } else {
    [bin, ...args] = c.sqlcmd;
    args = [...args, "-d", db, "-h", "-1", "-W", "-w", "65535", "-s", "\t"];
    input = `${ANTES}${sql}\nGO\n`;
  }
  const r = spawnSync(bin, args, { input, encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.error) throw new Error(`No se pudo ejecutar ${bin}: ${r.error.message}`);
  if (r.status !== 0 || /^Msg \d+, Level \d+/m.test(r.stdout)) throw new Error(`Error de SQL Server: ${(r.stderr || r.stdout).split("\n").filter(Boolean).slice(0, 4).join(" ")}`);
  return r.stdout.split(/\r?\n/).filter((l) => l.length).map((l) => l.split("\t"));
}

/** Excel de un conjunto: cabecera en negrita y las columnas numéricas como número. */
export function aExcel(def, filas, nombre) {
  const num = new Set(def.numericas);
  const rows = [def.cabecera, ...filas.map((f) => f.map((v, i) => (num.has(i) && v !== "" && Number.isFinite(Number(v)) ? Number(v) : v)))];
  return buildXlsx(rows, { sheetName: nombre, widths: def.cabecera.map(() => 18) });
}

function escribirSql(dir, meses) {
  fs.mkdirSync(dir, { recursive: true });
  for (const tipo of Object.keys(CONSULTAS)) fs.writeFileSync(path.join(dir, `exportar-${tipo}.sql`), "\uFEFF" + sqlParaSqlcmd(tipo, meses).replace(/\n/g, "\r\n"));
  console.log(`Escritas ${Object.keys(CONSULTAS).length} consultas en ${dir}`);
}

function main() {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  if (process.argv.includes("--escribir-sql")) return escribirSql(arg("escribir-sql", "./sql"), Number(arg("meses", "12")));
  const db = arg("db", process.env.A3_DB ?? "VALENTIN");
  const salida = arg("salida", process.env.CARPETA_DATOS ?? "./salida-datos");
  const meses = Number(arg("meses", process.env.MESES_HISTORIAL ?? "12"));
  const cmd = conexionDeEntorno();
  fs.mkdirSync(salida, { recursive: true });
  const ficheros = { clientes: "clientes.xlsx", productos: "productos.xlsx", historial: "historial-ventas.xlsx" };
  for (const [tipo, def] of Object.entries(CONSULTAS)) {
    const filas = consultar(cmd, db, def.sql(meses));
    const mal = filas.filter((f) => f.length !== def.cabecera.length);
    if (mal.length) throw new Error(`${tipo}: ${mal.length} filas con un número de columnas distinto de ${def.cabecera.length} (ej.: ${JSON.stringify(mal[0]).slice(0, 200)})`);
    if (!filas.length) throw new Error(`${tipo}: la consulta no devolvió ninguna fila`);
    const destino = path.join(salida, ficheros[tipo]);
    const excel = aExcel(def, filas, tipo);
    // Si no ha cambiado nada, no se toca el fichero: así Drive no lo vuelve a subir y la web no lo vuelve a importar
    if (fs.existsSync(destino) && fs.readFileSync(destino).equals(excel)) { console.log(`${ficheros[tipo]}: ${filas.length} filas, sin cambios`); continue; }
    // Escritura atómica: un corte no deja un Excel a medias en la carpeta que lee la web
    fs.writeFileSync(destino + ".tmp", excel);
    fs.renameSync(destino + ".tmp", destino);
    console.log(`${ficheros[tipo]}: ${filas.length} filas, ACTUALIZADO`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch (e) { console.error("ERROR:", e.message); process.exit(1); }
}
