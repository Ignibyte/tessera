// Builds test/browser/harness.ts into one script before the browser tests run.
import { resolve } from "node:path";
import { build } from "vite";

const root = resolve(import.meta.dirname, "../..");

export const HARNESS_DIR = resolve(root, "node_modules/.cache/tessera-harness");

export default async function globalSetup(): Promise<void> {
  await build({
    configFile: false,
    root,
    logLevel: "warn",
    build: {
      outDir: HARNESS_DIR,
      emptyOutDir: true,
      minify: false,
      target: "es2022",
      lib: {
        entry: resolve(root, "test/browser/harness.ts"),
        name: "TesseraHarness",
        formats: ["iife"],
        fileName: () => "harness.js",
      },
    },
  });
}
