import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Les identifiants Wi-Fi vivent UNIQUEMENT dans un secrets.h local (ignoré par git, voir .gitignore) : jamais dans un .ino ou un en-tête.
// Ce test échoue si un identifiant réapparaît dans un firmware — par exemple après avoir saisi le Wi-Fi « pour tester » dans un .ino : le retirer (ou le mettre dans secrets.h)
// AVANT de committer.
const root = path.join(__dirname, "..");
const DIRS = ["esp8266", "arduino_uno_r4"];

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.(ino|h|cpp)$/.test(entry.name) && entry.name !== "secrets.h") out.push(full);   // secrets.h : local et ignoré par git
  }
  return out;
}

// SSID / mot de passe affectés à une chaîne NON vide (les valeurs d'exemple « votre-ssid » sont tolérées dans les .example, qui ne sont pas lus ici)
const LEAK = /(?:WIFI_SSID|WIFI_PASSWORD|SECRET_WIFI_SSID|SECRET_WIFI_PASSWORD|\bssid|\bpassword)\s*(?:=|\s)\s*"[^"]+"/i;

test("aucun identifiant Wi-Fi dans les sketches et en-têtes suivis (ils vont dans secrets.h, ignoré par git)", () => {
  const leaks: string[] = [];
  for (const dir of DIRS) {
    for (const file of sources(path.join(root, dir))) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/^\s*\/\//.test(line)) return;                       // commentaire
        if (/__has_include|#include|#define SECRET_/.test(line) && !/"[^"]+"\s*$/.test(line.replace(/#include\s+"[^"]+"/, ""))) return;
        if (LEAK.test(line)) leaks.push(`${path.relative(root, file)}:${i + 1}`);   // numéro de ligne seulement : jamais la valeur
      });
    }
  }
  assert.deepEqual(leaks, [], `identifiants Wi-Fi en clair dans : ${leaks.join(", ")}`);
});

test("chaque dossier de firmware a un secrets.h.example et le .gitignore ignore secrets.h", () => {
  const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /arduino_uno_r4\/\*\*\/secrets\.h/);
  assert.match(ignore, /esp8266\/\*\*\/secrets\.h/);
  for (const folder of ["esp8266/esp_eink_2.9BWR", "esp8266/esp_tft1.8", "esp8266/esp_eink_2.7BW_OLED", "esp8266/esp_eink_2.7BW", "arduino_uno_r4/pod_uno_r4", "arduino_uno_r4/pod_uno_r4_eink29", "arduino_uno_r4/pod_uno_r4_eink27", "arduino_uno_r4/pod_uno_r4_eink27_oled", "arduino_uno_r4/pod_uno_r4_tft18"]) {
    assert.ok(fs.existsSync(path.join(root, folder, "secrets.h.example")), `${folder}/secrets.h.example manquant`);
  }
});
