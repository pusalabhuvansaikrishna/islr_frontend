"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import styles from "./Clips.module.css";
import { BASE_URL } from "@/config/api";
import { PaginatedClips, TakeClips } from "./lib/types";
import { PAGE_SIZE, AVAILABLE_ANGLES, MAX_PREVIEW_BUBBLES, formatDate, clustersForTake } from "./lib/utils";
import ClipThumb from "./components/ClipThumb";

export default function ClipsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedAngles, setSelectedAngles] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const [page, setPage] = useState(1);
  const [data, setData] = useState<PaginatedClips | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const toggleAngle = (angle: string) => {
    setSelectedAngles((prev) => (prev.includes(angle) ? prev.filter((a) => a !== angle) : [...prev, angle]));
    setPage(1);
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setSelectedAngles([]);
    setPage(1);
  };

  const hasActiveFilters = Boolean(dateFrom || dateTo || selectedAngles.length > 0);

  const fetchClips = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (dateFrom) params.set("date_from", new Date(dateFrom).toISOString());
      if (dateTo) params.set("date_to", new Date(dateTo).toISOString());
      selectedAngles.forEach((angle) => params.append("angles", angle));

      const res = await fetch(`${BASE_URL}/clips?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load clips (${res.status})`);
      const json: PaginatedClips = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load clips");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, dateFrom, dateTo, selectedAngles]);

  useEffect(() => {
    fetchClips();
  }, [fetchClips]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>Clips</h2>
        <div className={styles.headerControls}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search by clip, take, or recording name..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <button
            type="button"
            className={`${styles.filterToggleBtn} ${hasActiveFilters ? styles.filterToggleBtnActive : ""}`}
            onClick={() => setShowFilters((s) => !s)}
          >
            Filters {hasActiveFilters ? `(${selectedAngles.length + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)})` : ""}
          </button>
        </div>
      </div>

      {showFilters && (
        <div className={styles.filtersPanel}>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>From date</label>
            <input type="date" className={styles.filterInput} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          </div>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>To date</label>
            <input type="date" className={styles.filterInput} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
          </div>
          <div className={styles.filterGroup}>
            <label className={styles.filterLabel}>View angle</label>
            <div className={styles.angleFilterOptions}>
              {AVAILABLE_ANGLES.map((angle) => (
                <button key={angle} type="button" className={`${styles.angleFilterChip} ${selectedAngles.includes(angle) ? styles.angleFilterChipActive : ""}`} onClick={() => toggleAngle(angle)}>
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

      {loading && <p className={styles.statusText}>Loading clips…</p>}
      {!loading && error && <p className={styles.errorText}>{error}</p>}
      {!loading && !error && data && data.items.length === 0 && (
        <p className={styles.statusText}>{debouncedSearch || hasActiveFilters ? "No takes match your search/filters." : "No clips created yet."}</p>
      )}

      {!loading && !error && data && data.items.length > 0 && (
        <>
          <div className={styles.takeGrid}>
            {data.items.map((take: TakeClips) => {
              const clusters = clustersForTake(take);
              const previewClusters = clusters.slice(0, MAX_PREVIEW_BUBBLES);
              const extraCount = clusters.length - previewClusters.length;

              return (
                <Link key={take.take_id} href={`/dashboard/videos/clips/${take.take_id}`} className={styles.takeCard}>
                  <div className={styles.takeCardHeader}>
                    <p className={styles.takeCardName}>{take.take_name ?? "Untitled take"}</p>
                    <p className={styles.takeCardMeta}>{[take.session_name, formatDate(take.recorded_at)].filter(Boolean).join(" · ")}</p>
                  </div>

                  <div className={styles.bubbleStack}>
                    {previewClusters.map((cluster, i) => {
                      const first = cluster.clips[0];
                      if (!first) return null;
                      const displayName = first.label || first.filename;
                      return (
                        <div
                          key={cluster.key}
                          className={styles.bubbleThumb}
                          style={{ zIndex: previewClusters.length - i, ...(cluster.color ? ({ ["--clip-color" as string]: cluster.color } as React.CSSProperties) : {}) }}
                        >
                          <ClipThumb videoUrl={`${BASE_URL}${first.video_url}`} alt={displayName} />
                        </div>
                      );
                    })}
                    {extraCount > 0 && <div className={styles.bubbleMore} style={{ zIndex: 0 }}>+{extraCount}</div>}
                    {clusters.length === 0 && <span className={styles.bubbleEmpty}>No clips</span>}
                  </div>

                  <div className={styles.takeCardFooter}>
                    <span className={styles.clusterCount}>{clusters.length} clip{clusters.length === 1 ? "" : "s"}</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <div className={styles.pagination}>
            <button type="button" className={styles.pageBtn} onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Previous
            </button>
            <span className={styles.pageInfo}>Page {data.page} of {data.total_pages || 1} · {data.total} takes</span>
            <button type="button" className={styles.pageBtn} onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))} disabled={page >= data.total_pages}>
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}