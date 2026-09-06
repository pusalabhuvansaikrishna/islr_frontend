"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../admins/page.module.css";
import { apiFetch, ApiError } from "../admins/api";
import type { Editor } from "./types";
import ResetPasswordModal from "./ResetPasswordModal";

interface EditorsPanelProps {
  refreshKey: number;
}

export default function EditorsPanel({ refreshKey }: EditorsPanelProps) {
  const [editors, setEditors] = useState<Editor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [resetTarget, setResetTarget] = useState<Editor | null>(null);
  const [justReset, setJustReset] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<Editor[]>("/superadmin/editors");
        if (!cancelled) setEditors(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Couldn't load editors."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return editors;
    return editors.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.username.toLowerCase().includes(q) ||
        (e.email ?? "").toLowerCase().includes(q)
    );
  }, [editors, query]);

  function handleReset() {
    setResetTarget(null);
    if (resetTarget) setJustReset(resetTarget.username);
    // Clear the confirmation after a few seconds rather than leaving it
    // sitting there indefinitely.
    setTimeout(() => setJustReset(null), 4000);
  }

  async function handleToggleStatus(editor: Editor) {
    if (togglingId) return; // one in-flight toggle at a time
    setTogglingId(editor.user_id);
    setToggleError(null);

    try {
      const updated = await apiFetch<Editor>(
        `/superadmin/editors/${editor.user_id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: !editor.is_active }),
        }
      );
      // Update in place rather than refetching the whole list.
      setEditors((prev) =>
        prev.map((e) => (e.user_id === updated.user_id ? updated : e))
      );
    } catch (err) {
      setToggleError(
        err instanceof ApiError
          ? err.message
          : `Couldn't update status for ${editor.username}.`
      );
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <p className={styles.subtitle}>Loading editors…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.card}>
        <p className={styles.errorText}>Couldn't load editors: {error}</p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div className={styles.panelHeader}>
        <input
          type="search"
          placeholder="Search by name, username, or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.searchInput}
          aria-label="Search editors"
        />
        <span className={styles.countText}>
          {filtered.length} {filtered.length === 1 ? "editor" : "editors"}
        </span>
      </div>

      {justReset && (
        <p className={styles.subtitle}>
          Password reset for <strong>{justReset}</strong>.
        </p>
      )}

      {toggleError && <p className={styles.errorText}>{toggleError}</p>}

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          <p>
            {editors.length === 0
              ? "No editors yet. Add one to get started."
              : `No editors match "${query}".`}
          </p>
        </div>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>Email</th>
              <th>Status</th>
              <th>Created</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((editor) => (
              <tr key={editor.user_id}>
                <td>{editor.name}</td>
                <td className={styles.mutedCell}>{editor.username}</td>
                <td className={styles.mutedCell}>{editor.email || "—"}</td>
                <td>
                  <span
                    className={`${styles.statusDot} ${
                      editor.is_active
                        ? styles.statusActive
                        : styles.statusSuspended
                    }`}
                  >
                    {editor.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className={styles.mutedCell}>
                  {editor.created_at
                    ? new Date(editor.created_at).toLocaleDateString()
                    : "—"}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => handleToggleStatus(editor)}
                    disabled={togglingId === editor.user_id}
                    style={{ marginRight: 8 }}
                  >
                    {togglingId === editor.user_id
                      ? "Updating…"
                      : editor.is_active
                      ? "Deactivate"
                      : "Activate"}
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => setResetTarget(editor)}
                  >
                    Reset password
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {resetTarget && (
        <ResetPasswordModal
          editor={resetTarget}
          onClose={() => setResetTarget(null)}
          onReset={handleReset}
        />
      )}
    </div>
  );
}