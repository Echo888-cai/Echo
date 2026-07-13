import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(directory)
  .filter((file) => file.endsWith(".test.mjs"))
  .sort();

if (!tests.length) {
  console.error("No test files found.");
  process.exit(1);
}

for (const file of tests) {
  console.log(`\n━━ ${file} ━━`);
  const result = spawnSync(process.execPath, [join(directory, file)], {
    cwd: join(directory, ".."),
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\nAll ${tests.length} test files passed.`);
