"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import { apiFetch, ApiError } from "./api";
import type { Admin } from "./types";
import ResetPasswordModal from "./ResetPasswordModal";

interface AdminsPanelProps {
  refreshKey: number;
}

export default function AdminsPanel({ refreshKey }: AdminsPanelProps) {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [resetTarget, setResetTarget] = useState<Admin | null>(null);
  const [justReset, setJustReset] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<Admin[]>("/superadmin/admins");
        if (!cancelled) setAdmins(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Couldn't load admins."
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
    if (!q) return admins;
    return admins.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.username.toLowerCase().includes(q) ||
        (a.email ?? "").toLowerCase().includes(q)
    );
  }, [admins, query]);

  function handleReset() {
    setResetTarget(null);
    if (resetTarget) setJustReset(resetTarget.username);
    // Clear the confirmation after a few seconds rather than leaving it
    // sitting there indefinitely.
    setTimeout(() => setJustReset(null), 4000);
  }

  async function handleToggleStatus(admin: Admin) {
    if (togglingId) return; // one in-flight toggle at a time
    setTogglingId(admin.user_id);
    setToggleError(null);

    try {
      const updated = await apiFetch<Admin>(
        `/superadmin/admins/${admin.user_id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: !admin.is_active }),
        }
      );
      // Update in place rather than refetching the whole list.
      setAdmins((prev) =>
        prev.map((a) => (a.user_id === updated.user_id ? updated : a))
      );
    } catch (err) {
      setToggleError(
        err instanceof ApiError
          ? err.message
          : `Couldn't update status for ${admin.username}.`
      );
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <p className={styles.subtitle}>Loading admins…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.card}>
        <p className={styles.errorText}>Couldn't load admins: {error}</p>
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
          aria-label="Search admins"
        />
        <span className={styles.countText}>
          {filtered.length} {filtered.length === 1 ? "admin" : "admins"}
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
            {admins.length === 0
              ? "No admins yet. Add one to get started."
              : `No admins match "${query}".`}
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
            {filtered.map((admin) => (
              <tr key={admin.user_id}>
                <td>{admin.name}</td>
                <td className={styles.mutedCell}>{admin.username}</td>
                <td className={styles.mutedCell}>{admin.email || "—"}</td>
                <td>
                  <span
                    className={`${styles.statusDot} ${
                      admin.is_active
                        ? styles.statusActive
                        : styles.statusSuspended
                    }`}
                  >
                    {admin.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className={styles.mutedCell}>
                  {new Date(admin.created_at).toLocaleDateString()}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => handleToggleStatus(admin)}
                    disabled={togglingId === admin.user_id}
                    style={{ marginRight: 8 }}
                  >
                    {togglingId === admin.user_id
                      ? "Updating…"
                      : admin.is_active
                      ? "Deactivate"
                      : "Activate"}
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => setResetTarget(admin)}
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
          admin={resetTarget}
          onClose={() => setResetTarget(null)}
          onReset={handleReset}
        />
      )}
    </div>
  );
}