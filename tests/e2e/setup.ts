import postgres from "postgres";

const tenant = "__e2e__";
const ticker = "0700.HK";

export default async function setup() {
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql:///echo_dev";
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const companyExists = (await sql`select 1 from companies where ticker = ${ticker}`).length > 0;
  if (!companyExists) {
    await sql`
      insert into companies (ticker, name_zh, name_en, exchange, currency, sector, industry, is_hsi)
      values (${ticker}, '腾讯控股', 'Tencent Holdings', 'HKEX', 'HKD', '科技', '互联网服务', true)
    `;
  }
  await sql`insert into users (id, username, pass_hash) values (${tenant}, ${tenant}, '!test') on conflict (id) do nothing`;
  await sql.end();
  return async () => {
    const cleanup = postgres(process.env.DATABASE_URL!, { max: 1 });
    for (const table of ["portfolio_snapshot_totals", "notifications", "feedback", "portfolio_positions", "portfolio_snapshots", "watchlist_prefs", "watch_rules", "profile_events", "company_profiles", "research_sessions", "research_snapshots", "documents", "llm_audit", "user_preferences"]) {
      await cleanup.unsafe(`delete from ${table} where user_id = $1`, [tenant]);
    }
    await cleanup`delete from users where id = ${tenant}`;
    if (!companyExists) {
      // The run writes non-user-scoped rows keyed by ticker (research triggers
      // ensureFreshMarketSnapshot → market_snapshots), which FK back to
      // companies — so deleting the seeded company blew up the teardown on any
      // fresh database. It never fired locally, where 0700.HK already exists
      // and this branch is skipped, and CI never got here because lint:rust
      // failed first. Resolve dependents from the catalog instead of naming
      // market_snapshots: 16 tables reference companies.ticker today, and the
      // next capability to cache a row keyed by ticker would break this again.
      // Only reachable when this setup created the company, so every row
      // removed here belongs to the test run.
      const dependents = await cleanup<{ table_name: string; column_name: string }[]>`
        select distinct tc.table_name, kcu.column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name
        join information_schema.constraint_column_usage ccu on tc.constraint_name = ccu.constraint_name
        where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'companies' and ccu.column_name = 'ticker'
      `;
      for (const { table_name, column_name } of dependents) {
        await cleanup.unsafe(`delete from ${table_name} where ${column_name} = $1`, [ticker]);
      }
      await cleanup`delete from companies where ticker = ${ticker}`;
    }
    await cleanup.end();
  };
}
