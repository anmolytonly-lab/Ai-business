import { useEffect, useState } from "react";
import { Plug, Plus, Save, Trash2, Wrench } from "lucide-react";
import { api, type Agent, type AgentFull, type Integration } from "@/lib/api";
import { Badge, Button, Card, Input, Spinner, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

const DEPARTMENTS = ["executive", "product", "marketing", "sales", "ops"] as const;
const APPROVAL_ACTIONS = [
  "publish",
  "send_email",
  "send_dm",
  "send_proposal",
  "deploy",
  "spend",
  "legal_text",
];

const BLANK: AgentFull = {
  id: "",
  name: "",
  department: "ops",
  role: "",
  systemPrompt: "",
  tools: [],
  reportsTo: "coo",
  canDelegateTo: [],
  model: "gemini-2.5-flash",
  temperature: 0.5,
  maxCostPerTask: 0.2,
  requiresApproval: [],
};

function Chips({
  options,
  selected,
  onToggle,
  titleFor,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  titleFor?: (v: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            title={titleFor?.(o)}
            onClick={() => onToggle(o)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              on
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[11px] font-medium text-[var(--color-muted)]">{label}</label>
      {hint !== undefined && (
        <p className="mb-1 text-[10px] text-[var(--color-muted)]">{hint}</p>
      )}
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function AgentBuilder() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tools, setTools] = useState<{ name: string; description: string; external: boolean }[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentFull | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function loadList() {
    const [a, t, i] = await Promise.all([api.agents(), api.tools(), api.integrations()]);
    setAgents(a);
    setTools(t.tools);
    setIntegrations(i);
  }

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    if (selected === null) return;
    setCreating(false);
    setMessage(null);
    void api.agentFull(selected).then(setDraft);
  }, [selected]);

  function startNew() {
    setSelected(null);
    setCreating(true);
    setDraft({ ...BLANK });
    setMessage(null);
  }

  async function save() {
    if (draft === null) return;
    setBusy(true);
    setMessage(null);
    try {
      if (creating) {
        await api.createAgent(draft);
        setCreating(false);
        setSelected(draft.id);
      } else {
        await api.saveAgent(draft.id, draft);
      }
      await loadList();
      setMessage({ kind: "ok", text: "Saved to agents/" + draft.id + ".json — registry reloaded." });
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (draft === null || creating) return;
    if (!confirm(`Delete agents/${draft.id}.json? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.deleteAgent(draft.id);
      setDraft(null);
      setSelected(null);
      await loadList();
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof AgentFull>(key: K, value: AgentFull[K]) =>
    setDraft((d) => (d === null ? d : { ...d, [key]: value }));
  const toggle = (key: "tools" | "canDelegateTo" | "requiresApproval", value: string) =>
    setDraft((d) =>
      d === null
        ? d
        : {
            ...d,
            [key]: d[key].includes(value)
              ? d[key].filter((v) => v !== value)
              : [...d[key], value],
          }
    );

  const toolDescription = (name: string): string =>
    tools.find((t) => t.name === name)?.description ?? "";

  return (
    <div className="flex h-full">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-[var(--color-border)] p-3">
        <Button size="sm" className="mb-3 w-full" onClick={startNew}>
          <Plus size={13} /> New agent
        </Button>
        {DEPARTMENTS.map((dept) => {
          const members = agents.filter((a) => a.department === dept);
          if (members.length === 0) return null;
          return (
            <div key={dept} className="mb-3">
              <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                {dept}
              </p>
              {members.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setSelected(a.id)}
                  className={cn(
                    "w-full truncate rounded px-2 py-1 text-left text-xs transition-colors",
                    selected === a.id
                      ? "bg-[var(--color-surface-2)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                  )}
                >
                  {a.name}
                </button>
              ))}
            </div>
          );
        })}
      </aside>

      <div className="flex-1 overflow-y-auto p-5">
        {draft === null ? (
          <div className="pt-16 text-center">
            <Wrench size={26} className="mx-auto text-[var(--color-muted)]" />
            <p className="mt-2 text-sm">Pick an agent to edit, or create a new one</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Changes are written straight to <code>agents/&lt;id&gt;.json</code> and hot-reloaded.
            </p>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold">
                {creating ? "New agent" : `Editing ${draft.name}`}
              </h2>
              {!creating && <Badge variant="outline">agents/{draft.id}.json</Badge>}
              <div className="ml-auto flex gap-2">
                {!creating && (
                  <Button size="sm" variant="outline" onClick={() => void remove()} disabled={busy}>
                    <Trash2 size={13} /> Delete
                  </Button>
                )}
                <Button size="sm" onClick={() => void save()} disabled={busy}>
                  {busy ? <Spinner /> : <Save size={13} />} Save
                </Button>
              </div>
            </div>

            {message !== null && (
              <div
                className={cn(
                  "rounded-md border p-2 text-xs",
                  message.kind === "ok"
                    ? "border-[var(--color-ok)]/40 bg-[var(--color-ok)]/10 text-[var(--color-ok)]"
                    : "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                )}
              >
                {message.text}
              </div>
            )}

            <Card className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Agent id" hint="snake_case; becomes the filename">
                  <Input
                    value={draft.id}
                    disabled={!creating}
                    onChange={(e) => set("id", e.target.value)}
                  />
                </Field>
                <Field label="Display name">
                  <Input value={draft.name} onChange={(e) => set("name", e.target.value)} />
                </Field>
                <Field label="Department">
                  <select
                    value={draft.department}
                    onChange={(e) => set("department", e.target.value)}
                    className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
                  >
                    {DEPARTMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Reports to">
                  <select
                    value={draft.reportsTo}
                    onChange={(e) => set("reportsTo", e.target.value)}
                    className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
                  >
                    <option value="owner">owner (the human)</option>
                    {agents
                      .filter((a) => a.id !== draft.id)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.id}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              <Field label="Role" hint="One line: what this agent is for">
                <Input value={draft.role} onChange={(e) => set("role", e.target.value)} />
              </Field>
            </Card>

            <Card className="p-4">
              <Field
                label="System prompt"
                hint="The company handbook is prepended automatically — don't repeat brand rules here."
              >
                <Textarea
                  rows={9}
                  value={draft.systemPrompt}
                  onChange={(e) => set("systemPrompt", e.target.value)}
                  className="font-mono text-[11px] leading-relaxed"
                />
              </Field>
            </Card>

            <Card className="space-y-3 p-4">
              <Field label="Tools" hint="Only these can be called. Integrations are per-adapter.">
                <Chips
                  options={tools.filter((t) => !t.name.startsWith("integration_")).map((t) => t.name)}
                  selected={draft.tools}
                  onToggle={(v) => toggle("tools", v)}
                  titleFor={toolDescription}
                />
              </Field>
              <Field
                label="Integrations"
                hint="An agent can only reach an integration granted here. Unconfigured ones are clearly-marked stubs."
              >
                <div className="flex flex-wrap gap-1.5">
                  {integrations.map((i) => {
                    const tool = `integration_${i.id}`;
                    const on = draft.tools.includes(tool);
                    return (
                      <button
                        key={i.id}
                        type="button"
                        title={i.description}
                        onClick={() => toggle("tools", tool)}
                        className={cn(
                          "flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px]",
                          on
                            ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                            : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                        )}
                      >
                        <Plug size={10} />
                        {i.name}
                        {!i.configured && <span className="opacity-60">(stub)</span>}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </Card>

            <Card className="space-y-3 p-4">
              <Field
                label="Requires approval"
                hint="Actions this agent may never take without your click."
              >
                <Chips
                  options={APPROVAL_ACTIONS}
                  selected={draft.requiresApproval}
                  onToggle={(v) => toggle("requiresApproval", v)}
                />
              </Field>
              <Field label="Can delegate to">
                <Chips
                  options={agents.filter((a) => a.id !== draft.id).map((a) => a.id)}
                  selected={draft.canDelegateTo}
                  onToggle={(v) => toggle("canDelegateTo", v)}
                />
              </Field>
            </Card>

            <Card className="grid gap-3 p-4 sm:grid-cols-3">
              <Field label="Model">
                <select
                  value={draft.model}
                  onChange={(e) => set("model", e.target.value)}
                  className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm"
                >
                  {["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.0-flash"].map(
                    (m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    )
                  )}
                </select>
              </Field>
              <Field label={`Temperature (${draft.temperature})`}>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={draft.temperature}
                  onChange={(e) => set("temperature", Number(e.target.value))}
                  className="w-full accent-[var(--color-accent)]"
                />
              </Field>
              <Field label="Max cost per task (USD)">
                <Input
                  type="number"
                  step="0.05"
                  min="0.01"
                  value={draft.maxCostPerTask}
                  onChange={(e) => set("maxCostPerTask", Number(e.target.value))}
                />
              </Field>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
