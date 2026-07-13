/**
 * Test isolation: point the SQLite connection at a throwaway temp file so the
 * suite never writes research_sessions / portfolio rows into the dev echo.db.
 * Imported FIRST in every test file; db/index.js reads ECHO_DB_PATH lazily.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.ECHO_DB_PATH) {
  process.env.ECHO_DB_PATH = join(tmpdir(), `echo-test-${process.pid}.db`);
}
