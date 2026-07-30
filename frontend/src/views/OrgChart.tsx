import { useEffect, useState } from "react";
import { Shield, Wrench } from "lucide-react";
import { api, type Agent, type AgentStatus } from "@/lib/api";
import { Badge, Card, Spinner, EmptyState } from "@/components/ui";
import { cn, timeAgo } from "@/lib/utils";

const DEPARTMENTS: { key: string; label: string }[] = [
  { key: "executive", label: "Executive" },
  { key: "product", label: "Product & Tech" },
  { key: "marketing", label: "Marketing" },
  { key: "sales", label: "Sales & Customer" },
  { key: "ops", label: "Ops & Insight" },
];

function AgentCard({ agent, status }: { agent: Agent; status?: AgentStatus }) {
  const busy = status !== undefined;
  return (
    <Card
      className={cn(
        "p-3 transition-colors",
        busy && "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/5"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-block h-2 w-2 shrink-0 rounded-full",
                busy ? "animate-pulse bg-[var(--color-accent)]" : "bg-[var(--color-border)]"
              )}
            />
            <span className="truncate text-sm font-medium">{agent.name}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">{agent.role}</p>
        </div>
        {agent.requiresApproval.length > 0 && (
          <Shield size={13} className="mt-1 shrink-0 text-[var(--color-warn)]" />
        )}
      </div>

      {busy && (
        <p className="mt-2 line-clamp-2 text-[11px] text-[var(--color-accent)]">
          {status.activity === "reviewing" ? "Reviewing" : "Working"}
          {status.detail !== undefined ? `: ${status.detail}` : ""} · {timeAgo(status.since)}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Badge variant="outline">→ {agent.reportsTo}</Badge>
        {agent.tools.length > 0 && (
          <Badge variant="outline" title={agent.tools.join(", ")}>
            <Wrench size={9} className="mr-1" />
            {agent.tools.length}
          </Badge>
        )}
        {agent.requiresApproval.map((a) => (
          <Badge key={a} variant="warn">
            {a}
          </Badge>
        ))}
      </div>
    </Card>
  );
}

export function OrgChart() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [statuses, setStatuses] = useState<AgentStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void api.agents().then((a) => {
      if (alive) {
        setAgents(a);
        setLoading(false);
      }
    });
    const poll = async () => {
      try {
        const s = await api.agentStatuses();
        if (alive) setStatuses(s);
      } catch {
        // A transient poll failure shouldn't blank the chart.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const byId = new Map(statuses.map((s) => [s.agentId, s]));
  const working = statuses.length;

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-[var(--color-muted)]">
        <Spinner /> Loading org chart…
      </div>
    );
  }
  if (agents.length === 0) {
    return <EmptyState title="No agents loaded" hint="Check that /agents/*.json files exist." />;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Org chart</h2>
        <Badge variant={working > 0 ? "accent" : "outline"}>
          {working > 0 ? `${working} agent${working === 1 ? "" : "s"} active` : "all idle"}
        </Badge>
        <span className="text-xs text-[var(--color-muted)]">{agents.length} agents · live</span>
      </div>

      {DEPARTMENTS.map((dept) => {
        const members = agents.filter((a) => a.department === dept.key);
        if (members.length === 0) return null;
        return (
          <div key={dept.key}>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
              {dept.label}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {members.map((agent) => (
                <AgentCard key={agent.id} agent={agent} status={byId.get(agent.id)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
