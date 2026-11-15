/* =====================================================================================================================
   Consultas que lee la exportación automática de a3ERP (Distribuciones Valentín Martín).
   SOLO SELECT. Nada de INSERT, UPDATE, DELETE ni procedimientos. Base: VALENTIN.
   Tablas que toca: __CLIENTES, __ORGANIZACION, ARTICULO, CABEFACV, LINEFACT  (nada de contabilidad, bancos ni nóminas).
   Cada consulta devuelve las columnas con el nombre exacto que espera la web; de cada una sale un Excel.
   ===================================================================================================================== */

/* ---------- 0. Usuario de SOLO LECTURA, limitado a esas cinco tablas (lo ejecuta quien administre SQL Server, una vez) ---------- */
-- CREATE LOGIN vm_lectura WITH PASSWORD = 'una-clave-larga-y-secreta';
-- USE VALENTIN;
-- CREATE USER vm_lectura FOR LOGIN vm_lectura;
-- GRANT SELECT ON dbo.__CLIENTES      TO vm_lectura;
-- GRANT SELECT ON dbo.__ORGANIZACION  TO vm_lectura;
-- GRANT SELECT ON dbo.ARTICULO        TO vm_lectura;
-- GRANT SELECT ON dbo.CABEFACV        TO vm_lectura;
-- GRANT SELECT ON dbo.LINEFACT        TO vm_lectura;
-- (Para quitarlo del todo:  DROP USER vm_lectura;  DROP LOGIN vm_lectura;)

SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;   -- leer no bloquea a a3ERP mientras se trabaja

/* ---------- 1. CLIENTES  →  clientes.xlsx ---------- */
SELECT LTRIM(RTRIM(c.CODCLI))                                                         AS [Cód. cliente],
       o.NOMBRE                                                                       AS [Organización],
       o.NOMFISCAL                                                                    AS [Razón social / Nombre fiscal de la organización],
       ISNULL(NULLIF(LTRIM(RTRIM(o.POBLACION)), ''), o.MUNICIPIO)                     AS [Población],
       ISNULL(NULLIF(LTRIM(RTRIM(o.CODMUNICIPIO)), ''), o.CODMUNICIPIOFISCAL)         AS [Cód. municipio],
       o.DIRFISCAL                                                                    AS [Dirección fiscal],
       CONCAT_WS(' / ', NULLIF(LTRIM(RTRIM(o.TELEFONO)), ''), NULLIF(LTRIM(RTRIM(o.TELEFONO2)), ''), NULLIF(LTRIM(RTRIM(o.TELEFONOFISCAL)), '')) AS [Teléfono],
       CONCAT_WS(' ; ', NULLIF(LTRIM(RTRIM(o.E_MAIL)), ''), NULLIF(LTRIM(RTRIM(o.EMAILFISCAL)), ''))                                            AS [E-Mail],
       o.NIF                                                                          AS [NIF],
       CASE WHEN c.BLOQUEADO = 'T' OR o.BLOQUEADO_ORG = 'T' THEN 'Sí' ELSE 'No' END   AS [Bloqueado],
       CASE WHEN o.OBSOLETO = 'T' THEN 'Sí' ELSE 'No' END                             AS [Obsoleto]
FROM dbo.__CLIENTES c
JOIN dbo.__ORGANIZACION o ON o.IDORG = c.IDORG
ORDER BY c.CODCLI;

/* ---------- 2. ARTÍCULOS  →  productos.xlsx ----------
   Precio = precio de venta de la ficha (la «Tarifa al por mayor»); unidades por caja = unidades por paquete de venta;
   IVA: ORD21 = 21 %, RED10 = 10 %, SRE = 4 %. */
SELECT LTRIM(RTRIM(CODART))                                                           AS [Código],
       LTRIM(RTRIM(DESCART))                                                          AS [Descripción],
       ROUND(ISNULL(PRCVENTA, 0), 4)                                                  AS [Precio],
       CASE WHEN ISNULL(UNIPAQV, 0) > 0 THEN UNIPAQV END                              AS [Uds. por caja],
       CASE LTRIM(RTRIM(TIPIVA)) WHEN 'ORD21' THEN 21 WHEN 'RED10' THEN 10 WHEN 'SRE' THEN 4 END AS [% IVA],
       ROUND(ISNULL(DESC1, 0), 4)                                                     AS [Dto.],
       CASE WHEN BLOQUEADO = 'T' OR ESVENTA = 'F' THEN 'Sí' ELSE 'No' END            AS [Bloqueado],
       CASE WHEN OBSOLETO = 'T' THEN 'Sí' ELSE 'No' END                              AS [Obsoleto]
FROM dbo.ARTICULO
WHERE ISNULL(LTRIM(RTRIM(CODART)), '') <> ''
ORDER BY CODART;

/* ---------- 3. HISTORIAL DE VENTAS  →  historial-ventas.xlsx ----------
   Líneas de factura de venta de los últimos 12 meses (contados desde la última factura); los abonos (cantidad negativa) no entran. */
SELECT LTRIM(RTRIM(c.CODCLI))                                                         AS [Cód. cliente],
       CONVERT(varchar(10), c.FECHA, 23)                                              AS [Fecha],
       CONCAT(NULLIF(LTRIM(RTRIM(c.SERIE)), '') + '-', CAST(CAST(c.NUMDOC AS bigint) AS varchar(20))) AS [Documento],
       LTRIM(RTRIM(l.CODART))                                                         AS [Cód. artículo],
       l.UNIDADES                                                                     AS [Cantidad]
FROM dbo.LINEFACT l
JOIN dbo.CABEFACV c ON c.IDFACV = l.IDFACV
WHERE c.FECHA >= DATEADD(MONTH, -12, (SELECT MAX(FECHA) FROM dbo.CABEFACV))
  AND l.UNIDADES > 0
  AND ISNULL(LTRIM(RTRIM(l.CODART)), '') <> ''
ORDER BY c.CODCLI, c.FECHA, c.IDFACV, l.IDLIN;
