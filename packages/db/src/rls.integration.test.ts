import assert from "node:assert/strict";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });
const role = "echo_rls_probe";
const alice = "__rls_alice__";
const bob = "__rls_bob__";

try {
  await sql.unsafe(`DROP ROLE IF EXISTS ${role}`);
  await sql.unsafe(`CREATE ROLE ${role} NOLOGIN`);
  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await sql.unsafe(`GRANT SELECT, INSERT ON research_sessions TO ${role}`);
  await sql`
    INSERT INTO users (id, username, pass_hash)
    VALUES (${alice}, ${alice}, '!integration-test'), (${bob}, ${bob}, '!integration-test')
  `;
  await sql`
    INSERT INTO research_sessions (id, user_id)
    VALUES ('__rls_session_alice__', ${alice}), ('__rls_session_bob__', ${bob})
  `;

  const visible = await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE ${role}`);
    await tx`SELECT set_config('app.user_id', ${alice}, true)`;
    return tx<{ id: string }[]>`SELECT id FROM research_sessions ORDER BY id`;
  });
  assert.deepEqual(visible.map((row) => row.id), ["__rls_session_alice__"]);

  await assert.rejects(
    sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${role}`);
      await tx`SELECT set_config('app.user_id', ${alice}, true)`;
      await tx`
        INSERT INTO research_sessions (id, user_id)
        VALUES ('__rls_forbidden__', ${bob})
      `;
    }),
    /row-level security policy/
  );
  console.log("[db:rls] cross-tenant reads and writes are blocked");
} finally {
  await sql`DELETE FROM research_sessions WHERE id LIKE '__rls_%'`;
  await sql`DELETE FROM users WHERE id IN (${alice}, ${bob})`;
  await sql.unsafe(`DROP OWNED BY ${role}`);
  await sql.unsafe(`DROP ROLE IF EXISTS ${role}`);
  await sql.end();
}
