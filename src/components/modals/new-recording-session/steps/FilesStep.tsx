"use client";

import { useRef, useState } from "react";
import styles from "./FilesStep.module.css";
import type { SessionFormData } from "../NewRecordingSessionModal";

interface FilesStepProps {
  formData: SessionFormData;
  onChange: (data: Partial<SessionFormData>) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}

export default function FilesStep({ formData, onChange }: FilesStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (newFiles: FileList | File[]) => {
    const filesArray = Array.from(newFiles);
    onChange({ files: [...formData.files, ...filesArray] });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      addFiles(e.dataTransfer.files);
    }
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
    if (e.target.files?.length) {
      addFiles(e.target.files);
    }
    // reset so selecting the same file again still fires onChange
    e.target.value = "";
  };

  const handleRemoveFile = (indexToRemove: number) => {
    onChange({ files: formData.files.filter((_, i) => i !== indexToRemove) });
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
          multiple
          className={styles.hiddenInput}
          onChange={handleFileInputChange}
        />
        <p className={styles.dropzoneText}>
          Drag and drop videos or text files here, or{" "}
          <span className={styles.browseLink}>browse</span>
        </p>
        <p className={styles.dropzoneSubtext}>No file size or count limit</p>
      </div>

      {formData.files.length > 0 && (
        <div className={styles.fileList}>
          <p className={styles.fileListHeader}>
            {formData.files.length} file{formData.files.length !== 1 ? "s" : ""} added
          </p>
          {formData.files.map((file, index) => (
            <div key={`${file.name}-${index}`} className={styles.fileItem}>
              <span className={styles.fileIcon}>{isVideoFile(file) ? "🎬" : "📄"}</span>
              <div className={styles.fileInfo}>
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileSize}>{formatFileSize(file.size)}</span>
              </div>
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => handleRemoveFile(index)}
                aria-label={`Remove ${file.name}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}