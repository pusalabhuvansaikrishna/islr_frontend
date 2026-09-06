"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// TODO: make configurable (e.g. if the agent ever needs a non-default
// port, or exposes a discovery endpoint). Hardcoded is fine for now
// since it's just talking to localhost.
const AGENT_WS_URL = "ws://localhost:8787";

// Flip on with NEXT_PUBLIC_MOCK_AGENT=true while the real agent doesn't
// exist yet, so the rest of the UI (assignment, grid, recording flow)
// can be built and demoed without hardware.
const USE_MOCK = process.env.NEXT_PUBLIC_MOCK_AGENT === "true";

export interface DetectedCamera {
  id: string; // stable serial/identifier reported by the agent
  name: string; // display name, e.g. "GoPro HERO12 (Front-ish)"
  thumbnailUrl?: string; // still/placeholder frame, if agent provides one
}

export type AgentStatus = "connecting" | "connected" | "disconnected" | "error";

interface AgentState {
  status: AgentStatus;
  cameras: DetectedCamera[];
}

const MOCK_CAMERAS: DetectedCamera[] = [
  { id: "mock-cam-1", name: "GoPro HERO12 — A1B2" },
  { id: "mock-cam-2", name: "GoPro HERO12 — C3D4" },
  { id: "mock-cam-3", name: "GoPro HERO11 — E5F6" },
];

export function useAgentConnection() {
  const [state, setState] = useState<AgentState>({
    status: USE_MOCK ? "connected" : "connecting",
    cameras: USE_MOCK ? MOCK_CAMERAS : [],
  });
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (USE_MOCK) return;
    let cancelled = false;

    function connect() {
      const ws = new WebSocket(AGENT_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, status: "connected" }));
      };

      ws.onclose = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, status: "disconnected" }));
        // Agent may not be running yet, or the user just launched it —
        // keep retrying rather than giving up.
        retryTimeoutRef.current = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        if (cancelled) return;
        setState((s) => ({ ...s, status: "error" }));
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          // Expected agent protocol (TBD, adjust once the agent exists):
          // { type: "cameras", cameras: DetectedCamera[] }
          if (msg?.type === "cameras" && Array.isArray(msg.cameras)) {
            setState((s) => ({ ...s, cameras: msg.cameras }));
          }
        } catch {
          // Ignore malformed messages rather than crashing the connection.
        }
      };
    }

    connect();
    return () => {
      cancelled = true;
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  const sendCommand = useCallback((command: Record<string, unknown>) => {
    if (USE_MOCK) {
      console.info("[mock agent] command:", command);
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(command));
    }
  }, []);

  const startRecording = useCallback(
    () => sendCommand({ type: "startRecording" }),
    [sendCommand]
  );
  const stopRecording = useCallback(
    () => sendCommand({ type: "stopRecording" }),
    [sendCommand]
  );

  return { ...state, sendCommand, startRecording, stopRecording };
}