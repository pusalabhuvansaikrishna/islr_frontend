import { TakeClips } from "./types";

interface CacheEntry {
  data: TakeClips;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<TakeClips | null>>();

export function getCachedTake(takeId: string): TakeClips | null {
  return cache.get(takeId)?.data ?? null;
}

export function setCachedTake(takeId: string, data: TakeClips) {
  cache.set(takeId, { data, timestamp: Date.now() });
}

export function invalidateTake(takeId: string) {
  cache.delete(takeId);
}

export function getInflight(takeId: string): Promise<TakeClips | null> | undefined {
  return inflight.get(takeId);
}

export function setInflight(takeId: string, p: Promise<TakeClips | null>) {
  inflight.set(takeId, p);
  p.finally(() => inflight.delete(takeId));
}