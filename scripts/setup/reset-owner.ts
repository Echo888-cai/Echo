import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { hashPassword } from "../../apps/api/src/auth.js";

if (!process.argv.includes("--confirm-reset-all-users")) {
  throw new Error("Refusing to reset accounts without --confirm-reset-all-users");
}

const connectionString = process.env.DATABASE_URL;
const email = String(process.env.ECHO_BOOTSTRAP_EMAIL || "").trim().toLowerCase();
const password = String(process.env.ECHO_BOOTSTRAP_PASSWORD || "");
if (!connectionString) throw new Error("DATABASE_URL is required");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("ECHO_BOOTSTRAP_EMAIL must be a valid email");
if (password.length < 8) throw new Error("ECHO_BOOTSTRAP_PASSWORD must be at least 8 characters");

const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
const passHash = await hashPassword(password);
const now = new Date();
const periodEnd = new Date(now.getTime() + 365 * 86_400_000);

try {
  await sql.begin(async (tx) => {
    await tx.unsafe("TRUNCATE TABLE users CASCADE");
    await tx`
      INSERT INTO users (id, username, pass_hash, display_name, role)
      VALUES ('local', ${email}, ${passHash}, 'Arlan Howard', 'owner')
    `;
    await tx`
      INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_start, current_period_end)
      VALUES (${randomUUID()}, 'local', 'pro', 'active', ${now}, ${periodEnd})
    `;
  });
  console.log(`[accounts] reset complete; owner=${email}; plan=pro`);
} finally {
  await sql.end();
}
