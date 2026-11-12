# Carga inicial: que el programa nazca con todos los datos

La primera vez que se instala en el ordenador de la oficina no hay que meter nada a mano: se copia una carpeta con los archivos de partida y el instalador (o `cargar-inicial.bat`) lo carga todo de una vez. A partir de ahí, solo se suben **actualizaciones** desde el panel («Datos y Excel»).

## Qué lleva la carpeta (`C:\vm\inicial`)
| Archivo | Para qué |
|---|---|
| `articulos_….xlsx` | Excel de artículos de a3ERP (con «MODO DE VENTA», bloqueados y obsoletos) |
| `CLIENTES_….xlsx` | Excel de clientes de a3ERP |
| `descuentos.json` | Descuento de la tarifa por artículo |
| `fotos.zip` + `fotos-ia.json` | Fotos de los artículos (`<código>.png/jpg`) y cuáles están hechas con IA |
| `historial-….xlsx` (varios) | Historial de compras (aquí, solo el de los clientes de prueba) |
| `prueba.json` + carpeta `prueba\` | Clientes FICTICIOS de prueba (Pablo Martín) con su historial: se quitarán más adelante |

Los archivos llevan **datos reales de clientes y de la tarifa: nunca se suben a GitHub** (la carpeta `inicial/` está en `.gitignore`).

## Cómo se instala
1. Copia la carpeta `inicial` entera a `C:\vm\inicial` (por AnyDesk, USB…).
2. Ejecuta `instalar-todo.bat` como siempre: crea las claves, **carga los datos iniciales** y arranca el programa.
   - Si ya estaba instalado, ejecuta solo `deploy\windows\cargar-inicial.bat`.
3. Abre `http://localhost:3001/empresa` y comprueba: clientes, catálogo con fotos y el cliente de prueba entrando con su DNI.

## Por qué se carga en el ordenador y no va ya hecha la base de datos
Los códigos de acceso de los clientes (las «huellas» del DNI/CIF) se calculan con la clave `NIF_PEPPER`, que se genera al instalar y no se puede cambiar. Por eso la base de clientes se construye allí, con los mismos archivos y las mismas reglas que el panel.

## Se puede repetir
Usa la misma comparación que «Datos y Excel»: lo que ya está igual no se toca, no se duplica nada y cada tipo de archivo se reconoce solo. Si algo no se puede cargar, lo dice y sigue con lo demás.

## Después: solo actualizaciones
Cuando salga un Excel nuevo de artículos o de clientes, súbelo en «Datos y Excel»: te enseña solo lo que cambia y, si no hay nada nuevo, te lo dice.
