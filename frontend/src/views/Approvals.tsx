import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Inbox, ShieldAlert, XCircle } from "lucide-react";
import { api, type Approval, type Escalation } from "@/lib/api";
import { Badge, Button, Card, EmptyState, Input, Spinner } from "@/components/ui";
import { timeAgo } from "@/lib/utils";

function ApprovalCard({ card, onDecided }: { card: Approval; onDecided: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const flagged = card.legal_flags.length > 0;

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    try {
      await api.decideApproval(card.id, decision, note);
      onDecided();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] p-3">
        <div className="flex items-center gap-2">
          <Badge variant="accent">{card.agent_id}</Badge>
          <span className="text-xs text-[var(--color-muted)]">wants to</span>
          <Badge variant="warn">{card.action_type}</Badge>
        </div>
        <span className="text-[11px] text-[var(--color-muted)]">{timeAgo(card.created_at)}</span>
      </div>

      <div className="p-3">
        <p className="text-[10px] font-medium uppercase text-[var(--color-muted)]">Content</p>
        <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-bg)] p-2.5 text-[11px] leading-relaxed">
          {card.payload.content}
        </pre>

        <div
          className={`mt-3 rounded-md border p-2.5 ${
            flagged
              ? "border-[var(--color-warn)]/40 bg-[var(--color-warn)]/5"
              : "border-[var(--color-ok)]/40 bg-[var(--color-ok)]/5"
          }`}
        >
          <div className="flex items-center gap-1.5">
            {flagged ? (
              <ShieldAlert size={13} className="text-[var(--color-warn)]" />
            ) : (
              <CheckCircle2 size={13} className="text-[var(--color-ok)]" />
            )}
            <p
              className={`text-[11px] font-medium ${
                flagged ? "text-[var(--color-warn)]" : "text-[var(--color-ok)]"
              }`}
            >
              Legal review: {flagged ? `${card.legal_flags.length} flag(s)` : "clear"}
            </p>
          </div>
          {card.legal_assessment !== null && (
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-muted)]">
              {card.legal_assessment}
            </p>
          )}
          {flagged && (
            <ul className="mt-1.5 space-y-0.5">
              {card.legal_flags.map((f, i) => (
                <li key={i} className="text-[11px] text-[var(--color-warn)]">
                  • {f}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="h-8 text-xs"
          />
          <Button size="sm" variant="ok" disabled={busy} onClick={() => void decide("approved")}>
            {busy ? <Spinner /> : <CheckCircle2 size={13} />} Approve
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => void decide("rejected")}>
            <XCircle size={13} /> Reject
          </Button>
        </div>
      </div>
    </Card>
  );
}

function EscalationCard({ item, onResolved }: { item: Escalation; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  async function resolve(status: "resolved" | "dismissed") {
    setBusy(true);
    try {
      await api.resolveEscalation(item.id, status, "");
      onResolved();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="border-[var(--color-warn)]/40 p-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={13} className="text-[var(--color-warn)]" />
        <Badge variant="accent">{item.producer_id}</Badge>
        <span className="text-[11px] text-[var(--color-muted)]">
          failed review by {item.reviewer_id}
        </span>
        <span className="ml-auto text-[11px] text-[var(--color-muted)]">
          {timeAgo(item.created_at)}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-muted)]">{item.reason}</p>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[var(--color-bg)] p-2 text-[11px]">
        {item.deliverable}
      </pre>
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="ok" disabled={busy} onClick={() => void resolve("resolved")}>
          Accept anyway
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void resolve("dismissed")}>
          Dismiss
        </Button>
      </div>
    </Card>
  );
}

export function Approvals({ onChange }: { onChange: () => void }) {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [a, e] = await Promise.all([api.approvals(), api.escalations()]);
      setApprovals(a);
      setEscalations(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, []);

  const refresh = () => {
    void load();
    onChange();
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-[var(--color-muted)]">
        <Spinner /> Loading inbox…
      </div>
    );
  }

  const empty = approvals.length === 0 && escalations.length === 0;

  return (
    <div className="space-y-6 p-6">
      {empty && (
        <EmptyState
          icon={<Inbox size={28} />}
          title="Nothing waiting on you"
          hint="Outbound actions and work that failed review twice will appear here. Nothing external happens until you approve it."
        />
      )}

      {approvals.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Pending approvals</h2>
            <Badge variant="warn">{approvals.length}</Badge>
            <span className="text-xs text-[var(--color-muted)]">
              nothing is sent or published until you click
            </span>
          </div>
          <div className="space-y-3">
            {approvals.map((c) => (
              <ApprovalCard key={c.id} card={c} onDecided={refresh} />
            ))}
          </div>
        </section>
      )}

      {escalations.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold">Escalations</h2>
            <Badge variant="warn">{escalations.length}</Badge>
            <span className="text-xs text-[var(--color-muted)]">
              failed review after 2 revision rounds
            </span>
          </div>
          <div className="space-y-3">
            {escalations.map((e) => (
              <EscalationCard key={e.id} item={e} onResolved={refresh} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
