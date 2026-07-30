/**
 * Load every Markdown file in /seed into the Company Brain.
 *
 * The knowledge base lives in the SQLite database, which is gitignored — so
 * these files are the portable, reviewable source of truth. Edit them, re-run
 * `npm run seed`, and the Brain matches.
 *
 * A document whose title already exists is replaced, so re-running is safe.
 */
import fs from "node:fs";
import path from "node:path";
import { initRegistry } from "../agents/registry";
import { addDocument, deleteDocument, listDocuments } from "../brain";
import { initHandbook } from "../brain/handbook";
import { getDb } from "../db";
import { DEFAULT_WORKSPACE_ID, ensureDefaultWorkspace, workspaceExists } from "../workspace";

const SEED_DIR = path.resolve(process.cwd(), "seed");

async function main(): Promise<void> {
  getDb();
  ensureDefaultWorkspace();
  initRegistry();
  initHandbook();

  const workspaceId = process.argv[2] ?? DEFAULT_WORKSPACE_ID;
  if (!workspaceExists(workspaceId)) {
    throw new Error(`unknown workspace "${workspaceId}" — create it first`);
  }

  if (!fs.existsSync(SEED_DIR)) {
    console.log(`no seed directory at ${SEED_DIR} — nothing to load`);
    return;
  }
  const files = fs.readdirSync(SEED_DIR).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) {
    console.log("seed/ contains no .md files");
    return;
  }

  console.log(`loading ${files.length} document(s) into workspace "${workspaceId}"\n`);
  const existing = listDocuments(workspaceId);

  for (const file of files) {
    const raw = fs.readFileSync(path.join(SEED_DIR, file), "utf8");
    // First "# Heading" is the document title; the rest is the body.
    const match = raw.match(/^#\s+(.+?)\n([\s\S]*)$/);
    const title = match?.[1]?.trim() ?? path.basename(file, ".md");
    const content = (match?.[2] ?? raw).trim();
    if (content === "") {
      console.log(`  skipped ${file} (empty)`);
      continue;
    }

    // Replace rather than duplicate, so re-running stays idempotent.
    for (const doc of existing.filter((d) => d.title === title)) {
      deleteDocument(doc.id);
    }

    const { chunks } = await addDocument({ workspaceId, title, content, source: "owner" });
    console.log(`  ${title.slice(0, 52).padEnd(54)} ${chunks} chunk(s)`);
  }

  console.log(`\nknowledge base now holds ${listDocuments(workspaceId).length} document(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
