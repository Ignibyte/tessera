// Fails when the gzip size of a build named in size-budget.json is over its budget: the default
// build and the csp build (#19), each of which must hold nothing of the other's expression engine.
// Also builds each expression engine alone, minified, and holds it to its own budget: the trusted
// engine (src/expression.ts) is the default, the no-eval engine (src/noeval/engine.ts) the option
// for a strict Content-Security-Policy. Each must hold nothing of the other (#22).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";

interface Budget {
  builds: { default: { file: string; maxGzipBytes: number }; csp: { file: string; maxGzipBytes: number } };
  engines: { trusted: number; noEval: number };
}

const root = resolve(import.meta.dirname, "..");
const budget = JSON.parse(readFileSync(resolve(root, "size-budget.json"), "utf8")) as Budget;
const gzipped = (text: string | Buffer): number => gzipSync(text, { level: 9 }).length;
let failed = false;

// The no-eval engine's diagnostic codes survive minification.
const NO_EVAL_CODE = /NOEVAL_/;
// Nothing in the no-eval engine, or in a build that uses it, may compile code from a string. The
// engine alone must not hold the trusted engine's action marker either; a whole build may, since
// the directive registry reserves the name.
const COMPILES_CODE = /\bFunction\s*\(|\beval\s*\(/;
const TRUSTED_CODE = /\bFunction\s*\(|\beval\s*\(|__tesseraAction/;

for (const [name, { file, maxGzipBytes }, foreign] of [
  ["default", budget.builds.default, NO_EVAL_CODE],
  ["csp", budget.builds.csp, COMPILES_CODE],
] as const) {
  const code = readFileSync(resolve(root, file), "utf8");
  const bytes = gzipped(code);
  const line = `${file}: ${String(bytes)} bytes gzipped, budget ${String(maxGzipBytes)}`;
  if (bytes > maxGzipBytes) {
    console.error(`size: over budget. ${line}`);
    failed = true;
  } else console.log(`size: ${line}`);
  if (foreign.test(code)) {
    console.error(`size: the ${name} build holds code of the other engine (${String(foreign)}).`);
    failed = true;
  }
}

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
    foreign: NO_EVAL_CODE,
  },
  {
    name: "noEval",
    code: await engine("noEval", "src/noeval/engine.ts"),
    max: budget.engines.noEval,
    foreign: TRUSTED_CODE,
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
