"use client";

import { useEffect, useState } from "react";
import styles from "./BasicsStep.module.css";
import type { SessionFormData } from "../NewRecordingSessionModal";
import { BASE_URL } from "@/config/api";

interface BasicsStepProps {
  formData: SessionFormData;
  onChange: (data: Partial<SessionFormData>) => void;
  onSessionSelect?: () => void;
}

interface SessionSummary {
  session_id: string;
  name: string | null;
  location: string | null;
  started_at: string | null;
  ended_at: string | null;
  sign_person: string | null;
  organization: string | null;
  take_count: number;
  created_by: string | null;
  created_at: string | null;
}

interface HoveredSessionState {
  session: SessionSummary;
  top: number;
  left: number;
}

const MAX_LENGTH = 255;
// Below this many previous sessions, the list just grows naturally with no
// scrollbar. At or above it, the list caps its height and scrolls instead.
const SCROLL_THRESHOLD = 5;
// How long to wait after the user stops typing before firing the search request.
const SEARCH_DEBOUNCE_MS = 300;

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export default function BasicsStep({ formData, onChange, onSessionSelect }: BasicsStepProps) {
  const [previousSessions, setPreviousSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [hovered, setHovered] = useState<HoveredSessionState | null>(null);

  useEffect(() => {
    let cancelled = false;

    const timeoutId = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ page: "1", page_size: "10" });
        if (search.trim()) params.set("search", search.trim());

        const res = await fetch(`${BASE_URL}/sessions?${params.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = await res.json();
        if (!cancelled) setPreviousSessions(data.sessions || []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load sessions");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [search]);

  const isReusingSession = Boolean(formData.selectedSessionId);
  const isListScrollable = previousSessions.length >= SCROLL_THRESHOLD;
  const hasSearch = search.trim().length > 0;

  const handleSelectSession = (session: SessionSummary) => {
    // Selecting a session toggles it: clicking the already-selected one deselects it.
    if (formData.selectedSessionId === session.session_id) {
      onChange({ selectedSessionId: null, selectedSessionName: null });
    } else {
      onChange({
        selectedSessionId: session.session_id,
        selectedSessionName: session.name || "Untitled session",
      });
      // Jump straight to the Upload Files step once a session is actively selected.
      onSessionSelect?.();
    }
  };

  const handleDeleteSession = async (session: SessionSummary) => {
    setDeleteError(null);

    const confirmed = window.confirm(
      `Delete "${session.name || "this session"}"? This can't be undone.`
    );
    if (!confirmed) return;

    setDeletingId(session.session_id);
    try {
      const res = await fetch(`${BASE_URL}/recording-sessions/${session.session_id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        throw new Error(errBody?.detail || `Request failed (${res.status})`);
      }

      setPreviousSessions((prev) => prev.filter((s) => s.session_id !== session.session_id));

      // If the deleted session was selected, clear the selection so the
      // form doesn't stay pointed at a session that no longer exists.
      if (formData.selectedSessionId === session.session_id) {
        onChange({ selectedSessionId: null, selectedSessionName: null });
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete session");
    } finally {
      setDeletingId(null);
    }
  };

  const handleCardMouseEnter = (e: React.MouseEvent<HTMLDivElement>, session: SessionSummary) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHovered({ session, top: rect.top, left: rect.right + 12 });
  };

  const handleCardMouseLeave = () => {
    setHovered(null);
  };

  return (
    <div className={styles.stepGrid}>
      {/* Left: Previous Sessions */}
      <div className={styles.previousSessionsPanel}>
        <h4 className={styles.panelTitle}>Previous Sessions</h4>

        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon}>
            <SearchIcon />
          </span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search by name, location, or organization…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search previous sessions"
          />
          {hasSearch && (
            <button
              type="button"
              className={styles.searchClearBtn}
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {deleteError && <p className={styles.deleteErrorText}>{deleteError}</p>}

        {loading ? (
          <div className={styles.previousSessionsEmpty}>
            <p>Loading…</p>
          </div>
        ) : error ? (
          <div className={styles.previousSessionsEmpty}>
            <p>Couldn&apos;t load sessions.</p>
          </div>
        ) : previousSessions.length === 0 ? (
          <div className={styles.previousSessionsEmpty}>
            <p>{hasSearch ? "No sessions match your search." : "No previous sessions to show yet."}</p>
          </div>
        ) : (
          <ul
            className={`${styles.previousSessionsList} ${
              isListScrollable ? styles.previousSessionsListScrollable : ""
            }`}
          >
            {previousSessions.map((s) => {
              const isSelected = formData.selectedSessionId === s.session_id;
              const isDeleting = deletingId === s.session_id;
              return (
                <li key={s.session_id}>
                  <div
                    className={`${styles.previousSessionItem} ${
                      isSelected ? styles.previousSessionItemSelected : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    aria-disabled={isDeleting}
                    aria-pressed={isSelected}
                    onClick={() => {
                      if (!isDeleting) handleSelectSession(s);
                    }}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && !isDeleting) {
                        e.preventDefault();
                        handleSelectSession(s);
                      }
                    }}
                    onMouseEnter={(e) => handleCardMouseEnter(e, s)}
                    onMouseLeave={handleCardMouseLeave}
                  >
                    <span className={styles.previousSessionName}>
                      {s.name || "Untitled session"}
                    </span>
                    <span className={styles.previousSessionMeta}>
                      {[formatDate(s.started_at), s.location].filter(Boolean).join(" · ")}
                    </span>
                    <span className={styles.previousSessionTakes}>
                      {s.take_count} {s.take_count === 1 ? "take" : "takes"}
                    </span>

                    <button
                      type="button"
                      className={styles.previousSessionDeleteBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(s);
                      }}
                      disabled={isDeleting}
                      aria-label={`Delete ${s.name || "session"}`}
                      title="Delete session"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Right: Form fields, or a "reusing session" notice */}
      {isReusingSession ? (
        <div className={styles.reuseNotice}>
          <p className={styles.reuseNoticeTitle}>
            Adding files to &ldquo;{formData.selectedSessionName}&rdquo;
          </p>
          <p className={styles.reuseNoticeBody}>
            Session details won&apos;t be changed. Click Next to upload videos and
            transcriptions into this session.
          </p>
          <button
            type="button"
            className={styles.reuseNoticeClear}
            onClick={() => onChange({ selectedSessionId: null, selectedSessionName: null })}
          >
            Start a new session instead
          </button>
        </div>
      ) : (
        <div className={styles.formPanel}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="session-name">
              Name
            </label>
            <input
              id="session-name"
              type="text"
              maxLength={MAX_LENGTH}
              className={styles.input}
              value={formData.name}
              onChange={(e) => onChange({ name: e.target.value })}
            />
            <span className={styles.charCount}>
              {MAX_LENGTH - formData.name.length} characters remaining
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="session-location">
              Location
            </label>
            <input
              id="session-location"
              type="text"
              maxLength={MAX_LENGTH}
              className={styles.input}
              value={formData.location}
              onChange={(e) => onChange({ location: e.target.value })}
            />
            <span className={styles.charCount}>
              {MAX_LENGTH - formData.location.length} characters remaining
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="session-date">
              Date
            </label>
            <input
              id="session-date"
              type="date"
              className={styles.input}
              value={formData.date}
              onChange={(e) => onChange({ date: e.target.value })}
            />
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="session-start">
                Started at
              </label>
              <input
                id="session-start"
                type="time"
                className={styles.input}
                value={formData.startedAt}
                onChange={(e) => onChange({ startedAt: e.target.value })}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="session-end">
                End time
              </label>
              <input
                id="session-end"
                type="time"
                className={styles.input}
                value={formData.endTime}
                onChange={(e) => onChange({ endTime: e.target.value })}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="session-description">
              Description
            </label>
            <textarea
              id="session-description"
              rows={3}
              className={styles.textarea}
              value={formData.description}
              onChange={(e) => onChange({ description: e.target.value })}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="session-sign-person">
              Sign person
            </label>
            <input
              id="session-sign-person"
              type="text"
              maxLength={MAX_LENGTH}
              className={styles.input}
              value={formData.signPerson}
              onChange={(e) => onChange({ signPerson: e.target.value })}
            />
            <span className={styles.charCount}>
              {MAX_LENGTH - formData.signPerson.length} characters remaining
            </span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="session-organization">
              Organization
            </label>
            <input
              id="session-organization"
              type="text"
              maxLength={MAX_LENGTH}
              className={styles.input}
              value={formData.organization}
              onChange={(e) => onChange({ organization: e.target.value })}
            />
            <span className={styles.charCount}>
              {MAX_LENGTH - formData.organization.length} characters remaining
            </span>
          </div>
        </div>
      )}

      {/* Floating hover-details tooltip — rendered outside the scrolling
          list so it can't be clipped and never contributes to the list's
          scrollable area. */}
      {hovered && (
        <div
          className={styles.floatingTooltip}
          role="tooltip"
          style={{ top: hovered.top, left: hovered.left }}
        >
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipLabel}>Organization</span>
            <span className={styles.tooltipValue}>{hovered.session.organization || "—"}</span>
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipLabel}>Sign person</span>
            <span className={styles.tooltipValue}>{hovered.session.sign_person || "—"}</span>
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipLabel}>Started</span>
            <span className={styles.tooltipValue}>
              {hovered.session.started_at
                ? `${formatDate(hovered.session.started_at)} · ${formatTime(hovered.session.started_at)}`
                : "—"}
            </span>
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipLabel}>Ended</span>
            <span className={styles.tooltipValue}>
              {hovered.session.ended_at
                ? `${formatDate(hovered.session.ended_at)} · ${formatTime(hovered.session.ended_at)}`
                : "—"}
            </span>
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipLabel}>Created by</span>
            <span className={styles.tooltipValue}>{hovered.session.created_by || "—"}</span>
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipLabel}>Added</span>
            <span className={styles.tooltipValue}>
              {hovered.session.created_at ? formatDate(hovered.session.created_at) : "—"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}