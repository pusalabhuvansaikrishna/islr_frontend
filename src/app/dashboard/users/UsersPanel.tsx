"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../admins/page.module.css";
import { apiFetch, ApiError } from "../admins/api";
import type { User } from "./types";
import EditUserModal from "./EditUserModal";
import ResetPasswordModal from "./ResetPasswordModal";
import DeleteUserModal from "./DeleteUserModal";

interface UsersPanelProps {
  refreshKey: number;
}

export default function UsersPanel({ refreshKey }: UsersPanelProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editTarget, setEditTarget] = useState<User | null>(null);
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [justReset, setJustReset] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<User[]>("/superadmin/users");
        if (!cancelled) setUsers(data);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Couldn't load users."
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
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q)
    );
  }, [users, query]);

  function handleUpdated(updated: User) {
    setEditTarget(null);
    setUsers((prev) => prev.map((u) => (u.user_id === updated.user_id ? updated : u)));
  }

  function handleReset() {
    setResetTarget(null);
    if (resetTarget) setJustReset(resetTarget.username);
    // Clear the confirmation after a few seconds rather than leaving it
    // sitting there indefinitely.
    setTimeout(() => setJustReset(null), 4000);
  }

  function handleDeleted(userId: string) {
    setDeleteTarget(null);
    setUsers((prev) => prev.filter((u) => u.user_id !== userId));
  }

  async function handleToggleStatus(user: User) {
    if (togglingId) return; // one in-flight toggle at a time
    setTogglingId(user.user_id);
    setToggleError(null);

    try {
      const updated = await apiFetch<User>(
        `/superadmin/users/${user.user_id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ is_active: !user.is_active }),
        }
      );
      // Update in place rather than refetching the whole list.
      setUsers((prev) =>
        prev.map((u) => (u.user_id === updated.user_id ? updated : u))
      );
    } catch (err) {
      setToggleError(
        err instanceof ApiError
          ? err.message
          : `Couldn't update status for ${user.username}.`
      );
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) {
    return (
      <div className={styles.card}>
        <p className={styles.subtitle}>Loading users…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.card}>
        <p className={styles.errorText}>Couldn't load users: {error}</p>
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
          aria-label="Search users"
        />
        <span className={styles.countText}>
          {filtered.length} {filtered.length === 1 ? "user" : "users"}
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
            {users.length === 0
              ? "No users yet. Add one to get started."
              : `No users match "${query}".`}
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
            {filtered.map((user) => (
              <tr key={user.user_id}>
                <td>{user.name}</td>
                <td className={styles.mutedCell}>{user.username}</td>
                <td className={styles.mutedCell}>{user.email || "—"}</td>
                <td>
                  <span
                    className={`${styles.statusDot} ${
                      user.is_active
                        ? styles.statusActive
                        : styles.statusSuspended
                    }`}
                  >
                    {user.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className={styles.mutedCell}>
                  {user.created_at
                    ? new Date(user.created_at).toLocaleDateString()
                    : "—"}
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => setEditTarget(user)}
                    style={{ marginRight: 8 }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => handleToggleStatus(user)}
                    disabled={togglingId === user.user_id}
                    style={{ marginRight: 8 }}
                  >
                    {togglingId === user.user_id
                      ? "Updating…"
                      : user.is_active
                      ? "Deactivate"
                      : "Activate"}
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => setResetTarget(user)}
                    style={{ marginRight: 8 }}
                  >
                    Reset password
                  </button>
                  <button
                    type="button"
                    className={styles.ghostBtn}
                    onClick={() => setDeleteTarget(user)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editTarget && (
        <EditUserModal
          user={editTarget}
          onClose={() => setEditTarget(null)}
          onUpdated={handleUpdated}
        />
      )}

      {resetTarget && (
        <ResetPasswordModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onReset={handleReset}
        />
      )}

      {deleteTarget && (
        <DeleteUserModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}