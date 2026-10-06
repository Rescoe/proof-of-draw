import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { NextRequest } from "next/server";
import {
  INSTALL_PROFILE_LIST,
  profileForSelection,
  resolveInstallProfileId,
} from "../app/learn/data/installProfiles";
import { GET } from "../app/api/esp-firmware/route";

test("apprendre : chaque couple écran × carte est unique", () => {
  const combinations = INSTALL_PROFILE_LIST.map((profile) => `${profile.installScreenId}:${profile.boardId}`);
  assert.equal(new Set(combinations).size, combinations.length);
});

test("apprendre : e-ink 2.9 propose ESP8266 et UNO R4 avec leurs firmwares propres", () => {
  const esp = profileForSelection("eink29bwr", "esp8266");
  const r4 = profileForSelection("eink29bwr", "unoR4");
  assert.equal(esp?.firmwareFolder, "esp_eink_2.9BWR");
  assert.equal(r4?.firmwareFolder, "pod_uno_r4_eink29");
  assert.equal(r4?.wiring[0]?.controllerName, "UNO R4 WiFi");
});

test("apprendre : une combinaison indisponible conserve l'écran et choisit sa carte compatible", () => {
  assert.equal(resolveInstallProfileId("tft28", "esp8266"), "r4Tft28");
  assert.equal(resolveInstallProfileId("eink27bwSolo", "unoR4"), "eink27bwSolo");
  assert.equal(resolveInstallProfileId("r4Eink29", null), "r4Eink29");
});

for (const variant of ["r4Eink29", "r4Tft28"] as const) {
  test(`archive ${variant} : firmware autonome sans secrets Wi-Fi`, async () => {
    const response = await GET(new NextRequest(`http://localhost/api/esp-firmware?variant=${variant}`));
    assert.equal(response.status, 200);
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const paths = Object.keys(zip.files);
    const profile = INSTALL_PROFILE_LIST.find((item) => item.firmwareVariant === variant);
    assert.ok(profile);
    assert.ok(paths.includes(`${profile.firmwareFolder}/${profile.firmwareEntryFile}`));
    assert.ok(paths.includes(`${profile.firmwareFolder}/secrets.h.example`));
    assert.ok(!paths.some((path) => /(^|\/)secrets\.h$/i.test(path)));
  });
}
