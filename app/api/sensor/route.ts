// app/api/sensor/route.ts — capteur de température (UNO R4 WiFi + DHT22).
//   POST  la carte poste UNE mesure par heure : { deviceId, pairCode, c: dixièmes de °C, h?: dixièmes de % }
//   GET   ?deviceId=…&hours=168 — historique, réservé au PROPRIÉTAIRE de l'appareil (cookie de session), 1 LRANGE
// Coûts Redis et décisions : lib/sensorData.ts. Aucune écriture si la mesure arrive moins de 50 min après la précédente (SET NX, 1 commande).

import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { getDevice, writeDeviceKey } from "@/lib/deviceStore";
import { checkRateLimit, getIP, tooManyRequests } from "@/lib/rateLimit";
import { sessionOwnsDevice } from "@/lib/session";
import {
  SENSOR_KEEP, SENSOR_MIN_INTERVAL_SEC, SENSOR_TTL_SEC, clampHours, decodeReadings, encodeReading, isSensorScreens, parseReading, sensorGateKey, sensorKey, summarize,
} from "@/lib/sensorData";

export async function POST(req: NextRequest) {
  const ip = getIP(req);
  try {
    // 60 requêtes / heure / IP : une carte en poste 1 ; large pour plusieurs capteurs derrière une même box
    const rl = await checkRateLimit({ route: "sensor", id: ip, limit: parseInt(process.env.SENSOR_LIMIT_PER_HOUR ?? "60"), windowSec: 3600, strikeId: ip, strikeType: "ip" });
    if (!rl.allowed) return tooManyRequests(rl.retryAfter);

    const body = await req.json().catch(() => null);
    const deviceId = typeof body?.deviceId === "string" ? body.deviceId : "";
    const pairCode = typeof body?.pairCode === "string" ? body.pairCode : "";
    if (!/^dev_[A-Z0-9]{8}$/.test(deviceId) || pairCode.length === 0) return NextResponse.json({ error: "deviceId et pairCode requis" }, { status: 400 });
    const reading = parseReading(body);
    if (!reading.ok) return NextResponse.json({ error: reading.error }, { status: 400 });

    const device = await getDevice(deviceId);
    if (!device) return NextResponse.json({ error: "device inconnu" }, { status: 404 });
    if (device.pairCode !== pairCode) return NextResponse.json({ error: "code invalide" }, { status: 403 });
    if (!isSensorScreens(device.screens)) return NextResponse.json({ error: "cet appareil n'est pas un capteur" }, { status: 400 });
    if (!device.artistId && !device.artistName) return NextResponse.json({ error: "capteur non appairé" }, { status: 403 });

    // anti-rafale : une mesure toutes les 50 min au plus (un redémarrage en boucle ne coûte qu'une commande)
    const gate = await redis.set(sensorGateKey(deviceId), "1", { nx: true, ex: SENSOR_MIN_INTERVAL_SEC });
    if (gate === null) return NextResponse.json({ ok: true, stored: false, nextSec: SENSOR_MIN_INTERVAL_SEC });

    const t = Math.floor(Date.now() / 1000);
    const key = sensorKey(deviceId);
    await redis.pipeline().lpush(key, encodeReading({ t, c: reading.c, ...(reading.h !== undefined ? { h: reading.h } : {}) })).ltrim(key, 0, SENSOR_KEEP - 1).expire(key, SENSOR_TTL_SEC).exec();

    device.lastSeen = Date.now(); device.lastPing = Date.now();   // présence (la fiche d'un appairé vit 90 j, rafraîchie ici)
    await writeDeviceKey(device);
    return NextResponse.json({ ok: true, stored: true, t, nextSec: SENSOR_MIN_INTERVAL_SEC });
  } catch (err) {
    console.error("[/api/sensor POST]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const deviceId = req.nextUrl.searchParams.get("deviceId") ?? "";
    if (!/^dev_[A-Z0-9]{8}$/.test(deviceId)) return NextResponse.json({ error: "deviceId invalide" }, { status: 400 });
    if (!(await sessionOwnsDevice(deviceId))) return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    const hours = clampHours(req.nextUrl.searchParams.get("hours"));
    const raws = await redis.lrange(sensorKey(deviceId), 0, hours - 1);
    const readings = decodeReadings(raws as unknown[]);
    return NextResponse.json({ deviceId, hours, readings, summary: summarize(readings) }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (err) {
    console.error("[/api/sensor GET]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
