"use client";

import { useCallback, useEffect, useRef } from "react";

export type RecordingPhase = "idle" | "countdown" | "recording" | "stopped";

// Everything that can cross between the main tab and the teleprompter
// window. Kept as a single discriminated union so both sides share one
// source of truth for the wire format.
export type PrompterMessage =
  | { type: "phase"; phase: RecordingPhase; countdownValue?: number }
  | { type: "script"; text: string }
  | { type: "control"; action: "setSpeed" | "jumpToStart"; speed?: number }
  // Sent FROM the teleprompter window so the main tab's monitor panel
  // can mirror what the presenter is currently seeing.
  | { type: "scrollStatus"; lineIndex: number; totalLines: number }
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