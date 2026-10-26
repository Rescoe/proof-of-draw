"use client";
// Recherche et filtres de la page Apprendre : un champ, trois profondeurs, cinq types. Tout est calculé dans le navigateur à partir du catalogue (aucune requête, aucun Redis).
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DEPTHS, DEPTH_HINT, DEPTH_LABEL, KINDS, KIND_LABEL, PATH_LABEL, facetCounts, hrefOf, searchCatalog,
  type CatalogEntry, type Depth, type Kind,
} from "../../../lib/learnCatalog";
import styles from "../learn.module.css";

const SUGGESTIONS = ["wifi", "câblage", "batterie", "vote", "port usb", "ota", "licence"];

export function LearnFinder({ entries, initialQuery = "" }: { entries: CatalogEntry[]; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [depth, setDepth] = useState<Depth | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);

  const results = useMemo(() => searchCatalog(entries, { query, depth, kind }), [entries, query, depth, kind]);
  const counts = useMemo(() => facetCounts(entries, { query, depth, kind }), [entries, query, depth, kind]);
  const filtered = query.trim() !== "" || depth !== null || kind !== null;

  function updateQuery(v: string) {
    setQuery(v);
    try {   // adresse partageable : /learn?q=wifi
      const url = new URL(window.location.href);
      if (v.trim()) url.searchParams.set("q", v.trim()); else url.searchParams.delete("q");
      window.history.replaceState(null, "", url.toString());
    } catch { /* adresse non modifiable : sans importance */ }
  }
  const reset = () => { updateQuery(""); setDepth(null); setKind(null); };

  const row = (e: CatalogEntry) => (
    <li key={e.id}>
      <Link href={hrefOf(e)} className={styles.finderRow}>
        <span className={styles.finderTitle}>{e.title}</span>
        <span className={styles.finderSummary}>{e.summary}</span>
        <span className={styles.finderMeta}>
          <span className={`${styles.finderBadge} ${styles[`kind_${e.kind}`]}`}>{KIND_LABEL[e.kind]}</span>
          <span className={styles.finderBadge}>{DEPTH_LABEL[e.depth]}</span>
          <span className={styles.finderPath}>{PATH_LABEL[e.path]}</span>
        </span>
      </Link>
    </li>
  );

  return (
    <section className={styles.finder} id="recherche" aria-labelledby="finder-title">
      <div className={styles.finderHead}>
        <h2 id="finder-title">Trouver un sujet</h2>
        <p>Tape un mot (« wifi », « câblage », « batterie »…) ou filtre par niveau de profondeur et par type de contenu. Rien n’est caché : tout le contenu reste dans ses parcours.</p>
      </div>

      <div className={styles.finderSearch}>
        <input
          type="search" value={query} onChange={(ev) => updateQuery(ev.target.value)} placeholder="Rechercher dans Apprendre…" aria-label="Rechercher dans Apprendre"
          autoComplete="off" spellCheck={false}
        />
        {filtered && <button type="button" onClick={reset} className={styles.finderReset}>Tout afficher</button>}
      </div>

      <div className={styles.finderFilters} role="group" aria-label="Niveau de profondeur">
        <span className={styles.finderFilterLabel}>Niveau</span>
        {DEPTHS.map((d) => (
          <button key={d} type="button" aria-pressed={depth === d} className={styles.finderChip} onClick={() => setDepth(depth === d ? null : d)} title={DEPTH_HINT[d]}>
            {DEPTH_LABEL[d]} <small>{counts.depth[d]}</small>
          </button>
        ))}
      </div>
      <div className={styles.finderFilters} role="group" aria-label="Type de contenu">
        <span className={styles.finderFilterLabel}>Type</span>
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} className={styles.finderChip} onClick={() => setKind(kind === k ? null : k)}>
            {KIND_LABEL[k]} <small>{counts.kind[k]}</small>
          </button>
        ))}
      </div>

      <p className={styles.finderCount} role="status" aria-live="polite">
        {filtered ? `${results.length} résultat${results.length > 1 ? "s" : ""}` : `${entries.length} sujets, classés par niveau`}
      </p>

      {results.length === 0 ? (
        <div className={styles.finderEmpty}>
          <p>Aucun sujet ne correspond. Essaie un mot plus court ou retire un filtre.</p>
          <div className={styles.finderSuggest}>
            {SUGGESTIONS.map((s) => <button key={s} type="button" className={styles.finderChip} onClick={() => { updateQuery(s); setDepth(null); setKind(null); }}>{s}</button>)}
          </div>
        </div>
      ) : filtered ? (
        <ul className={styles.finderList}>{results.map(row)}</ul>
      ) : (
        DEPTHS.map((d) => {
          const group = results.filter((r) => r.depth === d);
          if (group.length === 0) return null;
          return (
            <details key={d} className={styles.finderGroup} open={d !== "comprendre"}>
              <summary><strong>{DEPTH_LABEL[d]}</strong><span>{DEPTH_HINT[d]} · {group.length}</span></summary>
              <ul className={styles.finderList}>{group.map(row)}</ul>
            </details>
          );
        })
      )}
    </section>
  );
}
