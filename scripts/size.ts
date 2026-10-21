// Fails when the gzip size of the file named in size-budget.json is over its budget. Also builds
// each expression engine alone, minified, and holds it to its own budget: the trusted engine
// (src/expression.ts) is the default, the no-eval engine (src/noeval/engine.ts) the option for a
// strict Content-Security-Policy. Each must hold nothing of the other (#22).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";

interface Budget {
  file: string;
  maxGzipBytes: number;
  engines: { trusted: number; noEval: number };
}

const root = resolve(import.meta.dirname, "..");
const budget = JSON.parse(readFileSync(resolve(root, "size-budget.json"), "utf8")) as Budget;
const gzipped = (text: string | Buffer): number => gzipSync(text, { level: 9 }).length;
let failed = false;

const bytes = gzipped(readFileSync(resolve(root, budget.file)));
const line = `${budget.file}: ${String(bytes)} bytes gzipped, budget ${String(budget.maxGzipBytes)}`;
if (bytes > budget.maxGzipBytes) {
  console.error(`size: over budget. ${line}`);
  failed = true;
} else console.log(`size: ${line}`);

const outDir = resolve(root, "node_modules/.cache/tessera-size");

async function engine(name: string, entry: string): Promise<string> {
  await build({
    configFile: false,
    root,
    logLevel: "warn",
    build: {
      outDir,
      emptyOutDir: false,
      target: "es2022",
      minify: "terser",
      lib: { entry: resolve(root, entry), formats: ["es"], fileName: () => `${name}.js` },
    },
  });
  return readFileSync(resolve(outDir, `${name}.js`), "utf8");
}

const engines = [
  {
    name: "trusted",
    code: await engine("trusted", "src/expression.ts"),
    max: budget.engines.trusted,
    // The no-eval engine's diagnostic codes survive minification.
    foreign: /NOEVAL_/,
  },
  {
    name: "noEval",
    code: await engine("noEval", "src/noeval/engine.ts"),
    max: budget.engines.noEval,
    // Nothing in the no-eval engine may compile code from a string.
    foreign: /\bFunction\s*\(|\beval\s*\(|__tesseraAction/,
  },
];
for (const { name, code, max, foreign } of engines) {
  const size = gzipped(code);
  const report = `the ${name} engine alone: ${String(size)} bytes gzipped, budget ${String(max)}`;
  if (size > max) {
    console.error(`size: over budget. ${report}`);
    failed = true;
  } else console.log(`size: ${report}`);
  if (foreign.test(code)) {
    console.error(`size: the ${name} engine's build holds code of the other engine (${String(foreign)}).`);
    failed = true;
  }
}

if (failed) process.exit(1);
