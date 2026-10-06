"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Cable,
  CheckCircle2,
  Cpu,
  Download,
  KeyRound,
  Monitor,
  Palette,
  Upload,
  Wifi,
} from "lucide-react";
import { WiringDiagram } from "../WiringDiagram";
import {
  BOARD_PROFILES,
  COMMON_LIBRARIES,
  INSTALL_PROFILES,
  INSTALL_PROFILE_LIST,
  INSTALL_SCREEN_OPTIONS,
  profileForSelection,
  profileLabel,
  type BoardId,
  type InstallProfileId,
  type InstallScreenId,
} from "../data/installProfiles";
import { Callout, Code, CodeBlock, Disclosure, MenuPath, SectionHeading } from "./ContentPrimitives";
import styles from "../learn.module.css";

function InstallStep({
  number,
  title,
  icon,
  id,
  children,
}: {
  number: number;
  title: string;
  icon: ReactNode;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.installStep} id={id}>
      <div className={styles.stepRail}>
        <span className={styles.stepNumber}>{number}</span>
        <span className={styles.stepLine} aria-hidden />
      </div>
      <div className={styles.stepContent}>
        <div className={styles.stepTitle}>
          <span className={styles.stepIcon}>{icon}</span>
          <h3>{title}</h3>
        </div>
        {children}
      </div>
    </section>
  );
}

export function InstallGuide({ initialProfileId = "eink29bwr" }: { initialProfileId?: InstallProfileId }) {
  const [selectedId, setSelectedId] = useState<InstallProfileId>(initialProfileId);
  const selected = INSTALL_PROFILES[selectedId];
  const board = BOARD_PROFILES[selected.boardId];

  function selectProfile(id: InstallProfileId) {
    const profile = INSTALL_PROFILES[id];
    setSelectedId(profile.id);
    const url = new URL(window.location.href);
    url.searchParams.set("screen", profile.installScreenId);
    url.searchParams.set("board", profile.boardId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function selectScreen(screenId: InstallScreenId) {
    const sameBoard = profileForSelection(screenId, selected.boardId);
    const fallback = INSTALL_PROFILE_LIST.find((profile) => profile.installScreenId === screenId);
    const profile = sameBoard ?? fallback;
    if (profile) selectProfile(profile.id);
  }

  function selectBoard(boardId: BoardId) {
    const profile = profileForSelection(selected.installScreenId, boardId);
    if (profile) selectProfile(profile.id);
  }

  const libraries = [...COMMON_LIBRARIES, ...selected.specificLibraries];

  return (
    <section className={styles.majorSection} id="installer">
      <SectionHeading eyebrow="Parcours 01" title="Installer un écran">
        <p>
          Le choix du matériel pilote tout le guide. Le câblage, les bibliothèques et le
          téléchargement affichés ci-dessous correspondent toujours à la variante sélectionnée.
        </p>
      </SectionHeading>

      <div className={styles.progressStrip} aria-label="Étapes de l’installation">
        {["Écran", "Matériel", "Câblage", "Arduino", "Firmware", "Wi-Fi et flash", "Premier démarrage", "Association"].map((label, index) => (
          <a href={`#install-step-${index + 1}`} key={label}>
            <span>{index + 1}</span>{label}
          </a>
        ))}
      </div>

      <InstallStep number={1} title="Choisir l’écran et la carte" icon={<Monitor size={20} />} id="install-step-1">
        <div id="material" className={styles.anchorOffset} />
        <p className={styles.selectorLabel}>1. Votre écran</p>
        <div className={styles.screenSelector} aria-label="Types d’écran">
          {INSTALL_SCREEN_OPTIONS.map((screen) => {
            const active = screen.id === selected.installScreenId;
            return (
              <button
                type="button"
                aria-pressed={active}
                className={`${styles.screenChoice} ${active ? styles.screenChoiceActive : ""}`}
                onClick={() => selectScreen(screen.id)}
                key={screen.id}
              >
                <span className={styles.screenChoiceMark} style={{ background: screen.accent }} />
                <strong>{screen.label}</strong>
                <small>{screen.technicalSummary}</small>
              </button>
            );
          })}
        </div>

        <p className={styles.selectorLabel}>2. Votre carte</p>
        <div className={styles.boardSelector} aria-label="Types de carte">
          {Object.values(BOARD_PROFILES).map((boardOption) => {
            const profile = profileForSelection(selected.installScreenId, boardOption.id);
            const active = boardOption.id === selected.boardId;
            return (
              <button
                type="button"
                aria-pressed={active}
                disabled={!profile}
                className={`${styles.boardChoice} ${active ? styles.boardChoiceActive : ""}`}
                onClick={() => selectBoard(boardOption.id)}
                key={boardOption.id}
              >
                <Cpu size={18} aria-hidden />
                <span><strong>{boardOption.shortName}</strong><small>{profile ? "Guide et firmware disponibles" : "Pas encore disponible pour cet écran"}</small></span>
              </button>
            );
          })}
        </div>

        <Disclosure title="Je ne sais pas quel écran j’ai">
          <p>Comparez l’inscription imprimée sur le module, sa taille et ses couleurs avec ces références :</p>
          <div className={styles.identificationGrid}>
            {INSTALL_SCREEN_OPTIONS.map((screen) => (
              <button type="button" onClick={() => selectScreen(screen.id)} key={screen.id}>
                <strong>{screen.label}</strong>
                <span>{screen.moduleReference}</span>
                <small>{screen.technicalSummary}</small>
              </button>
            ))}
          </div>
        </Disclosure>
      </InstallStep>

      <div className={styles.selectedProfileBanner}>
        <div>
          <span>Guide actif</span>
          <strong>{profileLabel(selected)} + {board.shortName}</strong>
          <p>{selected.shortDescription}</p>
        </div>
        <div className={styles.profileSpecs}>
          {selected.screens.map((screen) => (
            <span key={screen.id}>{screen.width} × {screen.height}px · {screen.pixelFormat}</span>
          ))}
        </div>
      </div>

      {!selected.testedOnHardware ? (
        <Callout tone="warning" title="Combinaison disponible, validation matérielle en attente">
          <p>{selected.statusNote}</p>
        </Callout>
      ) : null}

      <InstallStep number={2} title="Préparer le matériel" icon={<Cpu size={20} />} id="install-step-2">
        <p>
          Il vous faut une carte <strong>{board.name}</strong>, le module
          <strong> {selected.moduleReference}</strong>, {selected.installScreenId === "tft28" ? "une carte microSD facultative" : "des fils Dupont"} et un câble USB permettant le transfert de données.
        </p>
        <Callout tone="warning" title={selected.installScreenId === "tft28" ? "Manipuler le shield hors tension" : "Alimentation 3,3 V uniquement"}>
          <p>
            {selected.installScreenId === "tft28"
              ? "Le shield est alimenté directement par l’UNO R4 lorsqu’il est correctement enfiché. Débranchez l’USB avant de le retirer."
              : <>Alimentez l’écran depuis la broche <Code>3V3</Code>, jamais depuis <Code>VIN</Code> ou 5 V. Débranchez l’USB avant de déplacer un fil.</>}
          </p>
        </Callout>
      </InstallStep>

      <InstallStep number={3} title={`Câbler ${profileLabel(selected)}`} icon={<Cable size={20} />} id="install-step-3">
        <div id="wiring" className={styles.anchorOffset} />
        <p>{selected.wiringIntro} Les schémas et tableaux ci-dessous proviennent directement des broches utilisées par le firmware.</p>
        {selected.wiring.map((spec) => (
          <div className={styles.wiringBlock} key={spec.id}>
            <WiringDiagram spec={spec} />
          </div>
        ))}
        {selected.optionalWiring ? (
          <Disclosure title="Optionnel — câbler le lecteur de carte SD du TFT">
            <p>Le firmware TFT démarre sans carte SD. Ce câblage n’est utile que si vous souhaitez utiliser le lecteur intégré.</p>
            <WiringDiagram spec={selected.optionalWiring} />
          </Disclosure>
        ) : null}
        {selected.boardId === "esp8266" ? (
          <Disclosure title="Détail technique — correspondance D0–D8 et GPIO">
            <CodeBlock>{`D0 = GPIO16    D1 = GPIO5     D2 = GPIO4
D3 = GPIO0     D4 = GPIO2     D5 = GPIO14
D6 = GPIO12    D7 = GPIO13    D8 = GPIO15`}</CodeBlock>
            <p>
              Pour les e-ink, <Code>CLK → D5</Code> et <Code>DIN → D7</Code> passent par le SPI matériel,
              même si ces broches ne sont pas répétées dans le fichier <Code>epdif.h</Code>.
            </p>
          </Disclosure>
        ) : (
          <Disclosure title="Détail technique — SPI matériel de l’UNO R4">
            <p><Code>D11</Code> est la sortie COPI (MOSI), <Code>D12</Code> l’entrée CIPO (MISO) et <Code>D13</Code> l’horloge SCK. Ne remplacez pas ces broches par celles du NodeMCU.</p>
          </Disclosure>
        )}
      </InstallStep>

      <InstallStep number={4} title="Installer et préparer Arduino IDE" icon={<Palette size={20} />} id="install-step-4">
        <div id="arduino-ide" className={styles.anchorOffset} />
        <div className={styles.subSteps}>
          <div>
            <span>1</span>
            <div>
              <h4>Installer Arduino IDE 2.x</h4>
              <p>
                Téléchargez le logiciel sur <a href="https://www.arduino.cc/en/software" target="_blank" rel="noreferrer">arduino.cc</a>,
                installez-le puis ouvrez-le. Vous n’avez pas besoin de connaître la programmation Arduino pour suivre la suite.
              </p>
            </div>
          </div>
          <div>
            <span>2</span>
            <div>
              <h4>Ajouter le support {board.shortName}</h4>
              {selected.boardId === "esp8266" ? (
                <>
                  <p>Ouvrez <MenuPath steps={["Fichier", "Préférences"]} /> et ajoutez dans « URL de gestionnaire de cartes supplémentaires » :</p>
                  <CodeBlock>http://arduino.esp8266.com/stable/package_esp8266com_index.json</CodeBlock>
                  <p id="esp-boards">Ouvrez ensuite <MenuPath steps={["Outils", "Type de carte", "Gestionnaire de cartes"]} />, recherchez <Code>esp8266</Code> et installez « {board.arduinoPackage} ».</p>
                </>
              ) : (
                <p>Ouvrez <MenuPath steps={["Outils", "Type de carte", "Gestionnaire de cartes"]} />, recherchez <Code>UNO R4</Code> et installez « {board.arduinoPackage} ». Aucune URL supplémentaire n’est nécessaire.</p>
              )}
            </div>
          </div>
          <div>
            <span>3</span>
            <div>
              <h4>Brancher et sélectionner la carte</h4>
              <p>
                Connectez la carte en USB, puis sélectionnez
                <MenuPath steps={board.arduinoMenu} />
                et choisissez son port dans <MenuPath steps={["Outils", "Port"]} />.
              </p>
            </div>
          </div>
        </div>
        {selected.boardId === "esp8266" ? (
          <Disclosure title="Mon ordinateur ne détecte aucun port USB">
            <p>
              Le NodeMCU utilise généralement une puce CH340 ou CP2102. Regardez l’inscription du petit circuit près de la prise USB,
              puis installez le <a href="https://sparks.gogo.co.nz/ch340.html" target="_blank" rel="noreferrer">pilote CH340</a> ou le
              <a href="https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers" target="_blank" rel="noreferrer"> pilote CP210x</a> correspondant.
            </p>
          </Disclosure>
        ) : (
          <Disclosure title="La R4 ne se connecte pas au Wi-Fi">
            <p>Dans Arduino IDE, ouvrez <MenuPath steps={["Outils", "Updater le firmware WiFi"]} /> afin de mettre à jour le coprocesseur réseau, puis redémarrez la carte.</p>
          </Disclosure>
        )}
        <Disclosure title="Optionnel — vérifier Arduino avec l’exemple Blink">
          <p>
            Ouvrez <MenuPath steps={["Fichier", "Exemples", "01.Basics", "Blink"]} /> puis cliquez sur
            « Téléverser ». La LED intégrée de la carte doit ensuite clignoter.
          </p>
        </Disclosure>
      </InstallStep>

      <InstallStep number={5} title="Installer les bibliothèques et télécharger le bon firmware" icon={<Download size={20} />} id="install-step-5">
        <div id="libraries" className={styles.anchorOffset} />
        <p>
          Dans Arduino IDE, ouvrez <MenuPath steps={["Outils", "Gérer les bibliothèques"]} /> et installez les bibliothèques suivantes.
          {` ${board.networkLibraries}`}
        </p>
        <div className={styles.libraryGrid}>
          {libraries.map((library) => (
            <div key={library.name}>
              <CheckCircle2 size={17} aria-hidden />
              <p><strong>{library.name}</strong><span>{library.version}</span><small>{library.purpose}</small></p>
            </div>
          ))}
        </div>
        <div className={styles.downloadCard} id="firmware">
          <div>
            <span>Firmware correspondant à votre sélection</span>
            <strong>{selected.firmwareFolder}</strong>
            <small>{selected.firmwareFilename}</small>
          </div>
          <a
            className={styles.primaryButton}
            href={`/api/esp-firmware?variant=${selected.firmwareVariant}`}
            download={selected.firmwareFilename}
          >
            <Download size={17} aria-hidden /> Télécharger le ZIP
          </a>
        </div>
      </InstallStep>

      <InstallStep number={6} title="Ouvrir le code, renseigner le Wi-Fi et téléverser" icon={<Upload size={20} />} id="install-step-6">
        <div id="configure" className={styles.anchorOffset} />
        <Callout tone="info" title="Le point important : deux lignes seulement">
          <p>
            Pour rejoindre le réseau public Proof-of-Draw, ne modifiez pas l’adresse du serveur.
            Vous devez uniquement remplir <Code>{selected.boardId === "unoR4" ? "SECRET_WIFI_SSID" : "WIFI_SSID"}</Code> et <Code>{selected.boardId === "unoR4" ? "SECRET_WIFI_PASSWORD" : "WIFI_PASSWORD"}</Code>.
          </p>
        </Callout>
        <div className={styles.subSteps}>
          <div>
            <span>1</span>
            <div>
              <h4>Ouvrir le bon fichier</h4>
              <p>
                Décompressez le ZIP. Ouvrez le dossier <Code>{selected.firmwareFolder}</Code>, puis double-cliquez sur le fichier
                <Code> {selected.firmwareEntryFile}</Code>. Arduino IDE ouvre le projet complet.
              </p>
            </div>
          </div>
          <div>
            <span>2</span>
            <div>
              <h4>{selected.boardId === "unoR4" ? "Créer le fichier Wi-Fi privé" : "Trouver immédiatement les réglages Wi-Fi"}</h4>
              {selected.boardId === "unoR4" ? (
                <>
                  <p>Dans le dossier du firmware, copiez <Code>secrets.h.example</Code> et renommez la copie <Code>secrets.h</Code>. Ouvrez-la puis remplacez seulement les deux valeurs entre guillemets :</p>
                  <CodeBlock>{`#define SECRET_WIFI_SSID     "Nom exact de votre Wi-Fi"
#define SECRET_WIFI_PASSWORD "Mot de passe de votre Wi-Fi"`}</CodeBlock>
                  <p>Ne renommez pas le fichier d’exemple lui-même : conservez-le comme modèle. <Code>secrets.h</Code> reste local à votre ordinateur et n’est pas inclus dans le dépôt.</p>
                </>
              ) : (
                <>
                  <p>Ils se trouvent parmi les premières lignes du fichier. Utilisez <Code>Ctrl + F</Code> ou <Code>⌘ + F</Code>, recherchez <Code>WIFI_SSID</Code> et remplacez seulement le contenu entre guillemets :</p>
                  <CodeBlock>{`const char* WIFI_SSID     = "Nom exact de votre Wi-Fi";
const char* WIFI_PASSWORD = "Mot de passe de votre Wi-Fi";

#define SERVER_URL "https://proof-of-draw.vercel.app"  // laisser tel quel`}</CodeBlock>
                </>
              )}
              <ul>
                <li>Le SSID est le nom du réseau Wi-Fi affiché sur votre téléphone ou ordinateur.</li>
                <li>Conservez les guillemets{selected.boardId === "esp8266" ? ", le point-virgule" : ""} et les majuscules/minuscules du mot de passe.</li>
                <li>Utilisez un réseau Wi-Fi 2,4 GHz pour cette installation.</li>
              </ul>
            </div>
          </div>
          <div>
            <span>3</span>
            <div>
              <h4>Compiler puis téléverser</h4>
              <p>
                Vérifiez que « {board.shortName} » et le bon port sont toujours sélectionnés. Cliquez d’abord sur le bouton ✓
                « Vérifier » pour compiler, puis sur la flèche → « Téléverser » pour envoyer le code à la carte.
              </p>
              <p>
                Attendez le message de fin du téléversement. La carte redémarre ensuite automatiquement ; ouvrez le Moniteur série à <Code>115200 bauds</Code> si vous souhaitez suivre les étapes.
              </p>
              {selected.animationFirmware && selected.boardId === "esp8266" ? (
                <Disclosure title="Facultatif — animations : réglage « Flash Size » (garde l’animation après un redémarrage)">
                  <p>
                    Ce firmware (<Code>{selected.animationFirmware}</Code>) joue les <strong>animations</strong> du réseau en boucle. Le clip (moins de 10 Ko) est rangé dans la mémoire flash de la carte :
                    l’animation reprend toute seule après une coupure de courant. Pour cela, avant de téléverser, ouvrez
                    <MenuPath steps={["Outils", "Flash Size"]} /> et choisissez une ligne qui contient <Code>FS</Code>, par exemple <Code>4MB (FS:2MB OTA:~1019KB)</Code>.
                  </p>
                  <p>
                    <strong>Ce réglage est facultatif.</strong> Sans lui, tout fonctionne : l’animation est simplement retéléchargée depuis un cache public avant chaque lecture
                    (aucun coût pour le serveur de données) et ne reprend pas toute seule après un redémarrage. Le Moniteur série indique le cas rencontré :
                    <Code> [ANIM] flash LittleFS : disponible</Code> ou <Code>ABSENTE</Code>.
                  </p>
                  <p>
                    Une animation n’est reçue que si la version du firmware est <Code>{selected.animationFirmware}</Code> ou plus récente : la carte l’annonce au serveur à chaque démarrage,
                    et Mon profil affiche « firmware à mettre à jour » tant qu’elle est plus ancienne.
                  </p>
                </Disclosure>
              ) : null}
              {selected.id === "r4Tft28" ? (
                <Disclosure title="Facultatif — ajouter une carte microSD pour le cartel et les animations">
                  <p>Le TFT fonctionne sans microSD, mais la carte permet de restaurer l’œuvre après un redémarrage, de masquer le cartel et de conserver localement les animations. Utilisez une microSD formatée en FAT ou FAT32.</p>
                </Disclosure>
              ) : null}
            </div>
          </div>
        </div>
      </InstallStep>

      <InstallStep number={7} title="Laisser le premier démarrage se terminer" icon={<KeyRound size={20} />} id="install-step-7">
        <Callout tone="warning" title="Le premier affichage peut demander jusqu’à 15 minutes">
          <p>
            Après le câblage et le téléversement du code avec votre Wi-Fi, ne débranchez pas la carte si l’écran semble encore vide.
            La génération et l’affichage successif des clés, puis du QR code et du code d’appairage, peuvent prendre plusieurs minutes.
            Attendez jusqu’à <strong>15 minutes</strong> avant de commencer le dépannage.
          </p>
        </Callout>
        <p>
          Pendant cette phase, l’écran peut se rafraîchir plusieurs fois. Les informations de clé sont montrées avant l’écran
          d’appairage. Gardez-les privées et attendez l’apparition du QR code ou du code d’appairage à 8 caractères (par exemple <Code>ABCD2345</Code>).
        </p>
        <Disclosure title="Voir ce qui se passe dans le Moniteur série">
          <p>
            Ouvrez <MenuPath steps={["Outils", "Moniteur série"]} /> et sélectionnez <Code>115200 bauds</Code>.
            Vous pourrez suivre la connexion Wi-Fi, l’enregistrement de l’appareil et la création du code d’appairage.
          </p>
          <CodeBlock>{`[WIFI] Connexion....
[WIFI] IP: 192.168.x.x
[REGISTER] deviceId: dev_XXXXXXXX
[REGISTER] paired: non`}</CodeBlock>
          <p>
            Si vous voyez à la place un message d’échec de connexion Wi-Fi, vérifiez le nom du réseau, le mot de passe et que le réseau est bien
            en 2,4 GHz (après un changement de box, le nom ou le mot de passe peut avoir changé).
          </p>
        </Disclosure>
      </InstallStep>

      <InstallStep number={8} title="Associer l’écran et afficher le premier dessin" icon={<Wifi size={20} />} id="install-step-8">
        <div id="onboard" className={styles.anchorOffset} />
        <p>
          Scannez le QR code affiché ou ouvrez la page <Link href="/onboard">Onboard</Link> et saisissez le code d’appairage.
          Choisissez ensuite votre nom d’artiste. L’appareil apparaîtra dans votre <Link href="/profile">profil</Link>.
        </p>
        <div className={styles.finishActions} id="draw">
          <Link className={styles.primaryButton} href="/onboard">Associer mon écran</Link>
          <Link className={styles.secondaryButton} href="/draw">Faire mon premier dessin</Link>
        </div>

        <Disclosure title="L’écran ne fonctionne pas ? Ouvrir la checklist de dépannage">
          <p className={styles.debugIntro}>
            Cette liste est facultative. Utilisez-la seulement si rien ne s’affiche après avoir attendu le premier démarrage complet.
          </p>
          <div className={styles.debugChecklist}>
            {[
              "J’ai attendu jusqu’à 15 minutes après le premier démarrage.",
              selected.installScreenId === "tft28"
                ? "Le shield est correctement enfiché sur l’UNO R4, hors tension lors de sa manipulation."
                : "L’écran est alimenté depuis 3V3 et GND est commun.",
              "Le câblage correspond exactement au profil sélectionné en haut du guide.",
              "Le firmware téléchargé correspond à ce même profil.",
              selected.boardId === "unoR4"
                ? "SECRET_WIFI_SSID et SECRET_WIFI_PASSWORD sont remplis dans secrets.h."
                : "WIFI_SSID et WIFI_PASSWORD sont remplis entre guillemets.",
              "Le réseau Wi-Fi utilisé est disponible en 2,4 GHz.",
              `${board.shortName} et le bon port sont sélectionnés dans Arduino IDE.`,
              "Le téléversement s’est terminé sans erreur.",
              "Le Moniteur série à 115200 bauds montre une connexion Wi-Fi.",
            ].map((item) => (
              <label key={item}><input type="checkbox" /> <span>{item}</span></label>
            ))}
          </div>
          <Callout tone="warning" title="Si l’écran reste noir">
            <p>
              Vérifiez d’abord l’alimentation, puis les fils de données et d’horloge. Pour un e-ink, contrôlez aussi le fil
              <Code> BUSY</Code>. Pour un OLED, vérifiez l’adresse I²C <Code>0x3C</Code> ou <Code>0x3D</Code>.
            </p>
          </Callout>
        </Disclosure>
      </InstallStep>

      <div className={styles.installComplete}>
        <CheckCircle2 size={24} aria-hidden />
        <div><strong>Installation terminée</strong><span>Votre écran peut maintenant participer au réseau et recevoir les œuvres validées.</span></div>
      </div>
    </section>
  );
}
