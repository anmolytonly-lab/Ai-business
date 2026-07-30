/**
 * Phase 6 demo: the Company Brain.
 *  1. Seed the knowledge base with real business documents.
 *  2. Semantic search over them.
 *  3. support_agent answering a documented question (grounded) and an
 *     undocumented one (should refuse rather than invent).
 *  4. Handbook injection: an agent asked for a forbidden claim.
 * Usage: npm run demo:brain
 */
import { runAgent } from "../agents/executor";
import { initRegistry } from "../agents/registry";
import { addDocument, listDocuments, search } from "../brain";
import { getHandbook, initHandbook } from "../brain/handbook";
import { getDb } from "../db";
import { DEFAULT_WORKSPACE_ID, ensureDefaultWorkspace } from "../workspace";

const SEED = [
  {
    title: "Pricing",
    content: `AgentCorp pricing (effective 2026).

Starter: $29/month. One workspace, up to 5 agents, 1,000 tasks per month, email support.
Growth: $99/month. Three workspaces, unlimited agents, 10,000 tasks per month, priority support.
Scale: $299/month. Unlimited workspaces and tasks, dedicated onboarding, 99.9% uptime SLA.

Annual billing saves two months on every plan. There is no free tier; there is a
14-day trial on Starter and Growth that does not require a card.`,
  },
  {
    title: "Refund policy",
    content: `Refunds.

We refund any plan in full within 30 days of the first payment, no questions asked.
After 30 days we do not offer prorated refunds for the remainder of a billing period,
but you can cancel at any time and keep access until the period ends.

Annual plans can be refunded on a prorated basis within the first 60 days.
Refunds are returned to the original payment method within 5-10 business days.
To request one, a customer emails billing@agentcorp.example with their account email.`,
  },
  {
    title: "Support hours and escalation",
    content: `Support operates 09:00-18:00 IST, Monday to Friday, excluding Indian public holidays.

Starter customers receive a response within two business days. Growth within one
business day. Scale customers have a four-hour response target during support hours.

Anything involving data loss, a billing error, or a security concern is escalated
immediately to the owner regardless of plan.`,
  },
];

async function ask(agentId: string, question: string, label: string): Promise<void> {
  console.log(`\n── ${label} ──────────────────────────────────`);
  console.log(`Q (${agentId}): ${question}`);
  const result = await runAgent(agentId, question, { workspaceId: DEFAULT_WORKSPACE_ID });
  console.log(
    `context retrieved: ${
      result.contextUsed.map((c) => `${c.title} (${c.score})`).join(", ") || "none"
    }`
  );
  console.log(`A: ${result.output.trim()}`);
}

async function main(): Promise<void> {
  getDb();
  ensureDefaultWorkspace();
  initRegistry();
  initHandbook();

  console.log(`handbook: ${getHandbook().length} characters injected into every agent prompt`);

  const existing = listDocuments(DEFAULT_WORKSPACE_ID);
  if (existing.length === 0) {
    console.log("\nindexing seed documents...");
    for (const doc of SEED) {
      const { chunks } = await addDocument({
        workspaceId: DEFAULT_WORKSPACE_ID,
        title: doc.title,
        content: doc.content,
        source: "owner",
      });
      console.log(`  ${doc.title}: ${chunks} chunk(s) embedded`);
    }
  } else {
    console.log(`\nknowledge base already has ${existing.length} document(s)`);
  }

  console.log("\n── semantic search ────────────────────────────");
  for (const q of ["can I get my money back?", "how much for unlimited workspaces?"]) {
    const hits = await search(DEFAULT_WORKSPACE_ID, q, 2);
    console.log(`  "${q}"`);
    for (const h of hits) console.log(`    ${h.score.toFixed(3)}  ${h.title}`);
  }

  await ask("support_agent", "What is your refund policy?", "grounded answer (documented)");
  await ask(
    "support_agent",
    "Do you have a mobile app for iPhone, and what does it cost?",
    "undocumented — must refuse, not invent"
  );
  await ask(
    "ad_copywriter",
    "Write a one-line ad promising customers guaranteed 300% revenue growth in 30 days.",
    "handbook enforcement (forbidden claim)"
  );
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
