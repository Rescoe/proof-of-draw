// 29/10/2026 — page « Apprendre » : le câblage du lecteur microSD des TFT sur UNO R4 vient des broches RÉELLES du firmware (TFT 1,8″ : écran de station, CS D4 ; TFT 2,8″ tactile : SD_CS 4).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WIRING } from "../app/learn/wiring";
import { INSTALL_PROFILES } from "../app/learn/data/installProfiles";

const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const wire = (spec: { wires: Array<{ pin: string; node: string }> }, pin: string) => spec.wires.find((w) => w.pin === pin)?.node;

test("TFT 1,8″ sur UNO R4 : le câblage SD optionnel existe, suit le firmware de la station (CS D4) et partage le bus SPI de l'écran", () => {
  assert.match(read("docs/PRODUIT_R4_TFT18_ENV_2026_10_26.md"), /CS SD D4/);
  const sd = WIRING.r4Tft18Sd, tft = WIRING.r4Tft18;
  assert.equal(wire(sd, "SD_CS"), "D4");
  assert.equal(wire(sd, "SD_MOSI"), wire(tft, "SDA"), "MOSI partagé avec l'écran (D11)");
  assert.equal(wire(sd, "SD_SCK"), wire(tft, "SCL"), "SCK partagé avec l'écran (D13)");
  assert.equal(wire(sd, "SD_MISO"), "D12", "MISO = CIPO de la R4");
  assert.notEqual(wire(sd, "SD_CS"), wire(tft, "CS"), "deux chip selects distincts");
  const p = INSTALL_PROFILES.r4Tft18;
  assert.equal(p.optionalWiring, sd);
  assert.match(p.optionalWiringNote ?? "", /Sans carte SD ni capteur/, "honnête : la carte SD n'est utilisée qu'avec les options de la station");
});

test("TFT 2,8″ tactile sur UNO R4 : la microSD du shield est câblée sur D4 comme dans le firmware, et l'aide microSD est présente", () => {
  assert.match(read("arduino_uno_r4/pod_uno_r4/pod_uno_r4.ino"), /#define SD_CS\s+4/);
  assert.equal(wire(WIRING.r4Tft28, "SD CS"), "D4");
  assert.equal(wire(WIRING.r4Tft28, "CIPO"), "D12");
  assert.match(read("app/learn/components/InstallGuide.tsx"), /selected\.id === "r4Tft28" \? \(\s+<Disclosure id="i-microsd"/);
});

test("TFT 1,8″ ESP8266 : câblage SD optionnel inchangé (D4 / D7 / D5 / D6)", () => {
  const sd = WIRING.tftSd;
  assert.deepEqual(["CS", "MOSI", "SCLK", "MISO"].map((p) => wire(sd, p)), ["D4", "D7", "D5", "D6"]);
});
