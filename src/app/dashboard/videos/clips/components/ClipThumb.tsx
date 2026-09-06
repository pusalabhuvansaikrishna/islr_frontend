"use client";

import styles from "../Clips.module.css";

/** Muted, non-interactive <video> seeked to a still frame — used as a
 *  thumbnail. The browser only pulls the small byte-range it needs for
 *  that one frame (FileResponse supports Range). */
export default function ClipThumb({ videoUrl, alt }: { videoUrl: string; alt: string }) {
  return (
    <video
      className={styles.thumbImg}
      src={videoUrl}
      muted
      playsInline
      preload="metadata"
      aria-label={alt}
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        const target = Math.min(1, (v.duration || 2) / 4);
        try {
          v.currentTime = target;
        } catch {
          // Some browsers throw if metadata isn't fully ready yet; ignore.
        }
      }}
    />
  );
}