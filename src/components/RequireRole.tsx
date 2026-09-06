"use client";

import { ReactNode } from "react";
import { useUser } from "@/contexts/UserContext";
import styles from "./RequireRole.module.css";

function LockIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export default function RequireRole({
  allowed,
  children,
}: {
  allowed: string[];
  children: ReactNode;
}) {
  const { user, loading } = useUser();

  // /me is still resolving — avoid a flash of "access denied" for legit users
  if (loading) {
    return (
      <div className={styles.statusWrap}>
        <p className={styles.statusText}>Loading…</p>
      </div>
    );
  }

  const hasAccess = !!user && allowed.includes(user.role);

  if (!hasAccess) {
    return (
      <div className={styles.wrap}>
        <div className={styles.card}>
          <div className={styles.iconWrap} aria-hidden="true">
            <LockIcon />
          </div>
          <h2 className={styles.title}>You don&apos;t have access to this page</h2>
          <p className={styles.desc}>
            This section is restricted to {allowed.join(" / ")}. If you think
            this is a mistake, reach out to your administrator.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}