"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../Clips.module.css";
import { TakeClips, Cluster } from "../lib/types";
import { clustersForTake, formatDate } from "../lib/utils";
import { fetchTakeById } from "../lib/api";
import { getCachedTake } from "../lib/cache";
import ClusterCard from "./ClusterCard";

interface TakeModalProps {
  takeId: string;
  onClose: () => void;
  onSelectCluster: (cluster: Cluster) => void;
  /** Set to false when this modal is rendered "behind" a ClipViewerModal,
   *  so Escape closes the viewer first, not both at once. */
  enableEscapeToClose?: boolean;
}

export default function TakeModal({
  takeId,
  onClose,
  onSelectCluster,
  enableEscapeToClose = true,
}: TakeModalProps) {
  // Seed from cache so switching back to a take we've already loaded
  // renders instantly instead of flashing a loading state.
  const [take, setTake] = useState<TakeClips | null>(() => getCachedTake(takeId));
  const [loading, setLoading] = useState(() => getCachedTake(takeId) === null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const cached = getCachedTake(takeId);
    if (cached) {
      setTake(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    // Always revalidate in the background, even on a cache hit, so stale
    // data (e.g. a clip deleted elsewhere) gets corrected quietly.
    fetchTakeById(takeId)
      .then((t) => {
        if (cancelled) return;
        if (!t) setError("This take no longer exists.");
        else setTake(t);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load take");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [takeId]);

  useEffect(() => {
    if (!enableEscapeToClose) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enableEscapeToClose, onClose]);

  return (
    <div
      className={styles.playerOverlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={take?.take_name ?? "Take"}
    >
      <div className={`${styles.takeModalPanel} ${styles.panelEnter}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.playerHeader}>
          <div className={styles.playerHeaderText}>
            <p className={styles.playerTitle}>{take?.take_name ?? "Untitled take"}</p>
            <p className={styles.playerSubtitle}>
              {take ? [take.session_name, formatDate(take.recorded_at)].filter(Boolean).join(" · ") : ""}
            </p>
          </div>
          <button type="button" className={styles.playerCloseBtn} onClick={onClose} aria-label="Close">
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

        {take && (
          <div className={styles.clusterGridModal}>
            {clustersForTake(take).map((cluster) => (
              <ClusterCard
                key={cluster.key}
                cluster={cluster}
                onClick={() => onSelectCluster(cluster)}
                onHoverPrefetch={() =>
                  router.prefetch(`/dashboard/videos/clips/${takeId}/${cluster.key}`)
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}