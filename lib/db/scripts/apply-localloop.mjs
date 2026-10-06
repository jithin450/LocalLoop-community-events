import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  throw new Error(
    "SUPABASE_DB_URL is required to apply the LocalLoop Supabase migration.",
  );
}

const migrationPath = resolve(
  import.meta.dirname,
  "../../../artifacts/localloop/supabase/migrations/20261006000000_local_loop_init.sql",
);
const sql = await readFile(migrationPath, "utf8");
const version = "20261006000000";
const client = new pg.Client({ connectionString });

try {
  await client.connect();
  await client.query(`
    create table if not exists public.localloop_schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const prior = await client.query(
    "select 1 from public.localloop_schema_migrations where version = $1",
    [version],
  );

  if (prior.rowCount) {
    process.stdout.write("LocalLoop Supabase schema is already up to date.\n");
  } else {
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        "insert into public.localloop_schema_migrations (version) values ($1)",
        [version],
      );
      await client.query("commit");
      process.stdout.write("LocalLoop Supabase schema applied successfully.\n");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  }
} catch (error) {
  const diagnostic = error && typeof error === "object" ? error : {};
  process.stderr.write(
    `Unable to apply the LocalLoop Supabase schema (${diagnostic.code ?? diagnostic.name ?? typeof error}): ${diagnostic.message || "connection or migration failed"}\n`,
  );
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
