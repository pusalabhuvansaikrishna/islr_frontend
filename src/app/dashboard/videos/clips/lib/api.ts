import { BASE_URL } from "@/config/api";
import { PaginatedClips, TakeClips } from "./types";
import { getInflight, setInflight, setCachedTake, invalidateTake } from "./cache";

async function doFetch(takeId: string): Promise<TakeClips | null> {
  const res = await fetch(`${BASE_URL}/clips?take_id=${takeId}&page_size=1`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to load take (${res.status})`);
  const json: PaginatedClips = await res.json();
  const take = json.items[0] ?? null;
  if (take) setCachedTake(takeId, take);
  return take;
}

/** Fetches a single take by id, reusing /clips with take_id filtering.
 *  Dedupes concurrent calls for the same takeId (TakeModal and
 *  ClipViewerModal both fetch on mount) so only one network request fires. */
export async function fetchTakeById(takeId: string): Promise<TakeClips | null> {
  const existing = getInflight(takeId);
  if (existing) return existing;

  const p = doFetch(takeId);
  setInflight(takeId, p);
  return p;
}

/** Forces a fresh fetch, bypassing any inflight/cached value — use after a
 *  mutation (delete, transcript edit) that we know invalidates the cache. */
export async function refetchTakeById(takeId: string): Promise<TakeClips | null> {
  invalidateTake(takeId);
  return fetchTakeById(takeId);
}