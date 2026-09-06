"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./page.module.css";
import {
  useTeleprompterChannel,
  type PrompterMessage,
  type RecordingPhase,
} from "@/hooks/useTeleprompterChannel";

const DEFAULT_SCROLL_PIXELS_PER_SECOND = 28;
const DEFAULT_FONT_SIZE = 42;
const MIN_FONT_SIZE = 24;
const MAX_FONT_SIZE = 72;

// The font-size slider on the record page (24-72px) was tuned against this
// window size (the popup's default open dimensions). When this window ends
// up a different size than that — e.g. it gets dragged to another screen
// and resized/maximized there — we scale the rendered font proportionally
// so the script still fills the space sensibly instead of looking tiny on
// a big screen or oversized on a small one.
const REFERENCE_WIDTH = 900;
const REFERENCE_HEIGHT = 600;
const MIN_SCALE = 0.5;
const MAX_SCALE = 2.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export default function TeleprompterPage() {
  const searchParams = useSearchParams();
  const takeId = searchParams.get("takeId") ?? "unassigned";

  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [script, setScript] = useState<string>("Waiting for script…");
  const [speed, setSpeed] = useState(DEFAULT_SCROLL_PIXELS_PER_SECOND);
  const [baseFontSize, setBaseFontSize] = useState(DEFAULT_FONT_SIZE);

  // This window's own current viewport size. Updated on mount and on every
  // resize, which in most browsers also fires when the window is moved to
  // a screen with a different resolution/scale factor (the CSS pixel
  // viewport recalculates even without the user manually dragging an edge).
  const [windowSize, setWindowSize] = useState({ width: REFERENCE_WIDTH, height: REFERENCE_HEIGHT });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const lastReportedLineRef = useRef<number>(-1);

  const handleMessage = (msg: PrompterMessage) => {
    if (msg.type === "phase") {
      setPhase(msg.phase);
      if (msg.phase === "countdown") setCountdownValue(msg.countdownValue ?? null);
      if (msg.phase === "recording") setCountdownValue(null);
      // "stopped" intentionally does NOT reset scroll position — it just
      // stops the animation loop below, freezing wherever it was.
    } else if (msg.type === "script") {
      setScript(msg.text);
    } else if (msg.type === "control") {
      if (msg.action === "setSpeed" && msg.speed) setSpeed(msg.speed);
      if (msg.action === "setFontSize" && msg.fontSize) setBaseFontSize(msg.fontSize);
      if (msg.action === "jumpToStart" && scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
    }
  };

  const post = useTeleprompterChannel(takeId, handleMessage);

  // Announce we're up and ready — the main tab responds by sending the
  // current script, font size, and speed (see record/page.tsx).
  useEffect(() => {
    post({ type: "windowReady" });
  }, [post]);

  // Track this window's real size.
  useEffect(() => {
    function updateSize() {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    }
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  // How far this window's actual size is from the reference size the font
  // slider was designed around.
  const scaleFactor = clamp(
    Math.min(windowSize.width / REFERENCE_WIDTH, windowSize.height / REFERENCE_HEIGHT),
    MIN_SCALE,
    MAX_SCALE
  );
  const effectiveFontSize = clamp(
    baseFontSize * scaleFactor,
    MIN_FONT_SIZE,
    MAX_FONT_SIZE * MAX_SCALE
  );

  // Tell the record page our real size + the font size we're actually
  // rendering at, so its live monitor can mirror this exactly instead of
  // guessing with a fixed scale-down.
  useEffect(() => {
    post({
      type: "windowInfo",
      innerWidth: windowSize.width,
      innerHeight: windowSize.height,
      effectiveFontSize,
    });
  }, [windowSize, effectiveFontSize, post]);

  const scriptLines = script.split("\n");

  // Finds the topmost line already scrolled to (or past) the top of the
  // viewport, using each line's *real* offsetTop rather than assuming
  // uniform line height. This stays accurate regardless of how the text
  // wraps — including right after a resize changes the wrap points, which
  // is exactly when the old average-height math used to fall apart.
  const getCurrentLineIndex = useCallback((scrollTop: number) => {
    const lines = lineRefs.current;
    let lo = 0;
    let hi = lines.length - 1;
    let result = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const el = lines[mid];
      if (!el) break;
      if (el.offsetTop <= scrollTop) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }, []);

  // Auto-scroll only while phase === "recording"; paused (not reset) the
  // instant it isn't. Re-reads `speed` on every render via the effect's
  // dependency array, so changing the slider on the record page takes
  // effect immediately without restarting from the top.
  useEffect(() => {
    if (phase !== "recording") {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastFrameTimeRef.current = null;
      return;
    }

    function step(timestamp: number) {
      if (lastFrameTimeRef.current === null) lastFrameTimeRef.current = timestamp;
      const deltaSeconds = (timestamp - lastFrameTimeRef.current) / 1000;
      lastFrameTimeRef.current = timestamp;

      const el = scrollRef.current;
      if (el) {
        el.scrollTop += speed * deltaSeconds;

        const lineIndex = getCurrentLineIndex(el.scrollTop);
        if (lineIndex !== lastReportedLineRef.current) {
          lastReportedLineRef.current = lineIndex;
          post({ type: "scrollStatus", lineIndex, totalLines: scriptLines.length });
        }
      }

      rafRef.current = requestAnimationFrame(step);
    }

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [phase, speed, scriptLines.length, post, getCurrentLineIndex]);

  return (
    <div className={styles.page}>
      {countdownValue !== null && (
        <div className={styles.countdownOverlay}>
          <span className={styles.countdownNumber}>{countdownValue}</span>
        </div>
      )}
      <div ref={scrollRef} className={styles.scrollArea}>
        <div className={styles.scriptText} style={{ fontSize: `${effectiveFontSize}px` }}>
          {scriptLines.map((line, i) => (
            <div
              key={i}
              ref={(el) => {
                lineRefs.current[i] = el;
              }}
              className={styles.scriptLine}
            >
              {line || "\u00A0"}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.statusBar}>{phase}</div>
    </div>
  );
}