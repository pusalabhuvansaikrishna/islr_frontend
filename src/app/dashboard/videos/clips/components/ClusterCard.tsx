"use client";

import { useEffect, useState } from "react";
import styles from "../Clips.module.css";
import { BASE_URL } from "@/config/api";
import { Cluster } from "../lib/types";
import { signedOffset, getCoverflowStyle, formatDuration, CAROUSEL_INTERVAL_MS } from "../lib/utils";
import ClipThumb from "./ClipThumb";
import TranscriptIcon from "./TranscriptIcon";

interface ClusterCardProps {
  cluster: Cluster;
  onClick: () => void;
  /** Optional — called on hover so the caller can warm up the next route
   *  (router.prefetch) before the click actually happens. */
  onHoverPrefetch?: () => void;
}

/** One cluster rendered as a clickable card, used inside the take modal.
 *  Multi-angle clusters get a hover-triggered coverflow carousel. */
export default function ClusterCard({ cluster, onClick, onHoverPrefetch }: ClusterCardProps) {
  const first = cluster.clips[0];
  const displayName = first.label || first.filename;
  const angleCount = cluster.clips.length;
  const hasCarousel = angleCount > 1;
  const hasTranscript = Boolean(cluster.transcription);

  const [isHovered, setIsHovered] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!hasCarousel || !isHovered) return;
    const id = setInterval(() => {
      setActiveIndex((i) => (i + 1) % cluster.clips.length);
    }, CAROUSEL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hasCarousel, isHovered, cluster.clips.length]);

  const handleMouseEnter = () => {
    setIsHovered(true);
    onHoverPrefetch?.();
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setActiveIndex(0);
  };

  return (
    <div
      className={styles.clusterCard}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {hasCarousel ? (
        <div
          className={styles.coverflowStage}
          style={cluster.color ? ({ ["--clip-color" as string]: cluster.color }) : undefined}
        >
          {cluster.clips.map((clip, i) => {
            const diff = signedOffset(i, activeIndex, cluster.clips.length);
            const isCenter = diff === 0;
            return (
              <div
                key={clip.clip_id}
                className={styles.coverflowSlide}
                style={getCoverflowStyle(diff, cluster.clips.length)}
              >
                <ClipThumb videoUrl={`${BASE_URL}${clip.video_url}`} alt={clip.label || clip.filename} />
                {isCenter && (
                  <>
                    <div className={styles.playBadge} aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path d="M8 5v14l11-7z" fill="currentColor" />
                      </svg>
                    </div>
                    {cluster.duration != null && (
                      <span className={styles.durationBadge}>{formatDuration(cluster.duration)}</span>
                    )}
                    <span className={styles.angleCountBadge}>{angleCount} angles</span>
                    {hasTranscript && (
                      <span className={styles.transcriptBadge} title="Transcript available">
                        <TranscriptIcon />
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })}
          <div className={styles.carouselDots} aria-hidden="true">
            {cluster.clips.map((clip, i) => (
              <span
                key={clip.clip_id}
                className={`${styles.carouselDot} ${i === activeIndex ? styles.carouselDotActive : ""}`}
              />
            ))}
          </div>
        </div>
      ) : (
        <div
          className={styles.thumbWrap}
          style={cluster.color ? ({ ["--clip-color" as string]: cluster.color }) : undefined}
        >
          <ClipThumb videoUrl={`${BASE_URL}${first.video_url}`} alt={displayName} />
          <div className={styles.playBadge} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M8 5v14l11-7z" fill="currentColor" />
            </svg>
          </div>
          {cluster.duration != null && <span className={styles.durationBadge}>{formatDuration(cluster.duration)}</span>}
          {first.view_angle && <span className={styles.angleBadgeOnThumb}>{first.view_angle}</span>}
          {hasTranscript && (
            <span className={styles.transcriptBadge} title="Transcript available">
              <TranscriptIcon />
            </span>
          )}
        </div>
      )}
      <div className={styles.clusterFooter}>
        <p className={styles.clipName}>{displayName}</p>
      </div>
    </div>
  );
}