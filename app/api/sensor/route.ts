// app/api/sensor/route.ts — mesures des appareils (capteurs). Modèle générique : lib/measures.ts.
//   POST  la carte poste ses lectures en tampon : { deviceId, pairCode, r: [{ a: âge en s, temp: 211, hum: 719 }, …], m: { rssi, lat, dl } }   (dixièmes d'unité pour temp/hum ; l'ancien { m } / { c, h } est accepté)
//   GET   ?deviceId=…&hours=168   historique du PROPRIÉTAIRE (cookie), jusqu'à 31 jours, 1 LRANGE
//   GET   ?deviceId=…&public=1    historique PUBLIC des 48 dernières heures (vue réseau), mis en cache par le CDN 2 min : 1 LRANGE par minute et par appareil au plus
// Coûts Redis : lib/measures.ts. Aucune écriture si la mesure arrive trop tôt après la précédente (SET NX, 1 commande).

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice, writeDeviceKey } from "@/lib/deviceStore";
import { checkRateLimit, getIP, tooManyRequests } from "@/lib/rateLimit";
import { sessionOwnsDevice } from "@/lib/session";
import {
  MEASURE_KEEP, MEASURE_PRESENCE_REFRESH_MS, MEASURE_TTL_SEC, clampHours, decodeMeasures, encodeMeasure, measGateKey, measKey, measureKindsOf, MEASURE_INDEX_KEY, measureMinIntervalSec, parseMeasureBatch, MEASURE_KIND_IDS, summarize, type Measure,
} from "@/lib/measures";

const ID_RE = /^dev_[A-Z0-9]{8}$/;
const PUBLIC_HOURS = 48;
const PUBLIC_MAX_ENTRIES = 600;   // 48 h à 5 min = 576

export async function POST(req: NextRequest) {
  const ip = getIP(req);
  try {
    // 60 requêtes / heure / IP : une carte en poste ≤ 12 (essai à 5 min) ; large pour plusieurs capteurs derrière une même box
    const rl = await checkRateLimit({ route: "sensor", id: ip, limit: parseInt(process.env.SENSOR_LIMIT_PER_HOUR ?? "60"), windowSec: 3600, strikeId: ip, strikeType: "ip" });
    if (!rl.allowed) return tooManyRequests(rl.retryAfter);

    const body = await req.json().catch(() => null);
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId : "";
    const pairCode = typeof body?.pairCode === "string" ? body.pairCode : "";
    if (!ID_RE.test(deviceId) || pairCode.length === 0) return NextResponse.json({ error: "deviceId et pairCode requis" }, { status: 400 });
    const post = parseMeasureBatch(body);
    if (!post.ok) return NextResponse.json({ error: post.error }, { status: 400 });

    // Appareil inconnu OU code faux : même réponse 403 (aucune énumération ; le firmware se ré-inscrit)
    const device = await getDevice(deviceId);
    if (!device || device.pairCode !== pairCode) return NextResponse.json({ error: "appareil inconnu ou code invalide" }, { status: 403 });
    const kinds = measureKindsOf(device);
    if (kinds.length === 0) return NextResponse.json({ error: "cet appareil ne déclare aucun capteur" }, { status: 400 });
    if (!device.artistId && !device.artistName) return NextResponse.json({ error: "appareil non appairé" }, { status: 403 });
    // lectures datées sur l'horloge du SERVEUR (t = maintenant - âge), grandeurs non déclarées ignorées, ordre chronologique
    const nowS = Math.floor(Date.now() / 1000);
    const stored: Measure[] = post.readings
      .map((r) => ({ t: nowS - r.ageSec, v: Object.fromEntries(Object.entries(r.values).filter(([k]) => (kinds as string[]).includes(k))) as Measure["v"] }))
      .filter((m) => Object.keys(m.v).length > 0)
      .sort((a, b) => a.t - b.t);
    if (stored.length === 0) return NextResponse.json({ error: "grandeur non déclarée par cet appareil" }, { status: 400 });

    // anti-rafale (SET NX) : intervalle minimal selon la phase (essai 4 min, production 25 min ; extinction automatique de l'essai : lib/measures.ts)
    const minSec = measureMinIntervalSec();
    const gate = await redis.set(measGateKey(deviceId), "1", { nx: true, ex: minSec });
    if (gate === null) return NextResponse.json({ ok: true, stored: false, nextSec: minSec });

    const t = stored[stored.length - 1].t;
    const key = measKey(deviceId);
    // UN seul LPUSH pour toutes les lectures (la plus récente en tête) : le coût Redis ne dépend pas du nombre de lectures du lot
    await redis.pipeline().lpush(key, ...stored.map(encodeMeasure)).ltrim(key, 0, MEASURE_KEEP - 1).expire(key, MEASURE_TTL_SEC).sadd(MEASURE_INDEX_KEY, deviceId).exec();   // + index des appareils qui mesurent (idempotent : couvre un firmware qui ne se ré-inscrit pas)

    // présence : la fiche d'un appairé vit 90 j ; réécrite au plus toutes les 12 h (la vue réseau lit l'heure de la dernière MESURE)
    if (Date.now() - (device.lastPing ?? 0) > MEASURE_PRESENCE_REFRESH_MS) { device.lastSeen = Date.now(); device.lastPing = Date.now(); await writeDeviceKey(device); }
    return NextResponse.json({ ok: true, stored: true, count: stored.length, t, nextSec: minSec });
  } catch (err) {
    console.error("[/api/sensor POST]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const deviceId = sp.get("deviceId") ?? "";
    if (!ID_RE.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });

    if (sp.get("public") === "1") {
      // Vue réseau publique : 48 h au plus, sans identifiant d'artiste. Seuls les appareils DÉCLARÉS capteurs sont lisibles (index meas:devices ; 1 SISMEMBER).
      if (!(await redis.sismember("meas:devices", deviceId))) return NextResponse.json({ error: "aucune mesure" }, { status: 404 });
      const raws = await redis.lrange(measKey(deviceId), 0, PUBLIC_MAX_ENTRIES - 1);
      const all = decodeMeasures(raws as unknown[]);
      const newest = all[0]?.t ?? 0;
      const measures = all.filter((m) => m.t >= newest - PUBLIC_HOURS * 3600);
      return NextResponse.json({ deviceId, measures }, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } });
    }

    if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    const hours = clampHours(sp.get("hours"));
    const raws = await redis.lrange(measKey(deviceId), 0, MEASURE_KEEP - 1);
    const all = decodeMeasures(raws as unknown[]);
    const newest = all[0]?.t ?? 0;
    const measures = all.filter((m) => m.t >= newest - hours * 3600);
    const summary = Object.fromEntries(MEASURE_KIND_IDS.map((k) => [k, summarize(measures, k)]));
    return NextResponse.json({ deviceId, hours, measures, summary }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    console.error("[/api/sensor GET]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
