import postgres from "postgres";

const tenant = "__e2e__";

export default async function setup() {
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql:///echo_dev";
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  await sql`insert into users (id, username, pass_hash) values (${tenant}, ${tenant}, '!test') on conflict (id) do nothing`;
  await sql.end();
  return async () => {
    const cleanup = postgres(process.env.DATABASE_URL!, { max: 1 });
    for (const table of ["portfolio_snapshot_totals", "notifications", "feedback", "portfolio_positions", "portfolio_snapshots", "watchlist_prefs", "watch_rules", "profile_events", "company_profiles", "research_sessions", "research_snapshots", "documents", "llm_audit", "user_preferences"]) {
      await cleanup.unsafe(`delete from ${table} where user_id = $1`, [tenant]);
    }
    await cleanup`delete from users where id = ${tenant}`;
    await cleanup.end();
  };
}
