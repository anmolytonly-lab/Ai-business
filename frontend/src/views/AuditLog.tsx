import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ScrollText } from "lucide-react";
import { api, type AuditRow } from "@/lib/api";
import { Badge, Card, EmptyState, Input, Spinner, type BadgeProps } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

function eventVariant(type: string): BadgeProps["variant"] {
  if (type.includes("failed") || type.includes("denied") || type.includes("violation")) return "danger";
  if (
    type.includes("escalated") ||
    type.includes("revise") ||
    type.includes("flagged") ||
    type.includes("alert") ||
    type.includes("kill_switch") ||
    type.includes("budget")
  )
    return "warn";
  if (type.includes("completed") || type.includes("approved") || type.includes("clear")) return "ok";
  return "accent";
}

function Row({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[var(--color-border)] last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-2)]"
      >
        {open ? (
          <ChevronDown size={12} className="shrink-0 text-[var(--color-muted)]" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-[var(--color-muted)]" />
        )}
        <Badge variant={eventVariant(row.event_type)}>{row.event_type}</Badge>
        {row.agent_id !== null && (
          <span className="shrink-0 text-[11px] text-[var(--color-muted)]">{row.agent_id}</span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--color-muted)]">
          {JSON.stringify(row.detail)}
        </span>
        <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
          {timeAgo(row.created_at)}
        </span>
      </button>
      {open && (
        <pre className="overflow-auto bg-[var(--color-bg)] px-9 py-2 text-[11px] leading-relaxed">
          {JSON.stringify(row.detail, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function AuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await api.audit(200);
        if (alive) {
          setRows(r);
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q === "") return rows;
    return rows.filter(
      (r) =>
        r.event_type.toLowerCase().includes(q) ||
        (r.agent_id ?? "").toLowerCase().includes(q) ||
        JSON.stringify(r.detail).toLowerCase().includes(q)
    );
  }, [rows, filter]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-[var(--color-muted)]">
        <Spinner /> Loading audit log…
      </div>
    );
  }

  return (
    <div className="space-y-3 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Audit log</h2>
        <Badge variant="outline">{filtered.length} events</Badge>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by event, agent or content…"
          className="ml-auto h-8 max-w-sm text-xs"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ScrollText size={28} />}
          title={rows.length === 0 ? "No events yet" : "No events match that filter"}
          hint={rows.length === 0 ? "Every prompt, tool call, approval and cost lands here." : undefined}
        />
      ) : (
        <Card className="overflow-hidden">
          {filtered.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </Card>
      )}
    </div>
  );
}
