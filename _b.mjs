import fs from "node:fs";
function edit(f, pairs) { let s = fs.readFileSync(f, "utf8"); const crlf = s.includes("\r\n"); s = s.replace(/\r\n/g, "\n"); for (const [a, b] of pairs) { if (s.split(a).length !== 2) throw new Error(f + " motif " + a.slice(0, 70)); s = s.replace(a, () => b); } fs.writeFileSync(f, crlf ? s.replace(/\n/g, "\r\n") : s); }
edit("tests/wifiMsFirmware.test.ts", [[`  return out.join("\n");\n}\nexport function msViolations`, `  return out.join("\n").replace('#define FIRMWARE_VERSION "multiscreen-2.7"', '#define FIRMWARE_VERSION "multiscreen-2.5"');   // seule différence voulue hors marqueurs : la version déclarée\n}\nexport function msViolations`]]);
edit("tests/esp8266Eink27OledCanary.test.ts", [
  [`import { describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";`, `import { describeChoice, findCompiler, runProcess } from "./helpers/cppHarness";\nimport { stripMs, isMsIno } from "./helpers/msStrip";`],
  [`const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");`, `// le sketch du multiscreen est lu SANS les ajouts du portail Wi-Fi / client OTA / capteur / profil de distribution (23/10/2026, tests/helpers/msStrip.ts) : ces tests portent sur le lot canari 8B2C\nconst read = (p: string) => { const t = fs.readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n"); return isMsIno(p) ? stripMs(t) : t; };`],
]);
edit("tests/renderFirmware.test.ts", [[`{ name: "ESP8266 e-ink 2,7″ + OLED", ino:`, `{ name: "ESP8266 e-ink 2,7″ + OLED", evolved: true, ino:`]]);
console.log("ok");
