"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import styles from "./ClipEditor.module.css";
import { BASE_URL } from "@/config/api";
import ClipDetailModal from "./ClipDetailModal";

// ---- Types ----
// Mirrors the backend's ClipEditorTakeDetail response_model
// (GET /takes/{take_id}/clip-editor). If you already have these types
// exported somewhere shared (e.g. "@/types/take"), swap these local defs
// for that import instead of duplicating them here.

interface RawVideoDetail {
  raw_video_id: string;
  filename: string;
  video_url: string;
  angle: string | null;
  // The ViewAngle lookup row's own id (distinct from raw_video_id) —
  // this is what the clip-detail modal's upload/delete routes
  // (/clip-groups/{id}/angles/{viewAngleId}/...) actually key off of.
  // Populated by the backend as of the /takes/{take_id}/clip-editor
  // update that added view_angle_id to RawVideoSummary.
  view_angle_id: string | null;
}

interface ClipTranscriptionSummary {
  transcription_file_id: string;
  filename: string;
  transcription_url: string;
  format: string | null;
}

export interface ClipSummary {
  clip_id: string;
  clip_group_id: string | null;
  raw_video_id: string;
  filename: string;
  video_url: string;
  start_time_seconds: number;
  end_time_seconds: number;
  color: string;
  label: string | null;
  duration_seconds: number;
  transcription: ClipTranscriptionSummary | null;
  created_at: string;
}

// One angle's clip within a clip_group — the backend cuts one Clip row
// per raw_video/view_angle for a given timeline selection, and groups
// them under a shared clip_group_id so the frontend can tell "these N
// clips are really one selection, cut across N angles" apart from N
// unrelated clips that just happen to overlap in time.
export interface ClipGroupAngle {
  raw_video_id: string;
  angle: string | null;
  clip: ClipSummary;
}

export interface ClipGroup {
  clip_group_id: string | null; // null for legacy/ungrouped single-angle clips
  start_time_seconds: number;
  end_time_seconds: number;
  color: string | null;
  label: string | null;
  angles: ClipGroupAngle[];
}

interface TakeSummary {
  take_id: string;
  name: string | null;
  raw_videos: RawVideoDetail[];
  // Existing clips already created on this take, grouped by clip_group_id
  // (each group holds one clip per view angle cut from the same timeline
  // selection), sorted by start time by the backend.
  clip_groups: ClipGroup[];
}

// One entry per angle that failed to cut/save when creating clips for a
// take — mirrors the backend's ClipCreationFailure. Surfaced in
// clipSubmitError so a partial failure (e.g. one angle's source file is
// missing on disk) doesn't get silently swallowed even though the clips
// that did succeed are already saved.
interface ClipCreationFailure {
  raw_video_id: string;
  view_angle: string | null;
  error: string;
}

// Response shape of POST /takes/{take_id}/clips — mirrors the backend's
// ClipCreateForTakeResponse.
interface ClipCreateForTakeResponse {
  clips: ClipSummary[];
  failed: ClipCreationFailure[];
}

const ANGLE_ORDER: Record<string, number> = { left: 0, front: 1, right: 2 };

// The three "designated" mirror slots. Each always renders — either with
// its video, or as an empty placeholder — so a take with only one or two
// videos still shows them in their correct position (left/front/right)
// instead of being centered and awkwardly re-rotated. Matches TakeDetail's
// behavior so the layout is consistent between the two pages, and this
// same slot concept is reused (at a smaller scale) for each clip group's
// mini mirror in the sidebar — see buildGroupAngleSlots below.
export const KNOWN_ANGLES = ["left", "front", "right"] as const;
export type KnownAngle = (typeof KNOWN_ANGLES)[number];

interface VideoSlot {
  angle: KnownAngle;
  video: RawVideoDetail | null;
}

function sortByAngleOrder(videos: RawVideoDetail[]): RawVideoDetail[] {
  return [...videos].sort((a, b) => {
    const aRank = ANGLE_ORDER[a.angle?.toLowerCase() ?? ""] ?? Number.MAX_SAFE_INTEGER;
    const bRank = ANGLE_ORDER[b.angle?.toLowerCase() ?? ""] ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}

// Splits raw videos into the three fixed left/front/right slots (each
// either filled or empty) plus any "extra" videos whose angle doesn't
// match one of the three known slots. If two videos claim the same known
// angle, the first one found wins that slot and the rest fall through to
// "extra" rather than being dropped. (Same logic as TakeDetail.)
function buildVideoSlots(videos: RawVideoDetail[]): {
  slots: VideoSlot[];
  extras: RawVideoDetail[];
} {
  const byAngle = new Map<KnownAngle, RawVideoDetail>();
  const extras: RawVideoDetail[] = [];

  for (const rv of videos) {
    const key = rv.angle?.toLowerCase() ?? "";
    if ((KNOWN_ANGLES as readonly string[]).includes(key) && !byAngle.has(key as KnownAngle)) {
      byAngle.set(key as KnownAngle, rv);
    } else {
      extras.push(rv);
    }
  }

  const slots: VideoSlot[] = KNOWN_ANGLES.map((angle) => ({
    angle,
    video: byAngle.get(angle) ?? null,
  }));

  return { slots, extras };
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// ---- Clip group helpers ----
// A ClipGroup's own color/label can be null (e.g. legacy data, or a group
// whose top-level fields weren't set even though the underlying clips
// have their own), so these fall back to the first angle's clip rather
// than showing nothing.

export function getGroupKey(group: ClipGroup): string {
  return group.clip_group_id ?? group.angles[0]?.clip.clip_id ?? "unknown-group";
}

export function getGroupColor(group: ClipGroup): string {
  return group.color ?? group.angles[0]?.clip.color ?? DEFAULT_CLIP_COLOR;
}

export function getGroupLabel(group: ClipGroup): string | null {
  return group.label ?? group.angles[0]?.clip.label ?? null;
}

// One slot per known angle (left/front/right) for a single clip group,
// mirroring buildVideoSlots but over that group's ClipGroupAngle entries
// instead of the take's raw videos. Powers the sidebar's mini "mirror"
// layout — each group always shows all three designated slots (filled or
// empty), never a carousel, so every angle is visible and clickable at
// once instead of requiring navigation to see them. Also reused (as-is)
// by ClipDetailModal so the double-click modal shows the same fixed
// left/front/right layout as the sidebar card it was opened from.
export interface GroupAngleSlot {
  angle: KnownAngle;
  groupAngle: ClipGroupAngle | null;
}

export function buildGroupAngleSlots(group: ClipGroup): {
  slots: GroupAngleSlot[];
  extras: ClipGroupAngle[];
} {
  const byAngle = new Map<KnownAngle, ClipGroupAngle>();
  const extras: ClipGroupAngle[] = [];

  for (const a of group.angles) {
    const key = a.angle?.toLowerCase() ?? "";
    if ((KNOWN_ANGLES as readonly string[]).includes(key) && !byAngle.has(key as KnownAngle)) {
      byAngle.set(key as KnownAngle, a);
    } else {
      extras.push(a);
    }
  }

  const slots: GroupAngleSlot[] = KNOWN_ANGLES.map((angle) => ({
    angle,
    groupAngle: byAngle.get(angle) ?? null,
  }));

  return { slots, extras };
}

// Which angle's transcription shows in a group card's footer — prefers
// "front" since that's the most natural default view, falling back to
// whichever angle happens to be first. Also reused for the timeline
// marker's hover/focus tooltip so both surfaces agree on which angle's
// text is displayed (and, now, which clip gets edited when either
// surface's edit button is used).
function getFooterAngle(group: ClipGroup): ClipGroupAngle | null {
  const front = group.angles.find((a) => a.angle?.toLowerCase() === "front");
  return front ?? group.angles[0] ?? null;
}

// ---- Sidebar angle carousel ----
// Each group card shows one angle's clip at a time with prev/next
// navigation, rather than all angles at once. An entry's groupAngle is
// null for a known slot (left/front/right) the group has no clip for —
// rendered as an empty placeholder, same as before.

interface CarouselAngleEntry {
  key: string;
  label: string;
  groupAngle: ClipGroupAngle | null;
}

// Combines the three fixed left/front/right slots (filled or empty) with
// any "extra" angles beyond those three. Extras previously had no home in
// the sidebar's per-angle rendering and were silently dropped — folding
// them into one ordered list here means every clip in a group is always
// reachable via the arrows, not just the first three known angles.
function buildCarouselEntries(group: ClipGroup): CarouselAngleEntry[] {
  const { slots, extras } = buildGroupAngleSlots(group);
  const known: CarouselAngleEntry[] = slots.map((slot) => ({
    key: slot.groupAngle?.clip.clip_id ?? `empty-${slot.angle}`,
    label: slot.angle,
    groupAngle: slot.groupAngle,
  }));
  const extraEntries: CarouselAngleEntry[] = extras.map((a, i) => ({
    key: a.clip.clip_id,
    label: a.angle ?? `Extra ${i + 1}`,
    groupAngle: a,
  }));
  return [...known, ...extraEntries];
}

// Default angle to show for a group that hasn't been navigated yet:
// "front" if it has a clip, else the first entry that has one, else just
// the first entry (which will render as an empty placeholder).
function getDefaultAngleIndex(entries: CarouselAngleEntry[]): number {
  const frontIdx = entries.findIndex((e) => e.label.toLowerCase() === "front" && e.groupAngle);
  if (frontIdx !== -1) return frontIdx;
  const firstWithVideo = entries.findIndex((e) => e.groupAngle);
  return firstWithVideo !== -1 ? firstWithVideo : 0;
}

// ---- Clip creation ----

interface ClipDraft {
  start: number;
  end: number;
  color: string;
  transcription: string;
}

const DEFAULT_CLIP_LENGTH_SECONDS = 5;
const MIN_CLIP_LENGTH_SECONDS = 0.5;
export const DEFAULT_CLIP_COLOR = "#35D0B5";

type DragMode = "start" | "end" | "move" | null;

export default function ClipEditorPage() {
  const { take_id } = useParams<{ take_id: string }>();
  const router = useRouter();

  const [take, setTake] = useState<TakeSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---- Synced playback (same approach as the take detail page) ----
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({});
  const [isSeeking, setIsSeeking] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);

  // ---- Clip creation state ----
  const [clipDraft, setClipDraft] = useState<ClipDraft | null>(null);
  const [isSubmittingClip, setIsSubmittingClip] = useState(false);
  const [clipSubmitError, setClipSubmitError] = useState<string | null>(null);
  // Clip groups that exist on this take: seeded from `take.clip_groups` on
  // load, then appended to whenever a new one is saved. Each group holds
  // one clip per view angle it was cut from — this stays grouped (rather
  // than flattened) all the way through to rendering, so the sidebar and
  // the timeline can both treat "one selection, N angles" as one thing.
  const [groups, setGroups] = useState<ClipGroup[]>([]);
  const [activeDragMode, setActiveDragMode] = useState<DragMode>(null);

  // ---- Clip group deletion state ----
  // Tracks which group's delete request is in flight (disables that
  // card's trash button + swaps in a spinner) and the most recent delete
  // failure, scoped to the group it happened on so an error from one
  // card's delete attempt never bleeds into another card's display.
  const [deletingGroupKey, setDeletingGroupKey] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ groupKey: string; message: string } | null>(null);

  // ---- Clip group color update state ----
  // Tracks which group's color-update request is in flight (swaps the
  // tooltip's pencil hint for a spinner) and the most recent failure,
  // scoped to the group it happened on — same pattern as
  // deletingGroupKey/deleteError above.
  const [updatingColorGroupKey, setUpdatingColorGroupKey] = useState<string | null>(null);
  const [colorUpdateError, setColorUpdateError] = useState<{ groupKey: string; message: string } | null>(
    null
  );

  // Which group (if any) is currently "selected" — clicking either a
  // group's card in the sidebar or its marker on the timeline sets this,
  // and highlights both representations of it so it's obvious they're the
  // same selection. Selecting no longer moves the master playhead itself
  // — see handleSelectGroup / handleTogglePlay.
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const clipCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // ---- Clip detail modal ----
  // Which group (if any) the double-click "clip detail" modal is showing.
  // Kept separate from selectedGroupKey/selection above — opening the
  // modal is a distinct action from selecting a clip on the timeline, and
  // the two shouldn't fight over the same piece of state. Storing the
  // whole ClipGroup (not just its key) means the modal keeps showing the
  // clip it was opened for even if `groups` re-sorts or updates while
  // it's open.
  const [modalGroup, setModalGroup] = useState<ClipGroup | null>(null);

  const clipTrackRef = useRef<HTMLDivElement | null>(null);
  const moveDragOriginRef = useRef<{ startX: number; draftStart: number; draftEnd: number } | null>(null);
  // Mirrors clipDraft, but read inside the global keydown handler instead
  // of depending on clipDraft directly — clipDraft changes on every pixel
  // while dragging, and we don't want the window keydown listener tearing
  // down/reattaching that often.
  const clipDraftRef = useRef<ClipDraft | null>(null);
  useEffect(() => {
    clipDraftRef.current = clipDraft;
  }, [clipDraft]);

  // Time (in seconds, on the master timeline) that master playback should
  // stop at, or null when playback should run freely. Set by
  // handleTogglePlay whenever Play is pressed with a clip draft or a
  // saved clip selected — playback is capped to that clip's own range
  // instead of continuing into the rest of the take. Enforced in
  // handleLongestTimeUpdate, and cleared by anything that manually moves
  // the playhead (seeking, restart, skip) or changes the selection, since
  // those actions step outside the "play just this clip" intent.
  const playUntilRef = useRef<number | null>(null);

  // Mirrors currentTime in a ref so handleSelectGroup/handleHighlightGroup
  // can read the latest position without needing currentTime as a
  // dependency (which would otherwise recreate those callbacks on every
  // timeupdate tick during playback).
  const currentTimeRef = useRef(0);
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  // The master seek bar's displayed position is frozen at whatever it was
  // showing the moment a clip got selected, and stays frozen for as long
  // as that clip stays selected — even while it plays. That's what keeps
  // the visible timeline from jumping to/tracking the selected clip's own
  // playback. Only read while selectedGroupKey is set; see
  // displayedCurrentTime below and handleSelectGroup/handleHighlightGroup,
  // which populate it.
  const timelineFreezeTimeRef = useRef(0);

  // ---- Sidebar mini-mirror preview + transcription text ----
  // Each group's card renders all of its angles at once (left/front/right,
  // whichever exist) as static mirror-style panels — see buildGroupAngleSlots
  // and renderGroupCard. Clicking a specific angle's panel plays only that
  // one clip, locally, inline in the sidebar; it never touches the master
  // 3-plane player or its timeline.
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const clipVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  // Which angle each group's carousel is currently showing, keyed by
  // group key. A group with no entry here falls back to
  // getDefaultAngleIndex — so newly-loaded/created groups don't need to
  // be seeded up front.
  const [groupAngleIndex, setGroupAngleIndex] = useState<Record<string, number>>({});

  // Whether the right-hand clips sidebar is collapsed to a slim rail.
  // Collapsing hides the card list (rather than just visually shrinking
  // it) so a long list doesn't keep doing layout work while out of view.
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Transcription files only expose a URL on ClipSummary, not their text,
  // so each clip's transcript is fetched lazily and cached here, keyed by
  // clip_id. Separate "errors" map so a failed fetch doesn't get retried
  // every render. This same cache backs both the sidebar card's footer
  // AND the timeline marker's hover/focus tooltip — see
  // renderGroupCard/getFooterAngle usage below and the clip marker map.
  const [transcriptionTexts, setTranscriptionTexts] = useState<Record<string, string>>({});
  const [transcriptionErrors, setTranscriptionErrors] = useState<Record<string, boolean>>({});

  // ---- Transcription editing ----
  // Which clip's transcription is currently open for editing. Both the
  // sidebar card's footer and the timeline marker's tooltip key off the
  // same clip (see getFooterAngle), so this one bit of state drives the
  // edit box in whichever surface it was opened from. Only one edit box
  // is open at a time across the page.
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editDraftText, setEditDraftText] = useState("");
  const [isSavingTranscription, setIsSavingTranscription] = useState(false);
  const [transcriptionSaveError, setTranscriptionSaveError] = useState<{
    clipId: string;
    message: string;
  } | null>(null);

  const fetchTake = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Hits the clip-editor-specific endpoint, which eager-loads raw
      // videos + their existing clips (+ each clip's transcription file)
      // in one query, so this page has everything it needs up front.
      const res = await fetch(`${BASE_URL}/takes/${take_id}/clip-editor`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load take (${res.status})`);
      const json: TakeSummary = await res.json();
      setTake(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load take");
    } finally {
      setLoading(false);
    }
  }, [take_id]);

  useEffect(() => {
    fetchTake();
  }, [fetchTake]);

  // Seed `groups` from whatever already exists on this take, every time
  // `take` is (re)loaded. Kept separate from the "append on create" logic
  // in handleConfirmClip so freshly-created groups aren't wiped out by
  // this effect re-running for an unrelated reason.
  useEffect(() => {
    if (!take) return;
    setGroups(take.clip_groups);
  }, [take]);

  // Groups in start-time order for the sidebar and the timeline. The
  // backend already sorts clip_groups, but a group appended locally after
  // creation goes on the end regardless of where its start time falls, so
  // this re-sorts on render rather than assuming insertion order stays
  // correct. Guarded against groups ever being undefined/null so a shape
  // mismatch degrades to an empty sidebar instead of crashing the page.
  const sortedGroups = useMemo(
    () => [...(groups ?? [])].sort((a, b) => a.start_time_seconds - b.start_time_seconds),
    [groups]
  );

  // Sorted flat list (left → front → right → unknown). Drives the mirror
  // stage layout and the longestVideoId fallback below.
  const orderedVideos = useMemo(
    () => (take ? sortByAngleOrder(take.raw_videos) : []),
    [take]
  );

  // Fixed left/front/right slots (filled or empty) plus any videos whose
  // angle doesn't match one of the three known slots — mirrors TakeDetail.
  const { slots: videoSlots, extras: extraVideos } = useMemo(
    () => (take ? buildVideoSlots(take.raw_videos) : { slots: [], extras: [] }),
    [take]
  );

  // Maps each known angle (left/front/right) to that angle's ViewAngle id
  // on this take — built from take.raw_videos, which now carries
  // view_angle_id alongside the human-readable angle name (see
  // RawVideoDetail above / the backend's /takes/{id}/clip-editor
  // endpoint). This is what powers the Replace/Delete buttons in
  // ClipDetailModal: those buttons are disabled until an angle's id shows
  // up here, since the upload/delete routes are keyed on view_angle_id,
  // not raw_video_id or the angle name string.
  const viewAngleIds = useMemo(() => {
    const map: Partial<Record<KnownAngle, string>> = {};
    for (const rv of take?.raw_videos ?? []) {
      const key = rv.angle?.toLowerCase() ?? "";
      if (
        (KNOWN_ANGLES as readonly string[]).includes(key) &&
        !map[key as KnownAngle] &&
        rv.view_angle_id
      ) {
        map[key as KnownAngle] = rv.view_angle_id;
      }
    }
    return map;
  }, [take]);

  const duration = useMemo(() => {
    const values = Object.values(videoDurations);
    return values.length > 0 ? Math.max(...values) : 0;
  }, [videoDurations]);

  // What the master seek bar and time labels actually render. While a
  // clip is selected, this stays pinned at timelineFreezeTimeRef (set in
  // handleSelectGroup/handleHighlightGroup) instead of tracking the real
  // playback position — so playing the selected clip never visibly moves
  // the timeline. currentTime itself keeps updating underneath as normal
  // (used for logic like handleStartClip's default range), it's just not
  // what gets shown here. Deselecting immediately switches this back to
  // the live value.
  const displayedCurrentTime = selectedGroupKey !== null ? timelineFreezeTimeRef.current : currentTime;

  const longestVideoId = useMemo(() => {
    let bestId: string | null = null;
    let bestDuration = -1;
    for (const [id, d] of Object.entries(videoDurations)) {
      if (d > bestDuration) {
        bestDuration = d;
        bestId = id;
      }
    }
    return bestId ?? orderedVideos[0]?.raw_video_id ?? null;
  }, [videoDurations, orderedVideos]);

  const registerVideoRef = useCallback(
    (id: string) => (el: HTMLVideoElement | null) => {
      videoRefs.current[id] = el;
    },
    []
  );

  const registerClipCardRef = useCallback(
    (groupKey: string) => (el: HTMLDivElement | null) => {
      clipCardRefs.current[groupKey] = el;
    },
    []
  );

  const registerClipVideoRef = useCallback(
    (clipId: string) => (el: HTMLVideoElement | null) => {
      clipVideoRefs.current[clipId] = el;
    },
    []
  );

  const forEachVideo = useCallback((fn: (v: HTMLVideoElement) => void) => {
    Object.values(videoRefs.current).forEach((v) => {
      if (v) fn(v);
    });
  }, []);

  const seekAllTo = useCallback(
    (value: number) => {
      forEachVideo((v) => {
        v.currentTime = value;
      });
      setCurrentTime(value);
    },
    [forEachVideo]
  );

  // Shared handler for both the sidebar cards and the timeline markers —
  // selecting a group highlights it in both places (card + marker), and
  // clicking an already-selected group deselects it. It deliberately does
  // NOT move the master playhead; pressing the master Play button is what
  // seeks to the clip and plays it (see handleTogglePlay), and that
  // playback stops automatically at the clip's end rather than
  // continuing into the rest of the timeline. While a clip is selected,
  // the master seek bar's visible position is frozen (see
  // timelineFreezeTimeRef / displayedCurrentTime) so pressing Play never
  // visibly drags the timeline — deselecting is what brings it back to
  // showing the live position.
  const handleSelectGroup = useCallback((group: ClipGroup) => {
    const key = getGroupKey(group);
    setSelectedGroupKey((prev) => {
      if (prev === key) return null; // clicking the selected group deselects it
      timelineFreezeTimeRef.current = currentTimeRef.current;
      return key;
    });
    // Clear any "play just this clip" boundary left over from a previous
    // selection, so the next Play press seeks fresh to this group's start
    // instead of stopping partway through at the old group's end.
    playUntilRef.current = null;
  }, []);

  // Highlights a group (so its card + timeline marker read as "selected"
  // and the timeline freezes, same as handleSelectGroup) WITHOUT touching
  // the master playhead. Used when a specific angle's panel inside a
  // group card is clicked to play — so playing a clip in the sidebar
  // never drags or seeks the master 3-plane player.
  const handleHighlightGroup = useCallback((group: ClipGroup) => {
    const key = getGroupKey(group);
    setSelectedGroupKey((prev) => {
      if (prev !== key) {
        timelineFreezeTimeRef.current = currentTimeRef.current;
      }
      return key;
    });
  }, []);

  // Opens the double-click "clip detail" modal for a group. Separate from
  // selection/highlighting above — this doesn't touch selectedGroupKey or
  // the master player at all, it just surfaces the modal.
  const handleOpenClipModal = useCallback((group: ClipGroup) => {
    setModalGroup(group);
  }, []);

  const handleCloseClipModal = useCallback(() => {
    setModalGroup(null);
  }, []);

  // Keep the sidebar scrolled to whatever's selected — covers both
  // clicking a timeline marker (the corresponding card may be off-screen
  // in the sidebar) and a newly-created group being auto-selected.
  useEffect(() => {
    if (!selectedGroupKey) return;
    clipCardRefs.current[selectedGroupKey]?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [selectedGroupKey]);

  // Lazily fetch transcription text for any clip that has a transcription
  // file but whose text we haven't fetched (or failed to fetch) yet.
  // Pulled from every angle of every group (not just the footer's pick)
  // so a group card never has to wait on a fetch to show something.
  useEffect(() => {
    const allClips = groups.flatMap((g) => g.angles.map((a) => a.clip));
    const toFetch = allClips.filter(
      (c) => c.transcription && !(c.clip_id in transcriptionTexts) && !transcriptionErrors[c.clip_id]
    );
    if (toFetch.length === 0) return;

    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        toFetch.map(async (c) => {
          try {
            const res = await fetch(c.transcription!.transcription_url, { credentials: "include" });
            if (!res.ok) throw new Error();
            const text = await res.text();
            return { id: c.clip_id, text };
          } catch {
            return { id: c.clip_id, text: null as string | null };
          }
        })
      );
      if (cancelled) return;

      setTranscriptionTexts((prev) => {
        const next = { ...prev };
        for (const r of results) if (r.text !== null) next[r.id] = r.text;
        return next;
      });
      setTranscriptionErrors((prev) => {
        const next = { ...prev };
        for (const r of results) if (r.text === null) next[r.id] = true;
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [groups, transcriptionTexts, transcriptionErrors]);

  // Opens the inline editor for a clip's transcription, seeded with
  // whatever text is currently cached/shown for it. Guarded to clips that
  // actually have a transcription file, since saving needs a
  // transcription_file_id to PATCH against.
  const handleStartEditTranscription = useCallback(
    (clip: ClipSummary, e: React.SyntheticEvent) => {
      e.stopPropagation();
      if (!clip.transcription) return;
      setTranscriptionSaveError(null);
      setEditDraftText(transcriptionTexts[clip.clip_id] ?? "");
      setEditingClipId(clip.clip_id);
    },
    [transcriptionTexts]
  );

  const handleCancelEditTranscription = useCallback((e: React.SyntheticEvent) => {
    e.stopPropagation();
    setEditingClipId(null);
    setTranscriptionSaveError(null);
  }, []);

  // Saves the edited text via
  // PATCH /takes/{take_id}/transcriptions/{transcription_file_id}. That
  // endpoint's response only carries file metadata (no text field back),
  // so on success the local cache is updated with what was just sent
  // rather than anything read back from the response body.
  const handleSaveTranscription = useCallback(
    async (clip: ClipSummary, e: React.SyntheticEvent) => {
      e.stopPropagation();
      if (!take || !clip.transcription) return;

      const nextText = editDraftText;
      if (!nextText.trim()) {
        setTranscriptionSaveError({
          clipId: clip.clip_id,
          message: "Transcription can't be empty.",
        });
        return;
      }

      setIsSavingTranscription(true);
      setTranscriptionSaveError(null);
      try {
        const res = await fetch(
          `${BASE_URL}/takes/${take.take_id}/transcriptions/${clip.transcription.transcription_file_id}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: nextText }),
          }
        );

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const detail = typeof body?.detail === "string" ? body.detail : body?.detail?.message;
          throw new Error(detail || `Failed to save transcription (${res.status})`);
        }

        setTranscriptionTexts((prev) => ({ ...prev, [clip.clip_id]: nextText }));
        setTranscriptionErrors((prev) => {
          if (!(clip.clip_id in prev)) return prev;
          const next = { ...prev };
          delete next[clip.clip_id];
          return next;
        });
        setEditingClipId(null);
      } catch (err) {
        setTranscriptionSaveError({
          clipId: clip.clip_id,
          message: err instanceof Error ? err.message : "Failed to save transcription",
        });
      } finally {
        setIsSavingTranscription(false);
      }
    },
    [take, editDraftText]
  );

  // Toggle a clip's own local preview (its panel in the sidebar's mini
  // mirror). Independent of the master play/pause — starting one
  // pauses+rewinds whichever other clip's preview was playing, so only
  // one plays at a time across the whole sidebar, and it never touches
  // the master 3-plane player.
  const handleToggleClipPlay = useCallback(
    (clipId: string) => {
      const el = clipVideoRefs.current[clipId];
      if (!el) return;

      if (playingClipId === clipId) {
        el.pause();
        setPlayingClipId(null);
        return;
      }
      if (playingClipId) {
        const prevEl = clipVideoRefs.current[playingClipId];
        prevEl?.pause();
        if (prevEl) prevEl.currentTime = 0;
      }
      el.currentTime = 0;
      el.play().catch(() => {});
      setPlayingClipId(clipId);
    },
    [playingClipId]
  );

  const handleClipVideoEnded = useCallback(
    (clipId: string) => () => {
      setPlayingClipId((prev) => (prev === clipId ? null : prev));
    },
    []
  );

  // Step the given group's carousel forward/back by one, wrapping around
  // at the ends. Stops the currently-playing preview first — switching
  // angle unmounts the previous video element, so its playback stops
  // regardless, but this keeps the mini play/pause glyph from appearing
  // stuck "on" for a clip that's no longer even rendered.
  const handleCycleAngle = useCallback(
    (groupKey: string, entries: CarouselAngleEntry[], delta: number) =>
      (e: React.MouseEvent) => {
        e.stopPropagation();
        setPlayingClipId(null);
        setGroupAngleIndex((prev) => {
          const current = prev[groupKey] ?? getDefaultAngleIndex(entries);
          const next = (current + delta + entries.length) % entries.length;
          return { ...prev, [groupKey]: next };
        });
      },
    []
  );

  // Jump directly to a specific angle via its dot indicator.
  const handleSetAngleIndex = useCallback(
    (groupKey: string, index: number) => (e: React.MouseEvent) => {
      e.stopPropagation();
      setPlayingClipId(null);
      setGroupAngleIndex((prev) => ({ ...prev, [groupKey]: index }));
    },
    []
  );

  const handleTogglePlay = useCallback(() => {
    if (isPlaying) {
      forEachVideo((v) => v.pause());
      setIsPlaying(false);
      return;
    }

    // While drafting a clip, always start playback from the selected
    // range's start and cap it at the range's end — makes Space/the play
    // button a quick "preview the clip" action instead of resuming from
    // wherever the playhead happens to be, and stops it from bleeding
    // into whatever comes after in the take. clipDraftRef (not clipDraft)
    // is used so this callback doesn't need to be recreated on every
    // drag-tick update.
    if (clipDraftRef.current) {
      seekAllTo(clipDraftRef.current.start);
      playUntilRef.current = clipDraftRef.current.end;
    } else if (selectedGroupKey && playUntilRef.current === null) {
      // A saved clip is selected and we're not already mid-playback of it
      // (playUntilRef is only null here on a fresh Play press, not a
      // resume-after-pause) — seek to its start and cap playback at its
      // end, same idea as the draft case above. Checking playUntilRef
      // first means pausing partway through and pressing Play again
      // resumes from where you left off instead of jumping back to the
      // clip's start every time.
      const group = groups.find((g) => getGroupKey(g) === selectedGroupKey);
      if (group) {
        seekAllTo(group.start_time_seconds);
        playUntilRef.current = group.end_time_seconds;
      }
    }

    forEachVideo((v) => {
      v.play().catch(() => {});
    });
    setIsPlaying(true);
  }, [isPlaying, forEachVideo, seekAllTo, selectedGroupKey, groups]);

  const handleRestart = useCallback(() => {
    forEachVideo((v) => {
      v.currentTime = 0;
    });
    setCurrentTime(0);
    // Manually restarting steps outside whatever clip-only playback was in
    // progress, so drop the boundary rather than have playback stop again
    // once it happens to reach the old clip's end time.
    playUntilRef.current = null;
  }, [forEachVideo]);

  const handleSkip = useCallback(
    (deltaSeconds: number) => {
      forEachVideo((v) => {
        v.currentTime = Math.min(
          Math.max(0, v.currentTime + deltaSeconds),
          v.duration || Infinity
        );
      });
      setCurrentTime((prev) => Math.min(Math.max(0, prev + deltaSeconds), duration || Infinity));
      // Same reasoning as handleRestart — a manual skip means the person
      // is steering the playhead themselves, so any "play just this clip"
      // cap from before no longer applies.
      playUntilRef.current = null;
    },
    [forEachVideo, duration]
  );

  const applyVolume = useCallback(
    (value: number) => {
      const clamped = Math.min(1, Math.max(0, value));
      setVolume(clamped);
      const nextMuted = clamped === 0;
      setIsMuted(nextMuted);
      forEachVideo((v) => {
        v.volume = clamped;
        v.muted = nextMuted;
      });
    },
    [forEachVideo]
  );

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      applyVolume(Number(e.target.value));
    },
    [applyVolume]
  );

  const handleToggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    forEachVideo((v) => {
      v.muted = nextMuted;
    });
  }, [isMuted, forEachVideo]);

  // ---- Clip creation: start / cancel / confirm ----

  const handleStartClip = useCallback(() => {
    if (clipDraftRef.current) return; // already drafting one
    if (!duration) return; // nothing loaded yet

    let start = currentTime;
    let end = Math.min(currentTime + DEFAULT_CLIP_LENGTH_SECONDS, duration);
    if (end - start < DEFAULT_CLIP_LENGTH_SECONDS) {
      // Not enough room ahead of the playhead for a full 5s clip (e.g. near
      // the end of a short video) — anchor the default range to the end of
      // the video instead of silently giving a shorter-than-5s clip.
      start = Math.max(0, duration - DEFAULT_CLIP_LENGTH_SECONDS);
      end = duration;
    }

    // Drafting a new clip supersedes whatever was selected before.
    setSelectedGroupKey(null);
    playUntilRef.current = null;
    setClipSubmitError(null);
    setClipDraft({ start, end, color: DEFAULT_CLIP_COLOR, transcription: "" });
  }, [duration, currentTime]);

  const handleCancelClip = useCallback(() => {
    setClipDraft(null);
    setClipSubmitError(null);
    setActiveDragMode(null);
    moveDragOriginRef.current = null;
    playUntilRef.current = null;
  }, []);

  const handleConfirmClip = useCallback(async () => {
    if (!clipDraft) return;
    if (!take) return;
    if (!clipDraft.transcription.trim()) {
      setClipSubmitError("Add a transcription before saving the clip.");
      return;
    }

    setIsSubmittingClip(true);
    setClipSubmitError(null);
    try {
      // Take-level endpoint: cuts one Clip per view angle raw video on
      // this take, grouped server-side under a shared clip_group_id.
      const res = await fetch(`${BASE_URL}/takes/${take.take_id}/clips`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_time_seconds: clipDraft.start,
          end_time_seconds: clipDraft.end,
          color: clipDraft.color,
          transcription_text: clipDraft.transcription,
          // view_angle_ids omitted → backend cuts every angle available
          // on this take. Add a value here if the UI later lets the user
          // deselect specific angles before cutting.
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = typeof body?.detail === "string" ? body.detail : body?.detail?.message;
        throw new Error(detail || `Failed to create clip (${res.status})`);
      }

      const result: ClipCreateForTakeResponse = await res.json();

      // Guard against an empty clips array before indexing into it —
      // result.clips[0] is typed as ClipSummary | undefined by
      // TypeScript's noUncheckedIndexedAccess-style narrowing, and
      // asserting it away would also mask a real bug (e.g. the backend
      // reporting success with zero clips actually cut).
      const firstClip = result.clips[0];
      if (firstClip) {
        // Rebuild the group client-side: every clip in a single create
        // response shares one clip_group_id (or none, if the backend
        // didn't set one), and each clip's angle is looked up from the
        // take's raw videos rather than trusted to any local guess.
        const angleByRawVideoId = new Map(take.raw_videos.map((rv) => [rv.raw_video_id, rv.angle]));
        const newGroup: ClipGroup = {
          clip_group_id: firstClip.clip_group_id,
          start_time_seconds: clipDraft.start,
          end_time_seconds: clipDraft.end,
          color: clipDraft.color,
          label: null,
          angles: result.clips.map((c) => ({
            raw_video_id: c.raw_video_id,
            angle: angleByRawVideoId.get(c.raw_video_id) ?? null,
            clip: c,
          })),
        };
        setGroups((prev) => [...prev, newGroup]);
        setSelectedGroupKey(getGroupKey(newGroup));
        playUntilRef.current = null;
      }

      if (result.failed.length > 0) {
        // Some angles succeeded and some didn't — clips that did succeed
        // are already saved and added to state above, so this just
        // surfaces which angles need a retry rather than blocking anything.
        const summary = result.failed
          .map((f) => `${f.view_angle ?? "unknown angle"}: ${f.error}`)
          .join("; ");
        setClipSubmitError(
          result.clips.length > 0
            ? `Saved ${result.clips.length} angle(s), but some failed — ${summary}`
            : `Failed to create clip — ${summary}`
        );
      }

      // Only close the draft editor once every angle succeeded. A partial
      // failure keeps the draft open (with the error shown) so the user
      // can see what happened and decide whether to retry.
      if (result.failed.length === 0) {
        setClipDraft(null);
      }
    } catch (err) {
      setClipSubmitError(err instanceof Error ? err.message : "Failed to create clip");
    } finally {
      setIsSubmittingClip(false);
    }
  }, [clipDraft, take]);

  // ---- Clip group deletion ----
  // Deletes an entire group (every angle's clip + the shared
  // transcription file, both DB rows and files on disk) via
  // DELETE /takes/{take_id}/clips/group/{clip_group_id}. Confirms first
  // since this is destructive and irreversible, then removes the group
  // from local state on success so the sidebar/timeline update without a
  // full refetch.
  const handleDeleteGroup = useCallback(
    async (group: ClipGroup, e: React.MouseEvent | React.KeyboardEvent) => {
      e.stopPropagation();
      if (!take) return;

      const groupKey = getGroupKey(group);

      if (!group.clip_group_id) {
        // Legacy/ungrouped clips have no clip_group_id, so the group-delete
        // endpoint has nothing to target — surface that instead of firing
        // a request that can only 404.
        setDeleteError({ groupKey, message: "This clip can't be deleted from here." });
        return;
      }

      const label = getGroupLabel(group);
      const confirmed = window.confirm(
        label
          ? `Delete "${label}"? This removes every angle of this clip and its transcription. This can't be undone.`
          : "Delete this clip? This removes every angle of this clip and its transcription. This can't be undone."
      );
      if (!confirmed) return;

      setDeletingGroupKey(groupKey);
      setDeleteError(null);
      try {
        const res = await fetch(
          `${BASE_URL}/takes/${take.take_id}/clips/group/${group.clip_group_id}`,
          { method: "DELETE", credentials: "include" }
        );

        if (!res.ok && res.status !== 204) {
          const body = await res.json().catch(() => null);
          const detail = typeof body?.detail === "string" ? body.detail : body?.detail?.message;
          throw new Error(detail || `Failed to delete clip (${res.status})`);
        }

        setGroups((prev) => prev.filter((g) => getGroupKey(g) !== groupKey));
        setSelectedGroupKey((prev) => (prev === groupKey ? null : prev));
        setModalGroup((prev) => (prev && getGroupKey(prev) === groupKey ? null : prev));
        if (deletingGroupKey === groupKey || selectedGroupKey === groupKey) {
          playUntilRef.current = null;
        }
        setGroupAngleIndex((prev) => {
          if (!(groupKey in prev)) return prev;
          const next = { ...prev };
          delete next[groupKey];
          return next;
        });

        // Drop any cached transcription state and stop any inline preview
        // tied to this group's clips so nothing stale lingers in memory.
        const clipIds = group.angles.map((a) => a.clip.clip_id);
        setTranscriptionTexts((prev) => {
          const next = { ...prev };
          for (const id of clipIds) delete next[id];
          return next;
        });
        setTranscriptionErrors((prev) => {
          const next = { ...prev };
          for (const id of clipIds) delete next[id];
          return next;
        });
        setPlayingClipId((prev) => (prev && clipIds.includes(prev) ? null : prev));
        // Close the transcription editor too, if it happened to be open
        // on one of this group's clips.
        setEditingClipId((prev) => (prev && clipIds.includes(prev) ? null : prev));
      } catch (err) {
        setDeleteError({
          groupKey,
          message: err instanceof Error ? err.message : "Failed to delete clip",
        });
      } finally {
        setDeletingGroupKey(null);
      }
    },
    [take, deletingGroupKey, selectedGroupKey]
  );

  // ---- Clip group color update ----
  // Recolors an entire group (every angle) via
  // PATCH /takes/{take_id}/clips/group/{clip_group_id}, with body
  // { color }. Triggered from the editable swatch in the timeline
  // marker's tooltip (see renderTooltipColorSwatch) — hovering the dot
  // reveals a pencil hint, and clicking it opens the native color picker
  // via the swatch's hidden <input type="color">. Only offered for
  // groups that actually have a clip_group_id to PATCH against; legacy/
  // ungrouped clips fall back to a plain, non-editable dot.
  const handleUpdateGroupColor = useCallback(
    async (group: ClipGroup, newColor: string) => {
      if (!take || !group.clip_group_id) return;
      const groupKey = getGroupKey(group);

      setUpdatingColorGroupKey(groupKey);
      setColorUpdateError(null);
      try {
        const res = await fetch(
          `${BASE_URL}/takes/${take.take_id}/clips/group/${group.clip_group_id}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ color: newColor }),
          }
        );

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          const detail = typeof body?.detail === "string" ? body.detail : body?.detail?.message;
          throw new Error(detail || `Failed to update clip color (${res.status})`);
        }

        // Update local state so both the sidebar card and this same
        // tooltip (both read color via getGroupColor) reflect the change
        // immediately, without a full refetch.
        setGroups((prev) =>
          prev.map((g) => (getGroupKey(g) === groupKey ? { ...g, color: newColor } : g))
        );
      } catch (err) {
        setColorUpdateError({
          groupKey,
          message: err instanceof Error ? err.message : "Failed to update clip color",
        });
      } finally {
        setUpdatingColorGroupKey(null);
      }
    },
    [take]
  );

  // ---- Clip range dragging (resize handles + move-whole-range) ----

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const track = clipTrackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration]
  );

  const handleRangeHandleDown = useCallback(
    (mode: "start" | "end") => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setActiveDragMode(mode);
    },
    []
  );

  const handleRangeBarDown = useCallback(
    (e: React.MouseEvent) => {
      if (!clipDraft) return;
      e.preventDefault();
      e.stopPropagation();
      moveDragOriginRef.current = {
        startX: e.clientX,
        draftStart: clipDraft.start,
        draftEnd: clipDraft.end,
      };
      setActiveDragMode("move");
    },
    [clipDraft]
  );

  useEffect(() => {
    if (!activeDragMode) return;

    const handleMouseMove = (e: MouseEvent) => {
      setClipDraft((prev) => {
        if (!prev) return prev;

        if (activeDragMode === "start") {
          const t = timeFromClientX(e.clientX);
          const newStart = Math.max(0, Math.min(t, prev.end - MIN_CLIP_LENGTH_SECONDS));
          return { ...prev, start: newStart };
        }

        if (activeDragMode === "end") {
          const t = timeFromClientX(e.clientX);
          const newEnd = Math.min(duration, Math.max(t, prev.start + MIN_CLIP_LENGTH_SECONDS));
          return { ...prev, end: newEnd };
        }

        // "move" — shift the whole range together, clamped to [0, duration]
        const origin = moveDragOriginRef.current;
        const track = clipTrackRef.current;
        if (!origin || !track) return prev;
        const rect = track.getBoundingClientRect();
        const deltaTime = ((e.clientX - origin.startX) / rect.width) * duration;
        const length = origin.draftEnd - origin.draftStart;

        let newStart = origin.draftStart + deltaTime;
        let newEnd = origin.draftEnd + deltaTime;
        if (newStart < 0) {
          newStart = 0;
          newEnd = length;
        }
        if (newEnd > duration) {
          newEnd = duration;
          newStart = duration - length;
        }
        return { ...prev, start: newStart, end: newEnd };
      });
    };

    const handleMouseUp = () => {
      setActiveDragMode(null);
      moveDragOriginRef.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [activeDragMode, duration, timeFromClientX]);

  // ---- Keyboard shortcuts for the transport controls ----
  // Space: play/pause · ←/→: skip 5s · ↑/↓: volume · M: mute · R: restart ·
  // C: add clip · Esc: cancel the in-progress clip.
  // Ignored while focus is on a form control (inputs, textareas, the range
  // sliders themselves, buttons) so native behavior — e.g. Space activating
  // a focused button, or arrow keys nudging a focused slider — isn't
  // double-handled, and so the shortcuts don't fire while a real text field
  // (like the transcription box) would want to receive the keystroke
  // instead. Escape is the one exception — it never types a character, so
  // it's handled even while a form control is focused, letting Esc cancel
  // a clip draft even while the transcription textarea has focus.
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        target.isContentEditable
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (orderedVideos.length === 0) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Escape") {
        if (clipDraftRef.current) {
          e.preventDefault();
          handleCancelClip();
        }
        return;
      }

      if (isEditableTarget(e.target)) return;

      switch (e.key) {
        case " ":
        case "Spacebar":
          e.preventDefault();
          handleTogglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          handleSkip(-5);
          break;
        case "ArrowRight":
          e.preventDefault();
          handleSkip(5);
          break;
        case "ArrowUp":
          e.preventDefault();
          applyVolume((isMuted ? 0 : volume) + 0.05);
          break;
        case "ArrowDown":
          e.preventDefault();
          applyVolume((isMuted ? 0 : volume) - 0.05);
          break;
        case "m":
        case "M":
          e.preventDefault();
          handleToggleMute();
          break;
        case "r":
        case "R":
          e.preventDefault();
          handleRestart();
          break;
        case "c":
        case "C":
          e.preventDefault();
          handleStartClip();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    orderedVideos.length,
    handleTogglePlay,
    handleSkip,
    handleToggleMute,
    handleRestart,
    handleStartClip,
    handleCancelClip,
    applyVolume,
    isMuted,
    volume,
  ]);

  const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCurrentTime(Number(e.target.value));
  }, []);

  // Grabbing the seek bar directly is a clear signal the person wants to
  // scrub the real timeline themselves — deselect right away (rather than
  // waiting for mouse-up) so the bar unfreezes and tracks the drag live
  // instead of sitting still until the drag ends.
  const handleSeekGrab = useCallback(() => {
    setIsSeeking(true);
    setSelectedGroupKey(null);
    playUntilRef.current = null;
  }, []);

  const handleSeekCommit = useCallback(
    (e: React.ChangeEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement>) => {
      seekAllTo(Number((e.target as HTMLInputElement).value));
      setIsSeeking(false);
      // Manually scrubbing the seek bar steps outside whatever clip-only
      // playback boundary was active, same reasoning as handleRestart.
      playUntilRef.current = null;
    },
    [seekAllTo]
  );

  const handleLongestTimeUpdate = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (isSeeking) return;
      const t = e.currentTarget.currentTime;
      setCurrentTime(t);

      // Enforce the "play only this clip" boundary set in handleTogglePlay
      // (either the clip draft's end, or the selected saved clip's end) —
      // once playback reaches it, stop instead of continuing into the
      // rest of the take. Cleared afterward so the next Play press treats
      // it as a fresh start and re-seeks to the clip's beginning again.
      if (playUntilRef.current !== null && t >= playUntilRef.current) {
        forEachVideo((v) => v.pause());
        setIsPlaying(false);
        seekAllTo(playUntilRef.current);
        playUntilRef.current = null;
      }
    },
    [isSeeking, forEachVideo, seekAllTo]
  );

  const handleVideoLoadedMetadata = useCallback(
    (id: string) => (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const d = e.currentTarget.duration;
      if (Number.isFinite(d)) {
        setVideoDurations((prev) => ({ ...prev, [id]: d }));
      }
      e.currentTarget.volume = volume;
      e.currentTarget.muted = isMuted;
    },
    [volume, isMuted]
  );

  // Renders one filled video card in a mirror slot (or an "extra" slot),
  // matching TakeDetail's card structure/markup so the two pages share the
  // same visual language.
  const renderVideoCard = (video: RawVideoDetail, slotAttr: string) => (
    <div key={video.raw_video_id} className={styles.previewCard} data-slot={slotAttr}>
      <span className={styles.angleLabel}>{video.angle ?? "Unknown angle"}</span>
      <div className={styles.videoStage}>
        <video
          ref={registerVideoRef(video.raw_video_id)}
          className={styles.previewVideo}
          src={video.video_url}
          preload="metadata"
          crossOrigin="use-credentials"
          onTimeUpdate={
            video.raw_video_id === longestVideoId ? handleLongestTimeUpdate : undefined
          }
          onLoadedMetadata={handleVideoLoadedMetadata(video.raw_video_id)}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />
        <div className={styles.videoGloss} aria-hidden="true" />
      </div>
    </div>
  );

  // Renders the currently-active angle's panel inside a group card's
  // carousel — either the clip's video (click to play/pause just that
  // panel, inline) or an empty placeholder if this group has no clip for
  // that angle. Clicking the panel highlights the group (for the card +
  // timeline marker) but deliberately never seeks the master player — see
  // handleHighlightGroup.
  const renderActiveAnglePanel = (group: ClipGroup, entry: CarouselAngleEntry) => {
    if (!entry.groupAngle) {
      return (
        <div className={`${styles.miniStagePanel} ${styles.miniStagePanelEmpty}`}>
          <div className={styles.miniVideoStage}>
            <span className={styles.miniEmptyText}>No {entry.label}</span>
          </div>
          <span className={styles.miniAngleLabel}>{entry.label}</span>
        </div>
      );
    }

    const clip = entry.groupAngle.clip;
    const isClipPlaying = clip.clip_id === playingClipId;
    const handleActivate = (e: React.SyntheticEvent) => {
      e.stopPropagation();
      handleHighlightGroup(group);
      handleToggleClipPlay(clip.clip_id);
    };

    return (
      <div
        className={styles.miniStagePanel}
        onClick={handleActivate}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          // Always stop propagation here (not just on activation) so a
          // keyboard Enter/Space on this panel never also bubbles up to
          // the card's own onKeyDown and triggers a redundant select+seek.
          e.stopPropagation();
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleActivate(e);
          }
        }}
        aria-label={`${entry.label}, ${isClipPlaying ? "playing, click to pause" : "click to play"}`}
      >
        <div className={styles.miniVideoStage}>
          <video
            ref={registerClipVideoRef(clip.clip_id)}
            className={styles.miniVideo}
            src={clip.video_url}
            preload="metadata"
            muted
            playsInline
            crossOrigin="use-credentials"
            onEnded={handleClipVideoEnded(clip.clip_id)}
          />
          <div
            className={`${styles.miniPlayHint} ${isClipPlaying ? styles.miniPlayHintPlaying : ""}`}
            aria-hidden="true"
          >
            {isClipPlaying ? <PauseIcon /> : <PlayIcon />}
          </div>
        </div>
        <span className={styles.miniAngleLabel}>{entry.label}</span>
      </div>
    );
  };

  // Renders the inline transcription editor shared by the sidebar card's
  // footer and the timeline marker's tooltip — a textarea seeded with the
  // clip's current text, plus Cancel/Save. Save PATCHes
  // /takes/{take_id}/transcriptions/{transcription_file_id}; Cancel just
  // discards the draft and closes the box.
  const renderTranscriptionEditBox = (clip: ClipSummary) => (
    <div
      className={styles.transcriptionEditBox}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      // The sidebar group card (and, via bubbling, nothing else — the
      // timeline marker's wrap has no such handler) treats Space/Enter as
      // "select this card", the same way a native <button> does, via its
      // own onKeyDown. Without stopping propagation here, every keystroke
      // typed into the textarea below bubbles up to that handler too —
      // Space in particular gets caught, preventDefault()'d (so it never
      // reaches the textarea's value), and treated as "select/highlight
      // this clip" instead of "type a space". Stopping propagation at the
      // edit box's root keeps every keystroke — not just Space — scoped
      // to the textarea itself, the same way onMouseDown/onClick above
      // keep clicks from also selecting the card underneath.
      onKeyDown={(e) => e.stopPropagation()}
    >
      <textarea
        className={styles.transcriptionEditInput}
        value={editDraftText}
        onChange={(e) => setEditDraftText(e.target.value)}
        rows={3}
        autoFocus
        disabled={isSavingTranscription}
      />
      {transcriptionSaveError?.clipId === clip.clip_id && (
        <p className={styles.clipErrorText}>{transcriptionSaveError.message}</p>
      )}
      <div className={styles.transcriptionEditActions}>
        <button
          type="button"
          className={styles.transcriptionCancelBtn}
          onClick={handleCancelEditTranscription}
          disabled={isSavingTranscription}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.transcriptionSaveBtn}
          onClick={(e) => handleSaveTranscription(clip, e)}
          disabled={isSavingTranscription}
        >
          {isSavingTranscription ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );

  // Renders the timeline tooltip's color indicator. For groups that have
  // a clip_group_id (so there's something to PATCH), this is an editable
  // swatch: a hidden native <input type="color"> plus a pencil-icon hint
  // that's invisible until the swatch is hovered/focused, so the color
  // dot reads as "just a color" at rest and only reveals itself as
  // editable on interaction. Picking a new value fires
  // handleUpdateGroupColor immediately (native color inputs commit on
  // every change, so there's no separate Save step). Legacy/ungrouped
  // clips (no clip_group_id) fall back to the original plain, read-only
  // dot, since there's no group to target.
  const renderTooltipColorSwatch = (group: ClipGroup, color: string) => {
    const groupKey = getGroupKey(group);

    if (!group.clip_group_id) {
      return (
        <span
          className={styles.clipMarkerColorDot}
          style={{ background: color }}
          aria-hidden="true"
        />
      );
    }

    const isUpdating = updatingColorGroupKey === groupKey;

    return (
      <label
        className={styles.clipMarkerColorSwatch}
        style={{ background: color }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        title="Change clip color"
      >
        <input
          type="color"
          value={color}
          onChange={(e) => handleUpdateGroupColor(group, e.target.value)}
          disabled={isUpdating}
          aria-label="Change clip color"
        />
        <span className={styles.clipMarkerColorEditHint} aria-hidden="true">
          {isUpdating ? <SpinnerIcon /> : <EditIcon />}
        </span>
      </label>
    );
  };

  // Renders one group card in the right-hand sidebar: a single-angle
  // carousel (prev/next arrows + dot indicators) showing that group's
  // clips one at a time, a delete (trash) button, plus a footer showing
  // one angle's transcription — editable in place via the pencil button.
  // Clicking the carousel panel plays only that clip, inline, without
  // moving the master player; clicking the card elsewhere (its
  // meta/footer) selects the group and seeks the main timeline, same as
  // clicking its marker there. Double-clicking anywhere on the card
  // (other than the interactive controls, which stop propagation) opens
  // the full clip-detail modal — see handleOpenClipModal.
  const renderGroupCard = (group: ClipGroup) => {
    const groupKey = getGroupKey(group);
    const isSelected = groupKey === selectedGroupKey;
    const isDeleting = deletingGroupKey === groupKey;
    const carouselEntries = buildCarouselEntries(group);
    const activeAngleIndex = groupAngleIndex[groupKey] ?? getDefaultAngleIndex(carouselEntries);
    const activeEntry = carouselEntries[activeAngleIndex] ?? carouselEntries[0];
    const footerAngle = getFooterAngle(group);
    const footerClip = footerAngle?.clip ?? null;
    const transcriptionText = footerClip ? transcriptionTexts[footerClip.clip_id] : undefined;
    const transcriptionFailed = footerClip ? transcriptionErrors[footerClip.clip_id] : false;
    const groupLabel = getGroupLabel(group);
    const isEditingFooter = footerClip != null && editingClipId === footerClip.clip_id;

    return (
      <div
        key={groupKey}
        ref={registerClipCardRef(groupKey)}
        className={`${styles.groupCard} ${isSelected ? styles.groupCardSelected : ""}`}
        style={{
          // @ts-expect-error -- custom property consumed by the CSS module
          "--clip-color": getGroupColor(group),
        }}
        onClick={() => handleSelectGroup(group)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handleOpenClipModal(group);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleSelectGroup(group);
          }
        }}
        aria-pressed={isSelected}
        aria-label={
          groupLabel
            ? `${groupLabel}, ${formatTime(group.start_time_seconds)} to ${formatTime(group.end_time_seconds)}`
            : `Clip from ${formatTime(group.start_time_seconds)} to ${formatTime(group.end_time_seconds)}`
        }
      >
        <div className={styles.miniMirrorStage}>
          <div className={styles.miniCarousel}>
            {carouselEntries.length > 1 && (
              <button
                type="button"
                className={styles.miniNavBtn}
                onClick={handleCycleAngle(groupKey, carouselEntries, -1)}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Previous angle"
                title="Previous angle"
              >
                <ChevronLeftIcon />
              </button>
            )}

            <div className={styles.miniStageWrap}>
              {renderActiveAnglePanel(group, activeEntry)}
            </div>

            {carouselEntries.length > 1 && (
              <button
                type="button"
                className={styles.miniNavBtn}
                onClick={handleCycleAngle(groupKey, carouselEntries, 1)}
                onKeyDown={(e) => e.stopPropagation()}
                aria-label="Next angle"
                title="Next angle"
              >
                <ChevronRightIcon />
              </button>
            )}
          </div>

          {carouselEntries.length > 1 && (
            <div className={styles.miniDots}>
              {carouselEntries.map((entry, i) => (
                <button
                  key={entry.key}
                  type="button"
                  className={`${styles.miniDot} ${i === activeAngleIndex ? styles.miniDotActive : ""}`}
                  onClick={handleSetAngleIndex(groupKey, i)}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label={`Show ${entry.label} angle`}
                  aria-current={i === activeAngleIndex}
                  title={entry.label}
                />
              ))}
            </div>
          )}
        </div>

        <div className={styles.groupMeta}>
          <div className={styles.groupMetaRow}>
            <div className={styles.groupMetaText}>
              {groupLabel && (
                <span className={styles.groupLabel} title={groupLabel}>
                  {groupLabel}
                </span>
              )}
              <span className={styles.groupTime}>
                {formatTime(group.start_time_seconds)} – {formatTime(group.end_time_seconds)}
              </span>
            </div>

            <button
              type="button"
              className={styles.deleteGroupBtn}
              onClick={(e) => handleDeleteGroup(group, e)}
              onKeyDown={(e) => e.stopPropagation()}
              disabled={isDeleting}
              aria-label={groupLabel ? `Delete ${groupLabel}` : "Delete clip"}
              title="Delete clip"
            >
              {isDeleting ? <SpinnerIcon /> : <TrashIcon />}
            </button>
          </div>

          {deleteError?.groupKey === groupKey && (
            <p className={styles.clipErrorText}>{deleteError.message}</p>
          )}
        </div>

        <div className={styles.groupFooter}>
          {isEditingFooter && footerClip ? (
            renderTranscriptionEditBox(footerClip)
          ) : (
            <div className={styles.groupFooterRow}>
              {transcriptionText ? (
                <p className={styles.groupTranscription} title={transcriptionText}>
                  {transcriptionText}
                </p>
              ) : transcriptionFailed ? (
                <p className={styles.groupTranscriptionMuted}>Transcription unavailable</p>
              ) : footerClip?.transcription ? (
                <p className={styles.groupTranscriptionMuted}>Loading transcript…</p>
              ) : (
                <p className={styles.groupTranscriptionMuted}>No transcription</p>
              )}

              {footerClip?.transcription && (
                <button
                  type="button"
                  className={styles.editTranscriptionBtn}
                  onClick={(e) => handleStartEditTranscription(footerClip, e)}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label="Edit transcription"
                  title="Edit transcription"
                >
                  <EditIcon />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={() => router.push(`/dashboard/videos/raw/${take_id}`)}
      >
        ← Back to take
      </button>

      {loading && <p className={styles.statusText}>Loading take…</p>}
      {!loading && error && <p className={styles.errorText}>{error}</p>}

      {!loading && !error && take && (
        <div className={styles.editorLayout}>
          {/* ---- Main column: mirror stage, clip actions, master transport ---- */}
          <div className={styles.mainColumn}>
            <div className={styles.header}>
              <h2 className={styles.title}>Edit clips — {take.name ?? "Untitled take"}</h2>
            </div>

            {/* ---- Synced preview: fixed Left / Front / Right mirror slots,
                same as TakeDetail. Each slot always renders — either the
                video for that angle, or an empty placeholder — so a take
                with only one or two videos still shows them in the right
                position instead of collapsing to a lone centered card. ---- */}
            <div className={styles.mirrorStage}>
              <div className={styles.videoGrid}>
                {videoSlots.map((slot) =>
                  slot.video ? (
                    renderVideoCard(slot.video, slot.angle)
                  ) : (
                    <div
                      key={`empty-${slot.angle}`}
                      className={`${styles.previewCard} ${styles.previewCardEmpty}`}
                      data-slot={slot.angle}
                    >
                      <span className={styles.angleLabel}>{slot.angle}</span>
                      <div className={styles.videoStage}>
                        <div className={styles.emptySlotInner}>
                          <p className={styles.emptySlotText}>No {slot.angle} video</p>
                        </div>
                      </div>
                    </div>
                  )
                )}
                {extraVideos.map((v) => renderVideoCard(v, "extra"))}
                {videoSlots.every((s) => !s.video) && extraVideos.length === 0 && (
                  <p className={styles.emptyText}>No videos on this take yet.</p>
                )}
              </div>
            </div>

            {/* ---- "+ Clip" action, below the video section, right-aligned.
                Flips to Cancel/Done while a clip is being drafted. ---- */}
            <div className={styles.clipActionsRow}>
              {!clipDraft ? (
                <button
                  type="button"
                  className={styles.addClipBtn}
                  onClick={handleStartClip}
                  disabled={!duration || duration < MIN_CLIP_LENGTH_SECONDS}
                  title="Add clip (C)"
                >
                  <PlusIcon />
                  <span>Clip</span>
                </button>
              ) : (
                <div className={styles.clipActionsGroup}>
                  <button
                    type="button"
                    className={styles.cancelClipBtn}
                    onClick={handleCancelClip}
                    disabled={isSubmittingClip}
                    aria-label="Cancel clip"
                    title="Cancel (Esc)"
                  >
                    <CloseIcon />
                  </button>
                  <button
                    type="button"
                    className={styles.doneClipBtn}
                    onClick={handleConfirmClip}
                    disabled={isSubmittingClip}
                  >
                    {isSubmittingClip ? "Saving…" : "Done"}
                  </button>
                </div>
              )}
            </div>

            {/* ---- Master transport: transparent, music-player style.
                Row 1: big centered play/pause, with restart/back-10 to the
                left and forward-10/mute/volume to the right.
                Row 2: timeline (current time / seek bar / duration), plus
                the clip-range selector overlaid on the seek bar itself.
                Row 3: keyboard shortcut hints styled as small key chips. ---- */}
            {orderedVideos.length > 0 && (
              <div className={styles.masterControls}>
                <div className={styles.masterControlsRow}>
                  <div className={styles.masterTransportLeft}>
                    <button
                      type="button"
                      className={styles.masterIconBtn}
                      onClick={handleRestart}
                      aria-label="Restart all"
                      title="Restart (R)"
                    >
                      <RestartIcon />
                    </button>
                    <button
                      type="button"
                      className={styles.masterIconBtn}
                      onClick={() => handleSkip(-10)}
                      aria-label="Back 10 seconds"
                      title="Back 10s (←)"
                    >
                      <SkipBackIcon />
                    </button>
                  </div>

                  <button
                    type="button"
                    className={styles.masterPlayBtn}
                    onClick={handleTogglePlay}
                    aria-label={
                      isPlaying
                        ? "Pause all"
                        : clipDraft
                          ? "Preview clip from start"
                          : selectedGroupKey
                            ? "Play selected clip"
                            : "Play all"
                    }
                    title={
                      isPlaying
                        ? "Pause all (Space)"
                        : clipDraft
                          ? "Preview clip from start (Space)"
                          : selectedGroupKey
                            ? "Play selected clip (Space)"
                            : "Play all (Space)"
                    }
                  >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </button>

                  <div className={styles.masterTransportRight}>
                    <button
                      type="button"
                      className={styles.masterIconBtn}
                      onClick={() => handleSkip(10)}
                      aria-label="Forward 10 seconds"
                      title="Forward 10s (→)"
                    >
                      <SkipForwardIcon />
                    </button>
                    <button
                      type="button"
                      className={styles.masterIconBtn}
                      onClick={handleToggleMute}
                      aria-label={isMuted ? "Unmute" : "Mute"}
                      title={isMuted ? "Unmute (M)" : "Mute (M)"}
                    >
                      {isMuted || volume === 0 ? <VolumeMuteIcon /> : <VolumeHighIcon />}
                    </button>
                    <input
                      type="range"
                      className={styles.masterVolumeBar}
                      min={0}
                      max={1}
                      step={0.01}
                      value={isMuted ? 0 : volume}
                      style={{
                        // @ts-expect-error -- custom property consumed by the CSS module
                        "--fill": `${(isMuted ? 0 : volume) * 100}%`,
                      }}
                      onChange={handleVolumeChange}
                      aria-label="Volume for all videos"
                    />
                  </div>
                </div>

                <div className={styles.masterTimeline}>
                  <span className={styles.masterTime}>{formatTime(displayedCurrentTime)}</span>

                  <div className={styles.seekBarWrapper} ref={clipTrackRef}>
                    <input
                      type="range"
                      className={styles.masterSeekBar}
                      min={0}
                      max={duration || 0}
                      step={0.01}
                      value={Math.min(displayedCurrentTime, duration || 0)}
                      style={{
                        // @ts-expect-error -- custom property consumed by the CSS module
                        "--fill": `${duration > 0 ? Math.min(displayedCurrentTime, duration) / duration * 100 : 0}%`,
                      }}
                      onMouseDown={handleSeekGrab}
                      onTouchStart={handleSeekGrab}
                      onChange={handleSeekChange}
                      onMouseUp={handleSeekCommit}
                      onTouchEnd={handleSeekCommit}
                      aria-label="Seek all videos"
                    />

                    {/* One marker per clip group (not per individual angle
                        clip) — a group spanning 3 angles shows as a single
                        segment here, matching how it's one card in the
                        sidebar. Keyed by group key — stable across
                        refetches, unlike array index. Clicking a marker
                        selects (highlights) that group, same as clicking
                        its card in the sidebar — it doesn't move the
                        playhead; press Play to actually jump to and play
                        it. Double-clicking a marker opens the same
                        clip-detail modal as double-clicking its sidebar
                        card. Hovering (or focusing, via keyboard) a marker
                        shows a read-only-by-default tooltip with that
                        clip's color and transcription — same info as the
                        sidebar card's footer, just reachable straight from
                        the timeline, and now editable in place via its own
                        pencil button, same as the sidebar footer. The
                        color dot itself is also editable in place — see
                        renderTooltipColorSwatch — so recoloring a clip
                        never requires opening the sidebar card. */}
                    {duration > 0 &&
                      sortedGroups.map((g) => {
                        const key = getGroupKey(g);
                        const isSelected = key === selectedGroupKey;
                        const label = getGroupLabel(g);
                        const groupColor = getGroupColor(g);
                        const tooltipAngle = getFooterAngle(g);
                        const tooltipClip = tooltipAngle?.clip ?? null;
                        const tooltipTranscription = tooltipClip
                          ? transcriptionTexts[tooltipClip.clip_id]
                          : undefined;
                        const tooltipTranscriptionFailed = tooltipClip
                          ? transcriptionErrors[tooltipClip.clip_id]
                          : false;
                        const isEditingTooltip =
                          tooltipClip != null && editingClipId === tooltipClip.clip_id;

                        return (
                          <div
                            key={key}
                            className={styles.clipMarkerWrap}
                            style={{
                              left: `${(g.start_time_seconds / duration) * 100}%`,
                              width: `${((g.end_time_seconds - g.start_time_seconds) / duration) * 100}%`,
                            }}
                          >
                            <button
                              type="button"
                              className={`${styles.clipMarker} ${isSelected ? styles.clipMarkerSelected : ""}`}
                              style={{ background: groupColor }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectGroup(g);
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                handleOpenClipModal(g);
                              }}
                              aria-label={
                                label
                                  ? `Select clip ${label}, ${formatTime(g.start_time_seconds)} to ${formatTime(g.end_time_seconds)}`
                                  : `Select clip, ${formatTime(g.start_time_seconds)} to ${formatTime(g.end_time_seconds)}`
                              }
                            />

                            {/*
                              Tooltip container. Two things fix the
                              "disappears before I can reach it" bug:
                              1. `.clipMarkerWrap::before` (in the CSS
                                 module) adds an invisible hover bridge
                                 over the gap between the marker and this
                                 box, so moving the mouse up from the
                                 marker never leaves a hoverable area.
                              2. While this clip's transcription is being
                                 edited (isEditingTooltip), we add the
                                 `clipMarkerTooltipPinned` class, which
                                 forces the tooltip to stay open/interactive
                                 regardless of hover state — so it can never
                                 vanish mid-edit even if the cursor drifts
                                 off it while typing.
                            */}
                            <div
                              className={`${styles.clipMarkerTooltip} ${
                                isEditingTooltip ? styles.clipMarkerTooltipPinned : ""
                              }`}
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <div className={styles.clipTooltipRow}>
                                {renderTooltipColorSwatch(g, groupColor)}
                                <span className={styles.clipRangeTime}>
                                  {formatTime(g.start_time_seconds)} – {formatTime(g.end_time_seconds)}
                                </span>
                              </div>

                              {colorUpdateError?.groupKey === key && (
                                <p className={styles.clipErrorText}>{colorUpdateError.message}</p>
                              )}

                              {label && (
                                <p className={styles.clipMarkerTooltipLabel} title={label}>
                                  {label}
                                </p>
                              )}

                              {isEditingTooltip && tooltipClip ? (
                                renderTranscriptionEditBox(tooltipClip)
                              ) : (
                                <div className={styles.clipMarkerTooltipFooterRow}>
                                  <p className={styles.clipMarkerTooltipTranscription}>
                                    {tooltipTranscription
                                      ? tooltipTranscription
                                      : tooltipTranscriptionFailed
                                        ? "Transcription unavailable"
                                        : tooltipClip?.transcription
                                          ? "Loading transcript…"
                                          : "No transcription"}
                                  </p>
                                  {tooltipClip?.transcription && (
                                    <button
                                      type="button"
                                      className={styles.editTranscriptionBtn}
                                      onClick={(e) => handleStartEditTranscription(tooltipClip, e)}
                                      aria-label="Edit transcription"
                                      title="Edit transcription"
                                    >
                                      <EditIcon />
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                    {/* The in-progress draft: draggable range + handles +
                        the color/transcription tooltip. */}
                    {clipDraft && duration > 0 && (
                      <div
                        className={styles.clipRangeBar}
                        style={{
                          left: `${(clipDraft.start / duration) * 100}%`,
                          width: `${((clipDraft.end - clipDraft.start) / duration) * 100}%`,
                          // @ts-expect-error -- custom property consumed by the CSS module
                          "--clip-color": clipDraft.color,
                        }}
                        onMouseDown={handleRangeBarDown}
                      >
                        <div
                          className={styles.clipRangeHandle}
                          data-side="start"
                          onMouseDown={handleRangeHandleDown("start")}
                        />
                        <div
                          className={styles.clipRangeHandle}
                          data-side="end"
                          onMouseDown={handleRangeHandleDown("end")}
                        />

                        <div className={styles.clipTooltip} onMouseDown={(e) => e.stopPropagation()}>
                          <div className={styles.clipTooltipRow}>
                            <label className={styles.clipColorSwatch} style={{ background: clipDraft.color }}>
                              <input
                                type="color"
                                value={clipDraft.color}
                                onChange={(e) =>
                                  setClipDraft((prev) => (prev ? { ...prev, color: e.target.value } : prev))
                                }
                                aria-label="Clip color"
                              />
                            </label>
                            <span className={styles.clipRangeTime}>
                              {formatTime(clipDraft.start)} – {formatTime(clipDraft.end)}
                            </span>
                          </div>

                          <textarea
                            className={styles.clipTranscriptionInput}
                            placeholder="Type the transcription for this clip…"
                            value={clipDraft.transcription}
                            onChange={(e) =>
                              setClipDraft((prev) => (prev ? { ...prev, transcription: e.target.value } : prev))
                            }
                            rows={3}
                          />

                          {clipSubmitError && <p className={styles.clipErrorText}>{clipSubmitError}</p>}
                        </div>
                      </div>
                    )}
                  </div>

                  <span className={styles.masterTime}>{formatTime(duration)}</span>
                </div>

                <div className={styles.masterShortcutsHint}>
                  <span>
                    <span className={styles.shortcutKey}>Space</span>{" "}
                    {clipDraft ? "preview clip from start" : "play/pause"}
                  </span>
                  <span>
                    <span className={styles.shortcutKey}>←</span>
                    <span className={styles.shortcutKey}>→</span> skip 5s
                  </span>
                  <span>
                    <span className={styles.shortcutKey}>↑</span>
                    <span className={styles.shortcutKey}>↓</span> volume
                  </span>
                  <span>
                    <span className={styles.shortcutKey}>M</span> mute
                  </span>
                  <span>
                    <span className={styles.shortcutKey}>R</span> restart
                  </span>
                  <span>
                    <span className={styles.shortcutKey}>C</span> add clip
                  </span>
                  <span>
                    <span className={styles.shortcutKey}>Esc</span> cancel clip
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* ---- Right sidebar: collapsible, scrollable list of clip
              groups already created on this take. Each card shows a
              single-angle carousel of that group's clips — clicking a
              specific angle plays only that one clip inline, right there
              in the sidebar. A card's color accent matches its marker on
              the master timeline above, and selecting either one syncs
              the other. Double-clicking a card opens the full clip-detail
              modal. Collapsing hides the list behind a slim rail so it
              can be tucked away without losing the main column's
              width. ---- */}
          <aside
            className={`${styles.clipSidebar} ${isSidebarCollapsed ? styles.clipSidebarCollapsed : ""}`}
          >
            <div className={styles.clipSidebarHeader}>
              {!isSidebarCollapsed && (
                <>
                  <h3 className={styles.sectionTitle}>Clips</h3>
                  {sortedGroups.length > 0 && (
                    <span className={styles.clipStripCount}>{sortedGroups.length}</span>
                  )}
                </>
              )}
              <button
                type="button"
                className={styles.sidebarCollapseBtn}
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                aria-label={isSidebarCollapsed ? "Expand clips sidebar" : "Collapse clips sidebar"}
                aria-expanded={!isSidebarCollapsed}
                title={isSidebarCollapsed ? "Expand clips" : "Collapse clips"}
              >
                {isSidebarCollapsed ? <ChevronLeftIcon /> : <ChevronRightIcon />}
              </button>
            </div>

            {isSidebarCollapsed ? (
              sortedGroups.length > 0 && (
                <span className={styles.clipStripCountCollapsed}>{sortedGroups.length}</span>
              )
            ) : sortedGroups.length > 0 ? (
              <div className={styles.clipSidebarScroll}>
                {sortedGroups.map((group) => renderGroupCard(group))}
              </div>
            ) : (
              <p className={styles.clipStripEmpty}>
                No clips yet — use the “+ Clip” button to cut your first one.
              </p>
            )}
          </aside>
        </div>
      )}

      {/* ---- Clip detail modal: opened by double-clicking a sidebar card
          or a timeline marker. Shows the fixed left/front/right layout for
          that one clip group — video if that angle has a clip, an upload
          placeholder otherwise. Rendered at the page root, outside
          editorLayout, so it overlays everything regardless of sidebar
          collapse state. viewAngleIds (built above from take.raw_videos)
          is what enables the modal's Replace/Delete buttons per angle. ---- */}
      <ClipDetailModal
        group={modalGroup}
        onClose={handleCloseClipModal}
        viewAngleIds={viewAngleIds}
        onClipUploaded={(clipGroupId, angle, clip) => {
          setGroups((prev) =>
            prev.map((g) => {
              if (getGroupKey(g) !== clipGroupId && g.clip_group_id !== clipGroupId) return g;
              const withoutAngle = g.angles.filter((a) => a.angle?.toLowerCase() !== angle);
              const rawVideoId =
                take?.raw_videos.find((rv) => rv.angle?.toLowerCase() === angle)?.raw_video_id ??
                clip.raw_video_id;
              return {
                ...g,
                angles: [...withoutAngle, { raw_video_id: rawVideoId, angle, clip }],
              };
            })
          );
          setModalGroup((prev) => {
            if (!prev) return prev;
            if (getGroupKey(prev) !== clipGroupId && prev.clip_group_id !== clipGroupId) return prev;
            const withoutAngle = prev.angles.filter((a) => a.angle?.toLowerCase() !== angle);
            const rawVideoId =
              take?.raw_videos.find((rv) => rv.angle?.toLowerCase() === angle)?.raw_video_id ??
              clip.raw_video_id;
            return {
              ...prev,
              angles: [...withoutAngle, { raw_video_id: rawVideoId, angle, clip }],
            };
          });
        }}
        onClipDeleted={(clipGroupId, angle) => {
          setGroups((prev) =>
            prev.map((g) => {
              if (getGroupKey(g) !== clipGroupId && g.clip_group_id !== clipGroupId) return g;
              return { ...g, angles: g.angles.filter((a) => a.angle?.toLowerCase() !== angle) };
            })
          );
          setModalGroup((prev) => {
            if (!prev) return prev;
            if (getGroupKey(prev) !== clipGroupId && prev.clip_group_id !== clipGroupId) return prev;
            return { ...prev, angles: prev.angles.filter((a) => a.angle?.toLowerCase() !== angle) };
          });
        }}
      />
    </div>
  );
}

// ---- Icons (inline SVG, stroke-based to match the control bar's line weight) ----

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v13.72c0 .74.81 1.19 1.44.79l10.86-6.86a.94.94 0 0 0 0-1.58L9.44 4.35A.94.94 0 0 0 8 5.14Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4.5" height="14" rx="1" />
      <rect x="13.5" y="5" width="4.5" height="14" rx="1" />
    </svg>
  );
}

function SkipBackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="17 4 8 12 17 20" fill="currentColor" stroke="none" />
      <line x1="6" y1="4" x2="6" y2="20" />
    </svg>
  );
}

function SkipForwardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="7 4 16 12 7 20" fill="currentColor" stroke="none" />
      <line x1="18" y1="4" x2="18" y2="20" />
    </svg>
  );
}

function RestartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3.06-6.77" />
      <polyline points="3 4 3 9 8 9" />
    </svg>
  );
}

function VolumeHighIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="4 9 8 9 12 5 12 19 8 15 4 15" fill="currentColor" stroke="none" />
      <path d="M16 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

function VolumeMuteIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="4 9 8 9 12 5 12 19 8 15 4 15" fill="currentColor" stroke="none" />
      <line x1="16" y1="9" x2="21" y2="14" />
      <line x1="21" y1="9" x2="16" y2="14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4 7 6.5 7 20 7" />
      <path d="M18.5 7 17.7 19a2 2 0 0 1-2 1.9H8.3a2 2 0 0 1-2-1.9L5.5 7" />
      <path d="M9.5 7V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4A1.3 1.3 0 0 1 14.5 4.8V7" />
      <line x1="10" y1="11" x2="10" y2="16.5" />
      <line x1="14" y1="11" x2="14" y2="16.5" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={styles.spinIcon}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-3.24-6.91" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}