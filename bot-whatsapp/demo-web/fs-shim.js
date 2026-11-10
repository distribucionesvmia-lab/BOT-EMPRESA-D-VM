// «fs» y «path» vacíos: en el navegador no se usan (la demo no guarda fotos ni ficheros).
export const existsSync = () => false, readFileSync = () => { throw new Error("sin ficheros en el navegador"); }, writeFileSync = () => {}, mkdirSync = () => {}, appendFileSync = () => {}, join = (...p) => p.join("/"), basename = (p) => String(p).split("/").pop();
export default { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, join, basename };
