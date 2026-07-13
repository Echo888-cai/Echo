import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(packageDirectory, "package.json"), "utf8"));

assert.deepEqual(manifest.dependencies, undefined, "domain package must have zero runtime dependencies");

for (const file of readdirSync(join(packageDirectory, "src"))) {
  if (extname(file) !== ".js") continue;
  const source = readFileSync(join(packageDirectory, "src", file), "utf8");
  const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
  assert.ok(
    imports.every((specifier) => specifier.startsWith("./")),
    `${file} imports outside the domain boundary: ${imports.join(", ")}`
  );
  assert.doesNotMatch(source, /\b(?:fetch|process\.env)\b/, `${file} must not perform network or environment IO`);
}

console.log("Domain architecture boundary ✓ zero dependencies, framework-free, no IO");
