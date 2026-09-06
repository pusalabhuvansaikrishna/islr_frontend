"use client";

import { useState } from "react";
import styles from "../admins/page.module.css";
import { apiFetch, ApiError } from "../admins/api";
import type { User } from "./types";

interface DeleteUserModalProps {
  user: User;
  onClose: () => void;
  onDeleted: (userId: string) => void;
}

export default function DeleteUserModal({
  user,
  onClose,
  onDeleted,
}: DeleteUserModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      await apiFetch<void>(`/superadmin/users/${user.user_id}`, {
        method: "DELETE",
      });
      onDeleted(user.user_id);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `Couldn't delete ${user.username}.`
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-user-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 id="delete-user-title" className={styles.modalTitle}>
            Delete user
          </h3>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className={styles.subtitle}>
          This will permanently delete <strong>{user.username}</strong>
          &apos;s account. This action can&apos;t be undone.
        </p>

        {error && <p className={styles.errorText}>{error}</p>}

        <div className={styles.modalActions}>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleDelete}
            disabled={submitting}
          >
            {submitting ? "Deleting…" : "Delete user"}
          </button>
        </div>
      </div>
    </div>
  );
}