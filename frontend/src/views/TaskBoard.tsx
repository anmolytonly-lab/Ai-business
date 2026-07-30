import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { api, type Goal, type Task } from "@/lib/api";
import { Badge, Button, Card, EmptyState, Input, Spinner, statusVariant } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

const COLUMNS = [
  { key: "pending", label: "Pending", match: ["pending"] },
  { key: "running", label: "In progress", match: ["running", "in_review", "revising"] },
  { key: "completed", label: "Completed", match: ["completed"] },
  { key: "attention", label: "Needs attention", match: ["escalated", "failed", "blocked"] },
];

function TaskCard({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const deps = JSON.parse(task.depends_on) as string[];
  return (
    <Card className="p-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-1.5 text-left"
      >
        {open ? (
          <ChevronDown size={13} className="mt-0.5 shrink-0 text-[var(--color-muted)]" />
        ) : (
          <ChevronRight size={13} className="mt-0.5 shrink-0 text-[var(--color-muted)]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Badge variant="accent">{task.agent_id}</Badge>
            {task.revision_round > 0 && (
              <Badge variant="warn">rev {task.revision_round}</Badge>
            )}
          </div>
          <p className={`mt-1 text-xs leading-snug ${open ? "" : "line-clamp-2"}`}>
            {task.instruction}
          </p>
        </div>
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-[var(--color-border)] pt-2">
          {task.acceptance_criteria !== null && (
            <div>
              <p className="text-[10px] font-medium uppercase text-[var(--color-muted)]">
                Acceptance criteria
              </p>
              <p className="text-xs text-[var(--color-muted)]">{task.acceptance_criteria}</p>
            </div>
          )}
          {deps.length > 0 && (
            <p className="text-[11px] text-[var(--color-muted)]">
              Depends on: {deps.map((d) => d.split("-").pop()).join(", ")}
            </p>
          )}
          {task.result !== null && (
            <div>
              <p className="text-[10px] font-medium uppercase text-[var(--color-muted)]">Result</p>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-bg)] p-2 text-[11px] leading-relaxed">
                {task.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function TaskBoard({ refreshKey }: { refreshKey: number }) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goalDetail, setGoalDetail] = useState<Goal | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const g = await api.goals();
        if (!alive) return;
        setGoals(g);
        setLoading(false);
        setSelected((cur) => cur ?? g[0]?.id ?? null);
      } catch {
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refreshKey]);

  useEffect(() => {
    if (selected === null) return;
    let alive = true;
    const load = async () => {
      try {
        const detail = await api.goal(selected);
        if (alive) {
          setTasks(detail.tasks);
          setGoalDetail(detail);
        }
      } catch {
        // keep showing the last good state
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [selected, refreshKey]);

  async function create() {
    const description = draft.trim();
    if (description === "") return;
    setDraft("");
    const { goalId } = await api.createGoal(description);
    setGoals(await api.goals());
    setSelected(goalId);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-[var(--color-muted)]">
        <Spinner /> Loading tasks…
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="w-72 shrink-0 overflow-y-auto border-r border-[var(--color-border)] p-3">
        <div className="mb-3 flex gap-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            placeholder="New goal…"
            className="h-8 text-xs"
          />
          <Button size="sm" onClick={() => void create()} disabled={draft.trim() === ""}>
            <Plus size={13} />
          </Button>
        </div>

        {goals.length === 0 ? (
          <p className="px-1 py-4 text-xs text-[var(--color-muted)]">
            No goals yet. Create one above or ask the CEO in Chat.
          </p>
        ) : (
          <div className="space-y-1">
            {goals.map((g) => (
              <button
                key={g.id}
                onClick={() => setSelected(g.id)}
                className={`w-full rounded-md p-2 text-left transition-colors ${
                  selected === g.id
                    ? "bg-[var(--color-surface-2)]"
                    : "hover:bg-[var(--color-surface)]"
                }`}
              >
                <p className="line-clamp-2 text-xs leading-snug">{g.description}</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <Badge variant={statusVariant(g.status)}>{g.status}</Badge>
                  <span className="text-[10px] text-[var(--color-muted)]">
                    {timeAgo(g.created_at)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </aside>

      <div className="flex-1 overflow-y-auto p-4">
        {selected === null ? (
          <EmptyState title="Select a goal" hint="Pick one on the left to see its task DAG." />
        ) : (
          <>
            {goalDetail?.report !== null && goalDetail?.report !== undefined && (
              <Card className="mb-4 p-3">
                <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--color-muted)]">
                  {goalDetail.report}
                </pre>
              </Card>
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {COLUMNS.map((col) => {
                const items = tasks.filter((t) => col.match.includes(t.status));
                return (
                  <div key={col.key}>
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                        {col.label}
                      </h3>
                      <Badge variant="outline">{items.length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {items.map((t) => (
                        <TaskCard key={t.id} task={t} />
                      ))}
                      {items.length === 0 && (
                        <div className="rounded-md border border-dashed border-[var(--color-border)] p-3 text-center text-[11px] text-[var(--color-muted)]">
                          none
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
