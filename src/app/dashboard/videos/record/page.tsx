"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "./page.module.css";
import CountdownOverlay from "@/components/CountdownOverlay";
import { BASE_URL } from "@/config/api";
import { useAgentConnection, type DetectedCamera } from "@/hooks/useAgentConnection";
import {
  useTeleprompterChannel,
  type PrompterMessage,
  type RecordingPhase,
} from "@/hooks/useTeleprompterChannel";
import {
  KNOWN_ANGLES,
  loadAssignments,
  saveAssignments,
  angleForCamera,
  type ViewAngle,
  type AngleAssignments,
} from "@/lib/cameraAssignments";

// Used only when no transcriptionFileId is present (or its fetch fails) —
// e.g. someone navigates here directly without going through a transcript.
const PLACEHOLDER_SCRIPT =
  "This is a placeholder script for the teleprompter.\nReplace this with the real script for the take once that's wired up.";

const DEFAULT_FONT_SIZE = 42; // px, matches teleprompter popup's default
const MIN_FONT_SIZE = 24;
const MAX_FONT_SIZE = 72;
const FONT_STEP = 4;

const DEFAULT_SPEED = 28; // px/sec, matches teleprompter popup's default
const MIN_SPEED = 8;
const MAX_SPEED = 80;

function RecordPageInner() {
  const searchParams = useSearchParams();
  const takeId = searchParams.get("takeId") ?? "unassigned";
  const transcriptionFileId = searchParams.get("transcriptionFileId");

  const { status: agentStatus, cameras, startRecording, stopRecording } = useAgentConnection();

  const [assignments, setAssignments] = useState<AngleAssignments>({});
  useEffect(() => {
    setAssignments(loadAssignments());
  }, []);

  const unassignedCameras = useMemo(
    () => cameras.filter((cam) => !angleForCamera(assignments, cam.id)),
    [cameras, assignments]
  );

  const handleAssign = useCallback((angle: ViewAngle, cameraId: string) => {
    setAssignments((prev) => {
      const next = { ...prev, [angle]: cameraId };
      saveAssignments(next);
      return next;
    });
  }, []);

  const handleClearAssignment = useCallback((angle: ViewAngle) => {
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[angle];
      saveAssignments(next);
      return next;
    });
  }, []);

  const cameraById = useMemo(() => {
    const map = new Map<string, DetectedCamera>();
    cameras.forEach((c) => map.set(c.id, c));
    return map;
  }, [cameras]);

  // ---- Recording phase state machine ----
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [countdownValue, setCountdownValue] = useState<number | null>(null);

  // ---- Script for the teleprompter ----
  const [script, setScript] = useState<string>(PLACEHOLDER_SCRIPT);
  const [scriptLoading, setScriptLoading] = useState(!!transcriptionFileId);
  const [scriptError, setScriptError] = useState<string | null>(null);

  useEffect(() => {
    if (!transcriptionFileId) {
      setScript(PLACEHOLDER_SCRIPT);
      setScriptLoading(false);
      setScriptError(null);
      return;
    }

    let cancelled = false;

    async function loadScript() {
      setScriptLoading(true);
      setScriptError(null);
      try {
        const res = await fetch(`${BASE_URL}/media/transcription/${transcriptionFileId}`, {
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error(`Failed to load transcript (${res.status})`);
        }
        const contentText = await res.text();
        if (!cancelled) {
          setScript(contentText || PLACEHOLDER_SCRIPT);
        }
      } catch (err) {
        if (!cancelled) {
          setScriptError(err instanceof Error ? err.message : "Failed to load transcript");
          setScript(PLACEHOLDER_SCRIPT);
        }
      } finally {
        if (!cancelled) setScriptLoading(false);
      }
    }

    loadScript();
    return () => {
      cancelled = true;
    };
  }, [transcriptionFileId]);

  const scriptLines = useMemo(() => script.split("\n"), [script]);

  // ---- Font size + scroll speed controls (drive the popup remotely) ----
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);

  const handleFontDecrease = useCallback(() => {
    setFontSize((prev) => Math.max(MIN_FONT_SIZE, prev - FONT_STEP));
  }, []);
  const handleFontIncrease = useCallback(() => {
    setFontSize((prev) => Math.min(MAX_FONT_SIZE, prev + FONT_STEP));
  }, []);

  // ---- Teleprompter monitor state (mirrors the second window) ----
  const [prompterConnected, setPrompterConnected] = useState(false);
  const [scrollStatus, setScrollStatus] = useState<{ lineIndex: number; totalLines: number } | null>(
    null
  );
  // The popup's *real* current size and the font size it's actually
  // rendering at (it self-scales when moved/resized to another screen —
  // see teleprompter/page.tsx). This is what lets the mini preview below
  // be a true proportional mirror instead of a fixed-ratio guess.
  const [prompterWindowInfo, setPrompterWindowInfo] = useState<{
    width: number;
    height: number;
    fontSize: number;
  } | null>(null);
  const teleprompterWindowRef = useRef<Window | null>(null);

  const handlePrompterMessage = useCallback((msg: PrompterMessage) => {
    if (msg.type === "windowReady") {
      setPrompterConnected(true);
    } else if (msg.type === "scrollStatus") {
      setScrollStatus({ lineIndex: msg.lineIndex, totalLines: msg.totalLines });
    } else if (msg.type === "windowInfo") {
      setPrompterWindowInfo({
        width: msg.innerWidth,
        height: msg.innerHeight,
        fontSize: msg.effectiveFontSize,
      });
    }
  }, []);

  const postToPrompter = useTeleprompterChannel(takeId, handlePrompterMessage);

  const handleOpenTeleprompter = useCallback(() => {
    const win = window.open(
      `/dashboard/videos/teleprompter?takeId=${encodeURIComponent(takeId)}`,
      "teleprompter",
      "width=900,height=600"
    );
    teleprompterWindowRef.current = win;
  }, [takeId]);

  // Once the teleprompter window checks in, hand it the current script,
  // font size, and speed. Re-runs whenever any of those change so the
  // popup always mirrors this page's settings.
  useEffect(() => {
    if (!prompterConnected) return;
    postToPrompter({ type: "script", text: script });
    postToPrompter({ type: "control", action: "setFontSize", fontSize });
    postToPrompter({ type: "control", action: "setSpeed", speed });
  }, [prompterConnected, script, fontSize, speed, postToPrompter]);

  // ---- Live monitor: mirrors the popup's current scroll position, at the
  // same *effective* font size (scaled to match), auto-scrolling to track
  // scrollStatus.lineIndex. ----
  const monitorLineRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!scrollStatus) return;
    const el = monitorLineRefs.current[scrollStatus.lineIndex];
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [scrollStatus]);

  // Measure the actual rendered width of the mini preview box so we can
  // compute how much smaller it is than the real teleprompter window, and
  // scale the mirrored font size down by exactly that ratio.
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const [previewBoxWidth, setPreviewBoxWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = previewBoxRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setPreviewBoxWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Fallback (used before the popup has reported in at least once) keeps
  // the old fixed-ratio behavior so the box isn't empty/misformatted.
  const monitorFontSize =
    prompterWindowInfo && previewBoxWidth
      ? Math.max(10, prompterWindowInfo.fontSize * (previewBoxWidth / prompterWindowInfo.width))
      : Math.max(12, fontSize * 0.4);

  const allAnglesAssigned = KNOWN_ANGLES.every((angle) => assignments[angle]);

  const handleStartClick = useCallback(() => {
    if (!allAnglesAssigned) return;
    setPhase("countdown");
    postToPrompter({ type: "phase", phase: "countdown" });
  }, [allAnglesAssigned, postToPrompter]);

  const handleCountdownTick = useCallback(
    (value: number) => {
      setCountdownValue(value);
      postToPrompter({ type: "phase", phase: "countdown", countdownValue: value });
    },
    [postToPrompter]
  );

  const handleCountdownComplete = useCallback(() => {
    setCountdownValue(null);
    setPhase("recording");
    startRecording();
    postToPrompter({ type: "phase", phase: "recording" });
  }, [startRecording, postToPrompter]);

  const handleStopClick = useCallback(() => {
    setPhase("stopped");
    stopRecording();
    postToPrompter({ type: "phase", phase: "stopped" });
  }, [stopRecording, postToPrompter]);

  return (
    <div className={styles.page}>
      <div className={styles.contentGrid}>
        <div className={styles.mainColumn}>
          <div className={styles.header}>
            <h2 className={styles.title}>
              Record{takeId !== "unassigned" ? ` — Take ${takeId}` : ""}
            </h2>
            <span
              className={styles.agentBadge}
              data-status={agentStatus}
              title={`Agent: ${agentStatus}`}
            >
              ● Agent {agentStatus}
            </span>
          </div>

          {unassignedCameras.length > 0 && (
            <section className={styles.assignPanel}>
              <h3 className={styles.assignTitle}>Assign cameras to angles</h3>
              <p className={styles.assignHint}>
                These cameras haven&apos;t been assigned yet. Once set, this is remembered — you
                won&apos;t be asked again for the same camera.
              </p>
              <div className={styles.assignGrid}>
                {unassignedCameras.map((cam) => (
                  <div key={cam.id} className={styles.assignRow}>
                    <span className={styles.assignCamName}>{cam.name}</span>
                    <div className={styles.assignButtons}>
                      {KNOWN_ANGLES.map((angle) => (
                        <button
                          key={angle}
                          type="button"
                          className={styles.assignBtn}
                          disabled={!!assignments[angle]}
                          onClick={() => handleAssign(angle, cam.id)}
                        >
                          {assignments[angle] ? `${angle} (taken)` : angle}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className={styles.stage}>
            {phase === "countdown" && (
              <CountdownOverlay onTick={handleCountdownTick} onComplete={handleCountdownComplete} />
            )}

            <div className={styles.grid}>
              {KNOWN_ANGLES.map((angle) => {
                const cameraId = assignments[angle];
                const camera = cameraId ? cameraById.get(cameraId) : undefined;
                return (
                  <div key={angle} className={styles.slot} data-slot={angle}>
                    <span className={styles.slotLabel}>{angle}</span>
                    <div className={styles.feedBox}>
                      {!cameraId ? (
                        <p className={styles.feedEmptyText}>No camera assigned</p>
                      ) : !camera ? (
                        <p className={styles.feedEmptyText}>Camera not detected</p>
                      ) : (
                        <div className={styles.feedPlaceholder}>
                          <span>{camera.name}</span>
                          <span className={styles.feedLivePill}>
                            {phase === "recording" ? "● REC" : "live preview"}
                          </span>
                        </div>
                      )}
                      {cameraId && (
                        <button
                          type="button"
                          className={styles.reassignBtn}
                          onClick={() => handleClearAssignment(angle)}
                          title="Unassign this camera"
                        >
                          Unassign
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Teleprompter monitor — its own column, top-right of the page,
            entirely separate from the camera grid/stage card. Because this
            is a real grid column (not absolute/floated), the layout
            reserves its space; nothing can ever render underneath it. */}
        <div className={styles.telePreviewFloating}>
          <span className={styles.slotLabel}>Teleprompter</span>
          <div className={styles.telePreviewBox}>
            {!prompterConnected ? (
              <p className={styles.feedEmptyText}>Popup not connected</p>
            ) : (
              <div className={styles.telePreviewScroll} ref={previewBoxRef}>
                {scriptLines.map((line, i) => (
                  <div
                    key={i}
                    ref={(el) => {
                      monitorLineRefs.current[i] = el;
                    }}
                    className={styles.telePreviewLine}
                    style={{
                      fontSize: `${monitorFontSize}px`,
                      opacity: scrollStatus?.lineIndex === i ? 1 : 0.4,
                      fontWeight: scrollStatus?.lineIndex === i ? 700 : 500,
                    }}
                  >
                    {line || "\u00A0"}
                  </div>
                ))}
              </div>
            )}
            <span className={styles.feedLivePill}>
              {phase === "recording" ? "● REC" : "live preview"}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.controlsRow}>
        <button
          type="button"
          className={styles.recordBtn}
          onClick={handleStartClick}
          disabled={!allAnglesAssigned || phase === "countdown" || phase === "recording"}
        >
          {phase === "recording" ? "Recording…" : "● Record"}
        </button>
        <button
          type="button"
          className={styles.stopBtn}
          onClick={handleStopClick}
          disabled={phase !== "recording"}
        >
          ■ Stop
        </button>
        {countdownValue !== null && (
          <span className={styles.countdownLabel}>Starting in {countdownValue}…</span>
        )}
      </div>

      <section className={styles.prompterMonitor}>
        <div className={styles.prompterMonitorHeader}>
          <h3 className={styles.boxTitleSmall}>Teleprompter</h3>
          <button type="button" className={styles.openPrompterBtn} onClick={handleOpenTeleprompter}>
            {prompterConnected ? "Reopen window" : "Open teleprompter window"}
          </button>
        </div>

        {scriptLoading && <p className={styles.assignHint}>Loading script…</p>}
        {!scriptLoading && scriptError && (
          <p className={styles.assignHint}>
            Couldn&apos;t load the transcript ({scriptError}) — using placeholder script instead.
          </p>
        )}

        <div className={styles.prompterControlsRow}>
          <div className={styles.prompterControlGroup}>
            <span className={styles.prompterControlLabel}>Font size</span>
            <div className={styles.fontStepper}>
              <button
                type="button"
                className={styles.fontStepBtn}
                onClick={handleFontDecrease}
                disabled={fontSize <= MIN_FONT_SIZE}
                aria-label="Decrease font size"
              >
                A−
              </button>
              <span className={styles.fontStepValue}>{fontSize}px</span>
              <button
                type="button"
                className={styles.fontStepBtn}
                onClick={handleFontIncrease}
                disabled={fontSize >= MAX_FONT_SIZE}
                aria-label="Increase font size"
              >
                A+
              </button>
            </div>
          </div>

          <div className={styles.prompterControlGroup}>
            <span className={styles.prompterControlLabel}>Scroll speed</span>
            <input
              type="range"
              min={MIN_SPEED}
              max={MAX_SPEED}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className={styles.speedSlider}
            />
            <span className={styles.fontStepValue}>{speed}px/s</span>
          </div>
        </div>

        {!prompterConnected ? (
          <p className={styles.assignHint}>
            Open the teleprompter window so it&apos;s visible to the presenter — it stays in sync
            automatically with record/stop, font size, and speed.
          </p>
        ) : (
          <div className={styles.prompterProgress}>
            <span>
              Line {(scrollStatus?.lineIndex ?? 0) + 1} / {scrollStatus?.totalLines ?? "—"}
            </span>
            <div className={styles.prompterProgressBar}>
              <div
                className={styles.prompterProgressFill}
                style={{
                  width: scrollStatus
                    ? `${((scrollStatus.lineIndex + 1) / Math.max(scrollStatus.totalLines, 1)) * 100}%`
                    : "0%",
                }}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default function RecordPage() {
  return (
    <Suspense fallback={<div className={styles.page} />}>
      <RecordPageInner />
    </Suspense>
  );
}