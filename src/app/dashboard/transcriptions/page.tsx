"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./Transcriptions.module.css";
import { BASE_URL } from "@/config/api";
import TranscriptionModal from "./TranscriptionModal";

// ---- Types (mirrors backend TranscriptionFileListResponse) ----

type TranscriptionTypeValue = "RAW" | "EDITED";

interface TranscriptionFileListItem {
  transcription_file_id: string;
  transcription_type: TranscriptionTypeValue;
  filename: string;
  relative_path: string;
  download_url: string;
  format: string | null;
  language: string | null;
  file_size_bytes: number | null;
  created_by: string | null;
  created_at: string;
  take_id: string | null;
  take_name: string | null;
  session_id: string | null;
  session_name: string | null;
}

interface TranscriptionFileListResponse {
  items: TranscriptionFileListItem[];
  total: number;
  limit: number;
  offset: number;
}

// ---- Filter types ----

type TypeFilter = "ALL" | TranscriptionTypeValue;
type TimeRangeFilter = "all" | "today" | "7d" | "30d" | "custom";

const PAGE_SIZE = 12;

// ---- Helpers ----

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "-";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function startOfDayISO(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toISOString();
}
function endOfDayISO(dateStr: string): string {
  return new Date(`${dateStr}T23:59:59.999`).toISOString();
}

function presetRangeStart(range: TimeRangeFilter): string | null {
  const now = new Date();
  switch (range) {
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    case "7d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return start.toISOString();
    }
    case "30d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return start.toISOString();
    }
    default:
      return null;
  }
}

// ---- Delete confirmation target ----

type DeleteTarget =
  | { kind: "single"; item: TranscriptionFileListItem }
  | { kind: "bulk"; items: TranscriptionFileListItem[] };

async function deleteTranscription(item: TranscriptionFileListItem): Promise<void> {
  if (!item.take_id) {
    throw new Error(`${item.filename}: no associated take, cannot delete`);
  }
  const res = await fetch(
    `${BASE_URL}/takes/${item.take_id}/transcriptions/${item.transcription_file_id}`,
    { method: "DELETE", credentials: "include" }
  );
  if (!res.ok && res.status !== 204) {
    throw new Error(`${item.filename}: failed to delete (${res.status})`);
  }
}

export default function TranscriptionsPage() {
  const [items, setItems] = useState<TranscriptionFileListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [timeRange, setTimeRange] = useState<TimeRangeFilter>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [selected, setSelected] = useState<TranscriptionFileListItem | null>(null);

  // ---- Multi-select / delete state ----
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setOffset(0);
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const fetchTranscriptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));

      if (typeFilter !== "ALL") {
        params.set("type", typeFilter);
      }

      if (debouncedSearch.trim()) {
        params.set("q", debouncedSearch.trim());
      }

      if (timeRange === "custom") {
        if (customFrom) params.set("created_from", startOfDayISO(customFrom));
        if (customTo) params.set("created_to", endOfDayISO(customTo));
      } else {
        const start = presetRangeStart(timeRange);
        if (start) params.set("created_from", start);
      }

      const res = await fetch(`${BASE_URL}/transcriptions?${params.toString()}`, {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Failed to load transcriptions (${res.status})`);
      }

      const json: TranscriptionFileListResponse = await res.json();
      setItems(json.items);
      setTotal(json.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transcriptions");
    } finally {
      setLoading(false);
    }
  }, [offset, typeFilter, timeRange, customFrom, customTo, debouncedSearch]);

  useEffect(() => {
    fetchTranscriptions();
  }, [fetchTranscriptions]);

  const handleTypeFilterChange = useCallback((next: TypeFilter) => {
    setTypeFilter(next);
    setOffset(0);
  }, []);

  const handleTimeRangeChange = useCallback((next: TimeRangeFilter) => {
    setTimeRange(next);
    setOffset(0);
  }, []);

  const handleCustomFromChange = useCallback((next: string) => {
    setCustomFrom(next);
    setOffset(0);
  }, []);

  const handleCustomToChange = useCallback((next: string) => {
    setCustomTo(next);
    setOffset(0);
  }, []);

  const hasActiveFilters =
    typeFilter !== "ALL" ||
    timeRange !== "all" ||
    customFrom !== "" ||
    customTo !== "" ||
    searchInput.trim() !== "";

  const handleClearFilters = useCallback(() => {
    setTypeFilter("ALL");
    setTimeRange("all");
    setCustomFrom("");
    setCustomTo("");
    setSearchInput("");
    setDebouncedSearch("");
    setOffset(0);
  }, []);

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + PAGE_SIZE, total);

  const handlePrevPage = useCallback(() => {
    setOffset((prev) => Math.max(0, prev - PAGE_SIZE));
  }, []);

  const handleNextPage = useCallback(() => {
    setOffset((prev) => (prev + PAGE_SIZE < total ? prev + PAGE_SIZE : prev));
  }, [total]);

  // ---- Multi-select handlers ----

  const toggleSelectMode = useCallback(() => {
    setSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  }, []);

  const toggleItemSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleCardClick = useCallback(
    (tf: TranscriptionFileListItem) => {
      if (selectMode) {
        toggleItemSelected(tf.transcription_file_id);
      } else {
        setSelected(tf);
      }
    },
    [selectMode, toggleItemSelected]
  );

  // ---- Delete handlers ----

  const requestDeleteSingle = useCallback(
    (e: React.MouseEvent, tf: TranscriptionFileListItem) => {
      e.stopPropagation();
      setDeleteError(null);
      setDeleteTarget({ kind: "single", item: tf });
    },
    []
  );

  const requestDeleteBulk = useCallback(() => {
    const targets = items.filter((tf) => selectedIds.has(tf.transcription_file_id));
    if (targets.length === 0) return;
    setDeleteError(null);
    setDeleteTarget({ kind: "bulk", items: targets });
  }, [items, selectedIds]);

  const cancelDelete = useCallback(() => {
    if (deleting) return;
    setDeleteTarget(null);
  }, [deleting]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    const targets = deleteTarget.kind === "single" ? [deleteTarget.item] : deleteTarget.items;
    const results = await Promise.allSettled(targets.map((tf) => deleteTranscription(tf)));

    const failures = results
      .map((r, i) => (r.status === "rejected" ? { item: targets[i], reason: r.reason } : null))
      .filter((x): x is { item: TranscriptionFileListItem; reason: unknown } => x !== null);

    setDeleting(false);
    setDeleteTarget(null);

    if (failures.length > 0) {
      const messages = failures.map((f) =>
        f.reason instanceof Error ? f.reason.message : `${f.item.filename}: failed to delete`
      );
      setDeleteError(
        failures.length === targets.length
          ? messages.join("; ")
          : `${targets.length - failures.length} deleted, ${failures.length} failed: ${messages.join("; ")}`
      );
    }

    // Clear selection for whatever succeeded (or everything, on full success)
    const failedIds = new Set(failures.map((f) => f.item.transcription_file_id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      targets.forEach((t) => {
        if (!failedIds.has(t.transcription_file_id)) next.delete(t.transcription_file_id);
      });
      return next;
    });

    if (failures.length < targets.length) {
      // At least one delete succeeded - refresh the page from the server
      // (also keeps pagination/total counts correct).
      fetchTranscriptions();
    }

    if (failures.length === 0) {
      setSelectMode(false);
    }
  }, [deleteTarget, fetchTranscriptions]);

  const allSelectedOnPage = items.length > 0 && items.every((tf) => selectedIds.has(tf.transcription_file_id));

  const toggleSelectAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      if (allSelectedOnPage) {
        const next = new Set(prev);
        items.forEach((tf) => next.delete(tf.transcription_file_id));
        return next;
      }
      const next = new Set(prev);
      items.forEach((tf) => next.add(tf.transcription_file_id));
      return next;
    });
  }, [allSelectedOnPage, items]);

  return (
    <div className={styles.page}>
      <div
        className={styles.header}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <h2 className={styles.title}>Transcriptions</h2>

        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Search</span>
            <div className={styles.searchGroup}>
              <SearchIcon />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search by filename..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              {searchInput && (
                <button
                  type="button"
                  className={styles.searchClearBtn}
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
                  title="Clear search"
                >
                  <XIcon />
                </button>
              )}
            </div>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Type</span>
            <div className={styles.typeToggle}>
              {(["ALL", "RAW", "EDITED"] as TypeFilter[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`${styles.typeToggleBtn} ${
                    typeFilter === opt ? styles.typeToggleBtnActive : ""
                  }`}
                  onClick={() => handleTypeFilterChange(opt)}
                >
                  {opt === "ALL" ? "All" : opt === "RAW" ? "Raw" : "Edited"}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>Time range</span>
            <select
              className={styles.timeSelect}
              value={timeRange}
              onChange={(e) => handleTimeRangeChange(e.target.value as TimeRangeFilter)}
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom range...</option>
            </select>
          </div>

          <div className={styles.filterGroup}>
            <span className={styles.filterLabel}>&nbsp;</span>
            <button
              type="button"
              className={styles.clearFiltersBtn}
              onClick={toggleSelectMode}
              style={selectMode ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            >
              {selectMode ? "Cancel" : "Select"}
            </button>
          </div>
        </div>
      </div>

      {(timeRange === "custom" || hasActiveFilters) && (
        <div className={styles.filterBar} style={{ justifyContent: "flex-end" }}>
          <div className={styles.filterBarRight}>
            {timeRange === "custom" && (
              <div className={styles.customDateGroup}>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={customFrom}
                  onChange={(e) => handleCustomFromChange(e.target.value)}
                  aria-label="From date"
                />
                <span className={styles.dateSeparator}>-</span>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={customTo}
                  onChange={(e) => handleCustomToChange(e.target.value)}
                  aria-label="To date"
                />
              </div>
            )}

            {hasActiveFilters && (
              <button type="button" className={styles.clearFiltersBtn} onClick={handleClearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {selectMode && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            padding: "10px 4px",
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "13px",
              color: "var(--fg-muted)",
              cursor: items.length > 0 ? "pointer" : "default",
            }}
          >
            <input
              type="checkbox"
              checked={allSelectedOnPage}
              onChange={toggleSelectAllOnPage}
              disabled={items.length === 0}
            />
            Select all on page
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "13px", color: "var(--fg-muted)" }}>
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              className={styles.clearFiltersBtn}
              style={{
                borderColor: "var(--error)",
                color: "var(--error)",
                opacity: selectedIds.size === 0 ? 0.5 : 1,
                cursor: selectedIds.size === 0 ? "default" : "pointer",
              }}
              onClick={requestDeleteBulk}
              disabled={selectedIds.size === 0}
            >
              Delete selected
            </button>
          </div>
        </div>
      )}

      {deleteError && <p className={styles.errorText}>{deleteError}</p>}

      <div className={styles.resultsArea}>
        {loading && <p className={styles.statusText}>Loading transcriptions...</p>}
        {!loading && error && <p className={styles.errorText}>{error}</p>}

        {!loading && !error && items.length === 0 && (
          <p className={styles.statusText}>
            {hasActiveFilters
              ? "No transcription files match these filters."
              : "No transcription files yet."}
          </p>
        )}

        {!loading && !error && items.length > 0 && (
          <div className={styles.grid}>
            {items.map((tf) => {
              const isSelected = selectedIds.has(tf.transcription_file_id);
              const canDelete = !!tf.take_id;
              return (
                <div
                  key={tf.transcription_file_id}
                  className={styles.card}
                  onClick={() => handleCardClick(tf)}
                  style={{
                    cursor: "pointer",
                    position: "relative",
                    outline: isSelected ? "2px solid var(--accent)" : "none",
                    outlineOffset: "-1px",
                  }}
                >
                  {selectMode && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleItemSelected(tf.transcription_file_id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: "absolute",
                        top: "10px",
                        right: "10px",
                        width: "16px",
                        height: "16px",
                        cursor: "pointer",
                        zIndex: 1,
                      }}
                      aria-label={`Select ${tf.filename}`}
                    />
                  )}

                  <div className={styles.cardBody}>
                    <div className={styles.fileIconRow}>
                      <div className={styles.fileIcon}>
                        <DocumentIcon />
                      </div>
                      {tf.take_id ? (
                        <Link
                          href={`/dashboard/all-videos/${tf.take_id}`}
                          className={styles.takeLink}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {tf.take_name ?? "View take"}
                        </Link>
                      ) : null}
                    </div>

                    <div className={styles.cardMeta}>
                      <span className={styles.metaLine}>
                        {formatBytes(tf.file_size_bytes)}
                        {tf.format ? ` - ${tf.format.toUpperCase()}` : ""}
                        {tf.language ? ` - ${tf.language}` : ""}
                      </span>
                      <span className={styles.metaLine}>{formatDate(tf.created_at)}</span>
                      {tf.created_by ? (
                        <span className={styles.metaLine}>By {tf.created_by}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className={styles.cardFooter}>
                    <span className={styles.cardFilename} title={tf.filename}>
                      {tf.filename}
                    </span>
                    <div className={styles.cardFooterActions}>
                      <span
                        className={`${styles.typeBadge} ${
                          tf.transcription_type === "RAW"
                            ? styles.typeBadgeRaw
                            : styles.typeBadgeEdited
                        }`}
                      >
                        {tf.transcription_type === "RAW" ? "Raw" : "Edited"}
                      </span>
                      <a
                        href={tf.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.downloadBtn}
                        aria-label={`Download ${tf.filename}`}
                        title="Download"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DownloadIcon />
                      </a>
                      <button
                        type="button"
                        className={styles.downloadBtn}
                        aria-label={`Delete ${tf.filename}`}
                        title={canDelete ? "Delete" : "Cannot delete - no associated take"}
                        onClick={(e) => (canDelete ? requestDeleteSingle(e, tf) : e.stopPropagation())}
                        disabled={!canDelete}
                        style={{
                          border: "none",
                          background: "transparent",
                          cursor: canDelete ? "pointer" : "default",
                          opacity: canDelete ? 1 : 0.35,
                          color: "var(--error)",
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!loading && !error && items.length > 0 && (
        <div className={styles.pagination}>
          <span className={styles.paginationInfo}>
            Showing {rangeStart}-{rangeEnd} of {total}
          </span>
          <div className={styles.paginationControls}>
            <button
              type="button"
              className={styles.pageBtn}
              onClick={handlePrevPage}
              disabled={offset === 0}
            >
              &larr; Prev
            </button>
            <span className={styles.pageIndicator}>
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className={styles.pageBtn}
              onClick={handleNextPage}
              disabled={offset + PAGE_SIZE >= total}
            >
              Next &rarr;
            </button>
          </div>
        </div>
      )}

      {selected ? (
        <TranscriptionModal item={selected} onClose={() => setSelected(null)} />
      ) : null}

      {deleteTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
            padding: "20px",
          }}
          onClick={cancelDelete}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "420px",
              borderRadius: "14px",
              border: "1px solid var(--card-border)",
              background: "var(--card-bg)",
              padding: "20px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 10px", fontSize: "15px", color: "var(--fg)" }}>
              {deleteTarget.kind === "single"
                ? `Delete "${deleteTarget.item.filename}"?`
                : `Delete ${deleteTarget.items.length} transcription file${
                    deleteTarget.items.length === 1 ? "" : "s"
                  }?`}
            </h3>
            <p style={{ margin: "0 0 18px", fontSize: "13px", color: "var(--fg-muted)" }}>
              This cannot be undone. If a transcript is shared across multiple clip view
              angles for the same take, deleting it removes the transcript link from all
              of them.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                className={styles.clearFiltersBtn}
                onClick={cancelDelete}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.clearFiltersBtn}
                style={{ borderColor: "var(--error)", color: "var(--error)" }}
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Icons ----

function DocumentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="26"
      height="26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}