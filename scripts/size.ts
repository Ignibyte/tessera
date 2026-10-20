// Fails when the gzip size of the file named in size-budget.json is over its budget.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

interface Budget {
  file: string;
  maxGzipBytes: number;
}

const root = resolve(import.meta.dirname, "..");
const budget = JSON.parse(readFileSync(resolve(root, "size-budget.json"), "utf8")) as Budget;
const bytes = gzipSync(readFileSync(resolve(root, budget.file)), { level: 9 }).length;
const line = `${budget.file}: ${bytes} bytes gzipped, budget ${budget.maxGzipBytes}`;

if (bytes > budget.maxGzipBytes) {
  console.error(`size: over budget. ${line}`);
  process.exit(1);
}
console.log(`size: ${line}`);
