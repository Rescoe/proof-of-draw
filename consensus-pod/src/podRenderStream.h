// podRenderStream.h — NOYAU DE RENDU EN FLUX À MÉMOIRE BORNÉE (lot 8B-1) : même résultat, bit pour bit, que le rasteriseur de référence (podRender.h / lib/renderLayout.ts, layoutVersion 1), SANS grille logique.
//
//   e-ink 2,9″ / 2,7″  PodEinkRenderer   : lit les plans REÇUS (en mémoire de l'appelant, jamais modifiés) et produit les octets du pilote par morceaux de n'importe quelle taille (≥ 1 octet) ;
//                                          chaque octet est calculé à la demande depuis les pixels sources (fit / overlay / cartel) — aucun tampon image, aucune grille. Sortie = tampon de l'appelant.
//   TFT 1,8″           PodTftRenderer    : compositeur LIGNE PAR LIGNE : une ligne source (256 o) + une ligne de sortie (256 o), fournies par l'appelant ; le fit est monotone (la ligne source ne revient jamais en arrière).
//   OLED, TFT 2,8″, hidden   PodPassHasher : aucun traitement, les deux hashes sont alimentés par les mêmes octets (sans cartel gravé, ou mode « hidden »).
//   PodFrameHasher     : frameHash de l'e-ink, alimenté PAR MORCEAUX pendant le téléchargement (sans besoin des plans entiers pour le hash).
//
// frameHash = hash des octets REÇUS ; renderHash = hash des octets EXACTEMENT remis au pilote (chaque octet produit est haché avant de revenir à l'appelant). Les domaines sont ceux de podRender.h (gelés).
// Alimentation progressive : read() / emitRow() rendent la main à chaque appel — l'appelant peut yield() / nourrir le chien de garde entre deux appels (coût borné : ≤ 8 pixels par octet produit, ≤ 128 pixels par ligne TFT).
// Paramètres invalides, entrées tronquées, ordre d'appels incorrect : toujours un retour `false` / 0 et l'état FAILED (jamais un hash plausible) ; aucune exception, aucune allocation, aucun flottant, aucune STL.
// ⚠ VERSION HÔTE VÉRIFIÉE PAR DIFFÉRENTIEL (consensus-pod/host/render_stream_harness.cpp) + COMPILÉE pour ESP8266 / UNO R4 (consensus-pod/examples/RenderProbe*). JAMAIS ESSAYÉE SUR UNE CARTE, branchée sur aucun firmware.
#pragma once
#include "podRender.h"

#define POD_R_TEXT_MAX 49        // 48 caractères + NUL (e-ink 2,9″ : ⌊(296−4)/6⌋ = 48)
#define POD_R_MAX_ROW_BYTES 256  // ligne TFT 1,8″ : 128 × 2

enum PodRState { POD_RS_IDLE = 0, POD_RS_RUNNING, POD_RS_DONE, POD_RS_FINISHED, POD_RS_FAILED };

/** Une ligne de texte à graver : chaîne repliée, longueur, abscisse du premier caractère. */
struct PodRLine { char s[POD_R_TEXT_MAX]; uint8_t n; int16_t x; };
/** Le pixel (x, ligne `dy` de 0 à 6 du texte) du texte est-il allumé ? (5 colonnes allumées sur 6 d'avance, bit 0 de la colonne = ligne du haut) */
static inline bool pod_rline_bit(const PodRLine& L, int x, int dy) {
  const int rx = x - L.x;
  if (rx < 0 || rx >= (int)L.n * POD_R_ADVANCE) return false;
  const int c = rx % POD_R_ADVANCE;
  if (c >= 5) return false;
  return ((POD_FONT_5X7[pod_render_glyph(L.s[rx / POD_R_ADVANCE])][c] >> dy) & 1) != 0;
}
static inline void pod_rline_set(PodRLine& L, int w, bool centered, int x) {
  L.n = (uint8_t)pod_render_strlen(L.s);
  if (centered) { int tx = (w - (int)L.n * POD_R_ADVANCE) / 2; L.x = (int16_t)(tx < 0 ? 0 : tx); } else L.x = (int16_t)x;
}

/** Géométrie entière dérivée d'un écran (identique à lib/renderLayout.ts : fitGrid). */
struct PodRGeom { int16_t w, h, top1, bot0, safe0, safeH, nw, x0, bpr; uint8_t planes; bool eink; };
static inline PodRGeom pod_render_geom(const PodRenderSpec& s) {
  PodRGeom g;
  g.w = (int16_t)s.w; g.h = (int16_t)s.h; g.top1 = (int16_t)s.top1; g.bot0 = (int16_t)s.bot0; g.safe0 = (int16_t)(s.top1 + 1);
  g.safeH = (int16_t)(s.cartel ? s.bot0 - 1 - s.top1 : s.h);
  g.nw = (int16_t)(((uint32_t)s.w * (uint32_t)g.safeH) / s.h); g.x0 = (int16_t)((s.w - g.nw) / 2);
  g.bpr = (int16_t)(s.eink ? s.h / 8 : 0); g.planes = s.planes; g.eink = s.eink;
  return g;
}
static inline bool pod_render_mode_valid(PodRenderMode m) { return (unsigned)m <= (unsigned)POD_R_HIDDEN; }
static inline bool pod_render_meta_valid(const PodRenderMeta& m) { return (m.tsLen == 0 || m.ts) && (m.artistLen == 0 || m.artist) && (m.titleLen == 0 || m.title); }

/** Préfixes de hash (domaines gelés) ; retournent la longueur écrite, 0 en cas de dépassement. */
static inline size_t pod_render_frame_prefix(const PodRenderSpec& s, char* pre, size_t cap) {
  PodOut o(pre, cap); o.str("pod-frame-v1|"); o.str(s.name); o.ch('|'); o.u64(s.w); o.ch('x'); o.u64(s.h); o.ch('|'); o.u64(s.planes); o.ch('|');
  return o.ok ? o.pos : 0;
}
static inline size_t pod_render_render_prefix(const PodRenderSpec& s, PodRenderMode mode, char* pre, size_t cap) {
  PodOut o(pre, cap); o.str("pod-render-v1|"); o.str(s.name); o.ch('|'); o.u64(s.w); o.ch('x'); o.u64(s.h); o.ch('|'); o.u64(s.planes); o.ch('|');
  o.u64(POD_RENDER_LAYOUT_VERSION); o.ch('|'); o.str(pod_render_mode_name(mode)); o.ch('|');
  return o.ok ? o.pos : 0;
}
template <class Sha> static inline bool pod_render_hash_begin_frame(Sha& h, const PodRenderSpec& s) { char pre[64]; const size_t n = pod_render_frame_prefix(s, pre, sizeof(pre)); if (!n) return false; h.begin(); h.update(pre, n); return true; }
template <class Sha> static inline bool pod_render_hash_begin_render(Sha& h, const PodRenderSpec& s, PodRenderMode mode) { char pre[96]; const size_t n = pod_render_render_prefix(s, mode, pre, sizeof(pre)); if (!n) return false; h.begin(); h.update(pre, n); return true; }
template <class Sha> static inline void pod_render_hash_end(Sha& h, char out[65]) { uint8_t d[32]; h.finish(d); pod_hex(d, 32, out); }
/** Taille exacte (octets) de l'image reçue pour cet écran : tous les plans. */
static inline uint32_t pod_render_frame_bytes(const PodRenderSpec& s) { return (uint32_t)s.planes * pod_render_plane_bytes(s); }

// ─── frameHash alimenté par morceaux ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
template <class Sha> struct PodFrameHasher {
  Sha sha; uint32_t got, total; uint8_t state;
  PodFrameHasher() : got(0), total(0), state(POD_RS_IDLE) {}
  bool begin(const PodRenderSpec& s) {
    got = 0; total = pod_render_frame_bytes(s);
    state = pod_render_hash_begin_frame(sha, s) ? POD_RS_RUNNING : POD_RS_FAILED;
    return state == POD_RS_RUNNING;
  }
  /** Octets REÇUS, dans l'ordre (plan noir puis plan rouge). Dépasser la taille attendue fait échouer le hash. */
  bool update(const void* d, size_t n) {
    if (state != POD_RS_RUNNING) return false;
    if ((n && !d) || n > (size_t)(total - got)) { state = POD_RS_FAILED; return false; }
    if (n) sha.update(d, n);
    got += (uint32_t)n; return true;
  }
  /** Faux (et FAILED) si l'image n'a pas été reçue en entier. */
  bool finish(char hex[65]) {
    if (state != POD_RS_RUNNING || got != total) { state = POD_RS_FAILED; return false; }
    pod_render_hash_end(sha, hex); state = POD_RS_FINISHED; return true;
  }
};

// ─── Sans traitement : frameHash et renderHash sur les mêmes octets ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
template <class Sha> struct PodPassHasher {
  Sha frame, render; uint32_t got, total; uint8_t state;
  PodPassHasher() : got(0), total(0), state(POD_RS_IDLE) {}
  /** Valable pour un écran SANS cartel gravé (OLED, TFT 2,8″), ou le mode « hidden » de n'importe quel écran. */
  bool begin(const PodRenderSpec& s, PodRenderMode mode) {
    got = 0; total = pod_render_frame_bytes(s); state = POD_RS_FAILED;
    if (!pod_render_mode_valid(mode) || (s.cartel && mode != POD_R_HIDDEN)) return false;
    if (!pod_render_hash_begin_frame(frame, s) || !pod_render_hash_begin_render(render, s, mode)) return false;
    state = POD_RS_RUNNING; return true;
  }
  bool update(const void* d, size_t n) {
    if (state != POD_RS_RUNNING) return false;
    if ((n && !d) || n > (size_t)(total - got)) { state = POD_RS_FAILED; return false; }
    if (n) { frame.update(d, n); render.update(d, n); }
    got += (uint32_t)n; return true;
  }
  bool finish(char frameHex[65], char renderHex[65]) {
    if (state != POD_RS_RUNNING || got != total) { state = POD_RS_FAILED; return false; }
    pod_render_hash_end(frame, frameHex); pod_render_hash_end(render, renderHex); state = POD_RS_FINISHED; return true;
  }
};

// ─── E-ink : octets du pilote calculés à la demande depuis les plans reçus ─────────────────────────────────────────────────────────────────────────────────────────────────────
template <class Sha> struct PodEinkRenderer {
  Sha sha;                         // renderHash
  PodRGeom g; PodRLine top, bot;
  const uint8_t* src[2];
  uint32_t pos, perPlane, total;
  uint8_t mode, state; bool pass;

  PodEinkRenderer() : pos(0), perPlane(0), total(0), mode(0), state(POD_RS_IDLE), pass(false) { src[0] = src[1] = 0; top.n = bot.n = 0; top.x = bot.x = 0; top.s[0] = bot.s[0] = 0; g = pod_render_geom(pod_render_spec(POD_R_EINK29)); }

  /** `p0` / `p1` : plans reçus (p1 ignoré hors BWR), `planeLen` : octets de CHAQUE plan (doit valoir exactement la taille du profil). Les plans doivent rester intacts jusqu'à la fin du rendu. */
  bool begin(const PodRenderSpec& s, PodRenderMode m, const PodRenderMeta& meta, const uint8_t* p0, const uint8_t* p1, uint32_t planeLen) {
    state = POD_RS_FAILED; pos = 0;
    if (!s.eink || !s.cartel || !pod_render_mode_valid(m) || !pod_render_meta_valid(meta) || !p0 || (s.planes > 1 && !p1)) return false;
    if (planeLen != pod_render_plane_bytes(s) || (size_t)((s.w - 4) / POD_R_ADVANCE) + 1 > POD_R_TEXT_MAX) return false;
    g = pod_render_geom(s); mode = (uint8_t)m; src[0] = p0; src[1] = s.planes > 1 ? p1 : 0; perPlane = planeLen; total = (uint32_t)s.planes * planeLen;
    pass = (m == POD_R_HIDDEN);
    if (!pass) {
      pod_render_top_line(s, meta, top.s); pod_rline_set(top, s.w, true, 0);
      pod_render_bottom_line(meta, (size_t)((s.w - 4) / POD_R_ADVANCE), bot.s); pod_rline_set(bot, s.w, true, 0);
    }
    if (!pod_render_hash_begin_render(sha, s, m)) return false;
    state = POD_RS_RUNNING; return true;
  }

  /** Pixel logique de l'image reçue : 0 blanc, 1 noir, 2 rouge (le rouge l'emporte). */
  uint8_t srcPixel(int sx, int sy) const {
    const int bufCol = g.h - 1 - sy, idx = sx * g.bpr + (bufCol >> 3), bit = 7 - (bufCol & 7);
    if (src[1] && !((src[1][idx] >> bit) & 1)) return POD_R_RED;
    return ((src[0][idx] >> bit) & 1) ? POD_R_WHITE : POD_R_BLACK;
  }
  /** Pixel du cartel (bandes blanchies, séparateurs noirs, texte noir) pour une ligne y hors zone sûre. */
  uint8_t cartelPixel(int x, int y) const {
    if (y < g.top1) return (y >= 3 && y <= 9 && pod_rline_bit(top, x, y - 3)) ? POD_R_BLACK : POD_R_WHITE;
    if (y == g.top1 || y == g.bot0) return POD_R_BLACK;
    return (y >= g.bot0 + 3 && y <= g.bot0 + 9 && pod_rline_bit(bot, x, y - g.bot0 - 3)) ? POD_R_BLACK : POD_R_WHITE;
  }
  /** Pixel final (x, y) ; `sx` = colonne source déjà projetée (fit) ou x, -1 si hors de l'image ajustée. */
  uint8_t pixel(int x, int sx, int y) const {
    if (y < g.safe0 || y >= g.bot0) return cartelPixel(x, y);
    if (sx < 0) return POD_R_WHITE;
    if (mode == POD_R_FIT) return srcPixel(sx, (int)((((uint32_t)(2 * (y - g.safe0) + 1)) * (uint32_t)g.h) / (uint32_t)(2 * g.safeH)));
    return srcPixel(sx, y);
  }
  /** Octet `idx` du plan `plane` tel que transmis au pilote. */
  uint8_t byteAt(int plane, uint32_t idx) const {
    if (pass) return src[plane][idx];
    const int x = (int)(idx / (uint32_t)g.bpr), k = (int)(idx % (uint32_t)g.bpr);
    int sx = x;
    if (mode == POD_R_FIT) sx = (x < g.x0 || x >= g.x0 + g.nw) ? -1 : (int)((((uint32_t)(2 * (x - g.x0) + 1)) * (uint32_t)g.w) / (uint32_t)(2 * g.nw));
    uint8_t b = 0xFF;
    for (int j = 0; j < 8; j++) {
      const uint8_t v = pixel(x, sx, g.h - 1 - (8 * k + j));
      if (plane == 0 ? v == POD_R_BLACK : v == POD_R_RED) b = (uint8_t)(b & ~(1 << (7 - j)));
    }
    return b;
  }

  uint32_t totalBytes() const { return total; }
  uint32_t produced() const { return pos; }
  bool done() const { return state == POD_RS_DONE || state == POD_RS_FINISHED; }

  /** Produit au plus `cap` octets du pilote (plan noir en entier, puis plan rouge), les hache, les range dans `out`. Retourne le nombre d'octets (0 : terminé ou erreur). */
  uint32_t read(uint8_t* out, uint32_t cap) {
    if (state != POD_RS_RUNNING || !out || cap == 0) return 0;
    uint32_t n = 0;
    while (n < cap && pos < total) {
      const int plane = pos >= perPlane ? 1 : 0;
      out[n++] = byteAt(plane, pos - (uint32_t)plane * perPlane); pos++;
    }
    sha.update(out, n);
    if (pos == total) state = POD_RS_DONE;
    return n;
  }
  /** renderHash des octets produits. Faux tant que tout n'a pas été produit. */
  bool finish(char hex[65]) {
    if (state != POD_RS_DONE) { state = POD_RS_FAILED; return false; }
    pod_render_hash_end(sha, hex); state = POD_RS_FINISHED; return true;
  }
};

// ─── TFT 1,8″ : compositeur ligne par ligne ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Protocole de l'appelant (une ligne source + une ligne de sortie, rien d'autre) :
//     r.begin(...);
//     while (!r.allRowsEmitted()) {
//       while (r.needsSource()) { lire la ligne source suivante dans `src` ; r.consumeSource(src); }
//       r.emitRow(src, out);  écrire `out` sur le pilote ;
//     }
//     while (r.sourceRemaining()) { lire la ligne source suivante dans `src` ; r.consumeSource(src); }   // l'image reçue doit être hachée EN ENTIER
//     r.finish(frameHex, renderHex);
// En fit, la ligne source nécessaire est strictement croissante (zone sûre < hauteur) : jamais de retour en arrière.
template <class Sha> struct PodTftRenderer {
  Sha frameSha, renderSha;
  PodRGeom g; PodRLine bot, rescoe, label;
  uint16_t srcY, outY, rowBytes; uint8_t mode, state;

  PodTftRenderer() : srcY(0), outY(0), rowBytes(0), mode(0), state(POD_RS_IDLE) { bot.n = rescoe.n = label.n = 0; bot.x = rescoe.x = label.x = 0; bot.s[0] = rescoe.s[0] = label.s[0] = 0; g = pod_render_geom(pod_render_spec(POD_R_TFT18)); }

  bool begin(const PodRenderSpec& s, PodRenderMode m, const PodRenderMeta& meta) {
    state = POD_RS_FAILED; srcY = outY = 0;
    if (s.eink || !s.cartel || !pod_render_mode_valid(m) || !pod_render_meta_valid(meta)) return false;
    if ((uint32_t)s.w * 2 > POD_R_MAX_ROW_BYTES || (size_t)((s.w - 6) / POD_R_ADVANCE) + 1 > POD_R_TEXT_MAX) return false;
    g = pod_render_geom(s); mode = (uint8_t)m; rowBytes = (uint16_t)(s.w * 2);
    if (m != POD_R_HIDDEN) {
      pod_render_bottom_line(meta, (size_t)((s.w - 6) / POD_R_ADVANCE), bot.s); pod_rline_set(bot, s.w, false, 3);
      const char R[] = "RESCOE"; for (int i = 0; i < 7; i++) rescoe.s[i] = R[i]; pod_rline_set(rescoe, s.w, false, 3);
      label.n = 0; label.s[0] = 0;
      if (meta.blockIndex >= 0) { char num[24]; const int k = pod_utoa((uint64_t)meta.blockIndex, num); label.s[0] = '#'; for (int i = 0; i <= k && 1 + i < POD_R_TEXT_MAX; i++) label.s[1 + i] = num[i]; label.s[POD_R_TEXT_MAX - 1] = 0; const int lx = s.w - 3 - (1 + k) * POD_R_ADVANCE; pod_rline_set(label, s.w, false, lx < 50 ? 50 : lx); }
    }
    if (!pod_render_hash_begin_frame(frameSha, s) || !pod_render_hash_begin_render(renderSha, s, m)) return false;
    state = POD_RS_RUNNING; return true;
  }

  bool allRowsEmitted() const { return outY >= g.h; }
  bool sourceRemaining() const { return srcY < g.h; }
  /** Ligne source requise pour produire la prochaine ligne de sortie, ou -1 (ligne de bandeau : aucune ligne source). */
  int sourceRowNeeded() const {
    if (state != POD_RS_RUNNING || outY >= g.h) return -1;
    const int y = outY;
    if (mode == POD_R_HIDDEN) return y;
    if (y < g.safe0 || y >= g.bot0) return -1;
    return mode == POD_R_OVERLAY ? y : (int)((((uint32_t)(2 * (y - g.safe0) + 1)) * (uint32_t)g.h) / (uint32_t)(2 * g.safeH));
  }
  /** Faut-il encore lire une ligne source avant de pouvoir produire la ligne de sortie ? */
  bool needsSource() const { const int need = sourceRowNeeded(); return need >= 0 && (int)srcY <= need; }
  /** Ligne source reçue (rowBytes octets), dans l'ordre ; alimente le frameHash. */
  bool consumeSource(const uint8_t* row) {
    if (state != POD_RS_RUNNING || srcY >= g.h || !row) { state = POD_RS_FAILED; return false; }
    frameSha.update(row, rowBytes); srcY++; return true;
  }
  uint16_t cartelWord(int x, int y) const {
    if (y < g.top1) {
      if (y >= 4 && y <= 10) { if (pod_rline_bit(rescoe, x, y - 4)) return POD_T_GOLD; if (pod_rline_bit(label, x, y - 4)) return POD_T_GREY; }
      return POD_T_DARK;
    }
    if (y == g.top1 || y == g.bot0) return POD_T_GOLD;
    return (y >= g.bot0 + 4 && y <= g.bot0 + 10 && pod_rline_bit(bot, x, y - g.bot0 - 4)) ? POD_T_WHITE : POD_T_DARK;
  }
  /** Compose la prochaine ligne de sortie (`out` : rowBytes octets) ; `src` = dernière ligne source consommée (requise seulement si sourceRowNeeded() ≥ 0). */
  bool emitRow(const uint8_t* srcRow, uint8_t* out) {
    if (state != POD_RS_RUNNING || outY >= g.h || !out) { state = POD_RS_FAILED; return false; }
    const int y = outY, need = sourceRowNeeded();
    if (need >= 0 && (!srcRow || (int)srcY != need + 1)) { state = POD_RS_FAILED; return false; }
    if (mode == POD_R_HIDDEN || (mode == POD_R_OVERLAY && need >= 0)) memcpy(out, srcRow, rowBytes);
    else for (int x = 0; x < g.w; x++) {
      uint16_t v;
      if (need < 0) v = cartelWord(x, y);
      else if (x < g.x0 || x >= g.x0 + g.nw) v = POD_T_WHITE;
      else { const int sx = (int)((((uint32_t)(2 * (x - g.x0) + 1)) * (uint32_t)g.w) / (uint32_t)(2 * g.nw)); v = (uint16_t)(srcRow[2 * sx] | (srcRow[2 * sx + 1] << 8)); }
      out[2 * x] = (uint8_t)(v & 0xFF); out[2 * x + 1] = (uint8_t)(v >> 8);
    }
    renderSha.update(out, rowBytes); outY++; return true;
  }
  /** Faux (et FAILED) si une ligne de sortie manque ou si l'image reçue n'a pas été consommée en entier. */
  bool finish(char frameHex[65], char renderHex[65]) {
    if (state != POD_RS_RUNNING || outY != g.h || srcY != g.h) { state = POD_RS_FAILED; return false; }
    pod_render_hash_end(frameSha, frameHex); pod_render_hash_end(renderSha, renderHex); state = POD_RS_FINISHED; return true;
  }
};
