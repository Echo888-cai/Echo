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
    if (!companyExists) await cleanup`delete from companies where ticker = ${ticker}`;
    await cleanup.end();
  };
}
