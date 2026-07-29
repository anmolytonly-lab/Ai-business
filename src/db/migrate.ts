import { getDb } from "./index";

// Standalone entrypoint: `npm run migrate`
const db = getDb();
const rows = db
  .prepare("SELECT name, applied_at FROM schema_migrations ORDER BY name")
  .all() as { name: string; applied_at: string }[];

console.log("Applied migrations:");
for (const row of rows) console.log(`  ${row.name}  (${row.applied_at})`);
