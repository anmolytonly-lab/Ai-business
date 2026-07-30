import { useEffect, useState } from "react";
import { Building2, CheckCircle2, Plug, Plus, Unplug } from "lucide-react";
import {
  api,
  getWorkspaceId,
  setWorkspaceId,
  type Integration,
  type Workspace,
} from "@/lib/api";
import { Badge, Button, Card, Input, Spinner } from "@/components/ui";
import { money } from "@/lib/utils";

function Integrations() {
  const [items, setItems] = useState<Integration[]>([]);
  const [tested, setTested] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    void api.integrations().then(setItems);
  }, []);

  async function test(id: string) {
    setBusy(id);
    try {
      const r = await api.testIntegration(id);
      setTested((t) => ({ ...t, [id]: r.message }));
    } finally {
      setBusy(null);
    }
  }

  const configured = items.filter((i) => i.configured).length;

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-3">
        <Plug size={14} className="text-[var(--color-muted)]" />
        <h3 className="text-xs font-semibold">Integrations</h3>
        <Badge variant={configured > 0 ? "ok" : "outline"}>
          {configured} of {items.length} configured
        </Badge>
        <span className="text-[11px] text-[var(--color-muted)]">
          the system runs fully with all of them off
        </span>
      </div>
      <div className="divide-y divide-[var(--color-border)]">
        {items.map((i) => (
          <div key={i.id} className="p-3">
            <div className="flex items-center gap-2">
              {i.configured ? (
                <CheckCircle2 size={13} className="text-[var(--color-ok)]" />
              ) : (
                <Unplug size={13} className="text-[var(--color-muted)]" />
              )}
              <span className="text-xs font-medium">{i.name}</span>
              <Badge variant="outline">{i.category}</Badge>
              {i.capabilities.map((c) => (
                <Badge key={c} variant="outline">
                  {c}
                </Badge>
              ))}
              <Badge variant={i.configured ? "ok" : "warn"}>
                {i.configured ? "credentials set" : "stub"}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={busy !== null}
                onClick={() => void test(i.id)}
              >
                {busy === i.id ? <Spinner /> : "Test"}
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-[var(--color-muted)]">{i.description}</p>
            <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
              Needs:{" "}
              {i.requiredEnv.map((key, idx) => (
                <span key={key}>
                  {idx > 0 && ", "}
                  <code className="rounded bg-[var(--color-bg)] px-1">{key}</code>
                </span>
              ))}
            </p>
            {tested[i.id] !== undefined && (
              <p className="mt-1.5 rounded bg-[var(--color-bg)] p-2 text-[11px] text-[var(--color-muted)]">
                {tested[i.id]}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Workspaces({ onSwitch }: { onSwitch: () => void }) {
  const [items, setItems] = useState<Workspace[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ id: "", name: "", description: "", budget: "" });
  const [error, setError] = useState<string | null>(null);
  const current = getWorkspaceId();

  async function load() {
    setItems(await api.workspaces());
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setError(null);
    try {
      await api.createWorkspace({
        id: form.id.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        dailyBudgetUsd: form.budget === "" ? null : Number(form.budget),
      });
      setForm({ id: "", name: "", description: "", budget: "" });
      setCreating(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function switchTo(id: string) {
    setWorkspaceId(id);
    onSwitch();
  }

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-3">
        <Building2 size={14} className="text-[var(--color-muted)]" />
        <h3 className="text-xs font-semibold">Workspaces</h3>
        <span className="text-[11px] text-[var(--color-muted)]">
          each client has its own knowledge base, goals, approvals and budget
        </span>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setCreating((v) => !v)}>
          <Plus size={13} /> New
        </Button>
      </div>

      {creating && (
        <div className="space-y-2 border-b border-[var(--color-border)] p-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <Input
              placeholder="id (e.g. acme-co)"
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
            />
            <Input
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Input
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <Input
              placeholder="Daily budget USD (optional)"
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
            />
          </div>
          {error !== null && <p className="text-[11px] text-[var(--color-danger)]">{error}</p>}
          <Button size="sm" onClick={() => void create()} disabled={form.id === "" || form.name === ""}>
            Create workspace
          </Button>
        </div>
      )}

      <div className="divide-y divide-[var(--color-border)]">
        {items.map((w) => (
          <div key={w.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{w.name}</span>
                <Badge variant="outline">{w.id}</Badge>
                {w.id === current && <Badge variant="accent">current</Badge>}
                {w.archived === 1 && <Badge variant="warn">archived</Badge>}
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
                {w.description || "No description"} · {w.goals} goals · {w.documents} docs ·{" "}
                {money(w.spendTodayUsd)} today
                {w.daily_budget_usd !== null && ` of ${money(w.daily_budget_usd)} cap`}
              </p>
            </div>
            <Button
              size="sm"
              variant={w.id === current ? "secondary" : "outline"}
              disabled={w.id === current}
              onClick={() => switchTo(w.id)}
            >
              {w.id === current ? "Active" : "Switch"}
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function Settings({ onSwitch }: { onSwitch: () => void }) {
  return (
    <div className="space-y-4 p-6">
      <h2 className="text-sm font-semibold">Settings</h2>
      <Workspaces onSwitch={onSwitch} />
      <Integrations />
    </div>
  );
}
