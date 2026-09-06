"use client";

import { useState, type FormEvent } from "react";
import styles from "../admins/page.module.css";
import { apiFetch, ApiError } from "../admins/api";
import type { User, UpdateUserPayload } from "./types";

interface EditUserModalProps {
  user: User;
  onClose: () => void;
  onUpdated: (user: User) => void;
}

export default function EditUserModal({
  user,
  onClose,
  onUpdated,
}: EditUserModalProps) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailValid = email.trim().length === 0 || /\S+@\S+\.\S+/.test(email);
  const isValid = name.trim().length > 0 && emailValid;
  // Nothing changed — no reason to let the user submit.
  const isDirty = name.trim() !== user.name || email.trim() !== (user.email ?? "");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!isValid || !isDirty || submitting) return;

    setSubmitting(true);
    setError(null);

    const payload: UpdateUserPayload = {
      name: name.trim(),
      ...(email.trim() ? { email: email.trim() } : {}),
    };

    try {
      const updated = await apiFetch<User>(`/superadmin/users/${user.user_id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      onUpdated(updated);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't update this user."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-user-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3 id="edit-user-title" className={styles.modalTitle}>
            Edit user
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
          Updating <strong>{user.username}</strong>. Username can't be changed.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jordan Lee"
              className={styles.input}
              autoFocus
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Email (optional)</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jordan@company.com"
              className={styles.input}
            />
            {!emailValid && (
              <span className={styles.errorText}>
                Enter a valid email address.
              </span>
            )}
          </label>

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
              type="submit"
              className={styles.primaryBtn}
              disabled={!isValid || !isDirty || submitting}
            >
              {submitting ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}