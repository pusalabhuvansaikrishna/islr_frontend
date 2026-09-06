"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import styles from "./TakeDetail.module.css";
import { BASE_URL } from "@/config/api";

// ---- Types (mirrors backend TakeDetail response_model) ----

interface SessionSummary {
  session_id: string;
  name: string | null;
  location: string | null;
  started_at: string | null;
  ended_at: string | null;
  organization: string | null;
  sign_person: string | null;
}

interface RawVideoDetail {
  raw_video_id: string;
  filename: string;
  relative_path: string;
  video_url: string;
  angle: string | null;
  duration_seconds: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
  bitrate: number | null;
  aspect_ratio: string | null;
  file_size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

interface TranscriptionFileDetail {
  transcription_file_id: string;
  transcription_type: string;
  filename: string;
  relative_path: string;
  download_url: string;
  format: string | null;
  language: string | null;
  file_size_bytes: number | null;
  created_by: string | null;
  created_at: string;
}

interface TakeDetail {
  take_id: string;
  name: string | null;
  take_number: number | null;
  recorded_at: string | null;
  notes: string | null;
  session: SessionSummary | null;
  created_by: string | null;
  angles: string[];
  raw_videos: RawVideoDetail[];
  transcription_files: TranscriptionFileDetail[];
  created_at: string;
  updated_at: string;
}

// ---- Helpers ----

// Fixed display order for camera angles. Anything not listed here
// (unknown/null angle) sorts to the end, in whatever order it came in.
const ANGLE_ORDER: Record<string, number> = {
  left: 0,
  front: 1,
  right: 2,
};

// The three "designated" mirror slots. Each always renders — either with
// its video, or as an empty placeholder — so a take with only one video
// still shows that video in its correct position (left/front/right)
// instead of being centered and awkwardly re-rotated.
const KNOWN_ANGLES = ["left", "front", "right"] as const;
type KnownAngle = (typeof KNOWN_ANGLES)[number];

interface VideoSlot {
  angle: KnownAngle;
  video: RawVideoDetail | null;
}

function sortByAngleOrder(videos: RawVideoDetail[]): RawVideoDetail[] {
  return [...videos].sort((a, b) => {
    const aKey = a.angle?.toLowerCase() ?? "";
    const bKey = b.angle?.toLowerCase() ?? "";
    const aRank = ANGLE_ORDER[aKey] ?? Number.MAX_SAFE_INTEGER;
    const bRank = ANGLE_ORDER[bKey] ?? Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}

// Splits raw videos into the three fixed left/front/right slots (each
// either filled or empty) plus any "extra" videos whose angle doesn't
// match one of the three known slots. If two videos claim the same known
// angle, the first one found wins that slot and the rest fall through to
// "extra" rather than being dropped.
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Unknown date";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const NOTES_MAX_LENGTH = 1000;

export default function TakeDetailPage() {
  const { take_id } = useParams<{ take_id: string }>();
  const router = useRouter();

  const [data, setData] = useState<TakeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});

  // ---- Transcription upload state ----
  const transcriptionFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploadingTranscription, setIsUploadingTranscription] = useState(false);
  const [transcriptionUploadError, setTranscriptionUploadError] = useState<string | null>(
    null
  );

  // ---- Video upload state (for empty left/front/right slots) ----
  const videoFileInputRef = useRef<HTMLInputElement | null>(null);
  // Which angle the currently-open file picker is for. Set right before
  // triggering the hidden <input>'s click, read back once the user picks
  // (or cancels) a file, since the native file input itself only tells us
  // "a file was chosen", not which button opened it.
  const pendingUploadAngleRef = useRef<KnownAngle | null>(null);
  const [uploadingAngle, setUploadingAngle] = useState<KnownAngle | null>(null);
  const [videoUploadErrors, setVideoUploadErrors] = useState<Record<string, string>>({});

  // ---- Video delete state ----
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);
  const [videoActionErrors, setVideoActionErrors] = useState<Record<string, string>>({});

  const clearVideoActionError = useCallback((rawVideoId: string) => {
    setVideoActionErrors((prev) => {
      if (!(rawVideoId in prev)) return prev;
      const next = { ...prev };
      delete next[rawVideoId];
      return next;
    });
  }, []);

  // ---- Transcription text preview state ----
  // Each transcription file's plain-text contents, fetched client-side from
  // its download_url and cached by transcription_file_id so we don't
  // re-fetch on every render.
  type TranscriptTextEntry =
    | { status: "loading" }
    | { status: "loaded"; text: string }
    | { status: "error"; error: string };
  const [transcriptTexts, setTranscriptTexts] = useState<Record<string, TranscriptTextEntry>>(
    {}
  );
  const fetchedTranscriptIdsRef = useRef<Set<string>>(new Set());
  const lastTranscriptTakeIdRef = useRef<string | null>(null);

  // ---- Master control state ----
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  // Each loaded video's own duration, keyed by raw_video_id. The master
  // timeline's total length is the MAX of these (the longest clip), not
  // any single "primary" video — see `duration` and `longestVideoId` below.
  const [videoDurations, setVideoDurations] = useState<Record<string, number>>({});
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isSeeking, setIsSeeking] = useState(false);

  // ---- Take notes edit state ----
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const markVideoError = useCallback((rawVideoId: string) => {
    setVideoErrors((prev) => ({ ...prev, [rawVideoId]: true }));
  }, []);

  // Clicking "Add Transcription" just opens the hidden file input — the
  // actual upload happens in handleTranscriptionFileSelected once the user
  // picks a file.
  const handleAddTranscriptionClick = useCallback(() => {
    setTranscriptionUploadError(null);
    transcriptionFileInputRef.current?.click();
  }, []);

  const handleTranscriptionFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      // Reset the input so selecting the same file again still fires onChange.
      e.target.value = "";
      if (!file) return;

      if (!file.name.toLowerCase().endsWith(".txt")) {
        setTranscriptionUploadError("Only .txt files are supported.");
        return;
      }

      setTranscriptionUploadError(null);
      setIsUploadingTranscription(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        // Backend enum is ['RAW', 'EDITED']. User uploads via this button
        // are plain/original transcripts, so they're tagged RAW.
        formData.append("transcription_type", "RAW");

        const res = await fetch(`${BASE_URL}/takes/${take_id}/transcriptions`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Upload failed (${res.status})`);
        }

        const uploaded: TranscriptionFileDetail = await res.json();
        setData((prev) =>
          prev
            ? { ...prev, transcription_files: [...prev.transcription_files, uploaded] }
            : prev
        );
      } catch (err) {
        setTranscriptionUploadError(
          err instanceof Error ? err.message : "Failed to upload transcription file"
        );
      } finally {
        setIsUploadingTranscription(false);
      }
    },
    [take_id]
  );

  // Clicking "Add Video" on an empty slot just remembers which angle it
  // was for, then opens the (single, shared) hidden file input — the
  // actual upload happens in handleVideoFileSelected once a file is picked.
  const handleAddVideoClick = useCallback((angle: KnownAngle) => {
    setVideoUploadErrors((prev) => {
      if (!(angle in prev)) return prev;
      const next = { ...prev };
      delete next[angle];
      return next;
    });
    pendingUploadAngleRef.current = angle;
    videoFileInputRef.current?.click();
  }, []);

  const handleVideoFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      const angle = pendingUploadAngleRef.current;
      // Reset the input so selecting the same file again still fires onChange.
      e.target.value = "";
      if (!file || !angle) return;

      if (!file.type.startsWith("video/")) {
        setVideoUploadErrors((prev) => ({ ...prev, [angle]: "Please select a video file." }));
        pendingUploadAngleRef.current = null;
        return;
      }

      setUploadingAngle(angle);
      try {
        const formData = new FormData();
        // Backend expects the human-readable angle name (e.g. "Left"),
        // matched case-insensitively against ViewAngle rows.
        formData.append("view_angle", angle);
        formData.append("file", file);

        const res = await fetch(`${BASE_URL}/takes/${take_id}/videos`, {
          method: "POST",
          credentials: "include",
          body: formData,
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Upload failed (${res.status})`);
        }

        const uploaded: RawVideoDetail = await res.json();
        setData((prev) =>
          prev ? { ...prev, raw_videos: [...prev.raw_videos, uploaded] } : prev
        );
      } catch (err) {
        setVideoUploadErrors((prev) => ({
          ...prev,
          [angle]: err instanceof Error ? err.message : "Failed to upload video",
        }));
      } finally {
        setUploadingAngle(null);
        pendingUploadAngleRef.current = null;
      }
    },
    [take_id]
  );

  const handleDeleteVideoClick = useCallback(
    async (video: RawVideoDetail) => {
      const confirmed = window.confirm(
        `Delete the ${video.angle ?? "unlabeled"} video ("${video.filename}")? This cannot be undone.`
      );
      if (!confirmed) return;

      setDeletingVideoId(video.raw_video_id);
      clearVideoActionError(video.raw_video_id);
      try {
        const res = await fetch(`${BASE_URL}/takes/${take_id}/videos/${video.raw_video_id}`, {
          method: "DELETE",
          credentials: "include",
        });

        if (!res.ok && res.status !== 204) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Delete failed (${res.status})`);
        }

        // Remove it from the list so its slot reverts to the empty
        // "Add Video" placeholder (or it disappears from "extra" videos).
        setData((prev) =>
          prev
            ? {
                ...prev,
                raw_videos: prev.raw_videos.filter(
                  (v) => v.raw_video_id !== video.raw_video_id
                ),
              }
            : prev
        );

        // Clean up any other state keyed by this video's id so a future
        // video re-uploaded to the same slot doesn't inherit stale state.
        setVideoErrors((prev) => {
          if (!(video.raw_video_id in prev)) return prev;
          const next = { ...prev };
          delete next[video.raw_video_id];
          return next;
        });
        setVideoDurations((prev) => {
          if (!(video.raw_video_id in prev)) return prev;
          const next = { ...prev };
          delete next[video.raw_video_id];
          return next;
        });
        delete videoRefs.current[video.raw_video_id];
      } catch (err) {
        setVideoActionErrors((prev) => ({
          ...prev,
          [video.raw_video_id]:
            err instanceof Error ? err.message : "Failed to delete video",
        }));
      } finally {
        setDeletingVideoId(null);
      }
    },
    [take_id, clearVideoActionError]
  );

  // ---- Transcription edit/delete state ----
  const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(null);
  const [editDraftText, setEditDraftText] = useState("");
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [deletingTranscriptId, setDeletingTranscriptId] = useState<string | null>(null);
  const [transcriptActionErrors, setTranscriptActionErrors] = useState<Record<string, string>>(
    {}
  );

  const clearTranscriptActionError = useCallback((id: string) => {
    setTranscriptActionErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Enter edit mode: pre-fill the textarea with whatever text is already
  // loaded for this transcript (it should be, since it's fetched as soon
  // as the take loads).
  const handleEditTranscriptionClick = useCallback(
    (tf: TranscriptionFileDetail) => {
      const entry = transcriptTexts[tf.transcription_file_id];
      setEditDraftText(entry && entry.status === "loaded" ? entry.text : "");
      setEditingTranscriptId(tf.transcription_file_id);
      clearTranscriptActionError(tf.transcription_file_id);
    },
    [transcriptTexts, clearTranscriptActionError]
  );

  const handleCancelEditTranscription = useCallback(() => {
    setEditingTranscriptId(null);
    setEditDraftText("");
  }, []);

  const handleSaveEditTranscription = useCallback(
    async (tf: TranscriptionFileDetail) => {
      setSavingEditId(tf.transcription_file_id);
      clearTranscriptActionError(tf.transcription_file_id);
      try {
        const res = await fetch(
          `${BASE_URL}/takes/${take_id}/transcriptions/${tf.transcription_file_id}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: editDraftText }),
          }
        );

        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Save failed (${res.status})`);
        }

        const updated: TranscriptionFileDetail = await res.json();
        setData((prev) =>
          prev
            ? {
                ...prev,
                transcription_files: prev.transcription_files.map((f) =>
                  f.transcription_file_id === updated.transcription_file_id ? updated : f
                ),
              }
            : prev
        );
        // Reflect the saved text immediately rather than re-fetching it.
        setTranscriptTexts((prev) => ({
          ...prev,
          [updated.transcription_file_id]: { status: "loaded", text: editDraftText },
        }));
        setEditingTranscriptId(null);
        setEditDraftText("");
      } catch (err) {
        setTranscriptActionErrors((prev) => ({
          ...prev,
          [tf.transcription_file_id]:
            err instanceof Error ? err.message : "Failed to save transcript",
        }));
      } finally {
        setSavingEditId(null);
      }
    },
    [take_id, editDraftText, clearTranscriptActionError]
  );

  const handleDeleteTranscriptionClick = useCallback(
    async (tf: TranscriptionFileDetail) => {
      const confirmed = window.confirm(
        `Delete "${tf.filename}"? This cannot be undone.`
      );
      if (!confirmed) return;

      setDeletingTranscriptId(tf.transcription_file_id);
      clearTranscriptActionError(tf.transcription_file_id);
      try {
        const res = await fetch(
          `${BASE_URL}/takes/${take_id}/transcriptions/${tf.transcription_file_id}`,
          {
            method: "DELETE",
            credentials: "include",
          }
        );

        if (!res.ok && res.status !== 204) {
          const detail = await res.text().catch(() => "");
          throw new Error(detail || `Delete failed (${res.status})`);
        }

        setData((prev) =>
          prev
            ? {
                ...prev,
                transcription_files: prev.transcription_files.filter(
                  (f) => f.transcription_file_id !== tf.transcription_file_id
                ),
              }
            : prev
        );
        setTranscriptTexts((prev) => {
          if (!(tf.transcription_file_id in prev)) return prev;
          const next = { ...prev };
          delete next[tf.transcription_file_id];
          return next;
        });
        fetchedTranscriptIdsRef.current.delete(tf.transcription_file_id);
        if (editingTranscriptId === tf.transcription_file_id) {
          setEditingTranscriptId(null);
          setEditDraftText("");
        }
      } catch (err) {
        setTranscriptActionErrors((prev) => ({
          ...prev,
          [tf.transcription_file_id]:
            err instanceof Error ? err.message : "Failed to delete transcription",
        }));
      } finally {
        setDeletingTranscriptId(null);
      }
    },
    [take_id, editingTranscriptId, clearTranscriptActionError]
  );

  // ---- Copy transcript text to clipboard ----
  const [copiedTranscriptId, setCopiedTranscriptId] = useState<string | null>(null);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  const handleCopyTranscriptionClick = useCallback(
    async (tf: TranscriptionFileDetail) => {
      const entry = transcriptTexts[tf.transcription_file_id];
      if (!entry || entry.status !== "loaded") return;
      try {
        await navigator.clipboard.writeText(entry.text);
        setCopiedTranscriptId(tf.transcription_file_id);
        if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
        copiedTimeoutRef.current = setTimeout(() => setCopiedTranscriptId(null), 1500);
      } catch {
        // Clipboard access denied/unavailable — fail silently rather than
        // interrupt the user; they can still select/copy the text manually.
      }
    },
    [transcriptTexts]
  );

  // Fetch each transcription file's plain-text contents client-side (from
  // its download_url) so the actual transcript can be shown inline, not
  // just its metadata. Cached per transcription_file_id so switching tabs
  // or re-rendering doesn't re-fetch already-loaded transcripts.
  useEffect(() => {
    if (!data) return;

    // If we've navigated to a different take, drop any cached/in-flight
    // text from the previous one before fetching this take's transcripts.
    if (lastTranscriptTakeIdRef.current !== data.take_id) {
      lastTranscriptTakeIdRef.current = data.take_id;
      fetchedTranscriptIdsRef.current = new Set();
      setTranscriptTexts({});
    }

    data.transcription_files.forEach((tf) => {
      if (fetchedTranscriptIdsRef.current.has(tf.transcription_file_id)) return;
      fetchedTranscriptIdsRef.current.add(tf.transcription_file_id);

      setTranscriptTexts((prev) => ({
        ...prev,
        [tf.transcription_file_id]: { status: "loading" },
      }));

      fetch(tf.download_url, { credentials: "include" })
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load transcript (${res.status})`);
          return res.text();
        })
        .then((text) => {
          setTranscriptTexts((prev) => ({
            ...prev,
            [tf.transcription_file_id]: { status: "loaded", text },
          }));
        })
        .catch((err) => {
          setTranscriptTexts((prev) => ({
            ...prev,
            [tf.transcription_file_id]: {
              status: "error",
              error: err instanceof Error ? err.message : "Failed to load transcript text",
            },
          }));
        });
    });
  }, [data]);

  const fetchTake = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_URL}/takes/${take_id}`, {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Failed to load take (${res.status})`);
      }

      const json: TakeDetail = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load take");
    } finally {
      setLoading(false);
    }
  }, [take_id]);

  useEffect(() => {
    fetchTake();
  }, [fetchTake]);

  const orderedRawVideos = useMemo(
    () => (data ? sortByAngleOrder(data.raw_videos) : []),
    [data]
  );

  // Fixed left/front/right slots (filled or empty) plus any videos whose
  // angle doesn't match one of the three known slots.
  const { slots: videoSlots, extras: extraVideos } = useMemo(
    () => (data ? buildVideoSlots(data.raw_videos) : { slots: [], extras: [] }),
    [data]
  );

  // Master timeline length = the longest loaded video's duration, so the
  // seek bar always spans the full length of the longest angle rather than
  // being capped at a shorter one.
  const duration = useMemo(() => {
    const values = Object.values(videoDurations);
    return values.length > 0 ? Math.max(...values) : 0;
  }, [videoDurations]);

  // Which video currently holds the longest known duration. This one drives
  // the shared timeline (currentTime ticking, and flipping "Play" back to
  // "Pause" once it ends) so the bar reflects the full session length —
  // shorter videos just play to their own end and freeze on their last
  // frame, without affecting the master state. Falls back to the first
  // video in Left → Front → Right order until metadata has loaded for at
  // least one video.
  const longestVideoId = useMemo(() => {
    let bestId: string | null = null;
    let bestDuration = -1;
    for (const [id, d] of Object.entries(videoDurations)) {
      if (d > bestDuration) {
        bestDuration = d;
        bestId = id;
      }
    }
    return bestId ?? orderedRawVideos[0]?.raw_video_id ?? null;
  }, [videoDurations, orderedRawVideos]);

  const registerVideoRef = useCallback(
    (rawVideoId: string) => (el: HTMLVideoElement | null) => {
      videoRefs.current[rawVideoId] = el;
    },
    []
  );

  const forEachVideo = useCallback((fn: (v: HTMLVideoElement) => void) => {
    Object.values(videoRefs.current).forEach((v) => {
      if (v) fn(v);
    });
  }, []);

  // Reset master control state whenever the set of videos changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setVideoDurations({});
  }, [data?.take_id]);

  const handleTogglePlay = useCallback(() => {
    if (isPlaying) {
      forEachVideo((v) => v.pause());
      setIsPlaying(false);
    } else {
      forEachVideo((v) => {
        v.play().catch(() => {
          // Ignore playback errors (e.g. a video still loading metadata)
        });
      });
      setIsPlaying(true);
    }
  }, [isPlaying, forEachVideo]);

  const handleRestart = useCallback(() => {
    forEachVideo((v) => {
      v.currentTime = 0;
    });
    setCurrentTime(0);
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
    },
    [forEachVideo, duration]
  );

  const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    setCurrentTime(value);
  }, []);

  const handleSeekCommit = useCallback(
    (e: React.ChangeEvent<HTMLInputElement> | React.MouseEvent<HTMLInputElement>) => {
      const value = Number((e.target as HTMLInputElement).value);
      forEachVideo((v) => {
        v.currentTime = value;
      });
      setIsSeeking(false);
    },
    [forEachVideo]
  );

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value);
      setVolume(value);
      const nextMuted = value === 0;
      setIsMuted(nextMuted);
      forEachVideo((v) => {
        v.volume = value;
        v.muted = nextMuted;
      });
    },
    [forEachVideo]
  );

  const handleToggleMute = useCallback(() => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    forEachVideo((v) => {
      v.muted = nextMuted;
    });
  }, [isMuted, forEachVideo]);

  // ---- Longest-video event handlers (drive the shared timeline) ----
  const handleLongestTimeUpdate = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      if (isSeeking) return;
      setCurrentTime(e.currentTarget.currentTime);
    },
    [isSeeking]
  );

  // Fires for the currently-longest video only. Shorter videos reach the
  // end of their own playback and simply stop/freeze on their last frame
  // (native <video> behavior) — no extra handling needed for them.
  const handleLongestEnded = useCallback(() => {
    setIsPlaying(false);
  }, []);

  // Fires for EVERY video (not just the longest) so we learn each clip's
  // duration as its metadata loads, which is how `longestVideoId` above
  // gets determined in the first place. Also applies the current
  // volume/mute setting so newly-mounted videos start in sync with the
  // master volume control.
  const handleVideoLoadedMetadata = useCallback(
    (rawVideoId: string) => (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const d = e.currentTarget.duration;
      if (Number.isFinite(d)) {
        setVideoDurations((prev) => ({ ...prev, [rawVideoId]: d }));
      }
      e.currentTarget.volume = volume;
      e.currentTarget.muted = isMuted;
    },
    [volume, isMuted]
  );

  // Any video's own play/pause (e.g. via its native controls) keeps the
  // master button in sync rather than fighting it.
  const handleVideoPlay = useCallback(() => setIsPlaying(true), []);
  const handleVideoPause = useCallback(() => setIsPlaying(false), []);

  // Navigates to the clip-creation flow for this take. Kept as a simple
  // route push (rather than a modal) so clip creation gets its own URL/
  // page, consistent with how "Back to Raw Videos" treats this as a
  // distinct screen. Swap this out if clip creation should instead open
  // inline or hit an API directly.
  const handleMakeClipsClick = useCallback(() => {
    router.push(`/dashboard/videos/raw/${take_id}/edit`);
  }, [router, take_id]);

  // ---- Notes edit handlers ----
  // Enter edit mode: pre-fill the textarea with whatever notes are
  // currently loaded for this take.
  const handleEditNotesClick = useCallback(() => {
    setNotesDraft(data?.notes ?? "");
    setNotesError(null);
    setIsEditingNotes(true);
  }, [data]);

  const handleCancelEditNotes = useCallback(() => {
    setIsEditingNotes(false);
    setNotesDraft("");
    setNotesError(null);
  }, []);

  const handleSaveNotes = useCallback(async () => {
    setSavingNotes(true);
    setNotesError(null);
    try {
      // Send null rather than an empty string when the draft is blank, so
      // "clearing" the notes actually clears them instead of leaving an
      // empty-string row.
      const trimmed = notesDraft.trim();
      const res = await fetch(`${BASE_URL}/takes/${take_id}/notes`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: trimmed === "" ? null : notesDraft }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(detail || `Save failed (${res.status})`);
      }

      // This endpoint only returns the notes sub-resource (take_id, notes,
      // updated_at) — not the full TakeDetail — so we merge just the
      // notes field into existing state rather than replacing it wholesale.
      const updated: { take_id: string; notes: string | null; updated_at: string } =
        await res.json();
      setData((prev) => (prev ? { ...prev, notes: updated.notes } : prev));
      setIsEditingNotes(false);
      setNotesDraft("");
    } catch (err) {
      setNotesError(err instanceof Error ? err.message : "Failed to save notes");
    } finally {
      setSavingNotes(false);
    }
  }, [take_id, notesDraft]);

  // Renders one filled video card, reused for both known-slot videos and
  // "extra" videos whose angle didn't match left/front/right.
  const renderVideoCard = (video: RawVideoDetail, slotAttr: string) => (
    <div key={video.raw_video_id} className={styles.videoCard} data-slot={slotAttr}>
      <span className={styles.angleLabel}>{video.angle ?? "Unknown angle"}</span>
      <div className={styles.videoStage}>
        {videoErrors[video.raw_video_id] ? (
          <p className={styles.errorText}>
            Couldn&apos;t load this video. It may have been moved, or your
            session may have expired — try refreshing the page.
          </p>
        ) : (
          <>
            <video
              ref={registerVideoRef(video.raw_video_id)}
              className={styles.videoPlayer}
              src={video.video_url}
              controls
              preload="metadata"
              crossOrigin="use-credentials"
              onError={() => markVideoError(video.raw_video_id)}
              onPlay={handleVideoPlay}
              onPause={handleVideoPause}
              onTimeUpdate={
                video.raw_video_id === longestVideoId ? handleLongestTimeUpdate : undefined
              }
              onLoadedMetadata={handleVideoLoadedMetadata(video.raw_video_id)}
              onEnded={video.raw_video_id === longestVideoId ? handleLongestEnded : undefined}
            />
            <div className={styles.videoGloss} aria-hidden="true" />
          </>
        )}

        {/* Shown regardless of load success/failure — a broken video
            reference should still be deletable. */}
        <button
          type="button"
          className={styles.videoDeleteBtn}
          onClick={() => handleDeleteVideoClick(video)}
          disabled={deletingVideoId === video.raw_video_id}
          aria-label={`Delete ${video.angle ?? "video"}`}
          title={`Delete ${video.angle ?? "video"}`}
        >
          <TrashIcon />
        </button>
      </div>
      {videoActionErrors[video.raw_video_id] && (
        <p className={styles.videoCardError}>{videoActionErrors[video.raw_video_id]}</p>
      )}
    </div>
  );

  return (
    <div className={styles.page}>
      <button type="button" className={styles.backBtn} onClick={() => router.back()}>
        ← Back to Raw Videos
      </button>

      {loading && <p className={styles.statusText}>Loading take…</p>}
      {!loading && error && <p className={styles.errorText}>{error}</p>}

      {!loading && !error && data && (
        <>
          <div className={styles.infoGrid}>
            {/* ---- Session box ---- */}
            <section className={styles.infoBox}>
              <h3 className={styles.boxTitle}>Session</h3>
              <div className={styles.boxContent}>
                {data.session ? (
                  <dl className={styles.fieldList}>
                    <div className={styles.field}>
                      <dt>Name</dt>
                      <dd>{data.session.name ?? "Untitled session"}</dd>
                    </div>
                    {data.session.organization && (
                      <div className={styles.field}>
                        <dt>Organization</dt>
                        <dd>{data.session.organization}</dd>
                      </div>
                    )}
                    {data.session.location && (
                      <div className={styles.field}>
                        <dt>Location</dt>
                        <dd>{data.session.location}</dd>
                      </div>
                    )}
                    {(data.session.started_at || data.session.ended_at) && (
                      <div className={styles.field}>
                        <dt>{data.session.ended_at ? "Started" : "Date"}</dt>
                        <dd>{formatDate(data.session.started_at)}</dd>
                      </div>
                    )}
                    {data.session.ended_at && (
                      <div className={styles.field}>
                        <dt>Ended</dt>
                        <dd>{formatDate(data.session.ended_at)}</dd>
                      </div>
                    )}
                    {data.session.sign_person && (
                      <div className={styles.field}>
                        <dt>Sign person</dt>
                        <dd>{data.session.sign_person}</dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className={styles.emptyText}>No session linked.</p>
                )}
              </div>
            </section>

            {/* ---- Take box ---- */}
            <section className={styles.infoBox}>
              <h3 className={styles.boxTitle}>Take</h3>
              <div className={styles.boxContent}>
                <dl className={styles.fieldList}>
                  <div className={styles.field}>
                    <dt>Name</dt>
                    <dd>{data.name ?? "Untitled take"}</dd>
                  </div>
                  {data.take_number !== null && (
                    <div className={styles.field}>
                      <dt>Take number</dt>
                      <dd>{data.take_number}</dd>
                    </div>
                  )}
                  <div className={styles.field}>
                    <dt>Recorded</dt>
                    <dd>{formatDate(data.recorded_at)}</dd>
                  </div>
                  {data.angles.length > 0 && (
                    <div className={styles.field}>
                      <dt>Angles</dt>
                      <dd className={styles.pillRow}>
                        {data.angles.map((angle) => (
                          <span key={angle} className={styles.pill}>
                            {angle}
                          </span>
                        ))}
                      </dd>
                    </div>
                  )}
                  {data.created_by && (
                    <div className={styles.field}>
                      <dt>Created by</dt>
                      <dd>{data.created_by}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </section>

            {/* ---- Transcription box ---- */}
            <section className={styles.infoBox}>
              <h3 className={styles.boxTitle}>Transcription</h3>
              <div className={styles.boxContent}>
                <div
                  className={`${styles.transcriptionBoxInner} ${
                    data.transcription_files.length > 0
                      ? styles.transcriptionBoxInnerFilled
                      : ""
                  }`}
                >
                  {data.transcription_files.length > 0 ? (
                    <ul className={styles.transcriptList}>
                      {data.transcription_files.map((tf) => {
                        const textEntry = transcriptTexts[tf.transcription_file_id];
                        return (
                          <li key={tf.transcription_file_id} className={styles.transcriptItem}>
                            <div className={styles.transcriptTopRow}>
                              <span className={styles.transcriptName} title={tf.filename}>
                                {tf.filename}
                              </span>
                              <button
                                type="button"
                                className={styles.transcriptDeleteBtn}
                                onClick={() => handleDeleteTranscriptionClick(tf)}
                                disabled={
                                  deletingTranscriptId === tf.transcription_file_id ||
                                  savingEditId === tf.transcription_file_id
                                }
                              >
                                <TrashIcon />
                                {deletingTranscriptId === tf.transcription_file_id
                                  ? "Deleting…"
                                  : "Delete"}
                              </button>
                            </div>

                            <div className={styles.transcriptBadgeRow}>
                              <span className={styles.transcriptBadge}>
                                {tf.transcription_type}
                              </span>
                              {tf.format && (
                                <span className={styles.transcriptBadge}>
                                  {tf.format.toUpperCase()}
                                </span>
                              )}
                              <span className={styles.transcriptBadge}>
                                {formatBytes(tf.file_size_bytes)}
                              </span>
                              {tf.language && (
                                <span className={styles.transcriptBadge}>{tf.language}</span>
                              )}
                            </div>

                            {/* Overlay actions sit in the corner of this wrapper
                                (not inside the scrolling text area), so they
                                stay put regardless of scroll position and never
                                push the card taller. */}
                            <div className={styles.transcriptTextWrapper}>
                              <div className={styles.transcriptTextBox}>
                                {editingTranscriptId === tf.transcription_file_id ? (
                                  <textarea
                                    className={styles.transcriptTextEditArea}
                                    value={editDraftText}
                                    onChange={(e) => setEditDraftText(e.target.value)}
                                    disabled={savingEditId === tf.transcription_file_id}
                                    autoFocus
                                  />
                                ) : !textEntry || textEntry.status === "loading" ? (
                                  <p className={styles.transcriptTextStatus}>
                                    Loading transcript…
                                  </p>
                                ) : textEntry.status === "error" ? (
                                  <p className={styles.transcriptTextError}>
                                    {textEntry.error}
                                  </p>
                                ) : (
                                  <pre className={styles.transcriptTextContent}>
                                    {textEntry.text}
                                  </pre>
                                )}
                              </div>

                              <div className={styles.transcriptOverlayActions}>
                                {editingTranscriptId === tf.transcription_file_id ? (
                                  <>
                                    <button
                                      type="button"
                                      className={styles.transcriptOverlayIconBtn}
                                      onClick={() => handleSaveEditTranscription(tf)}
                                      disabled={savingEditId === tf.transcription_file_id}
                                      aria-label="Save transcript"
                                      title="Save transcript"
                                    >
                                      <CheckIcon />
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.transcriptOverlayIconBtn}
                                      onClick={handleCancelEditTranscription}
                                      disabled={savingEditId === tf.transcription_file_id}
                                      aria-label="Cancel editing"
                                      title="Cancel editing"
                                    >
                                      <XIcon />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      className={styles.transcriptOverlayIconBtn}
                                      onClick={() => handleCopyTranscriptionClick(tf)}
                                      disabled={!textEntry || textEntry.status !== "loaded"}
                                      aria-label={
                                        copiedTranscriptId === tf.transcription_file_id
                                          ? "Copied"
                                          : "Copy transcript text"
                                      }
                                      title={
                                        copiedTranscriptId === tf.transcription_file_id
                                          ? "Copied!"
                                          : "Copy transcript text"
                                      }
                                    >
                                      {copiedTranscriptId === tf.transcription_file_id ? (
                                        <CheckIcon />
                                      ) : (
                                        <CopyIcon />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      className={styles.transcriptOverlayIconBtn}
                                      onClick={() => handleEditTranscriptionClick(tf)}
                                      aria-label="Edit transcription"
                                      title="Edit transcription"
                                    >
                                      <PencilIcon />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {transcriptActionErrors[tf.transcription_file_id] && (
                              <p className={styles.transcriptActionError}>
                                {transcriptActionErrors[tf.transcription_file_id]}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <>
                      <p className={styles.transcriptEmptyText}>No transcription files yet.</p>
                      <button
                        type="button"
                        className={styles.addTranscriptionBtn}
                        onClick={handleAddTranscriptionClick}
                        disabled={isUploadingTranscription}
                      >
                        <PlusIcon />
                        {isUploadingTranscription ? "Uploading…" : "Add Transcription"}
                      </button>
                    </>
                  )}

                  <input
                    ref={transcriptionFileInputRef}
                    type="file"
                    accept=".txt,text/plain"
                    className={styles.hiddenFileInput}
                    onChange={handleTranscriptionFileSelected}
                    aria-hidden="true"
                    tabIndex={-1}
                  />
                  {transcriptionUploadError && (
                    <p className={styles.transcriptUploadError}>{transcriptionUploadError}</p>
                  )}
                </div>
              </div>
            </section>
          </div>

          {/* ---- Notes box (full width, sits under the three info boxes) ---- */}
          <section className={styles.notesBox}>
            <div className={styles.notesHeader}>
              <h3 className={styles.boxTitle}>Notes</h3>
              {!isEditingNotes && (
                <button
                  type="button"
                  className={styles.notesEditBtn}
                  onClick={handleEditNotesClick}
                  aria-label="Edit notes"
                  title="Edit notes"
                >
                  <PencilIcon />
                  Edit
                </button>
              )}
            </div>

            {isEditingNotes ? (
              <div className={styles.notesEditWrap}>
                <textarea
                  className={styles.notesTextArea}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  disabled={savingNotes}
                  maxLength={NOTES_MAX_LENGTH}
                  placeholder="Add notes about this take…"
                  autoFocus
                  rows={2}
                />
                <div className={styles.notesEditFooter}>
                  <span className={styles.notesCharCount}>
                    {notesDraft.length}/{NOTES_MAX_LENGTH}
                  </span>
                  <div className={styles.notesEditActions}>
                    <button
                      type="button"
                      className={styles.notesCancelBtn}
                      onClick={handleCancelEditNotes}
                      disabled={savingNotes}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.notesSaveBtn}
                      onClick={handleSaveNotes}
                      disabled={savingNotes}
                    >
                      {savingNotes ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
                {notesError && <p className={styles.errorText}>{notesError}</p>}
              </div>
            ) : data.notes ? (
              <p className={styles.notesText}>{data.notes}</p>
            ) : (
              <p className={styles.emptyText}>No notes yet.</p>
            )}
          </section>

          {/* ---- Raw videos, always shown in fixed Left / Front / Right slots ---- */}
          <div className={styles.header}>
            <h2 className={styles.title}>{data.name ?? "Untitled take"}</h2>
            <button
              type="button"
              className={styles.makeClipsBtn}
              onClick={handleMakeClipsClick}
            >
              <ScissorsIcon />
              Make Clips
            </button>
          </div>

          <div className={styles.mirrorStage}>
            <div className={styles.videoGrid}>
              {/* Always render the three Left/Front/Right slots — each
                  either a filled video card or an "Add Video" placeholder
                  — regardless of how many videos exist. buildVideoSlots([])
                  already produces three empty slots on its own, so a take
                  with zero videos (e.g. right after deleting the last one)
                  still shows all three upload buttons instead of just a
                  "No raw videos" message with no way to add any. */}
              {videoSlots.map((slot) =>
                slot.video ? (
                  // A video already exists for this angle — show the
                  // player, never the upload button.
                  renderVideoCard(slot.video, slot.angle)
                ) : (
                  <div
                    key={`empty-${slot.angle}`}
                    className={`${styles.videoCard} ${styles.videoCardEmpty}`}
                    data-slot={slot.angle}
                  >
                    <span className={styles.angleLabel}>{slot.angle}</span>
                    <div className={styles.videoStage}>
                      <div className={styles.emptySlotInner}>
                        <p className={styles.emptySlotText}>No {slot.angle} video</p>
                        <button
                          type="button"
                          className={styles.addVideoBtn}
                          onClick={() => handleAddVideoClick(slot.angle)}
                          disabled={uploadingAngle === slot.angle}
                        >
                          <PlusIcon />
                          {uploadingAngle === slot.angle ? "Uploading…" : "Add Video"}
                        </button>
                        {videoUploadErrors[slot.angle] && (
                          <p className={styles.errorText}>
                            {videoUploadErrors[slot.angle]}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              )}
              {extraVideos.map((rv) => renderVideoCard(rv, "extra"))}
            </div>
          </div>

          {/* Single shared hidden file input for all three "Add Video"
              buttons — which angle it's uploading for is tracked via
              pendingUploadAngleRef, set just before the picker opens. */}
          <input
            ref={videoFileInputRef}
            type="file"
            accept="video/*"
            className={styles.hiddenFileInput}
            onChange={handleVideoFileSelected}
            aria-hidden="true"
            tabIndex={-1}
          />

          {/* ---- Master controls (drives all three players at once) ---- */}
          {orderedRawVideos.length > 0 && (
            <div className={styles.masterControls}>
              <div className={styles.masterControlsRow}>
                <div className={styles.masterTransportGroup}>
                  <button
                    type="button"
                    className={styles.masterIconBtn}
                    onClick={handleRestart}
                    aria-label="Restart all"
                    title="Restart"
                  >
                    <RestartIcon />
                  </button>
                  <button
                    type="button"
                    className={styles.masterIconBtn}
                    onClick={() => handleSkip(-10)}
                    aria-label="Back 10 seconds"
                    title="Back 10s"
                  >
                    <SkipBackIcon />
                  </button>
                  <button
                    type="button"
                    className={styles.masterPlayBtn}
                    onClick={handleTogglePlay}
                    aria-label={isPlaying ? "Pause all" : "Play all"}
                    title={isPlaying ? "Pause all" : "Play all"}
                  >
                    {isPlaying ? <PauseIcon /> : <PlayIcon />}
                  </button>
                  <button
                    type="button"
                    className={styles.masterIconBtn}
                    onClick={() => handleSkip(10)}
                    aria-label="Forward 10 seconds"
                    title="Forward 10s"
                  >
                    <SkipForwardIcon />
                  </button>
                </div>

                <div className={styles.masterTimeline}>
                  <span className={styles.masterTime}>{formatTime(currentTime)}</span>
                  <input
                    type="range"
                    className={styles.masterSeekBar}
                    min={0}
                    max={duration || 0}
                    step={0.01}
                    value={Math.min(currentTime, duration || 0)}
                    style={{
                      // @ts-expect-error -- custom property consumed by the CSS module
                      "--fill": `${duration > 0 ? Math.min(currentTime, duration) / duration * 100 : 0}%`,
                    }}
                    onMouseDown={() => setIsSeeking(true)}
                    onTouchStart={() => setIsSeeking(true)}
                    onChange={handleSeekChange}
                    onMouseUp={handleSeekCommit}
                    onTouchEnd={handleSeekCommit}
                    aria-label="Seek all videos"
                  />
                  <span className={styles.masterTime}>{formatTime(duration)}</span>
                </div>

                <div className={styles.masterVolumeGroup}>
                  <button
                    type="button"
                    className={styles.masterIconBtn}
                    onClick={handleToggleMute}
                    aria-label={isMuted ? "Unmute" : "Mute"}
                    title={isMuted ? "Unmute" : "Mute"}
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
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---- Icons (inline SVG, stroke-based to match the control bar's line weight) ----

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ScissorsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <line x1="20" y1="4" x2="8.12" y2="15.88" />
      <line x1="14.47" y1="14.48" x2="20" y2="20" />
      <line x1="8.12" y1="8.12" x2="12" y2="12" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

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