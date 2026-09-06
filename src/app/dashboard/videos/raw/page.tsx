"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import styles from "./RawVideos.module.css";
import { BASE_URL } from "@/config/api";
import { useUser } from "@/contexts/UserContext";

interface TakeListItem {
  take_id: string;
  name: string | null;
  take_number: number | null;
  recorded_at: string | null;
  session_id: string | null;
  session_name: string | null;
  angles: string[];
  created_at: string;
}

interface PaginatedTakes {
  items: TakeListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

const PAGE_SIZE = 12;
const AVAILABLE_ANGLES = ["Front", "Left", "Right"];

function formatDate(iso: string | null): string {
  if (!iso) return "Unknown date";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function RawVideosPage() {
  const { user } = useUser();
  const router = useRouter();
  const canDelete = user?.permissions?.includes("DeleteDataset") ?? false;

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedAngles, setSelectedAngles] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedTakes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [confirmingTakeId, setConfirmingTakeId] = useState<string | null>(null);
  const [deletingTakeId, setDeletingTakeId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const toggleAngle = (angle: string) => {
    setSelectedAngles((prev) =>
      prev.includes(angle) ? prev.filter((a) => a !== angle) : [...prev, angle]
    );
    setPage(1);
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setSelectedAngles([]);
    setPage(1);
  };

  const hasActiveFilters = Boolean(dateFrom || dateTo || selectedAngles.length > 0);

  const fetchTakes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        page_size: String(PAGE_SIZE),
      });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (dateFrom) params.set("date_from", new Date(dateFrom).toISOString());
      if (dateTo) params.set("date_to", new Date(dateTo).toISOString());
      selectedAngles.forEach((angle) => params.append("angles", angle));

      const res = await fetch(`${BASE_URL}/takes?${params.toString()}`, {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Failed to load takes (${res.status})`);
      }

      const json: PaginatedTakes = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load takes");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, dateFrom, dateTo, selectedAngles]);

  useEffect(() => {
    fetchTakes();
  }, [fetchTakes]);

  const handleCardClick = (takeId: string) => {
    router.push(`/dashboard/videos/raw/${takeId}`);
  };

  const handleDeleteClick = (e: React.MouseEvent, takeId: string) => {
    e.stopPropagation();
    setDeleteError(null);
    setConfirmingTakeId(takeId);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmingTakeId(null);
  };

  const handleConfirmDelete = async (e: React.MouseEvent, takeId: string) => {
    e.stopPropagation();
    setDeleteError(null);
    setDeletingTakeId(takeId);

    try {
      const res = await fetch(`${BASE_URL}/takes/${takeId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Failed to delete (${res.status})`);
      }

      setConfirmingTakeId(null);
      await fetchTakes();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete take");
    } finally {
      setDeletingTakeId(null);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>Raw Videos</h2>
        <div className={styles.headerControls}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search by recording or take name..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button
            type="button"
            className={`${styles.filterToggleBtn} ${hasActiveFilters ? styles.filterToggleBtnActive : ""}`}
            onClick={() => setShowFilters((s) => !s)}
          >
            Filters{" "}
            {hasActiveFilters
              ? `(${selectedAngles.length + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)})`
              : ""}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className={styles.filtersPanel}>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>From date</label>
            <input
              type="date"
              className={styles.filterInput}
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>To date</label>
            <input
              type="date"
              className={styles.filterInput}
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>View angles</label>
            <div className={styles.angleFilterOptions}>
              {AVAILABLE_ANGLES.map((angle) => (
                <button
                  key={angle}
                  type="button"
                  className={`${styles.angleFilterChip} ${
                    selectedAngles.includes(angle) ? styles.angleFilterChipActive : ""
                  }`}
                  onClick={() => toggleAngle(angle)}
                >
                  {angle}
                </button>
              ))}
            </div>
          </div>

          {hasActiveFilters && (
            <button type="button" className={styles.clearFiltersBtn} onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {deleteError && <p className={styles.errorText}>{deleteError}</p>}

      {loading && <p className={styles.statusText}>Loading takes…</p>}
      {!loading && error && <p className={styles.errorText}>{error}</p>}

      {!loading && !error && data && data.items.length === 0 && (
        <p className={styles.statusText}>
          {debouncedSearch || hasActiveFilters
            ? "No takes match your search/filters."
            : "No takes recorded yet."}
        </p>
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <>
          <div className={styles.grid}>
            {data.items.map((take) => {
              const isConfirming = confirmingTakeId === take.take_id;
              const isDeleting = deletingTakeId === take.take_id;

              return (
                <div
                  key={take.take_id}
                  className={styles.card}
                  onClick={() => !isConfirming && handleCardClick(take.take_id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (!isConfirming && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      handleCardClick(take.take_id);
                    }
                  }}
                >
                  <div className={styles.cardBody}>
                    <span className={styles.sessionPill}>
                      {take.session_name ?? "Unknown session"}
                    </span>
                    <span className={styles.cardDate}>{formatDate(take.recorded_at)}</span>
                  </div>

                  <div className={styles.cardFooter}>
                    <div className={styles.cardFooterTop}>
                      <p className={styles.takeName}>{take.name ?? "Untitled take"}</p>

                      {canDelete && !isConfirming && (
                        <button
                          type="button"
                          className={styles.deleteBtn}
                          onClick={(e) => handleDeleteClick(e, take.take_id)}
                          aria-label="Delete take"
                        >
                          Delete
                        </button>
                      )}
                    </div>

                    {isConfirming && (
                      <div className={styles.confirmRow}>
                        <span className={styles.confirmText}>Delete this take?</span>
                        <div className={styles.confirmActions}>
                          <button
                            type="button"
                            className={styles.confirmCancelBtn}
                            onClick={handleCancelDelete}
                            disabled={isDeleting}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className={styles.confirmDeleteBtn}
                            onClick={(e) => handleConfirmDelete(e, take.take_id)}
                            disabled={isDeleting}
                          >
                            {isDeleting ? "Deleting…" : "Confirm"}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className={styles.angleBadges}>
                      {take.angles.length > 0 ? (
                        take.angles.map((angle) => (
                          <span key={angle} className={styles.badge}>
                            {angle}
                          </span>
                        ))
                      ) : (
                        <span className={styles.badgeEmpty}>No angles</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.pagination}>
            <button
              type="button"
              className={styles.pageBtn}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </button>
            <span className={styles.pageInfo}>
              Page {data.page} of {data.total_pages || 1} · {data.total} takes
            </span>
            <button
              type="button"
              className={styles.pageBtn}
              onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
              disabled={page >= data.total_pages}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}