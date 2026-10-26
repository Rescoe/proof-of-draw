// ota-format.mjs — format « .ota » d'Arduino pour l'UNO R4 WiFi, tel que LU dans le code du module (Arduino_ESP32_OTA, branche main, consultée le 16/10/2026).
//   fichier  = en-tête de 20 octets ‖ flux LZSS
//   en-tête  = len u32 LE ‖ crc32 u32 LE ‖ magic u32 LE (R4 : 0x23411002) ‖ version 8 octets (champ « signature » 1 bit + cible + x.y.z + build : JAMAIS lus par le module)
//   crc32    = CRC-32 standard (zlib) calculé sur magic ‖ version (12 octets) ‖ flux LZSS compressé ; `len` n'entre pas dans le CRC et n'est jamais comparé à rien
//   LZSS     = EI = 11, EJ = 4 (fenêtre 2048, copie de 2 à 17 octets), anneau initialisé à des espaces ; bit 1 + 8 bits = littéral ; bit 0 + 11 bits (indice) + 4 bits (longueur-2) = copie
// Rien ici n'est une signature : le CRC protège de la corruption, pas d'un faussaire (il se recalcule en une ligne).
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

export const R4_MAGIC = 0x23411002, ESP32_MAGIC = 0x23410070, EI = 11, EJ = 4, N = 1 << EI, F = (1 << EJ) + 1, HEADER = 20;

export const sha256 = (b) => createHash("sha256").update(b).digest("hex");
export const crc = (...parts) => crc32(Buffer.concat(parts.map((p) => Buffer.from(p)))) >>> 0;

class BitWriter {
  constructor() { this.out = []; this.acc = 0; this.n = 0; }
  put(value, bits) { for (let i = bits - 1; i >= 0; i--) { this.acc = (this.acc << 1) | ((value >> i) & 1); if (++this.n === 8) { this.out.push(this.acc); this.acc = 0; this.n = 0; } } }
  finish() { if (this.n) { this.out.push(this.acc << (8 - this.n)); this.acc = 0; this.n = 0; } return Buffer.from(this.out); }   // bourrage à zéro (< 8 bits) : le décodeur s'arrête faute de bits
}

/** Encodeur « littéraux seuls » : valide pour le décodeur du module, 9 bits par octet (≈ +12,5 %). Linéaire : c'est celui des fichiers de laboratoire. */
export function lzssEncodeLiterals(data) {
  const w = new BitWriter();
  for (const b of data) { w.put(1, 1); w.put(b, 8); }
  return w.finish();
}

/** Encodeur glouton AVEC copies (tests seulement : O(n · N · F)) — exerce le chemin « copie » du décodeur. */
export function lzssEncodeGreedy(data) {
  const w = new BitWriter(); const ring = Buffer.alloc(N, 0x20); let r = N - F;
  const put = (c) => { ring[r] = c; r = (r + 1) & (N - 1); };
  let p = 0;
  while (p < data.length) {
    let bestLen = 0, bestIdx = 0;
    const maxL = Math.min(F, data.length - p);
    for (let idx = 0; idx < N && bestLen < maxL; idx++) {   // simule la copie du décodeur (la source peut recouvrir ce qui s'écrit)
      const tmp = Buffer.from(ring); let rr = r, len = 0;
      while (len < maxL) { const c = tmp[(idx + len) & (N - 1)]; if (c !== data[p + len]) break; tmp[rr] = c; rr = (rr + 1) & (N - 1); len++; }
      if (len > bestLen) { bestLen = len; bestIdx = idx; }
    }
    if (bestLen >= 2) { w.put(0, 1); w.put(bestIdx, EI); w.put(bestLen - 2, EJ); for (let k = 0; k < bestLen; k++) put(data[p + k]); p += bestLen; }
    else { w.put(1, 1); w.put(data[p], 8); put(data[p]); p++; }
  }
  return w.finish();
}

/** Décodeur : transcription de LZSSDecoder (machine à quatre états) ; s'arrête quand il manque des bits, comme le module. */
export function lzssDecode(buf) {
  const out = []; const ring = Buffer.alloc(N, 0x20); let r = N - F; let acc = 0, nbits = 0, pos = 0, state = 0, idx = 0;
  const need = [1, 8, EI, EJ];
  const put = (c) => { out.push(c); ring[r] = c; r = (r + 1) & (N - 1); };
  for (;;) {
    const n = need[state];
    while (nbits < n) { if (pos >= buf.length) return Buffer.from(out); acc = ((acc << 8) | buf[pos++]) >>> 0; nbits += 8; }
    const c = (acc >>> (nbits - n)) & ((1 << n) - 1); nbits -= n; acc &= nbits ? (1 << nbits) - 1 : 0;
    if (state === 0) state = c ? 1 : 2;
    else if (state === 1) { put(c); state = 0; }
    else if (state === 2) { idx = c; state = 3; }
    else { for (let k = 0; k <= c + 1; k++) put(ring[(idx + k) & (N - 1)]); state = 0; }
  }
}

/** Construit un fichier .ota. `payload` = flux LZSS déjà encodé. `crcOverride` / `lenOverride` / `versionBytes` : falsifications de laboratoire. */
export function buildOta(payload, { magic = R4_MAGIC, versionBytes = Buffer.alloc(8), crcOverride, lenOverride } = {}) {
  const ver = Buffer.from(versionBytes); if (ver.length !== 8) throw new Error("version : 8 octets");
  const mag = Buffer.alloc(4); mag.writeUInt32LE(magic >>> 0);
  const hdr = Buffer.alloc(HEADER);
  hdr.writeUInt32LE((lenOverride ?? (HEADER + payload.length - 8)) >>> 0, 0);
  hdr.writeUInt32LE((crcOverride ?? crc(mag, ver, payload)) >>> 0, 4);
  mag.copy(hdr, 8); ver.copy(hdr, 12);
  return Buffer.concat([hdr, payload]);
}

/** Relit un .ota comme le fait le module : en-tête, magie, CRC ; renvoie le binaire décodé. N'impose RIEN d'autre (ni len, ni signature). */
export function parseOta(file, { magic = R4_MAGIC } = {}) {
  if (file.length < HEADER) return { ok: false, why: "short" };
  const len = file.readUInt32LE(0), crcHdr = file.readUInt32LE(4), mag = file.readUInt32LE(8);
  if (mag !== (magic >>> 0)) return { ok: false, why: "magic", code: -11 };
  const payload = file.subarray(HEADER);
  const calc = crc(file.subarray(8, 20), payload);
  const bin = lzssDecode(payload);
  return { ok: calc === crcHdr, why: calc === crcHdr ? "ok" : "crc", code: calc === crcHdr ? 0 : -10, len, lenOk: len === file.length - 8, bin, signatureBit: (file[12] & 0x80) !== 0 };
}

/** Jeu de fichiers de laboratoire à partir d'une image `bin` (inoffensive : build de la sonde) ; chaque entrée annonce ce que le CODE du module doit faire. */
export function makeCases(bin) {
  const payload = lzssEncodeLiterals(bin);
  const good = buildOta(payload);
  const flip = (b, i) => { const c = Buffer.from(b); c[i] ^= 1; return c; };
  const pad = (kb) => buildOta(lzssEncodeLiterals(Buffer.concat([bin, Buffer.alloc(kb * 1024 - bin.length > 0 ? kb * 1024 - bin.length : 0, 0)])));
  const sigBytes = Buffer.alloc(8); sigBytes[0] = 0x80;   // champ « signature » du premier octet de la version (position non vérifiée dans le module : indicatif)
  return {
    good:       { file: good, expect: { download: "decoded-size", verify: 0, flashable: true, note: "référence" } },
    badcrc:     { file: flip(good, 4), expect: { download: "decoded-size", verify: -10, flashable: "oui, SI on appelle update() malgré verify() < 0", note: "CRC d'en-tête falsifié : seul verify() le voit" } },
    badpayload: { file: flip(good, HEADER + Math.floor(payload.length / 2)), expect: { download: "n'importe quoi", verify: -10, flashable: "oui, SI update() malgré verify()", note: "un bit du flux compressé" } },
    badmagic:   { file: buildOta(payload, { magic: ESP32_MAGIC }), expect: { download: -11, verify: "sans objet", flashable: false, note: "magie d'une autre carte (ESP32 Nano) : refusée à l'en-tête" } },
    trunc:      { file: good.subarray(0, HEADER + Math.floor(payload.length / 2)), expect: { download: "décodé partiel", verify: -10, flashable: "oui, SI update() malgré verify()", note: "Content-Length honnête mais fichier coupé" } },
    lenlie:     { file: buildOta(payload, { lenOverride: 0x7fffffff }), expect: { download: "decoded-size", verify: 0, flashable: true, note: "champ len faux : jamais comparé -> ACCEPTÉ" } },
    sigbit:     { file: buildOta(payload, { versionBytes: sigBytes }), expect: { download: "decoded-size", verify: 0, flashable: true, note: "bit « signature » de l'en-tête armé : jamais lu -> ACCEPTÉ (aucune signature n'existe)" } },
    "pad200":   { file: pad(200), expect: { download: "mesure", verify: "mesure", flashable: false, note: "TÉLÉCHARGEMENT SEULEMENT (ne jamais U) : image remplie à 200 Ko pour mesurer la place du module" } },
    "pad400":   { file: pad(400), expect: { download: "mesure", verify: "mesure", flashable: false, note: "TÉLÉCHARGEMENT SEULEMENT (ne jamais U) : 400 Ko (plus grand que la flash de l'application)" } },
  };
}
