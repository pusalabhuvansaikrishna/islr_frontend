"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./TranscriptionModal.module.css";
import { BASE_URL } from "@/config/api";

interface TranscriptionFileListItem {
  transcription_file_id: string;
  transcription_type: "RAW" | "EDITED";
  filename: string;
}

interface ResolveResponse {
  transcription_file_id: string;
  transcription_type: string;
  result_type: "raw_video" | "no_raw_video" | "clip_group";
  take_id: string | null;
  take_name: string | null;
  clip_group_id: string | null;
  message: string | null;
}

interface Props {
  item: TranscriptionFileListItem;
  onClose: () => void;
}

export default function TranscriptionModal({ item, onClose }: Props) {
  const router = useRouter();
  const [resolveData, setResolveData] = useState<ResolveResponse | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Content and navigation info are two separate concerns fetched
        // from two separate endpoints:
        // - /media/transcription/{id} streams the actual file bytes
        //   (works for both RAW and EDITED — base dir resolved server-side)
        // - /transcriptions/{id}/resolve returns where the action button
        //   should navigate to
        const [resolveRes, contentRes] = await Promise.all([
          fetch(`${BASE_URL}/transcriptions/${item.transcription_file_id}/resolve`, {
            credentials: "include",
          }),
          fetch(`${BASE_URL}/media/transcription/${item.transcription_file_id}`, {
            credentials: "include",
          }),
        ]);

        if (!resolveRes.ok) {
          throw new Error(`Failed to resolve transcription (${resolveRes.status})`);
        }
        if (!contentRes.ok) {
          throw new Error(`Failed to load transcript text (${contentRes.status})`);
        }

        const resolveJson: ResolveResponse = await resolveRes.json();
        const contentText = await contentRes.text();

        if (!cancelled) {
          setResolveData(resolveJson);
          setText(contentText);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load transcription");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [item.transcription_file_id]);

  const handleAction = () => {
    if (!resolveData) return;

    if (resolveData.result_type === "raw_video" && resolveData.take_id) {
      router.push(`/dashboard/videos/raw/${resolveData.take_id}`);
    } else if (
      resolveData.result_type === "clip_group" &&
      resolveData.take_id &&
      resolveData.clip_group_id
    ) {
      router.push(`/dashboard/videos/clips/${resolveData.take_id}/${resolveData.clip_group_id}`);
    } else if (resolveData.result_type === "no_raw_video") {
      // Pass the transcription file id along so the record page can fetch
      // the real script itself (via the same /media/transcription/{id}
      // endpoint used above) instead of showing placeholder text.
      const params = new URLSearchParams();
      if (resolveData.take_id) params.set("takeId", resolveData.take_id);
      params.set("transcriptionFileId", item.transcription_file_id);
      router.push(`/dashboard/videos/record?${params.toString()}`);
    }
  };

  const actionLabel =
    resolveData?.result_type === "raw_video"
      ? "Go to Raw Videos"
      : resolveData?.result_type === "clip_group"
      ? "Go to Clip"
      : "Record";

  const actionDisabled =
    loading ||
    !!error ||
    !resolveData ||
    (resolveData.result_type === "raw_video" && !resolveData.take_id) ||
    (resolveData.result_type === "clip_group" && (!resolveData.take_id || !resolveData.clip_group_id));

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.filename} title={item.filename}>
            {item.filename}
          </span>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.body}>
          {loading && <p className={styles.statusText}>Loading transcript…</p>}
          {!loading && error && <p className={styles.errorText}>{error}</p>}
          {!loading && !error && (
            <pre className={styles.transcriptText}>{text || "No content available."}</pre>
          )}
          {!loading && !error && resolveData?.message && (
            <p className={styles.hintText}>{resolveData.message}</p>
          )}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={handleAction}
            disabled={actionDisabled}
          >
            {actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}