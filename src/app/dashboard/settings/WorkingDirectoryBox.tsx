"use client";

import { useEffect, useState } from "react";
import styles from "./WorkingDirectoryBox.module.css";
import { BASE_URL } from "@/config/api";

interface WorkingDirectorySetting {
  settings_id: string;
  key: string;
  value: string;
  description?: string | null;
  updated_by?: string | null;
  updated_at: string;
}

function LockClosedIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function LockOpenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 0 1 7.6-1.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type LoadState = "checking" | "authorized" | "unauthorized";

export default function WorkingDirectoryBox() {
  const [loadState, setLoadState] = useState<LoadState>("checking");
  const [savedPath, setSavedPath] = useState("");
  const [editValue, setEditValue] = useState("");
  const [locked, setLocked] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notSet, setNotSet] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`${BASE_URL}/settings/working-directory`, {
          method: "GET",
          credentials: "include",
        });

        if (cancelled) return;

        // 403 = user lacks ModifyDirectoryPath — this doubles as the
        // permission check for whether the box renders at all.
        if (res.status === 403) {
          setLoadState("unauthorized");
          return;
        }

        // 404 = authorized, but nobody has set a path yet.
        if (res.status === 404) {
          setLoadState("authorized");
          setNotSet(true);
          return;
        }

        if (!res.ok) {
          // Any other failure: fail closed rather than show a
          // permission-gated control in an uncertain state.
          setLoadState("unauthorized");
          return;
        }

        const data: WorkingDirectorySetting = await res.json();
        setSavedPath(data.value);
        setEditValue(data.value);
        setLoadState("authorized");
      } catch {
        if (!cancelled) setLoadState("unauthorized");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleToggleLock() {
    if (!locked) {
      // Re-locking discards unsaved edits.
      setEditValue(savedPath);
      setError(null);
    }
    setLocked((v) => !v);
  }

  function handleCancel() {
    setEditValue(savedPath);
    setError(null);
    setLocked(true);
  }

  async function handleSave() {
    const trimmed = editValue.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`${BASE_URL}/settings/working-directory`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(body?.detail ?? `Request failed (${res.status})`);
      }

      const data: WorkingDirectorySetting = body;
      setSavedPath(data.value);
      setEditValue(data.value);
      setNotSet(false);
      setLocked(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't save the working directory."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loadState !== "authorized") {
    return null;
  }

  return (
    <div
      className={`${styles.folderBox} ${
        locked ? styles.folderBoxLocked : styles.folderBoxUnlocked
      }`}
    >
      <div className={styles.folderHeaderRow}>
        <label htmlFor="folderPath" className={styles.folderLabel}>
          Working folder
        </label>
        <button
          type="button"
          className={styles.lockBtn}
          onClick={handleToggleLock}
          disabled={saving}
          aria-label={locked ? "Unlock to edit" : "Lock"}
          title={locked ? "Unlock to edit" : "Lock"}
        >
          {locked ? <LockClosedIcon /> : <LockOpenIcon />}
        </button>
      </div>

      <div className={styles.folderInputRow}>
        <input
          id="folderPath"
          type="text"
          placeholder="Paste folder path…"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className={styles.folderInput}
          spellCheck={false}
          disabled={locked || saving}
        />
        {!locked && (
          <>
            <button
              type="button"
              className={styles.folderBtn}
              onClick={handleSave}
              disabled={saving || !editValue.trim()}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className={styles.folderGhostBtn}
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {locked && notSet && !savedPath && (
        <p className={styles.folderSavedText}>No working directory set yet.</p>
      )}
      {error && <p className={styles.folderErrorText}>{error}</p>}
    </div>
  );
}