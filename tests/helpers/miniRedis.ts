// tests/helpers/miniRedis.ts — mini Redis en mémoire (GET / SET NX EX / DEL / EXISTS / LPUSH / LRANGE / LTRIM / EXPIRE) + exécuteur Lua RÉEL (fengari, VM Lua en JavaScript pur) pour tester les scripts d'archive.
// fengari n'est PAS une dépendance du dépôt : il est cherché dans FENGARI_DIR (dossier contenant node_modules/fengari) puis dans les modules du projet ; sinon `loadFengari()` retourne null et le test Lua est IGNORÉ (le test du miroir JS reste exécuté).
import { createRequire } from "node:module";
import path from "node:path";

type Reply = null | string | number | { ok: string } | Reply[];

export class MiniRedis {
  kv = new Map<string, string>();
  lists = new Map<string, string[]>();
  ttl = new Map<string, number>();
  commands = 0;
  /** Panne simulée : le N-ième appel de commande (après armement) lève une erreur ; 0 = aucune. */
  failAt = 0;
  private count = 0;

  private tick() { this.count++; if (this.failAt && this.count === this.failAt) { this.failAt = 0; throw new Error("panne Redis simulée"); } }

  exec(cmd: string[]): Reply {
    this.tick(); this.commands++;
    const [name, ...a] = cmd; const op = name.toUpperCase();
    switch (op) {
      case "GET": return this.kv.has(a[0]) ? this.kv.get(a[0])! : null;
      case "SET": {
        const nx = a.slice(2).some((x) => x.toUpperCase() === "NX");
        if (nx && this.kv.has(a[0])) return null;
        this.kv.set(a[0], a[1]);
        const ex = a.findIndex((x, i) => i >= 2 && x.toUpperCase() === "EX");
        if (ex > 0) this.ttl.set(a[0], Number(a[ex + 1])); else this.ttl.delete(a[0]);
        return { ok: "OK" };
      }
      case "DEL": { let n = 0; for (const k of a) { if (this.kv.delete(k)) n++; if (this.lists.delete(k)) n++; this.ttl.delete(k); } return n; }
      case "EXISTS": return a.filter((k) => this.kv.has(k) || this.lists.has(k)).length;
      case "LPUSH": { const l = this.lists.get(a[0]) ?? []; for (const v of a.slice(1)) l.unshift(v); this.lists.set(a[0], l); return l.length; }
      case "LRANGE": { const l = this.lists.get(a[0]) ?? []; const s = Number(a[1]); let e = Number(a[2]); if (e < 0) e = l.length + e; return l.slice(s, e + 1); }
      case "LTRIM": { const l = this.lists.get(a[0]) ?? []; let e = Number(a[2]); if (e < 0) e = l.length + e; this.lists.set(a[0], l.slice(Number(a[1]), e + 1)); return { ok: "OK" }; }
      case "EXPIRE": { if (!this.kv.has(a[0]) && !this.lists.has(a[0])) return 0; this.ttl.set(a[0], Number(a[1])); return 1; }
      default: throw new Error("commande non gérée : " + op);
    }
  }
}

type Fengari = { lua: any; lauxlib: any; lualib: any; to_luastring: (s: string) => any; to_jsstring: (b: any) => string };

export function loadFengari(): Fengari | null {
  const bases = [process.env.FENGARI_DIR ? path.join(process.env.FENGARI_DIR, "noop.js") : "", __filename].filter(Boolean);
  for (const base of bases) { try { const m = createRequire(base)("fengari"); return { lua: m.lua, lauxlib: m.lauxlib, lualib: m.lualib, to_luastring: m.to_luastring, to_jsstring: m.to_jsstring }; } catch { /* suivant */ } }
  return null;
}

/** Exécute un script Lua réel (sémantique EVAL de Redis pour ce que les scripts utilisent). Retour : entier Lua, ou null (false / nil). */
export function runLua(fg: Fengari, store: MiniRedis, script: string, keys: string[], args: string[]): number | null {
  const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fg;
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const S = (s: string) => to_luastring(s);
  const pushValue = (v: unknown): void => {
    if (v === null || v === undefined) lua.lua_pushboolean(L, 0);
    else if (typeof v === "string") lua.lua_pushstring(L, S(v));
    else if (typeof v === "number") lua.lua_pushinteger(L, v);
    else if (Array.isArray(v)) { lua.lua_newtable(L); v.forEach((x, i) => { pushValue(x); lua.lua_rawseti(L, -2, i + 1); }); }
    else if (typeof v === "object" && "ok" in (v as object)) { lua.lua_newtable(L); lua.lua_pushstring(L, S((v as { ok: string }).ok)); lua.lua_setfield(L, -2, S("ok")); }
  };
  const pushJson = (v: unknown): void => {
    if (v === null) lua.lua_pushnil(L);
    else if (typeof v === "string") lua.lua_pushstring(L, S(v));
    else if (typeof v === "number") lua.lua_pushnumber(L, v);
    else if (typeof v === "boolean") lua.lua_pushboolean(L, v ? 1 : 0);
    else if (Array.isArray(v)) { lua.lua_newtable(L); v.forEach((x, i) => { pushJson(x); lua.lua_rawseti(L, -2, i + 1); }); }
    else { lua.lua_newtable(L); for (const [k, x] of Object.entries(v as object)) { pushJson(x); lua.lua_setfield(L, -2, S(k)); } }
  };
  const table = (name: string, items: string[]) => { lua.lua_newtable(L); items.forEach((x, i) => { lua.lua_pushstring(L, S(x)); lua.lua_rawseti(L, -2, i + 1); }); lua.lua_setglobal(L, S(name)); };
  table("KEYS", keys); table("ARGV", args);
  lua.lua_newtable(L);
  lua.lua_pushjsfunction(L, (st: unknown) => {
    const n = lua.lua_gettop(st); const a: string[] = [];
    for (let i = 1; i <= n; i++) a.push(to_jsstring(lua.lua_tolstring(st, i)));
    let reply: Reply;
    try { reply = store.exec(a); } catch (e) { return lauxlib.luaL_error(st, S(String((e as Error).message))); }
    pushValue(reply); return 1;
  });
  lua.lua_setfield(L, -2, S("call")); lua.lua_setglobal(L, S("redis"));
  lua.lua_newtable(L);
  lua.lua_pushjsfunction(L, (st: unknown) => {
    const s = to_jsstring(lua.lua_tolstring(st, 1));
    let v: unknown; try { v = JSON.parse(s); } catch { return lauxlib.luaL_error(st, S("JSON invalide")); }
    pushJson(v); return 1;
  });
  lua.lua_setfield(L, -2, S("decode")); lua.lua_setglobal(L, S("cjson"));
  if (lauxlib.luaL_loadstring(L, S(script)) !== 0) throw new Error("Lua : " + to_jsstring(lua.lua_tolstring(L, -1)));
  if (lua.lua_pcall(L, 0, 1, 0) !== 0) throw new Error("Lua : " + to_jsstring(lua.lua_tolstring(L, -1)));
  const out = lua.lua_isinteger(L, -1) ? Number(lua.lua_tointeger(L, -1)) : null;
  return out;
}
