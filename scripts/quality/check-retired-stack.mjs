import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => file && existsSync(file));
const violations = [];
const retiredRoots = /^(?:server\.js|src\/|e2e\/|frontend\/|scheduler(?:\.js|\/))/;
const localOrGenerated = /^(?:\.env(?:$|\.(?!example$))|\.DS_Store$|node_modules\/|target\/|backups\/)|(?:^|\/)(?:dist|coverage|\.terraform)\/|\.node$/;
const fileDatabase = /\.(?:db|sqlite|sqlite3)(?:$|\.)/i;
const sqliteImport = /(?:from\s+["'](?:better-sqlite3|sqlite3|node:sqlite)["']|require\(["'](?:better-sqlite3|sqlite3|node:sqlite)["']\))/;

for (const file of files) {
  if (retiredRoots.test(file)) violations.push(`${file}: retired root or entrypoint`);
  if (localOrGenerated.test(file)) violations.push(`${file}: local or generated artifact is tracked`);
  if (fileDatabase.test(file)) violations.push(`${file}: file-database artifact is tracked`);

  if (file.endsWith("package.json")) {
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    for (const section of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const dependency of Object.keys(manifest[section] || {})) {
        if (["better-sqlite3", "sqlite3"].includes(dependency)) {
          violations.push(`${file}: ${section} contains ${dependency}`);
        }
      }
    }
  }

  if (/\.(?:[cm]?js|jsx|ts|tsx)$/.test(file) && sqliteImport.test(readFileSync(file, "utf8"))) {
    violations.push(`${file}: imports a retired SQLite runtime`);
  }
}

if (violations.length) {
  process.stderr.write("Retired stack check failed:\n" + violations.map((item) => `- ${item}`).join("\n") + "\n");
  process.exit(1);
}

process.stdout.write(`[retired-stack] clean: ${files.length} tracked files checked\n`);
