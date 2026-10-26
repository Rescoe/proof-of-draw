// protocol.mjs — protocole machine de la sonde OTA-3 (mode OTA3_AUTO) : lignes « @OTA3 {json} » émises par le sketch, commandes envoyées par l'orchestrateur.
// Tout ce que l'orchestrateur envoie à la carte passe par assertSafeCommand() : liste blanche STRICTE (jamais badmagic ni badpayload, jamais d'autre cas que good / to-a).
export const PREFIX = "@OTA3 ";
export const APP_MAX = 0x3C000;
export const FLASH_DATA_SIZE = 8192;
const HEX = (n) => new RegExp(`^[0-9A-Fa-f]{${n}}$`);
export const isHex = (s, n) => typeof s === "string" && HEX(n).test(s);
export const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export const isIpv4 = (s) => { const m = IPV4.exec(s ?? ""); return !!m && m.slice(1).every((x) => Number(x) <= 255); };

/** Cas téléchargeables par l'orchestrateur : UNIQUEMENT ceux-ci. */
export const SAFE_CASES = Object.freeze(["good", "to-a"]);

const COMMANDS = [
  /^h [1-9]\d{0,5}$/,                    // SHA-256 de la flash programme (taille 1..245760 contrôlée à part)
  /^w$/, /^m$/, /^r$/, /^U$/, /^YES$/,
  /^s \d{1,3}(\.\d{1,3}){3}:\d{1,5}$/,
  /^d (good|to-a)$/,
  /^e [0-9a-f]{64} [1-9]\d{0,5}$/,
];
export function assertSafeCommand(line) {
  if (typeof line !== "string" || !COMMANDS.some((re) => re.test(line))) throw new Error(`commande refusée par la liste blanche : ${JSON.stringify(line)}`);
  const m = /^(?:h|e [0-9a-f]{64}) (\d+)$/.exec(line);
  if (m && (Number(m[1]) < 1 || Number(m[1]) > APP_MAX)) throw new Error(`taille hors limites : ${line}`);
  return line;
}

/** Une ligne série -> { kind: "event", ev } | { kind: "text", s } | { kind: "bad", s, why } ; jamais d'exception. */
export function parseLine(line) {
  const s = String(line).replace(/\r$/, "");
  const i = s.indexOf(PREFIX);
  if (i < 0) return { kind: "text", s };
  if (s.length - i > 256) return { kind: "bad", s, why: "ligne trop longue" };
  let ev; try { ev = JSON.parse(s.slice(i + PREFIX.length)); } catch { return { kind: "bad", s, why: "JSON invalide" }; }
  if (!ev || typeof ev !== "object" || Array.isArray(ev) || typeof ev.e !== "string") return { kind: "bad", s, why: "événement sans champ e" };
  return { kind: "event", ev };
}

/** Découpe un flux d'octets/texte en lignes (gère les morceaux partiels et \r\n). */
export class LineSplitter {
  constructor() { this.buf = ""; }
  push(chunk) { this.buf += String(chunk); const out = []; let i; while ((i = this.buf.indexOf("\n")) >= 0) { out.push(this.buf.slice(0, i).replace(/\r$/, "")); this.buf = this.buf.slice(i + 1); } if (this.buf.length > 4096) { out.push(this.buf); this.buf = ""; } return out; }
}

/** Valide l'identité d'un événement boot / hello ; rend { ok, why, id } */
export function validateId(ev) {
  if (!["boot", "hello"].includes(ev.e)) return { ok: false, why: "pas un événement d'identité" };
  if (!(ev.build === "A" || ev.build === "B")) return { ok: false, why: "build inconnue" };
  if (!isHex(ev.run, 8)) return { ok: false, why: "run invalide" };
  if (!isHex(ev.uid, 32)) return { ok: false, why: "identifiant de puce invalide" };
  if (ev.n !== FLASH_DATA_SIZE) return { ok: false, why: `flash de données: ${ev.n} o au lieu de ${FLASH_DATA_SIZE}` };
  if (!Array.isArray(ev.fcrc) || ev.fcrc.length !== 5 || !ev.fcrc.every((c) => isHex(c, 8))) return { ok: false, why: "CRC de flash de données invalides" };
  return { ok: true, id: { build: ev.build, run: ev.run.toUpperCase(), uid: ev.uid.toUpperCase(), rst: ev.rst, fcrc: ev.fcrc.map((c) => c.toUpperCase()) } };
}
