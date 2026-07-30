import { useEffect, useState } from "react";
import { CalendarClock, Play, Unplug } from "lucide-react";
import { api, type KpiSnapshot, type Kpi, type Routine } from "@/lib/api";
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { cn, timeAgo } from "@/lib/utils";

/**
 * Chart colours. Single-hue sequential throughout: every chart here has one
 * series and encodes magnitude by length, so identity colour is never needed.
 * Validated against the app's dark surface (#15181f) with the dataviz
 * validator: lightness band, chroma, contrast all pass.
 */
const ACCENT = "#3987e5";
const GRID = "#2c2c2a";
const MUTED = "#898781";

function compact(value: number, unit: "count" | "usd"): string {
  if (unit === "usd") {
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    if (value === 0) return "$0";
    if (value < 0.01) return `$${value.toFixed(4)}`;
    return `$${value.toFixed(2)}`;
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

function StatTile({ kpi, hero }: { kpi: Kpi; hero?: boolean }) {
  // Not-connected metrics say so rather than showing a zero that would read
  // as "no revenue" instead of "no payment integration".
  if (!kpi.connected) {
    return (
      <Card className="p-3">
        <p className="text-xs text-[var(--color-muted)]">{kpi.label}</p>
        <div className="mt-1.5 flex items-center gap-1.5 text-[var(--color-muted)]">
          <Unplug size={14} />
          <span className="text-sm">Not connected</span>
        </div>
        {kpi.hint !== undefined && (
          <p className="mt-1 text-[10px] leading-snug text-[var(--color-muted)]">{kpi.hint}</p>
        )}
      </Card>
    );
  }

  const value = kpi.value ?? 0;
  const prev = kpi.previous;
  const delta = prev === undefined || prev === null ? null : value - prev;
  // For spend, down is good; for everything else, up is good.
  const upIsGood = kpi.key !== "spend" && kpi.key !== "pending_approvals";
  const deltaGood = delta === null || delta === 0 ? null : delta > 0 === upIsGood;

  return (
    <Card className="p-3" title={kpi.hint}>
      <p className="text-xs text-[var(--color-muted)]">{kpi.label}</p>
      <p className={cn("mt-1 font-semibold", hero ? "text-4xl" : "text-2xl")}>
        {compact(value, kpi.unit)}
      </p>
      {delta !== null && delta !== 0 && (
        <p
          className="mt-0.5 text-[11px]"
          style={{ color: deltaGood === true ? "#0ca30c" : "#d03b3b" }}
        >
          {delta > 0 ? "↑" : "↓"} {compact(Math.abs(delta), kpi.unit)} vs previous period
        </p>
      )}
      {delta === 0 && (
        <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">no change</p>
      )}
    </Card>
  );
}

/** 14-day spend: one series, so no legend — the title names it. */
function SpendChart({ data }: { data: { date: string; usd: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-[var(--color-muted)]">
        No spend recorded yet.
      </p>
    );
  }

  const W = 640;
  const H = 150;
  const PAD = { top: 12, right: 12, bottom: 22, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(...data.map((d) => d.usd), 0.0001);
  // Cap the width so a day or two of history doesn't render as giant slabs.
  const barW = Math.min(46, Math.max(3, (plotW / data.length) * 0.62));
  const x = (i: number) => PAD.left + (plotW / data.length) * (i + 0.5);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

  const ticks = [0, max / 2, max];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Daily AI spend over the last 14 days"
        onMouseLeave={() => setHover(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke={GRID}
              strokeWidth={1}
            />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill={MUTED}
              style={{ fontVariantNumeric: "tabular-nums" }}>
              {t === 0 ? "$0" : max < 0.1 ? `$${t.toFixed(4)}` : `$${t.toFixed(2)}`}
            </text>
          </g>
        ))}

        {data.map((d, i) => (
          <g key={d.date}>
            {/* Hit target wider than the mark. */}
            <rect
              x={x(i) - plotW / data.length / 2}
              y={PAD.top}
              width={plotW / data.length}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
            <rect
              x={x(i) - barW / 2}
              y={y(d.usd)}
              width={barW}
              height={Math.max(1, PAD.top + plotH - y(d.usd))}
              rx={2}
              fill={ACCENT}
              opacity={hover === null || hover === i ? 1 : 0.45}
            />
          </g>
        ))}

        <line
          x1={PAD.left}
          x2={W - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="#383835"
          strokeWidth={1}
        />
        {data.map((d, i) =>
          i === 0 || i === data.length - 1 || i === Math.floor(data.length / 2) ? (
            <text
              key={d.date}
              x={x(i)}
              y={H - 6}
              textAnchor="middle"
              fontSize={9}
              fill={MUTED}
            >
              {d.date.slice(5)}
            </text>
          ) : null
        )}
      </svg>

      {hover !== null && data[hover] !== undefined && (
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] shadow-lg">
          <span className="text-[var(--color-muted)]">{data[hover].date}</span>{" "}
          <span className="font-medium tabular-nums">${data[hover].usd.toFixed(4)}</span>
        </div>
      )}
    </div>
  );
}

/** Horizontal bars, single hue, every bar directly labelled. */
function BarList({
  rows,
  format,
}: {
  rows: { label: string; value: number; note?: string }[];
  format: (v: number) => string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-xs text-[var(--color-muted)]">No data yet.</p>;
  }
  // Scale against the real maximum. A `Math.max(..., 1)` guard would act as a
  // floor and squash every sub-$1 value against a 1.0 scale.
  const rawMax = Math.max(...rows.map((r) => r.value), 0);
  const max = rawMax > 0 ? rawMax : 1;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="w-32 shrink-0 truncate text-[11px] text-[var(--color-muted)]">
            {r.label}
          </span>
          <div className="h-4 flex-1">
            <div
              className="h-full rounded-r-[3px]"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, backgroundColor: ACCENT }}
            />
          </div>
          <span className="w-16 shrink-0 text-right text-[11px] tabular-nums">
            {format(r.value)}
          </span>
          {r.note !== undefined && (
            <span className="w-14 shrink-0 text-right text-[10px] text-[var(--color-muted)]">
              {r.note}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Routines() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  async function load() {
    setRoutines(await api.routines());
  }
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, []);

  async function run(id: string) {
    setRunning(id);
    try {
      await api.runRoutine(id);
      await load();
    } catch {
      // surfaced by the routine's own last-run status
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="space-y-1.5">
      {routines.map((r) => (
        <div
          key={r.id}
          className="flex items-center gap-2 rounded-md border border-[var(--color-border)] p-2"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-medium">{r.name}</span>
              <Badge variant="outline">{r.cron}</Badge>
              {!r.enabled && <Badge variant="warn">scheduler off</Badge>}
              {r.lastRun !== null && (
                <Badge variant={r.lastRun.status === "completed" ? "ok" : r.lastRun.status === "failed" ? "danger" : "outline"}>
                  {r.lastRun.status} {timeAgo(r.lastRun.started_at)}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-[10px] text-[var(--color-muted)]">
              {r.description}
            </p>
          </div>
          <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
            {r.nextRun === null ? "—" : new Date(r.nextRun).toLocaleString()}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={running !== null}
            onClick={() => void run(r.id)}
          >
            {running === r.id ? <Spinner /> : <Play size={12} />} Run
          </Button>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const [snap, setSnap] = useState<KpiSnapshot | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await api.kpis(7);
        if (alive) setSnap(s);
      } catch {
        // keep the last good snapshot
      }
    };
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (snap === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-[var(--color-muted)]">
        <Spinner /> Loading dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Dashboard</h2>
        <span className="text-xs text-[var(--color-muted)]">last {snap.periodDays} days</span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {snap.kpis.map((k) => (
          <StatTile key={k.key} kpi={k} />
        ))}
      </div>

      <Card>
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-3">
          <h3 className="text-xs font-semibold">Daily AI spend</h3>
          <span className="text-[11px] text-[var(--color-muted)]">last 14 days</span>
        </div>
        <div className="p-3">
          <SpendChart data={snap.spendByDay} />
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <div className="border-b border-[var(--color-border)] p-3">
            <h3 className="text-xs font-semibold">Tasks by status</h3>
          </div>
          <div className="p-3">
            <BarList
              rows={snap.tasksByStatus.map((t) => ({ label: t.status, value: t.count }))}
              format={(v) => String(v)}
            />
          </div>
        </Card>

        <Card>
          <div className="border-b border-[var(--color-border)] p-3">
            <h3 className="text-xs font-semibold">Spend by agent</h3>
          </div>
          <div className="p-3">
            <BarList
              rows={snap.topAgents.map((a) => ({
                label: a.agentId,
                value: a.costUsd,
                note: `${a.runs} calls`,
              }))}
              format={(v) => `$${v.toFixed(4)}`}
            />
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-3">
          <CalendarClock size={14} className="text-[var(--color-muted)]" />
          <h3 className="text-xs font-semibold">Autonomous routines</h3>
          <span className="text-[11px] text-[var(--color-muted)]">
            set SCHEDULER_ENABLED=true in .env to run them on schedule
          </span>
        </div>
        <div className="p-3">
          <Routines />
        </div>
      </Card>
    </div>
  );
}
