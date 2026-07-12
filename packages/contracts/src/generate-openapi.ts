/**
 * Builds the OpenAPI document from the registry and writes it to
 * packages/contracts/openapi.json. Run with: npm run generate-openapi -w @echo/contracts
 */
import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { registry } from "./registry.js";

const generator = new OpenApiGeneratorV3(registry.definitions);

const document = generator.generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Echo Research API (R-0 snapshot)",
    version: "0.1.0",
    description:
      "Descriptive snapshot of the current Node.js HTTP API (src/server/routes/*.js), generated for the NestJS migration (docs/REFACTOR_PROPOSAL.md). Not a forward-looking spec."
  },
  servers: [{ url: "http://127.0.0.1:4173" }]
});

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "openapi.json");
writeFileSync(outPath, JSON.stringify(document, null, 2) + "\n", "utf8");
console.log(`Wrote ${outPath}`);
