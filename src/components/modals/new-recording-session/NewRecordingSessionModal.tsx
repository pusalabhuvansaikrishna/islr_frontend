"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./NewRecordingSessionModal.module.css";
import BasicsStep from "./steps/BasicsStep";
import FilesStep from "./steps/FilesStep";
import TranscriptionFileStep from "./steps/TranscriptionFileStep";
import { BASE_URL } from "@/config/api";

export interface SessionFormData {
  name: string;
  location: string;
  date: string;        // "2026-08-10"
  startedAt: string;    // "14:30"
  endTime: string;      // "16:00"
  description: string;
  signPerson: string;
  organization: string;
  files: File[];
  csvFile: File | null; // used by the Transcriptions-only flow
  selectedSessionId: string | null;   // set when reusing an existing session
  selectedSessionName: string | null; // for display in the header/footer
}

export type SessionFlow = "videos" | "transcriptions";

interface ProgressState {
  completed: number;
  total: number;
}

function getTodayDateString(): string {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const INITIAL_FORM_DATA: SessionFormData = {
  name: "",
  location: "",
  date: getTodayDateString(),
  startedAt: "",
  endTime: "",
  description: "",
  signPerson: "",
  organization: "",
  files: [],
  csvFile: null,
  selectedSessionId: null,
  selectedSessionName: null,
};

// Combines a "YYYY-MM-DD" date and "HH:MM" time into an ISO 8601 string
// in the browser's local timezone. Returns null if either part is missing
// or invalid.
function combineDateAndTime(date: string, time: string): string | null {
  if (!date || !time) return null;
  const combined = new Date(`${date}T${time}:00`);
  if (isNaN(combined.getTime())) return null;
  return combined.toISOString();
}

// Reads a `text/event-stream` Response body and dispatches each parsed
// SSE event to `onEvent`. Shared by both the video-upload and
// transcription-upload flows so the parsing logic (buffering partial
// chunks, splitting on blank lines, tolerating malformed lines) only
// lives in one place.
async function consumeEventStream(
  response: Response,
  onEvent: (event: any) => void
): Promise<void> {
  if (!response.body) {
    throw new Error("Expected a streaming response but got none.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const raw of events) {
      if (!raw.startsWith("data: ")) continue;
      let event: any;
      try {
        event = JSON.parse(raw.slice(6));
      } catch {
        continue;
      }
      onEvent(event);
    }
  }
}

type StepDef = {
  id: string;
  label: string;
  render: (
    formData: SessionFormData,
    onChange: (data: Partial<SessionFormData>) => void,
    onAdvance: () => void
  ) => React.ReactNode;
};

const VIDEO_STEPS: StepDef[] = [
  {
    id: "details",
    label: "Session Details",
    render: (formData, onChange, onAdvance) => (
      <BasicsStep formData={formData} onChange={onChange} onSessionSelect={onAdvance} />
    ),
  },
  {
    id: "files",
    label: "Upload Files",
    render: (formData, onChange) => <FilesStep formData={formData} onChange={onChange} />,
  },
];

const TRANSCRIPTION_STEPS: StepDef[] = [
  {
    id: "details",
    label: "Session Details",
    render: (formData, onChange, onAdvance) => (
      <BasicsStep formData={formData} onChange={onChange} onSessionSelect={onAdvance} />
    ),
  },
  {
    id: "csv",
    label: "Upload Transcription",
    render: (formData, onChange) => (
      <TranscriptionFileStep formData={formData} onChange={onChange} />
    ),
  },
];

interface NewRecordingSessionModalProps {
  onClose: () => void;
  onCreated?: () => void; // optional: e.g. refresh a session list after success
  flow?: SessionFlow; // "videos" (default) or "transcriptions"
}

export default function NewRecordingSessionModal({
  onClose,
  onCreated,
  flow = "videos",
}: NewRecordingSessionModalProps) {
  const STEPS = useMemo(
    () => (flow === "transcriptions" ? TRANSCRIPTION_STEPS : VIDEO_STEPS),
    [flow]
  );

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [formData, setFormData] = useState<SessionFormData>(INITIAL_FORM_DATA);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [progress, setProgress] = useState<ProgressState | null>(null);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose, submitting]);

  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === STEPS.length - 1;
  const currentStep = STEPS[currentStepIndex];
  const isReusingSession = Boolean(formData.selectedSessionId);
  const isTranscriptionFlow = flow === "transcriptions";

  const handleFormChange = (data: Partial<SessionFormData>) => {
    setFormData((prev) => ({ ...prev, ...data }));
  };

  const handleNext = () => {
    if (!isLastStep) setCurrentStepIndex((i) => i + 1);
  };

  const handleBack = () => {
    if (!isFirstStep) setCurrentStepIndex((i) => i - 1);
  };

  const handleStepClick = (index: number) => {
    if (submitting) return;
    if (index === currentStepIndex) return;
    setCurrentStepIndex(index);
  };

  const runTranscriptionUpload = async () => {
    if (!formData.csvFile) {
      throw new Error("Please add a CSV file to upload.");
    }

    let url: string;
    const body = new FormData();

    if (isReusingSession && formData.selectedSessionId) {
      url = `${BASE_URL}/recording-sessions/${formData.selectedSessionId}/transcriptions`;
      body.append("file", formData.csvFile);
    } else {
      url = `${BASE_URL}/recording-sessions/transcriptions`;
      const startedAtIso = combineDateAndTime(formData.date, formData.startedAt);
      const endedAtIso = combineDateAndTime(formData.date, formData.endTime);
      if (formData.name) body.append("name", formData.name);
      if (formData.location) body.append("location", formData.location);
      if (startedAtIso) body.append("started_at", startedAtIso);
      if (endedAtIso) body.append("ended_at", endedAtIso);
      if (formData.description) body.append("description", formData.description);
      if (formData.signPerson) body.append("sign_person", formData.signPerson);
      if (formData.organization) body.append("organization", formData.organization);
      body.append("file", formData.csvFile);
    }

    const response = await fetch(url, { method: "POST", credentials: "include", body });

    if (!response.ok || !response.body) {
      const errBody = await response.json().catch(() => null);
      throw new Error(errBody?.detail || `Request failed (${response.status})`);
    }

    let sawError: string | null = null;

    await consumeEventStream(response, (event) => {
      if (event.type === "start") {
        setProgress({ completed: 0, total: event.total });
      } else if (event.type === "progress") {
        setProgress({ completed: event.completed, total: event.total });
      } else if (event.type === "error") {
        sawError = event.detail;
      } else if (event.type === "done") {
        setProgress({ completed: event.created, total: event.total });
        if (event.warnings?.length) setWarnings(event.warnings);
      }
    });

    if (sawError) throw new Error(sawError);
  };

  const runVideoUpload = async () => {
    let url: string;
    const body = new FormData();

    if (isReusingSession && formData.selectedSessionId) {
      // Existing session selected: just upload files to it.
      if (formData.files.length === 0) {
        throw new Error("Please add at least one file to upload.");
      }
      url = `${BASE_URL}/recording-sessions/${formData.selectedSessionId}/files`;
      formData.files.forEach((file) => body.append("files", file));
    } else {
      // No session selected: create a brand new one (original flow).
      url = `${BASE_URL}/recording-sessions`;
      const startedAtIso = combineDateAndTime(formData.date, formData.startedAt);
      const endedAtIso = combineDateAndTime(formData.date, formData.endTime);

      if (formData.name) body.append("name", formData.name);
      if (formData.location) body.append("location", formData.location);
      if (startedAtIso) body.append("started_at", startedAtIso);
      if (endedAtIso) body.append("ended_at", endedAtIso);
      if (formData.description) body.append("description", formData.description);
      if (formData.signPerson) body.append("sign_person", formData.signPerson);
      if (formData.organization) body.append("organization", formData.organization);
      formData.files.forEach((file) => body.append("files", file));
    }

    const response = await fetch(url, { method: "POST", credentials: "include", body });

    if (!response.ok) {
      const errBody = await response.json().catch(() => null);
      throw new Error(errBody?.detail || `Request failed (${response.status})`);
    }

    const contentType = response.headers.get("content-type") || "";

    // Fast path: no files were sent (e.g. creating a session with details
    // only), so the backend returned a plain JSON response instead of a
    // stream -- see create_recording_session's early-return branch.
    if (!contentType.includes("text/event-stream")) {
      const result = await response.json();
      if (result.warnings?.length) setWarnings(result.warnings);
      return;
    }

    // Streaming path: files were uploaded, backend is reporting progress
    // per-file as it saves/hashes/DB-inserts each one.
    let sawError: string | null = null;

    await consumeEventStream(response, (event) => {
      if (event.type === "start") {
        setProgress({ completed: 0, total: event.total });
      } else if (event.type === "progress") {
        setProgress({ completed: event.completed, total: event.total });
      } else if (event.type === "error") {
        sawError = event.detail;
      } else if (event.type === "done") {
        setProgress({ completed: event.completed ?? event.total, total: event.total });
        if (event.warnings?.length) setWarnings(event.warnings);
      }
    });

    if (sawError) throw new Error(sawError);
  };

  const handleCreate = async () => {
    setSubmitError(null);
    setWarnings([]);
    setProgress(null);
    setSubmitting(true);

    try {
      if (isTranscriptionFlow) {
        await runTranscriptionUpload();
      } else {
        await runVideoUpload();
      }

      onCreated?.();
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save session");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={submitting ? undefined : onClose}>
      <div
        className={styles.modalContent}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-session-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <h3 id="new-session-title" className={styles.modalTitle}>
            {isReusingSession
              ? `Add ${isTranscriptionFlow ? "Transcription" : "Files"} to "${
                  formData.selectedSessionName || "Session"
                }"`
              : isTranscriptionFlow
              ? "New Transcription Session"
              : "New Recording Session"}
          </h3>
          <button
            type="button"
            className={styles.modalCloseBtn}
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
          >
            ×
          </button>
        </div>

        <div className={styles.stepper}>
          {STEPS.map((step, index) => (
            <div key={step.id} className={styles.stepperItem}>
              <div
                className={`${styles.stepDot} ${
                  index === currentStepIndex
                    ? styles.stepDotActive
                    : index < currentStepIndex
                    ? styles.stepDotDone
                    : ""
                }`}
                onClick={() => handleStepClick(index)}
                role="button"
                tabIndex={0}
                style={{ cursor: submitting ? "default" : "pointer" }}
                aria-current={index === currentStepIndex ? "step" : undefined}
              >
                {index + 1}
              </div>
              <span
                className={`${styles.stepLabel} ${
                  index === currentStepIndex ? styles.stepLabelActive : ""
                }`}
                onClick={() => handleStepClick(index)}
                style={{ cursor: submitting ? "default" : "pointer" }}
              >
                {step.label}
              </span>
              {index < STEPS.length - 1 && <div className={styles.stepConnector} />}
            </div>
          ))}
        </div>

        <div className={styles.modalBody}>
          {currentStep.render(formData, handleFormChange, handleNext)}

          {progress && (
            <div className={styles.progressWrap}>
              <div className={styles.progressBarTrack}>
                <div
                  className={styles.progressBarFill}
                  style={{
                    width: `${
                      progress.total > 0 ? (progress.completed / progress.total) * 100 : 0
                    }%`,
                  }}
                />
              </div>
              <span className={styles.progressLabel}>
                Creating files: {progress.completed} / {progress.total}
              </span>
            </div>
          )}

          {submitError && <p className={styles.errorText}>{submitError}</p>}
          {warnings.length > 0 && (
            <div className={styles.warningsBox}>
              {warnings.map((w, i) => (
                <p key={i} className={styles.warningText}>{w}</p>
              ))}
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={handleBack}
            disabled={isFirstStep || submitting}
          >
            Back
          </button>
          {isLastStep ? (
            <button
              type="button"
              className={styles.primaryBtn}
              onClick={handleCreate}
              disabled={submitting}
            >
              {submitting
                ? "Uploading…"
                : isReusingSession
                ? isTranscriptionFlow
                  ? "Upload Transcription"
                  : "Upload Files"
                : "Create"}
            </button>
          ) : (
            <button type="button" className={styles.primaryBtn} onClick={handleNext}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}