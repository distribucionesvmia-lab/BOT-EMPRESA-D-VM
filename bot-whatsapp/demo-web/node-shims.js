// Piezas mínimas de Node para que el lector de Excel y el actualizador de datos funcionen DENTRO del navegador (demo en el artefacto).
// Solo se enlazan al compilar la demo (build.mjs); el programa real usa el Node de verdad.
import { sha256hex } from "./sha256.js";

const dec = new TextDecoder();
export class Buffer extends Uint8Array {
  static from(x) { return x instanceof ArrayBuffer ? new Buffer(x) : new Buffer(Array.isArray(x) || ArrayBuffer.isView(x) ? x : new TextEncoder().encode(String(x))); }
  static concat(l) { const o = new Buffer(l.reduce((n, b) => n + b.length, 0)); let p = 0; for (const b of l) { o.set(b, p); p += b.length; } return o; }
  readUInt16LE(i) { return this[i] | (this[i + 1] << 8); }
  readUInt32LE(i) { return (this[i] | (this[i + 1] << 8) | (this[i + 2] << 16) | (this[i + 3] << 24)) >>> 0; }
  toString(_enc, s = 0, e = this.length) { return dec.decode(this.subarray(s, e)); }
  equals(o) { return this.length === o.length && this.every((v, i) => v === o[i]); }
}

// Inflate (RFC 1951) en JavaScript puro
function inflateRaw(src) {
  let pos = 0, bit = 0, cur = 0;
  const out = [];
  const bits = (n) => { while (bit < n) { cur |= src[pos++] << bit; bit += 8; } const v = cur & ((1 << n) - 1); cur >>>= n; bit -= n; return v; };
  const build = (lens) => { const count = new Array(16).fill(0), offs = new Array(16).fill(0), sym = []; lens.forEach((l) => count[l]++); count[0] = 0; for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1]; lens.forEach((l, s) => { if (l) sym[offs[l]++] = s; }); return { count, sym }; };
  const decode = (h) => { let code = 0, first = 0, index = 0; for (let len = 1; len < 16; len++) { code |= bits(1); const c = h.count[len]; if (code - c < first) return h.sym[index + (code - first)]; index += c; first += c; first <<= 1; code <<= 1; } throw new Error("Excel dañado"); };
  const LB = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258], LE = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DB = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577], DE = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  let fixed = null;
  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) { bit = 0; cur = 0; const len = src[pos] | (src[pos + 1] << 8); pos += 4; for (let i = 0; i < len; i++) out.push(src[pos++]); continue; }
    let lit, dist;
    if (type === 1) { if (!fixed) { const l = []; for (let i = 0; i < 288; i++) l.push(i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8); fixed = [build(l), build(new Array(30).fill(5))]; } [lit, dist] = fixed; }
    else if (type === 2) {
      const nl = bits(5) + 257, nd = bits(5) + 1, nc = bits(4) + 4, ord = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], cl = new Array(19).fill(0);
      for (let i = 0; i < nc; i++) cl[ord[i]] = bits(3);
      const ch = build(cl), lens = [];
      while (lens.length < nl + nd) { const s = decode(ch); if (s < 16) lens.push(s); else { let rep, v = 0; if (s === 16) { v = lens[lens.length - 1]; rep = 3 + bits(2); } else if (s === 17) rep = 3 + bits(3); else rep = 11 + bits(7); while (rep--) lens.push(v); } }
      lit = build(lens.slice(0, nl)); dist = build(lens.slice(nl));
    } else throw new Error("Excel dañado");
    for (;;) {
      const s = decode(lit);
      if (s < 256) out.push(s);
      else if (s === 256) break;
      else { const l = LB[s - 257] + bits(LE[s - 257]), ds = decode(dist), d = DB[ds] + bits(DE[ds]); for (let i = 0; i < l; i++) out.push(out[out.length - d]); }
    }
  } while (!last);
  return Buffer.from(out);
}
export const inflateRawSync = (b) => inflateRaw(b);
// «crypto»: solo lo que importa nif-key.js. En la demo las huellas de NIF no se calculan con esto.
export const createHmac = (_a, k) => { let d = String(k); return { update(s) { d += "|" + s; return this; }, digest: () => sha256hex(d) }; };
export const timingSafeEqual = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export default { inflateRawSync, createHmac, timingSafeEqual };
