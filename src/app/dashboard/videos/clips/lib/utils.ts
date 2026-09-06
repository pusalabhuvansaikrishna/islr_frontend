import { TakeClips, Cluster } from "./types";

export const PAGE_SIZE = 12;
export const AVAILABLE_ANGLES = ["Front", "Left", "Right"];
export const MAX_PREVIEW_BUBBLES = 4;
export const CAROUSEL_INTERVAL_MS = 1200;

export function formatDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Turns a raw transcript file body into plain readable text. SRT/VTT get
 *  their cue numbers and timestamp lines stripped; JSON transcripts get
 *  their text extracted. DISPLAY-ONLY — edits always operate on the raw
 *  text, never this cleaned version. */
export function cleanTranscriptText(raw: string, format: string | null): string {
  const fmt = (format || "").trim().toLowerCase();

  if (fmt === "srt" || fmt === "vtt") {
    return raw
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (/^\d+$/.test(trimmed)) return false;
        if (/-->/.test(trimmed)) return false;
        if (trimmed.toUpperCase() === "WEBVTT") return false;
        return true;
      })
      .join("\n")
      .replace(/\n{2,}/g, "\n\n")
      .trim();
  }

  if (fmt === "json") {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string") return parsed.trim();
      if (parsed && typeof parsed.text === "string") return parsed.text.trim();
      if (Array.isArray(parsed?.segments)) {
        return parsed.segments
          .map((seg: { text?: string }) => (typeof seg.text === "string" ? seg.text.trim() : ""))
          .filter(Boolean)
          .join("\n");
      }
    } catch {
      // Not actually valid JSON despite the format tag — fall through.
    }
  }

  return raw.trim();
}

export function clustersForTake(take: TakeClips): Cluster[] {
  const fromGroups: Cluster[] = take.groups.map((g) => ({
    key: g.clip_group_id,
    color: g.color,
    duration:
      g.start_time_seconds != null && g.end_time_seconds != null
        ? g.end_time_seconds - g.start_time_seconds
        : null,
    clips: g.clips,
    transcription: g.transcription,
  }));

  const fromUngrouped: Cluster[] = take.ungrouped_clips.map((c) => ({
    key: `ungrouped:${c.clip_id}`,
    color: null,
    duration: null,
    clips: [c],
    transcription: c.transcription,
  }));

  return [...fromGroups, ...fromUngrouped];
}

/** Shortest signed distance from `index` to `active` around a circular
 *  list of length `len`, so the coverflow wraps the short way. */
export function signedOffset(index: number, active: number, len: number): number {
  let diff = (((index - active) % len) + len) % len;
  if (diff > len / 2) diff -= len;
  return diff;
}

/** Coverflow-style layout for a slide `diff` positions from the front one. */
export function getCoverflowStyle(diff: number, len: number): React.CSSProperties {
  const useFar = len >= 4;

  if (diff === 0) {
    const side = useFar ? 35 : 29;
    const vert = useFar ? 12 : 10;
    return {
      inset: `${vert}% ${side}% ${vert}% ${side}%`,
      transform: "rotateY(0deg)",
      opacity: 1,
      zIndex: 5,
    };
  }

  const dir = diff > 0 ? 1 : -1;
  const isNear = Math.abs(diff) === 1;

  if (isNear) {
    const vert = useFar ? 18 : 16;
    const inset = useFar
      ? dir === 1
        ? `${vert}% 16% ${vert}% 68%`
        : `${vert}% 68% ${vert}% 16%`
      : dir === 1
      ? `${vert}% 6% ${vert}% 76%`
      : `${vert}% 76% ${vert}% 6%`;
    return { inset, transform: `rotateY(${-dir * 26}deg)`, opacity: 0.7, zIndex: 3 };
  }

  const inset = dir === 1 ? "24% 3% 24% 87%" : "24% 87% 24% 3%";
  return { inset, transform: `rotateY(${-dir * 34}deg)`, opacity: 0, zIndex: 1 };
}