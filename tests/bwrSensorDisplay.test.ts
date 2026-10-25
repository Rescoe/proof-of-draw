// tests/bwrSensorDisplay.test.ts — branchement STATIQUE de la surimpression T/H du BWR 2,9″ (24/10/2026). Ne prouve PAS le rendu sur le panneau.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");
const ino = fs.readFileSync(path.join(root, "esp8266/esp_eink_2.9BWR/esp_eink_2.9BWR.ino"), "utf8").replace(/\r\n/g, "\n");

test("BWR surimpression : option à 0 par défaut, exige le capteur, aucun système de fichiers", () => {
  assert.match(ino, /#ifndef POD_SENSOR_DISPLAY\n#define POD_SENSOR_DISPLAY 0\n#endif/);
  assert.match(ino, /#if POD_SENSOR_DISPLAY && !POD_SENSOR_DHT22\n#error/);
  assert.doesNotMatch(ino, /LittleFS|SPIFFS/, "la sauvegarde est en flash brute : pas de bibliothèque de fichiers (RAM et flash)");
});
test("BWR surimpression : la zone flash sauvegardée est dans la partition de fichiers (4M2M), loin de l'EEPROM et du Wi-Fi système", () => {
  const base = Number(/#define ENV_FLASH_BASE\s+(0x[0-9A-Fa-f]+)UL/.exec(ino)![1]);
  assert.equal(base % 4096, 0);
  assert.ok(base >= 0x200000 && base + 3 * 4096 <= 0x3FA000, "dans la partition de fichiers 0x200000..0x3FA000");
  assert.match(ino, /static_assert\(\(BUF_SIZE % 4\) == 0 && \(ENV_HDR_SIZE \+ 2 \* BUF_SIZE\) <= 3 \* 4096/);
});
test("BWR surimpression : planes sauvegardés AVANT la gravure du cartel, en-tête écrit EN DERNIER, rafraîchissement après chaque lecture valide", () => {
  const fetch = ino.slice(ino.indexOf("bool doFetchFrame("));
  assert.ok(fetch.indexOf("envSaveFrame();") > 0 && fetch.indexOf("envSaveFrame();") < fetch.indexOf("burnEinkCartel_29("));
  const save = ino.slice(ino.indexOf("static void envSaveFrame()"), ino.indexOf("static void envRefresh()"));
  assert.ok(save.lastIndexOf("ENV_FLASH_BASE, (uint32_t*)h") > save.indexOf("(uint32_t*)redBuf"), "en-tête après les plans");
  assert.match(ino, /poddht::onRead\(g_dht, now, ok, t, h\);\n#if POD_SENSOR_DISPLAY\n    envOnRead\(ok, t, h\);\n#endif/);
});
test("BWR surimpression : la ligne T/H tient dans la bande du cartel avec la date, le bloc et le pire cas (températures négatives)", () => {
  const IMG_W = 296, envW = "-12.3C 100%".length * 6;
  const topLine = "24/10/2026 14:03 (Paris) #115".length * 6;
  assert.ok(3 + topLine + 8 + envW <= IMG_W - 3, `date + bloc (${topLine}px) + T/H (${envW}px) doivent tenir sur ${IMG_W}px`);
});

test("BWR surimpression : le rafraîchissement n'a lieu que si la mesure affichée change utilement (seuils) ou si la gravure a plus de 3 h", () => {
  assert.match(ino, /#define POD_ENV_MIN_DT10\s+5\b/);
  assert.match(ino, /#define POD_ENV_MIN_DH10\s+30\b/);
  assert.match(ino, /#define POD_ENV_MAX_AGE_MS\s+10800000UL/);
  const on = ino.slice(ino.indexOf("static void envOnRead("));
  assert.match(on, /if \(never \|\| moved \|\| old\) envRefresh\(\);/);
  assert.match(ino, /g_envEngT10 = g_envT10;/, "la mesure gravée est mémorisée au moment de la gravure");
});

test("BWR surimpression v2 (25/10/2026) : mise en page à capteur (date+bloc+titre / mesure + heure du relevé / artiste), mesure gravée persistée, rafraîchissement possible après un redémarrage", () => {
  assert.match(ino, /#include "pod_civil\.h"/);
  assert.match(ino, /"%s%d\.%dC %d\.%d%%"/, "température ET humidité avec une décimale");
  assert.match(ino, /clearRows29\(bBuf, BAND \+ 1, 2 \* BAND\)/, "deuxième bande réservée à la mesure");
  assert.match(ino, /releve %s/);
  assert.match(ino, /if \(envLayout && artistName\.length\(\) > 0\) botLine = artistName;/, "le titre est en haut : l'artiste seul reste en bas");
  assert.match(ino, /#define ENV_EE_OFF 620/);
  const refresh = ino.slice(ino.indexOf("static void envRefresh()"), ino.indexOf("static void envEePersist") > 0 ? ino.indexOf("/** Heure locale de l'écran") : undefined);
  assert.doesNotMatch(refresh.split("\n").slice(0, 3).join("\n"), /hasDisplayedFrame/, "plus d'exigence de frame affichée depuis le démarrage");
  assert.match(ino, /doc\["now"\]\.is<uint32_t>\(\) && doc\["tzo"\]\.is<int>\(\)/);
  assert.match(ino, /envEeLoad\(\);/);
});
