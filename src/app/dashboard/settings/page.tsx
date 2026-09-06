"use client";

import { useEffect, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import WorkingDirectoryBox from "./WorkingDirectoryBox";
import FolderPathSelect, { FolderOption } from "./FolderPathSelect";
import styles from "./page.module.css";
import { BASE_URL } from "@/config/api";

const FOLDER_SETTINGS = [
  { label: "Raw Files", endpoint: "raw-files" },
  { label: "Edited Files", endpoint: "edited-files" },
  { label: "Transcriptions", endpoint: "transcriptions" },
  { label: "Edited Transcriptions", endpoint: "edited-transcriptions" },
  { label: "Backup", endpoint: "backup" },
];

export default function SettingsPage() {
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [foldersError, setFoldersError] = useState<string | null>(null);

  // Fetch the working directory's subfolders once — shared across all
  // five dropdowns below instead of each one calling this separately.
  useEffect(() => {
    const fetchFolders = async () => {
      setFoldersLoading(true);
      setFoldersError(null);
      try {
        const res = await fetch(`${BASE_URL}/settings/working-directory/folders`, {
          credentials: "include",
        });

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail || `Request failed (${res.status})`);
        }

        const json = await res.json();
        setFolders(json.folders ?? []);
      } catch (err) {
        setFoldersError(
          err instanceof Error ? err.message : "Failed to load folder list"
        );
      } finally {
        setFoldersLoading(false);
      }
    };

    fetchFolders();
  }, []);

  return (
    <div className={styles.wrap}>
      <h2 className={styles.title}>Settings</h2>

      <div className={styles.layout}>
        <div className={styles.cardWrap}>
          <div className={styles.card}>
            <div className={styles.appearanceRow}>
              <span className={styles.label}>Appearance</span>
              <ThemeToggle />
            </div>
          </div>

          {FOLDER_SETTINGS.map((setting) => (
            <div className={styles.card} key={setting.endpoint}>
              <FolderPathSelect
                label={setting.label}
                endpoint={setting.endpoint}
                folders={folders}
                foldersLoading={foldersLoading}
                foldersError={foldersError}
              />
            </div>
          ))}
        </div>

        <div className={styles.sideColumn}>
          <div className={styles.card}>
            <div className={styles.workingDirRow}>
              <span className={styles.label}>Working Directory</span>
              <WorkingDirectoryBox />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}