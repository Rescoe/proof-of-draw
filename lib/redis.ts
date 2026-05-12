// lib/redis.ts
// Client Upstash Redis singleton — une seule instance par cold start
import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url:   process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});