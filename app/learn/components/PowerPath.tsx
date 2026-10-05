import { Callout, Code, CodeBlock, Disclosure, SectionHeading } from "./ContentPrimitives";
import {
  CHARGER_EFFICIENCY,
  COMPONENTS,
  DEFAULT_TARIFF_EUR_PER_KWH,
  POWER_SETUPS,
  PULL_BURST,
  estimateSetup,
  fleetEstimate,
  shareByPart,
} from "../data/powerProfiles";
import styles from "../learn.module.css";

const watts = (w: number) => `${w.toFixed(2).replace(".", ",")} W`;
const kwh = (v: number) => `${v.toFixed(1).replace(".", ",")} kWh`;
const euros = (v: number) => `${v.toFixed(2).replace(".", ",")} €`;
const pct = (v: number) => `${Math.round(v * 100)} %`;

export function PowerPath() {
  const rows = POWER_SETUPS.map((setup) => ({
    setup,
    typ: estimateSetup(setup),
    min: estimateSetup(setup, { scenario: "min" }),
    max: estimateSetup(setup, { scenario: "max" }),
    anim: setup.animationPart ? estimateSetup(setup, { withAnimation: true }) : null,
  }));
  const eink = rows.find((r) => r.setup.id === "eink29bwr")!;
  const tft28 = rows.find((r) => r.setup.id === "tft28")!;
  const tft28Shares = shareByPart(tft28.setup);
  const fleet = fleetEstimate({ eink29bwr: 4, eink27bwOled: 2, tft18: 2, tft28: 2 });

  return (
    <section className={styles.majorSection} id="consommation">
      <SectionHeading eyebrow="Parcours 04" title="Consommation électrique">
        <p>
          Combien coûte un écran branché 24 h/24 ? Réponse courte : de l’ordre de <strong>{euros(eink.typ.eurosYear)} à {euros(tft28.typ.eurosYear)} par an</strong>,
          soit de {watts(eink.typ.wattsWall)} à {watts(tft28.typ.wattsWall)} en continu. L’écran tactile est le plus gourmand, mais le coût reste faible.
        </p>
      </SectionHeading>

      <Callout tone="warning" title="Ce sont des estimations, pas des mesures">
        Les courants viennent de fiches techniques et de valeurs typiques publiées pour chaque composant, assemblées d’après le comportement réel des firmwares.
        Aucune mesure n’a encore été faite sur nos propres montages : un wattmètre USB (≈ 10 €) branché une heure donnera la valeur exacte de votre montage.
      </Callout>

      <div className={styles.powerTableWrap}>
        <table className={styles.powerTable}>
          <thead>
            <tr>
              <th scope="col">Montage</th>
              <th scope="col">Carte</th>
              <th scope="col">Courant 5 V</th>
              <th scope="col">Puissance (prise)</th>
              <th scope="col">Par an</th>
              <th scope="col">Coût / an</th>
              <th scope="col">Fourchette / an</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ setup, typ, min, max, anim }) => (
              <tr key={setup.id}>
                <th scope="row">
                  {setup.name}
                  {setup.untested ? <small> · firmware non testé</small> : null}
                </th>
                <td>{setup.board}</td>
                <td>{Math.round(typ.ma)} mA</td>
                <td>{watts(typ.wattsWall)}</td>
                <td>{kwh(typ.kwhYear)}</td>
                <td><strong>{euros(typ.eurosYear)}</strong>{anim ? <small>{euros(anim.eurosYear)} avec animation en boucle</small> : null}</td>
                <td>{euros(min.eurosYear)} – {euros(max.eurosYear)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.powerFootnote}>
        Tarif retenu : {DEFAULT_TARIFF_EUR_PER_KWH.toFixed(2).replace(".", ",")} €/kWh TTC. Rendement du chargeur : {pct(CHARGER_EFFICIENCY.typ)} (valeur typique).
      </p>

      <h3>Ce que cela veut dire</h3>
      <ul className={styles.powerList}>
        <li><strong>L’e-ink ne coûte presque rien par lui-même.</strong> Il ne consomme que pendant un rafraîchissement : c’est la carte ESP8266, toujours connectée, qui fait le total.</li>
        <li>
          <strong>L’écran tactile consomme environ {(tft28.typ.wattsWall / eink.typ.wattsWall).toFixed(1).replace(".", ",")} fois plus</strong> qu’un e-ink :
          le rétroéclairage ({pct(tft28Shares.find((s) => s.id === "tft28")?.share ?? 0)} du total) et la carte UNO R4 plus gourmande qu’un ESP8266.
          Cela reste environ {euros(tft28.typ.eurosYear)} par an.
        </li>
        <li><strong>Le réseau ne pèse presque rien</strong> : un pull toutes les 5 minutes ajoute en moyenne {pullMa(PULL_BURST.intervalHotS)} mA, soit moins de 1 % du courant.</li>
        <li>
          Exemple de parc (4 e-ink 2,9″, 2 e-ink + OLED, 2 TFT 1,8″, 2 TFT 2,8″) : environ <strong>{kwh(fleet.kwhYear)}</strong> par an, soit <strong>{euros(fleet.eurosYear)}</strong>.
        </li>
      </ul>

      <h3>Comment c’est calculé</h3>
      <CodeBlock>{`courant 5 V   = Σ courants des composants + rafale moyenne des pulls
puissance mur = courant × 5 V ÷ rendement du chargeur
kWh / an      = puissance mur × 8 760 h ÷ 1 000
coût / an     = kWh / an × tarif (€/kWh)`}</CodeBlock>
      <p className={styles.powerFootnote}>
        La rafale d’un pull (≈ +{PULL_BURST.extraMa} mA pendant {PULL_BURST.seconds.toString().replace(".", ",")} s) est répartie sur l’intervalle :
        5 min quand le réseau est actif (<Code>PULL_HOT_SEC</Code>), 15 min au repos, 60 s dans le pire cas. Aucun firmware n’utilise le deep-sleep : les cartes restent allumées en continu.
      </p>

      <Disclosure title="Courant retenu pour chaque composant">
        <ul className={styles.powerList}>
          {Object.values(COMPONENTS).map((c) => (
            <li key={c.id}>
              <strong>{c.label}</strong> — {c.ma.min} / <strong>{c.ma.typ}</strong> / {c.ma.max} mA (bas / typique / haut). <small>{c.basis}.</small>
            </li>
          ))}
        </ul>
      </Disclosure>

      <Disclosure title="Comment réduire la consommation">
        <ul className={styles.powerList}>
          <li><strong>TFT 2,8″ : éteindre ou atténuer le rétroéclairage</strong> après quelques minutes d’inactivité (un toucher le rallume) pourrait retirer jusqu’à la moitié du total. Idée non implémentée, à valider sur le matériel.</li>
          <li><strong>ESP8266 : mode veille du modem Wi-Fi</strong> entre deux pulls. Gain possible mais à tester : le firmware doit rester joignable pour les validations.</li>
          <li><strong>Un chargeur de qualité</strong> (rendement ≥ 80 %) réduit la consommation prise sur la prise murale.</li>
          <li>Plusieurs écrans sur un même chargeur multiport : un seul « à vide » au lieu de plusieurs.</li>
        </ul>
      </Disclosure>
    </section>
  );
}

function pullMa(intervalS: number) {
  return ((PULL_BURST.extraMa * PULL_BURST.seconds) / intervalS).toFixed(2).replace(".", ",");
}
