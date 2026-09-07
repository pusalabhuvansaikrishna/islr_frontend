"use client";

import { useCallback, useEffect, useRef } from "react";

export type RecordingPhase = "idle" | "countdown" | "recording" | "stopped";

// Everything that can cross between the main tab and the teleprompter
// window. Kept as a single discriminated union so both sides share one
// source of truth for the wire format.
export type PrompterMessage =
  | { type: "phase"; phase: RecordingPhase; countdownValue?: number }
  | { type: "script"; text: string }
  | { type: "control"; action: "setSpeed"; speed: number }
  | { type: "control"; action: "setFontSize"; fontSize: number }
  | { type: "control"; action: "jumpToStart" }
  // Sent FROM the teleprompter window so the main tab's monitor panel
  // can mirror what the presenter is currently seeing.
  | { type: "scrollStatus"; lineIndex: number; totalLines: number }
  // Sent FROM the teleprompter window whenever its own size or effective
  // font size changes (e.g. moved to another display), so the main tab's
  // mini preview can mirror it proportionally instead of guessing.
  | { type: "windowInfo"; innerWidth: number; innerHeight: number; effectiveFontSize: number }
  | { type: "windowReady" };

// One channel per take, so leaving multiple record tabs open (e.g. across
// takes) never cross-talks.
function channelNameForTake(takeId: string) {
  return `teleprompter-sync-${takeId}`;
}

export function useTeleprompterChannel(
  takeId: string,
  onMessage: (msg: PrompterMessage) => void
) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const channel = new BroadcastChannel(channelNameForTake(takeId));
    channelRef.current = channel;
    channel.onmessage = (evt) => onMessageRef.current(evt.data as PrompterMessage);
    return () => channel.close();
  }, [takeId]);

  const post = useCallback((msg: PrompterMessage) => {
    channelRef.current?.postMessage(msg);
  }, []);

  return post;
}