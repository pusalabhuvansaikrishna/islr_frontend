"use client";

import { useEffect, useState } from "react";
import styles from "./FolderPathSelect.module.css";
import { BASE_URL } from "@/config/api";

export interface FolderOption {
  name: string;
  path: string;
}

interface FolderPathSelectProps {
  label: string;
  // URL segment for this setting, e.g. "raw-files" -> GET/PUT /settings/raw-files
  endpoint: string;
  folders: FolderOption[];
  foldersLoading: boolean;
  foldersError: string | null;
}

export default function FolderPathSelect({
  label,
  endpoint,
  folders,
  foldersLoading,
  foldersError,
}: FolderPathSelectProps) {
  const [currentValue, setCurrentValue] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Load the currently saved path for this setting on mount.
  useEffect(() => {
    const fetchCurrent = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${BASE_URL}/settings/${endpoint}`, {
          credentials: "include",
        });

        if (res.status === 404) {
          // Not set yet — leave dropdown on the placeholder.
          setCurrentValue("");
          return;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail || `Request failed (${res.status})`);
        }

        const json = await res.json();
        setCurrentValue(json.value ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load setting");
      } finally {
        setLoading(false);
      }
    };

    fetchCurrent();
  }, [endpoint]);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPath = e.target.value;
    const previousValue = currentValue;

    setCurrentValue(newPath); // optimistic update
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch(`${BASE_URL}/settings/${endpoint}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: newPath }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Request failed (${res.status})`);
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setCurrentValue(previousValue); // revert on failure
      setError(err instanceof Error ? err.message : "Failed to save setting");
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || foldersLoading || saving || !!foldersError;

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>

      <div className={styles.controlWrap}>
        <select
          className={styles.select}
          value={currentValue}
          onChange={handleChange}
          disabled={disabled}
        >
          <option value="" disabled>
            {foldersLoading ? "Loading folders…" : "Select folder"}
          </option>
          {folders.map((f) => (
            <option key={f.path} value={f.path}>
              {f.name}
            </option>
          ))}
        </select>

        {saving && <span className={styles.status}>Saving…</span>}
        {saved && !saving && <span className={styles.statusSaved}>Saved</span>}
        {(error || foldersError) && (
          <span className={styles.error}>{error || foldersError}</span>
        )}
      </div>
    </div>
  );
}