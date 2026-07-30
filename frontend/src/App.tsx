import { useCallback, useEffect, useState } from "react";
import {
  Gauge,
  Inbox,
  LayoutGrid,
  MessageSquare,
  Network,
  Power,
  ScrollText,
} from "lucide-react";
import { api, type Budget, type Status } from "@/lib/api";
import { Badge, Button, Spinner } from "@/components/ui";
import { cn, money } from "@/lib/utils";
import { Approvals } from "@/views/Approvals";
import { AuditLog } from "@/views/AuditLog";
import { Chat } from "@/views/Chat";
import { Dashboard } from "@/views/Dashboard";
import { OrgChart } from "@/views/OrgChart";
import { TaskBoard } from "@/views/TaskBoard";

type Tab = "dashboard" | "chat" | "org" | "tasks" | "approvals" | "audit";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "dashboard", label: "Dashboard", icon: <Gauge size={15} /> },
  { key: "chat", label: "Chat", icon: <MessageSquare size={15} /> },
  { key: "org", label: "Org chart", icon: <Network size={15} /> },
  { key: "tasks", label: "Tasks", icon: <LayoutGrid size={15} /> },
  { key: "approvals", label: "Inbox", icon: <Inbox size={15} /> },
  { key: "audit", label: "Audit", icon: <ScrollText size={15} /> },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [status, setStatus] = useState<Status | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, b] = await Promise.all([api.status(), api.budget()]);
        if (alive) {
          setStatus(s);
          setBudget(b);
          setError(null);
        }
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refreshKey]);

  async function toggleKill() {
    if (status === null) return;
    const next = !status.killSwitchEngaged;
    if (next && !confirm("Halt every agent immediately?")) return;
    await api.setKillSwitch(next, next ? "engaged from the dashboard" : "");
    refresh();
  }

  const killed = status?.killSwitchEngaged === true;

  return (
    <div className="flex h-full flex-col">
      {killed && (
        <div className="flex items-center justify-center gap-2 bg-[var(--color-danger)] px-4 py-1.5 text-xs font-medium text-black">
          <Power size={13} /> KILL SWITCH ENGAGED — every agent is halted
        </div>
      )}

      <header className="flex items-center gap-4 border-b border-[var(--color-border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-[var(--color-accent)] text-[11px] font-bold text-black">
            AC
          </div>
          <span className="text-sm font-semibold">AgentCorp</span>
        </div>

        <nav className="flex items-center gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                tab === t.key
                  ? "bg-[var(--color-surface-2)] text-[var(--color-fg)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
              )}
            >
              {t.icon}
              {t.label}
              {t.key === "approvals" &&
                status !== null &&
                status.pendingApprovals > 0 && (
                  <Badge variant="warn">{status.pendingApprovals}</Badge>
                )}
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-xs">
          {status === null ? (
            <Spinner />
          ) : (
            <>
              <span className="text-[var(--color-muted)]">
                {status.agentsLoaded} agents · {status.documentsIndexed} docs
              </span>
              {budget !== null && (
                <span
                  className={cn(
                    "tabular-nums",
                    budget.alertThresholdReached
                      ? "text-[var(--color-warn)]"
                      : "text-[var(--color-muted)]"
                  )}
                  title={`${(budget.percentUsed * 100).toFixed(1)}% of today's budget`}
                >
                  {money(budget.dailySpendUsd)} / {money(budget.dailyBudgetUsd)}
                </span>
              )}
              <Button
                size="sm"
                variant={killed ? "ok" : "outline"}
                onClick={() => void toggleKill()}
                title={killed ? "Release the kill switch" : "Halt all agents immediately"}
              >
                <Power size={13} />
                {killed ? "Resume" : "Kill"}
              </Button>
            </>
          )}
        </div>
      </header>

      {error !== null && (
        <div className="border-b border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-1.5 text-xs text-[var(--color-danger)]">
          API unreachable: {error}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-hidden">
        {tab === "dashboard" && (
          <div className="h-full overflow-y-auto">
            <Dashboard />
          </div>
        )}
        {tab === "chat" && <Chat onGoalCreated={refresh} />}
        {tab === "org" && (
          <div className="h-full overflow-y-auto">
            <OrgChart />
          </div>
        )}
        {tab === "tasks" && <TaskBoard refreshKey={refreshKey} />}
        {tab === "approvals" && (
          <div className="h-full overflow-y-auto">
            <Approvals onChange={refresh} />
          </div>
        )}
        {tab === "audit" && (
          <div className="h-full overflow-y-auto">
            <AuditLog />
          </div>
        )}
      </main>
    </div>
  );
}
