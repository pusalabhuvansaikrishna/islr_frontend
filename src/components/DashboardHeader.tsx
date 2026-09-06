"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/contexts/UserContext";
import styles from "./DashboardHeader.module.css";
import {
  ChevronIcon,
  LogoutIcon,
  ReelScriptIcon,
  ScriptIcon,
} from "./icons/DashboardIcons";
import NewRecordingSessionModal, {
  SessionFlow,
} from "@/components/modals/new-recording-session/NewRecordingSessionModal";

export default function DashboardHeader({ title }: { title: string }) {
  const router = useRouter();
  const { user, logout } = useUser();
  const [open, setOpen] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [sessionFlow, setSessionFlow] = useState<SessionFlow>("videos");
  const menuRef = useRef<HTMLDivElement>(null);
  const newSessionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
      if (
        newSessionRef.current &&
        !newSessionRef.current.contains(e.target as Node)
      ) {
        setNewSessionOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const initials = user?.name
    ?.split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const canCreateDataset = user?.permissions?.includes("CreateDataset") ?? false;

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    router.replace("/");
  };

  const handleVideosAndTranscriptionClick = () => {
    setNewSessionOpen(false);
    setSessionFlow("videos");
    setShowNewSessionModal(true);
  };

  const handleTranscriptionsOnlyClick = () => {
    setNewSessionOpen(false);
    setSessionFlow("transcriptions");
    setShowNewSessionModal(true);
  };

  return (
    <header className={styles.header}>
      <h2 className={styles.pageTitle}>{title}</h2>

      <div className={styles.headerActions}>
        {canCreateDataset && (
          <div className={styles.newSessionWrap} ref={newSessionRef}>
            <button
              type="button"
              className={styles.newSessionBtn}
              onClick={() => setNewSessionOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={newSessionOpen}
            >
              + New Recording Session
              <ChevronIcon
                className={`${styles.chevron} ${newSessionOpen ? styles.chevronOpen : ""}`}
              />
            </button>

            {newSessionOpen && (
              <div className={styles.newSessionDropdown} role="menu">
                <button
                  type="button"
                  className={styles.newSessionOption}
                  onClick={handleVideosAndTranscriptionClick}
                  role="menuitem"
                >
                  <ReelScriptIcon />
                  Videos and Transcription
                </button>
                <button
                  type="button"
                  className={styles.newSessionOption}
                  onClick={handleTranscriptionsOnlyClick}
                  role="menuitem"
                >
                  <ScriptIcon />
                  Transcriptions
                </button>
              </div>
            )}
          </div>
        )}

        <div className={styles.profileWrap} ref={menuRef}>
          <button
            type="button"
            className={styles.profileBtn}
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <span className={styles.avatarSm}>{initials}</span>
            {user?.role && (
              <span className={styles.roleBadge}>{user.role}</span>
            )}
            <ChevronIcon className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
          </button>

          {open && (
            <div className={styles.dropdown} role="menu">
              <div className={styles.dropdownUserInfo}>
                <p className={styles.dropdownName}>{user?.name}</p>
                <p className={styles.dropdownEmail}>{user?.email ?? user?.username}</p>
                {user?.role && (
                  <span className={styles.dropdownRole}>{user.role}</span>
                )}
              </div>
              <div className={styles.dropdownDivider} aria-hidden="true" />
              <button
                type="button"
                className={styles.dropdownItem}
                onClick={handleLogout}
                role="menuitem"
              >
                <LogoutIcon />
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {showNewSessionModal && (
        <NewRecordingSessionModal
          flow={sessionFlow}
          onClose={() => setShowNewSessionModal(false)}
        />
      )}
    </header>
  );
}