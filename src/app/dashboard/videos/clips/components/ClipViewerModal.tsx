"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import styles from "../Clips.module.css";
import { BASE_URL } from "@/config/api";
import { useUser } from "@/contexts/UserContext";
import { ClipItem, TakeClips, Cluster, TranscriptionEditRequest } from "../lib/types";
import { clustersForTake, cleanTranscriptText } from "../lib/utils";
import { fetchTakeById, refetchTakeById } from "../lib/api";
import { getCachedTake } from "../lib/cache";
import ClipThumb from "./ClipThumb";

interface ClipViewerModalProps {
  takeId: string;
  clusterId: string;
  onClose: () => void;
}

export default function ClipViewerModal({ takeId, clusterId, onClose }: ClipViewerModalProps) {
  const { user } = useUser();
  const canDelete = user?.permissions?.includes("DeleteDataset") ?? false;
  const canEditTranscript = user?.permissions?.includes("CreateDataset") ?? false;

  // Seed from cache — if TakeModal (or a previous visit) already loaded
  // this take, we render instantly instead of flashing a spinner.
  const [take, setTake] = useState<TakeClips | null>(() => getCachedTake(takeId));
  const [loading, setLoading] = useState(() => getCachedTake(takeId) === null);
  const [error, setError] = useState<string | null>(null);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [confirmingClipId, setConfirmingClipId] = useState<string | null>(null);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [transcriptText, setTranscriptText] = useState<string | null>(null);
  const [transcriptRaw, setTranscriptRaw] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);

  const [isEditingTranscript, setIsEditingTranscript] = useState(false);
  const [editedTranscriptText, setEditedTranscriptText] = useState("");
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [transcriptSaveError, setTranscriptSaveError] = useState<string | null>(null);

  const cluster: Cluster | null = take ? clustersForTake(take).find((c) => c.key === clusterId) ?? null : null;
  const selectedClip: ClipItem | null = cluster?.clips.find((c) => c.clip_id === selectedClipId) ?? null;

  const loadTake = useCallback(
    async (opts?: { bypassCache?: boolean }) => {
      const cached = !opts?.bypassCache ? getCachedTake(takeId) : null;
      if (cached) {
        setTake(cached);
        setLoading(false);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const t = opts?.bypassCache ? await refetchTakeById(takeId) : await fetchTakeById(takeId);
        if (!t) {
          setError("This take no longer exists.");
          setTake(null);
        } else {
          setTake(t);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load take");
      } finally {
        setLoading(false);
      }
    },
    [takeId]
  );

  useEffect(() => {
    loadTake();
  }, [loadTake]);

  // If the cluster vanished from fresh data (its last clip got deleted),
  // there's nothing left to view.
  useEffect(() => {
    if (!loading && !error && take && !cluster) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, take, cluster]);

  useEffect(() => {
    if (!cluster) return;
    setSelectedClipId((prev) => {
      if (prev && cluster.clips.some((c) => c.clip_id === prev)) return prev;
      return cluster.clips[0]?.clip_id ?? null;
    });
  }, [cluster]);

  useEffect(() => {
    const info = selectedClip?.transcription;
    setIsEditingTranscript(false);
    setTranscriptSaveError(null);

    if (!info) {
      setTranscriptText(null);
      setTranscriptRaw(null);
      setTranscriptError(null);
      setTranscriptLoading(false);
      return;
    }

    let cancelled = false;
    setTranscriptLoading(true);
    setTranscriptError(null);
    setTranscriptText(null);
    setTranscriptRaw(null);

    fetch(`${BASE_URL}${info.transcript_url}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load transcript (${res.status})`);
        return res.text();
      })
      .then((raw) => {
        if (cancelled) return;
        setTranscriptRaw(raw);
        setTranscriptText(cleanTranscriptText(raw, info.format));
      })
      .catch((err) => {
        if (!cancelled) setTranscriptError(err instanceof Error ? err.message : "Failed to load transcript");
      })
      .finally(() => {
        if (!cancelled) setTranscriptLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClip?.transcription?.transcription_file_id]);

  // Escape closes this viewer (cancelling an edit first if one's in
  // progress). The TakeModal behind it has enableEscapeToClose={false}
  // so only one overlay closes per press.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isEditingTranscript) {
        setIsEditingTranscript(false);
        setTranscriptSaveError(null);
      } else {
        videoRef.current?.pause();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isEditingTranscript, onClose]);

  const handleSelectClip = (clip: ClipItem) => {
    if (clip.clip_id === selectedClipId) return;
    videoRef.current?.pause();
    setSelectedClipId(clip.clip_id);
  };

  const handleClose = () => {
    videoRef.current?.pause();
    onClose();
  };

  const handleDeleteClick = (e: React.MouseEvent, clipId: string) => {
    e.stopPropagation();
    setDeleteError(null);
    setConfirmingClipId(clipId);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingClipId(null);
  };

  const handleConfirmDelete = async (e: React.MouseEvent, clipId: string) => {
    e.stopPropagation();
    setDeleteError(null);
    setDeletingClipId(clipId);
    try {
      const res = await fetch(`${BASE_URL}/clips/${clipId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Failed to delete (${res.status})`);
      }
      setConfirmingClipId(null);
      // Bypass cache here — we know the data just changed on the server.
      await loadTake({ bypassCache: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete clip");
    } finally {
      setDeletingClipId(null);
    }
  };

  const handleStartEditTranscript = () => {
    if (transcriptRaw == null) return;
    setTranscriptSaveError(null);
    setEditedTranscriptText(transcriptRaw);
    setIsEditingTranscript(true);
  };

  const handleCancelEditTranscript = () => {
    setIsEditingTranscript(false);
    setTranscriptSaveError(null);
  };

  const handleSaveTranscript = async () => {
    const info = selectedClip?.transcription;
    if (!info) return;
    setSavingTranscript(true);
    setTranscriptSaveError(null);
    try {
      const res = await fetch(`${BASE_URL}/takes/${takeId}/transcriptions/${info.transcription_file_id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: editedTranscriptText } satisfies TranscriptionEditRequest),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Failed to save transcript (${res.status})`);
      }
      setTranscriptRaw(editedTranscriptText);
      setTranscriptText(cleanTranscriptText(editedTranscriptText, info.format));
      setIsEditingTranscript(false);
    } catch (err) {
      setTranscriptSaveError(err instanceof Error ? err.message : "Failed to save transcript");
    } finally {
      setSavingTranscript(false);
    }
  };

  return (
    <div className={styles.playerOverlay} onClick={handleClose} role="dialog" aria-modal="true" aria-label="Clip viewer">
      <div className={`${styles.viewerPanel} ${styles.panelEnter}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.playerHeader}>
          <div className={styles.playerHeaderText}>
            <p className={styles.playerTitle}>{take?.take_name ?? "Untitled take"}</p>
            <p className={styles.playerSubtitle}>
              {selectedClip?.label || selectedClip?.filename || ""}
              {selectedClip?.view_angle ? ` · ${selectedClip.view_angle}` : ""}
            </p>
          </div>
          <button type="button" className={styles.playerCloseBtn} onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        {loading && !take && (
          <p className={styles.statusText} style={{ padding: 16 }}>
            Loading…
          </p>
        )}
        {!loading && error && !take && (
          <p className={styles.errorText} style={{ padding: 16 }}>
            {error}
          </p>
        )}

        {cluster && (
          <div className={styles.viewerBody}>
            <div className={styles.viewerClipList}>
              {cluster.clips.map((clip) => {
                const isActive = clip.clip_id === selectedClipId;
                const isConfirming = confirmingClipId === clip.clip_id;
                const isDeleting = deletingClipId === clip.clip_id;
                const displayName = clip.label || clip.filename;
                return (
                  <div
                    key={clip.clip_id}
                    className={`${styles.viewerClipItem} ${isActive ? styles.viewerClipItemActive : ""}`}
                    onClick={() => !isConfirming && handleSelectClip(clip)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (!isConfirming && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        handleSelectClip(clip);
                      }
                    }}
                  >
                    <div className={styles.viewerClipThumbWrap}>
                      <ClipThumb videoUrl={`${BASE_URL}${clip.video_url}`} alt={displayName} />
                      {isActive && (
                        <div className={styles.viewerClipPlayingBadge} aria-hidden="true">
                          <svg viewBox="0 0 24 24" width="14" height="14">
                            <path d="M8 5v14l11-7z" fill="currentColor" />
                          </svg>
                        </div>
                      )}
                      {clip.view_angle && <span className={styles.angleBadgeOnThumb}>{clip.view_angle}</span>}
                    </div>
                    <div className={styles.viewerClipMeta}>
                      <div className={styles.cardFooterTop}>
                        <p className={styles.clipName}>{displayName}</p>
                        {canDelete && !isConfirming && (
                          <button
                            type="button"
                            className={styles.deleteBtn}
                            onClick={(e) => handleDeleteClick(e, clip.clip_id)}
                            aria-label="Delete clip"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                      {isConfirming && (
                        <div className={styles.confirmRow}>
                          <span className={styles.confirmText}>Delete this clip?</span>
                          <div className={styles.confirmActions}>
                            <button
                              type="button"
                              className={styles.confirmCancelBtn}
                              onClick={handleCancelDelete}
                              disabled={isDeleting}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className={styles.confirmDeleteBtn}
                              onClick={(e) => handleConfirmDelete(e, clip.clip_id)}
                              disabled={isDeleting}
                            >
                              {isDeleting ? "Deleting…" : "Confirm"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className={styles.viewerVideoCol}>
              {selectedClip && (
                <video
                  key={selectedClip.clip_id}
                  ref={videoRef}
                  className={styles.viewerVideo}
                  src={`${BASE_URL}${selectedClip.video_url}`}
                  controls
                  autoPlay
                  playsInline
                />
              )}
            </div>

            <div className={styles.viewerTranscriptCol}>
              <div className={styles.transcriptHeader}>
                <span className={styles.transcriptTitle}>Transcript</span>
                <div className={styles.transcriptHeaderActions}>
                  {selectedClip?.transcription?.language && !isEditingTranscript && (
                    <span className={styles.transcriptLangChip}>{selectedClip.transcription.language}</span>
                  )}
                  {canEditTranscript &&
                    selectedClip?.transcription &&
                    !transcriptLoading &&
                    !transcriptError &&
                    !isEditingTranscript && (
                      <button type="button" className={styles.transcriptEditBtn} onClick={handleStartEditTranscript}>
                        Edit
                      </button>
                    )}
                </div>
              </div>

              <div className={styles.transcriptBody}>
                {!selectedClip?.transcription && (
                  <p className={styles.transcriptStatus}>No transcript available for this clip.</p>
                )}
                {selectedClip?.transcription && transcriptLoading && (
                  <p className={styles.transcriptStatus}>Loading transcript…</p>
                )}
                {selectedClip?.transcription && transcriptError && (
                  <p className={styles.transcriptStatusError}>{transcriptError}</p>
                )}
                {selectedClip?.transcription &&
                  !transcriptLoading &&
                  !transcriptError &&
                  !isEditingTranscript &&
                  transcriptText && <pre className={styles.transcriptText}>{transcriptText}</pre>}
                {selectedClip?.transcription && isEditingTranscript && (
                  <textarea
                    className={styles.transcriptEditArea}
                    value={editedTranscriptText}
                    onChange={(e) => setEditedTranscriptText(e.target.value)}
                    disabled={savingTranscript}
                    autoFocus
                  />
                )}
              </div>

              {isEditingTranscript && (
                <div className={styles.transcriptEditFooter}>
                  {transcriptSaveError && <p className={styles.transcriptStatusError}>{transcriptSaveError}</p>}
                  <div className={styles.transcriptEditActions}>
                    <button
                      type="button"
                      className={styles.confirmCancelBtn}
                      onClick={handleCancelEditTranscript}
                      disabled={savingTranscript}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.transcriptSaveBtn}
                      onClick={handleSaveTranscript}
                      disabled={savingTranscript}
                    >
                      {savingTranscript ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {deleteError && (
          <p className={styles.errorText} style={{ padding: "0 16px 12px" }}>
            {deleteError}
          </p>
        )}
      </div>
    </div>
  );
}