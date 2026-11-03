"use client";
// app/measures/DataParts.tsx — éléments de l'espace « Données » (03/11/2026) : résumé de la vue d'ensemble, bande qualitative de l'air, fiche de sélection, panneau « Affichage ». Présentation seulement : aucun calcul de données ici
// (lib/chartCompose.ts, lib/chartView.ts), aucune requête (tout vient du tableau déjà chargé).
import { MEASURE_KINDS, formatMeasure, vocLevel, type Measure, type MeasureKind } from "@/lib/measures";
import { PRESETS, REPRS, bandBucketSec, bucketName, presetKinds, summarizeKind, trendBucketSec, valuesAt, neighborTime, type Dir, type Repr } from "@/lib/chartCompose";
import { bucketBands, medianStep, seriesOf, type Win } from "@/lib/chartView";
import { exactLabel } from "@/lib/measureReading";
import { KIND_COLOR } from "./palette";

const DIR_TEXT: Record<Dir, string> = { up: "↗ en hausse", down: "↘ en baisse", stable: "→ stable" };
const GROUPS: { id: string; label: string; kinds: MeasureKind[] }[] = [
  { id: "env", label: "Environnement", kinds: ["temp", "hum", "vocidx"] },
  { id: "link", label: "Connexion", kinds: ["rssi", "lat", "dl"] },
];

/** Dernière valeur, tendance courte et min / moyenne / max de la PÉRIODE, pour chaque grandeur proposée. */
export function OverviewSummary({ all, inRange, kinds, tz }: { all: Measure[]; inRange: Measure[]; kinds: MeasureKind[]; tz: number }) {
  const lastAny = kinds.map((k) => seriesOf(all, k).slice(-1)[0]).filter(Boolean).reduce((a, b) => (b.t > a.t ? b : a), { t: 0, v: 0 });
  return (
    <section className="mv-summary" aria-label="Résumé de la période">
      <div className="mv-cards">
        {kinds.map((k) => {
          const s = summarizeKind(inRange, k), lastAll = seriesOf(all, k).slice(-1)[0];
          const level = k === "vocidx" && lastAll ? vocLevel(lastAll.v) : null;
          return (
            <div key={k} className="mv-card-stat" style={{ borderTopColor: KIND_COLOR[k] }}>
              <div className="mv-card-stat__label">{MEASURE_KINDS[k].icon} {MEASURE_KINDS[k].label}</div>
              <div className="mv-card-stat__value" style={{ color: level?.color }}>{lastAll ? formatMeasure(k, lastAll.v) : "—"}</div>
              <div className="mv-card-stat__sub">{s.dir ? DIR_TEXT[s.dir] : "tendance : trop peu de mesures"}</div>
              <div className="mv-card-stat__sub">{s.n ? `min ${formatMeasure(k, s.min as number)} · moy. ${formatMeasure(k, s.avg as number)} · max ${formatMeasure(k, s.max as number)}` : "aucune mesure sur la période"}</div>
            </div>
          );
        })}
      </div>
      {lastAny.t > 0 && <p className="mv-muted">Dernière mesure : {exactLabel(lastAny.t, tz)}.</p>}
    </section>
  );
}

/** Bande qualitative de l'air alignée sous le graphique : une case par mesure, couleur = niveau (vert très faible … violet extrême). Jamais d'interpolation : sans mesure, la bande reste vide. */
export function AirStrip({ measures, win, tz }: { measures: Measure[]; win: Win; tz: number }) {
  const pts = seriesOf(measures, "vocidx");
  if (pts.length === 0) return null;
  const step = medianStep(pts), W = 720, PL = 46, PR = 46, span = win.t1 - win.t0, plot = W - PL - PR;
  const x = (t: number) => PL + ((t - win.t0) / span) * plot;
  return (
    <div className="mv-air" role="img" aria-label="Qualité de l'air : bande de niveaux, un segment par mesure">
      <svg viewBox={`0 0 ${W} 22`} className="mv-svg" aria-hidden>
        <text x={PL - 6} y={14} fontSize="10" textAnchor="end" fill={KIND_COLOR.vocidx}>Air</text>
        {pts.filter((p) => p.t >= win.t0 - step && p.t <= win.t1 + step).map((p) => <rect key={p.t} x={Math.max(PL, x(p.t - step / 2))} width={Math.max(1, Math.min(W - PR, x(p.t + step / 2)) - Math.max(PL, x(p.t - step / 2)))} y={4} height={14} rx={2} fill={vocLevel(p.v).color} opacity={0.85}><title>{`${exactLabel(p.t, tz)} : ${formatMeasure("vocidx", p.v)}`}</title></rect>)}
      </svg>
      <p className="mv-note">Bande de l’air : du vert (très faible) au violet (extrême). Segment absent = aucune mesure d’air.</p>
    </div>
  );
}

/** Fiche de sélection : valeurs de toutes les grandeurs affichées à l'instant choisi, valeurs agrégées signalées comme telles, mesure précédente / suivante. */
export function SelectionCard({ measures, kinds, sel, tz, repr, win, onSel }: { measures: Measure[]; kinds: MeasureKind[]; sel: number | null; tz: number; repr: Repr; win: Win; onSel: (t: number | null) => void }) {
  const prev = neighborTime(measures, kinds, sel, -1), next = neighborTime(measures, kinds, sel, 1);
  const nav = (
    <div className="mv-card__nav">
      <button type="button" className="mv-btn" disabled={prev === null || sel === null} onClick={() => onSel(prev)} aria-label="Mesure précédente">◀ Précédente</button>
      <button type="button" className="mv-btn" disabled={next === null || sel === null} onClick={() => onSel(next)} aria-label="Mesure suivante">Suivante ▶</button>
    </div>
  );
  if (sel === null) return <aside className="mv-card" aria-live="polite"><p className="mv-muted">Touchez un point d’un graphique pour lire ses valeurs exactes.</p></aside>;
  const vals = valuesAt(measures, kinds, sel), span = win.t1 - win.t0, sec = repr === "trend" ? trendBucketSec(span) : bandBucketSec(span);
  return (
    <aside className="mv-card" aria-live="polite">
      <div className="mv-card__title">{exactLabel(sel, tz)}</div>
      <ul className="mv-card__list">
        {vals.map((v) => {
          const agg = repr !== "points" && v.value !== null ? bucketBands(seriesOf(measures, v.kind), sec, tz).find((b) => sel >= b.start && sel < b.end) : undefined;
          return (
            <li key={v.kind}>
              <span style={{ color: KIND_COLOR[v.kind] }}>●</span> {MEASURE_KINDS[v.kind].label} :{" "}
              {v.value === null ? <i>aucune mesure à cet instant</i> : <b>{formatMeasure(v.kind, v.value)}</b>}
              {agg && <div className="mv-note">{repr === "trend" ? `Tendance ${bucketName(sec)} : moyenne ${formatMeasure(v.kind, agg.avg)}` : `Min–max ${bucketName(sec)} : ${formatMeasure(v.kind, agg.min)} à ${formatMeasure(v.kind, agg.max)}, moyenne ${formatMeasure(v.kind, agg.avg)}`} ({agg.n} mesure{agg.n > 1 ? "s" : ""}) — valeur agrégée.</div>}
            </li>
          );
        })}
      </ul>
      {nav}
    </aside>
  );
}

/** Panneau « Affichage » (replié par défaut) : données visibles, compositions prêtes, représentation, échelle, remise à zéro. Ouvert en panneau inférieur sur téléphone. */
export function DisplaySheet({ available, selected, onSelected, repr, onRepr, fullScale, onFullScale, rangeIsDay, onReset, onClose }: {
  available: MeasureKind[]; selected: MeasureKind[]; onSelected: (k: MeasureKind[]) => void; repr: Repr; onRepr: (r: Repr) => void; fullScale: boolean; onFullScale: (f: boolean) => void; rangeIsDay: boolean; onReset: () => void; onClose: () => void;
}) {
  const toggle = (k: MeasureKind) => onSelected(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
  return (
    <div className="mv-sheet" role="dialog" aria-label="Affichage des courbes">
      <div className="mv-sheet__head"><strong>Affichage</strong><button type="button" className="mv-btn" onClick={onClose}>Fermer</button></div>
      <section aria-label="Données affichées">
        <h4 className="mv-h">Choisir les données affichées</h4>
        {GROUPS.map((g) => {
          const ks = g.kinds.filter((k) => available.includes(k));
          return ks.length === 0 ? null : (
            <fieldset key={g.id} className="mv-fieldset"><legend>{g.label}</legend>
              {ks.map((k) => <label key={k} className="mv-check"><input type="checkbox" checked={selected.includes(k)} onChange={() => toggle(k)} /><span style={{ color: KIND_COLOR[k] }}>●</span> {MEASURE_KINDS[k].label}</label>)}
            </fieldset>
          );
        })}
        <p className="mv-note">{selected.length === 0 ? "Aucune donnée choisie." : selected.length === 1 ? "Une donnée : graphique simple." : selected.length === 2 ? "Deux données : un graphique, un axe à gauche et un à droite." : "Trois données ou plus : petits graphiques alignés dans le temps (jamais de superposition illisible)."}</p>
        <div className="mv-chips" role="group" aria-label="Compositions prêtes à l'emploi">
          {PRESETS.map((p) => { const ks = presetKinds(p, available); return ks.length === 0 ? null : <button key={p.id} type="button" className="mv-chip" onClick={() => onSelected(ks)}>{p.label}</button>; })}
        </div>
      </section>
      <section aria-label="Représentation">
        <h4 className="mv-h">Représentation</h4>
        <div className="mv-seg mv-seg--wrap" role="group" aria-label="Représentation des courbes">
          {REPRS.map((r) => <button key={r.id} type="button" className="mv-seg__btn" aria-pressed={repr === r.id} title={r.hint} onClick={() => onRepr(r.id)}>{r.label}</button>)}
        </div>
        <p className="mv-note">{REPRS.find((r) => r.id === repr)?.hint}.{rangeIsDay && (repr === "band" || repr === "both") ? " Sur 24 h, la bande est calculée par heure." : ""}</p>
      </section>
      <section aria-label="Échelle">
        <h4 className="mv-h">Échelle</h4>
        <div className="mv-seg" role="group" aria-label="Échelle des axes">
          <button type="button" className="mv-seg__btn" aria-pressed={!fullScale} onClick={() => onFullScale(false)}>Adaptative</button>
          <button type="button" className="mv-seg__btn" aria-pressed={fullScale} onClick={() => onFullScale(true)}>Complète</button>
        </div>
        <p className="mv-note">{fullScale ? "Domaine utile de chaque grandeur (humidité 0–100 %, air 0–500…)." : "Centrée sur ce qui est observé, avec une marge."}</p>
      </section>
      <button type="button" className="mv-btn mv-btn--wide" onClick={onReset}>Réinitialiser la vue</button>
    </div>
  );
}
