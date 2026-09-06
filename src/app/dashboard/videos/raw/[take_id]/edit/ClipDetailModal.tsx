"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ClipDetailModal.module.css";
import {
  type ClipGroup,
  type ClipGroupAngle,
  type ClipItem,
  type KnownAngle,
  buildGroupAngleSlots,
  formatTime,
  getGroupColor,
  getGroupLabel,
} from "./page";

interface ClipDetailModalProps {
  group: ClipGroup | null;
  onClose: () => void;
  viewAngleIds?: Partial<Record<KnownAngle, string>>;
  onClipUploaded?: (clipGroupId: string, angle: KnownAngle, clip: ClipItem) => void;
}

type AngleStatus = { uploading: boolean };

function emptyStatus(): AngleStatus {
  return { uploading: false };
}

// One dismissible error surfaced in the card list at the top of the modal.
interface ErrorCardEntry {
  id: string;
  angle: string;
  message: string;
}

// Keep this in sync with CLIP_DURATION_TOLERANCE_SECONDS on the backend.
const CLIP_DURATION_TOLERANCE_SECONDS = 0.5;

// Reads a File's real duration via a throwaway <video> element, without
// uploading anything. Resolves null if the browser can't determine it
// (e.g. corrupt file, unsupported codec for metadata probing).
function readFileDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    video.src = url;

    const cleanup = () => URL.revokeObjectURL(url);

    video.onloadedmetadata = () => {
      cleanup();
      resolve(Number.isFinite(video.duration) ? video.duration : null);
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
  });
}

function AnglePanel({
  angle,
  groupAngle,
  status,
  disabled,
  onFileSelected,
}: {
  angle: string;
  groupAngle: ClipGroupAngle | null;
  status: AngleStatus;
  disabled: boolean;
  onFileSelected: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onFileSelected(file);
  };

  return (
    <div className={styles.angleCard} data-slot={angle}>
      <span className={styles.angleLabel}>{angle}</span>
      <div className={styles.videoStage}>
        {groupAngle ? (
          <>
            <video
              className={styles.video}
              src={groupAngle.clip.video_url}
              controls
              preload="metadata"
              crossOrigin="use-credentials"
            />
            <div className={styles.angleActions}>
              <button
                type="button"
                className={styles.replaceBtn}
                onClick={handlePickFile}
                disabled={status.uploading || disabled}
                title={disabled ? "View angle id not loaded yet" : "Replace video"}
              >
                {status.uploading ? "Uploading…" : "Replace"}
              </button>
            </div>
            {status.uploading && <div className={styles.busyOverlay} aria-hidden="true" />}
          </>
        ) : (
          <div className={styles.placeholder}>
            <UploadIcon />
            <p className={styles.placeholderText}>No {angle} video</p>
            <button
              type="button"
              className={styles.uploadBtn}
              onClick={handlePickFile}
              disabled={status.uploading || disabled}
              title={disabled ? "View angle id not loaded yet" : undefined}
            >
              {status.uploading ? "Uploading…" : "Upload video"}
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className={styles.hiddenFileInput}
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}

export default function ClipDetailModal({
  group,
  onClose,
  viewAngleIds = {},
  onClipUploaded,
}: ClipDetailModalProps) {
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const [statusByAngle, setStatusByAngle] = useState<Record<string, AngleStatus>>({});
  const [errorCards, setErrorCards] = useState<ErrorCardEntry[]>([]);

  useEffect(() => {
    if (!group) return;
    setStatusByAngle({});
    setErrorCards([]);
    closeBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [group, onClose]);

  if (!group) return null;

  const { slots, extras } = buildGroupAngleSlots(group);
  const label = getGroupLabel(group);
  const color = getGroupColor(group);

  const setStatus = (angle: KnownAngle, patch: Partial<AngleStatus>) => {
    setStatusByAngle((prev) => ({
      ...prev,
      [angle]: { ...emptyStatus(), ...prev[angle], ...patch },
    }));
  };

  const pushError = (angle: string, message: string) => {
    setErrorCards((prev) => [
      ...prev,
      { id: `${angle}-${Date.now()}-${Math.random().toString(36).slice(2)}`, angle, message },
    ]);
  };

  const dismissError = (id: string) => {
    setErrorCards((prev) => prev.filter((e) => e.id !== id));
  };

  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleFileSelected = async (angle: KnownAngle, file: File) => {
    const viewAngleId = viewAngleIds[angle];
    if (!viewAngleId) {
      pushError(angle, `No view angle id configured for "${angle}".`);
      return;
    }

    // Instant client-side duration check — avoids an upload round trip
    // for the common case of picking a wrong-length file. The backend
    // still re-validates via ffprobe as the source of truth.
    const expectedDuration = group.end_time_seconds - group.start_time_seconds;
    const actualDuration = await readFileDuration(file);

    if (actualDuration !== null) {
      const diff = actualDuration - expectedDuration;
      if (Math.abs(diff) > CLIP_DURATION_TOLERANCE_SECONDS) {
        const direction = diff > 0 ? "longer" : "shorter";
        pushError(
          angle,
          `This clip needs a video that is ${expectedDuration.toFixed(2)}s long. ` +
            `The selected file is ${actualDuration.toFixed(2)}s — ` +
            `${Math.abs(diff).toFixed(2)}s too ${direction}.`
        );
        return; // don't upload at all
      }
    }

    setStatus(angle, { uploading: true });

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(
        `/clip-groups/${group.clip_group_id}/angles/${viewAngleId}/video`,
        {
          method: "POST",
          body: formData,
          credentials: "include",
        }
      );

      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.detail || `Upload failed (${res.status})`);
      }

      const clip: ClipItem = await res.json();
      setStatus(angle, { uploading: false });
      onClipUploaded?.(group.clip_group_id, angle, clip);
    } catch (err) {
      setStatus(angle, { uploading: false });
      pushError(angle, err instanceof Error ? err.message : "Upload failed.");
    }
  };

  return (
    <div className={styles.backdrop} onMouseDown={handleBackdropMouseDown}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label={label ? `Clip detail: ${label}` : "Clip detail"}
        style={{
          // @ts-expect-error -- custom property consumed by the CSS module
          "--clip-color": color,
        }}
      >
        <div className={styles.header}>
          <div className={styles.headerText}>
            <span className={styles.headerEyebrow}>Clip detail</span>
            {label && <h3 className={styles.title}>{label}</h3>}
            <span className={styles.timeRange}>
              {formatTime(group.start_time_seconds)} – {formatTime(group.end_time_seconds)}
            </span>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            <CloseIcon />
          </button>
        </div>

        {errorCards.length > 0 && (
          <div className={styles.errorCardList}>
            {errorCards.map((entry) => (
              <div key={entry.id} className={styles.errorCard} role="alert">
                <div className={styles.errorCardIcon} aria-hidden="true">
                  <WarningIcon />
                </div>
                <div className={styles.errorCardBody}>
                  <span className={styles.errorCardTitle}>
                    Couldn't replace {entry.angle} video
                  </span>
                  <span className={styles.errorCardMessage}>{entry.message}</span>
                </div>
                <button
                  type="button"
                  className={styles.errorCardDismiss}
                  onClick={() => dismissError(entry.id)}
                  aria-label="Dismiss"
                  title="Dismiss"
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={styles.angleGrid}>
          {slots.map((slot) => (
            <AnglePanel
              key={slot.angle}
              angle={slot.angle}
              groupAngle={slot.groupAngle}
              status={statusByAngle[slot.angle] ?? emptyStatus()}
              disabled={!viewAngleIds[slot.angle]}
              onFileSelected={(file) => handleFileSelected(slot.angle, file)}
            />
          ))}

          {extras.map((extra) => (
            <div key={extra.clip.clip_id} className={styles.angleCard} data-slot="extra">
              <span className={styles.angleLabel}>{extra.angle ?? "Extra angle"}</span>
              <div className={styles.videoStage}>
                <video
                  className={styles.video}
                  src={extra.clip.video_url}
                  controls
                  preload="metadata"
                  crossOrigin="use-credentials"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
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

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}