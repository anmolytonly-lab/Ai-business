import { useEffect, useRef, useState } from "react";
import { Rocket, Send, User } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Spinner, Textarea } from "@/components/ui";

interface Turn {
  role: "owner" | "ceo";
  content: string;
  suggestedGoal?: string;
  goalId?: string;
}

export function Chat({ onGoalCreated }: { onGoalCreated: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy]);

  async function send() {
    const message = draft.trim();
    if (message === "" || busy) return;
    setDraft("");
    setError(null);
    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: "owner", content: message }]);
    setBusy(true);
    try {
      const reply = await api.chat(message, history);
      setTurns((prev) => [
        ...prev,
        {
          role: "ceo",
          content: reply.reply,
          ...(reply.isGoal && reply.suggestedGoal !== ""
            ? { suggestedGoal: reply.suggestedGoal }
            : {}),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runGoal(index: number, description: string) {
    try {
      const { goalId } = await api.createGoal(description);
      setTurns((prev) =>
        prev.map((t, i) => (i === index ? { ...t, goalId, suggestedGoal: undefined } : t))
      );
      onGoalCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        {turns.length === 0 && (
          <div className="mx-auto max-w-lg pt-12 text-center">
            <h2 className="text-lg font-semibold">Talk to your CEO</h2>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Ask a question, or describe work you want done. When it's a goal, the CEO will
              plan it and you can hand it to the company with one click.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {[
                "What's our current status?",
                "Write a blog post about AI automation for small teams",
                "Draft a welcome email for new signups",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setDraft(s)}
                  className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="flex gap-3">
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                turn.role === "owner"
                  ? "bg-[var(--color-surface-2)]"
                  : "bg-[var(--color-accent)] text-black"
              }`}
            >
              {turn.role === "owner" ? <User size={14} /> : "CEO"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-[var(--color-muted)]">
                {turn.role === "owner" ? "You" : "Chief Executive Officer"}
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
                {turn.content}
              </div>

              {turn.suggestedGoal !== undefined && (
                <Card className="mt-3 border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 p-3">
                  <div className="flex items-start gap-3">
                    <Rocket size={15} className="mt-0.5 shrink-0 text-[var(--color-accent)]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--color-accent)]">
                        Ready to run as a goal
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">{turn.suggestedGoal}</p>
                    </div>
                    <Button size="sm" onClick={() => void runGoal(i, turn.suggestedGoal ?? "")}>
                      Run it
                    </Button>
                  </div>
                </Card>
              )}

              {turn.goalId !== undefined && (
                <Badge variant="ok" className="mt-2">
                  Goal started — see the Tasks tab
                </Badge>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-3 text-xs text-[var(--color-muted)]">
            <Spinner /> CEO is thinking…
          </div>
        )}
        {error !== null && (
          <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-[var(--color-border)] p-4">
        <div className="flex gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Message your CEO…  (Enter to send, Shift+Enter for a new line)"
            className="resize-none"
          />
          <Button onClick={() => void send()} disabled={busy || draft.trim() === ""} size="icon" className="h-auto w-11">
            <Send size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}
