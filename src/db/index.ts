import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "../config/env";

let db: Database.Database | null = null;
let vecAvailable = false;

/** Lazily opened singleton connection. Runs pending migrations on first open. */
export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.resolve(process.cwd(), env.DATABASE_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // sqlite-vec powers the Company Brain from Phase 6. Load it now so a broken
  // native build surfaces early, but don't make Phase 1 depend on it.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqliteVec = require("sqlite-vec") as { load: (d: Database.Database) => void };
    sqliteVec.load(db);
    vecAvailable = true;
  } catch (err) {
    console.warn(
      `sqlite-vec extension not loaded (vector search unavailable until Phase 6 needs it): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  runMigrations(db);
  return db;
}

export function isVecAvailable(): boolean {
  return vecAvailable;
}

function runMigrations(conn: Database.Database): void {
  conn
    .prepare(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       )`
    )
    .run();

  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set<string>(
    (conn.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map(
      (r) => r.name
    )
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const apply = conn.transaction(() => {
      conn.exec(sql);
      conn.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(file);
    });
    apply();
    console.log(`migration applied: ${file}`);
  }
}
