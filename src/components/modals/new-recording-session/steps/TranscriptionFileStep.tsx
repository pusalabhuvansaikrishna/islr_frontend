"use client";

import { useRef, useState } from "react";
import styles from "./FilesStep.module.css";
import type { SessionFormData } from "../NewRecordingSessionModal";

interface TranscriptionFileStepProps {
  formData: SessionFormData;
  onChange: (data: Partial<SessionFormData>) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isCsvFile(file: File): boolean {
  return file.type === "text/csv" || file.name.toLowerCase().endsWith(".csv");
}

export default function TranscriptionFileStep({
  formData,
  onChange,
}: TranscriptionFileStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const csvFile = formData.csvFile ?? null;

  const setFile = (file: File) => {
    if (!isCsvFile(file)) {
      setError("Only .csv files are accepted.");
      return;
    }
    setError(null);
    onChange({ csvFile: file });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) setFile(file);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setFile(file);
    e.target.value = "";
  };

  const handleRemoveFile = () => {
    onChange({ csvFile: null });
  };

  return (
    <div className={styles.container}>
      <div
        className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleBrowseClick}
        role="button"
        tabIndex={0}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className={styles.hiddenInput}
          onChange={handleFileInputChange}
        />
        <p className={styles.dropzoneText}>
          Drag and drop a CSV file here, or{" "}
          <span className={styles.browseLink}>browse</span>
        </p>
        <p className={styles.dropzoneSubtext}>Only .csv files are accepted · 1 file</p>
      </div>

      {error && (
        <p className={styles.fileListHeader} style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      {csvFile && (
        <div className={styles.fileList}>
          <p className={styles.fileListHeader}>1 file added</p>
          <div className={styles.fileItem}>
            <span className={styles.fileIcon}>📄</span>
            <div className={styles.fileInfo}>
              <span className={styles.fileName}>{csvFile.name}</span>
              <span className={styles.fileSize}>{formatFileSize(csvFile.size)}</span>
            </div>
            <button
              type="button"
              className={styles.removeBtn}
              onClick={handleRemoveFile}
              aria-label={`Remove ${csvFile.name}`}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}