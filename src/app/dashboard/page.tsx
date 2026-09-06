"use client";

import { useEffect, useState } from "react";
import styles from "./page.module.css";
import { BASE_URL } from "@/config/api";

type ViewAngleRow = { view_angle: string; count: number; percentage: number };
type OrgRow = { organization: string | null; count: number };
type SignPersonRow = { sign_person: string; sessions: number; takes: number; clips: number };
type EditorRow = { user_id: string; name: string; clip_count: number };

type DashboardData = {
  total_takes: number;
  total_transcriptions_take: number;
  total_clips: number;
  total_transcriptions_clip: number;
  memory_bytes: {
    takes: number;
    transcriptions_take: number;
    transcriptions_clip: number;
    clips: number;
  };
  sessions_per_organization: OrgRow[];
  sign_person_productivity: SignPersonRow[];
  view_angle_breakdown: ViewAngleRow[];
  avg_clips_per_take: number;
  avg_clip_duration_seconds: number;
  clips_by_editor: EditorRow[];
};

const CHART_PALETTE = [
  "#2dd4bf", // teal
  "#818cf8", // indigo
  "#fb923c", // orange
  "#f472b6", // pink
  "#facc15", // yellow
  "#60a5fa", // blue
];

function formatBytes(bytes: number): string {
  if (!bytes) return "0 GB";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  return `${seconds.toFixed(1)}s`;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0] + parts[parts.length - 1]![0]).toUpperCase();
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (startDate) params.set("start_date", startDate);
        if (endDate) params.set("end_date", endDate);

        const res = await fetch(
          `${BASE_URL}/analytics/dashboard${params.toString() ? `?${params}` : ""}`,
          { credentials: "include", signal: controller.signal }
        );

        if (res.status === 403) {
          throw new Error("You don't have permission to view this dashboard.");
        }
        if (!res.ok) {
          throw new Error("Couldn't load dashboard data. Try again.");
        }

        setData(await res.json());
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [startDate, endDate]);

  return (
    <div className={styles.dashboardTop}>
      <div className={styles.filterBar}>
        <h1 className={styles.pageTitle}>Dashboard</h1>
        <div className={styles.dateFilters}>
          <label className={styles.dateField}>
            <span>From</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={styles.dateInput}
            />
          </label>
          <label className={styles.dateField}>
            <span>To</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={styles.dateInput}
            />
          </label>
        </div>
      </div>

      {loading && <p className={styles.statusText}>Loading dashboard…</p>}
      {error && <p className={styles.error}>{error}</p>}

      {data && (
        <>
          {/* Hero row: raw totals + the two derived editing metrics, all together */}
          <div className={styles.heroRow}>
            <StatTile label="Takes" value={data.total_takes} />
            <StatTile label="Transcriptions (Take)" value={data.total_transcriptions_take} />
            <StatTile label="Clips" value={data.total_clips} />
            <StatTile label="Transcriptions (Clip)" value={data.total_transcriptions_clip} />
            <StatTile label="Avg. clips / take" value={data.avg_clips_per_take.toFixed(1)} />
            <StatTile
              label="Avg. clip duration"
              value={formatDuration(data.avg_clip_duration_seconds)}
            />
          </div>

          {/* Storage footprint + View angle coverage side by side — both
              charts are naturally compact, so pairing them stops either
              one from stretching across a full-width card. */}
          <div className={styles.twoCol}>
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>Storage footprint</h2>
              <StorageStackedBar memory={data.memory_bytes} />
            </section>

            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>View angle coverage</h2>
              {data.view_angle_breakdown.length === 0 ? (
                <p className={styles.statusText}>No raw videos in this range.</p>
              ) : (
                <ViewAngleDonutChart rows={data.view_angle_breakdown} />
              )}
            </section>
          </div>

          <div className={styles.twoCol}>
            {/* Recording session by organizations */}
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>Recording session by Organizations</h2>
              {data.sessions_per_organization.length === 0 ? (
                <p className={styles.statusText}>No sessions in this range.</p>
              ) : (
                <OrgVerticalBarChart rows={data.sessions_per_organization} />
              )}
            </section>

            {/* Sign person productivity */}
            <section className={styles.card}>
              <h2 className={styles.sectionTitle}>Sign person productivity</h2>
              {data.sign_person_productivity.length === 0 ? (
                <p className={styles.statusText}>No data in this range.</p>
              ) : (
                <SignPersonTable rows={data.sign_person_productivity} />
              )}
            </section>
          </div>

          {/* Clips by editor — full width now, so the ranked bars have
              room to breathe instead of being squeezed next to stat tiles. */}
          <section className={styles.card}>
            <h2 className={styles.sectionTitle}>Clips by editor</h2>
            {data.clips_by_editor.length === 0 ? (
              <p className={styles.statusText}>No clips in this range.</p>
            ) : (
              <EditorHorizontalBarChart rows={data.clips_by_editor} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className={styles.statTile}>
      <p className={styles.statValue}>{value}</p>
      <p className={styles.statLabel}>{label}</p>
    </div>
  );
}

/* Storage footprint — compact stacked bar + legend, distinct palette colors */
function StorageStackedBar({
  memory,
}: {
  memory: DashboardData["memory_bytes"];
}) {
  const segments = [
    { key: "takes", label: "Raw Files", bytes: memory.takes },
    { key: "transcriptions_take", label: "Transcriptions", bytes: memory.transcriptions_take },
    { key: "clips", label: "Clips", bytes: memory.clips },
    { key: "transcriptions_clip", label: "Transcriptions (Clips)", bytes: memory.transcriptions_clip },
  ];
  const total = segments.reduce((sum, s) => sum + s.bytes, 0) || 1;
  const visible = segments.filter((s) => s.bytes > 0);

  return (
    <div className={styles.storageChart}>
      <div className={styles.storageStackBar}>
        {segments.map((s, idx) => {
          const pct = (s.bytes / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={s.key}
              className={styles.storageSegment}
              style={{ width: `${pct}%`, background: CHART_PALETTE[idx % CHART_PALETTE.length] }}
              title={`${s.label}: ${formatBytes(s.bytes)} (${pct.toFixed(1)}%)`}
            />
          );
        })}
      </div>
      <div className={styles.storageLegend}>
        {(visible.length > 0 ? visible : segments).map((s) => {
          const idx = segments.indexOf(s);
          const pct = (s.bytes / total) * 100;
          return (
            <div key={s.key} className={styles.storageLegendItem}>
              <span
                className={styles.storageLegendSwatch}
                style={{ background: CHART_PALETTE[idx % CHART_PALETTE.length] }}
              />
              <span className={styles.storageLegendLabel}>{s.label}</span>
              <span className={styles.storageLegendValue}>
                {formatBytes(s.bytes)} · {pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Sessions by organization — scrollable vertical bar chart */
function OrgVerticalBarChart({ rows }: { rows: OrgRow[] }) {
  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div className={styles.vBarScrollOuter}>
      <div className={styles.vBarScroll}>
        {rows.map((row) => {
          const key = row.organization ?? "unassigned";
          const heightPct = (row.count / max) * 100;
          return (
            <div key={key} className={styles.vBarItem}>
              <span className={styles.vBarValue}>{row.count}</span>
              <div className={styles.vBarTrack}>
                <div
                  className={styles.vBarFill}
                  style={{ height: `${heightPct}%` }}
                />
              </div>
              <span className={styles.vBarLabel} title={row.organization ?? "Unassigned"}>
                {row.organization ?? "Unassigned"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* Sign person productivity — searchable, sortable data table */
type SignPersonSortKey = "sign_person" | "sessions" | "takes" | "clips";

function SignPersonTable({ rows }: { rows: SignPersonRow[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SignPersonSortKey>("sign_person");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function handleSort(key: SignPersonSortKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "sign_person" ? "asc" : "desc");
    }
  }

  const filtered = rows.filter((row) =>
    row.sign_person.toLowerCase().includes(query.trim().toLowerCase())
  );

  const sorted = filtered.slice().sort((a, b) => {
    let cmp: number;
    if (sortKey === "sign_person") {
      cmp = a.sign_person.localeCompare(b.sign_person);
    } else {
      cmp = a[sortKey] - b[sortKey];
    }
    return sortDir === "asc" ? cmp : -cmp;
  });

  const columns: { key: SignPersonSortKey; label: string }[] = [
    { key: "sign_person", label: "Sign person" },
    { key: "sessions", label: "Sessions" },
    { key: "takes", label: "Takes" },
    { key: "clips", label: "Clips" },
  ];

  return (
    <div>
      <div className={styles.searchBar}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sign person…"
          className={styles.searchInput}
        />
      </div>

      {sorted.length === 0 ? (
        <p className={styles.statusText}>No matches for &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className={styles.dataTable}>
          <div className={`${styles.dataRow} ${styles.dataRowHead}`}>
            {columns.map((col) => (
              <span
                key={col.key}
                className={styles.sortableHeader}
                onClick={() => handleSort(col.key)}
              >
                {col.label}
                <span className={styles.sortIndicator}>
                  {sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                </span>
              </span>
            ))}
          </div>
          {sorted.map((row) => (
            <div key={row.sign_person} className={styles.dataRow}>
              <span>{row.sign_person}</span>
              <span className={styles.dataValue}>{row.sessions}</span>
              <span className={styles.dataValue}>{row.takes}</span>
              <span className={styles.dataValue}>{row.clips}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* View angle coverage — compact donut chart, distinct palette colors */
function ViewAngleDonutChart({ rows }: { rows: ViewAngleRow[] }) {
  const total = rows.reduce((sum, r) => sum + r.count, 0) || 1;

  let cumulative = 0;
  const stops = rows
    .map((row, idx) => {
      const color = CHART_PALETTE[idx % CHART_PALETTE.length];
      const start = (cumulative / total) * 100;
      cumulative += row.count;
      const end = (cumulative / total) * 100;
      return `${color} ${start}% ${end}%`;
    })
    .join(", ");

  return (
    <div className={styles.donutChart}>
      <div
        className={styles.donutRing}
        style={{ background: `conic-gradient(${stops})` }}
      >
        <div className={styles.donutHole}>
          <span className={styles.donutTotal}>{total}</span>
          <span className={styles.donutTotalLabel}>videos</span>
        </div>
      </div>
      <div className={styles.donutLegend}>
        {rows.map((row, idx) => (
          <div key={row.view_angle} className={styles.donutLegendItem}>
            <span
              className={styles.donutLegendSwatch}
              style={{ background: CHART_PALETTE[idx % CHART_PALETTE.length] }}
            />
            <span className={styles.donutLegendLabel} title={row.view_angle}>
              {row.view_angle}
            </span>
            <span className={styles.donutLegendValue}>
              {row.count} · {row.percentage}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Clips by editor — F1-style horizontal bar chart with avatar icons.       */
/* Colors are drawn only from the app's own accent variable (shaded by      */
/* rank) so it stays on-palette instead of introducing new hues.            */
function EditorHorizontalBarChart({ rows }: { rows: EditorRow[] }) {
  const [query, setQuery] = useState("");

  const sorted = rows.slice().sort((a, b) => b.clip_count - a.clip_count);
  const max = Math.max(...sorted.map((r) => r.clip_count), 1);

  // Rank reflects each editor's position in the full ranking, not their
  // position within the filtered results, so a search doesn't relabel
  // everyone as if the leaderboard shrank.
  const rankByUserId = new Map(sorted.map((row, idx) => [row.user_id, idx + 1]));

  const filtered = sorted.filter((row) =>
    row.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div>
      <div className={styles.searchBar}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search editor…"
          className={styles.searchInput}
        />
      </div>

      {filtered.length === 0 ? (
        <p className={styles.statusText}>No matches for &ldquo;{query}&rdquo;.</p>
      ) : (
        <div className={styles.editorChart}>
          {filtered.map((row) => {
            const rank = rankByUserId.get(row.user_id) ?? 1;
            const widthPct = (row.clip_count / max) * 100;
            const shade = Math.max(1 - (rank - 1) * 0.12, 0.45);
            return (
              <div key={row.user_id} className={styles.editorRow}>
                <span className={styles.editorRank}>{rank}</span>
                <div className={styles.editorAvatar} style={{ opacity: shade }}>
                  {getInitials(row.name)}
                </div>
                <span className={styles.editorName} title={row.name}>
                  {row.name}
                </span>
                <div className={styles.editorTrack}>
                  <div
                    className={styles.editorFill}
                    style={{ width: `${widthPct}%`, opacity: shade }}
                  />
                </div>
                <span className={styles.editorValue}>{row.clip_count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}