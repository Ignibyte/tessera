// Writes dist/SHA256SUMS over the release's twelve files, in the format `sha256sum -c` reads. Run
// `npm run build` first; a missing file fails it.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { RELEASE_FILES } from "./release-files.ts";

const dist = resolve(import.meta.dirname, "../dist");
const lines = RELEASE_FILES.map((file) => `${createHash("sha256").update(readFileSync(resolve(dist, file))).digest("hex")}  ${file}\n`);
writeFileSync(resolve(dist, "SHA256SUMS"), lines.join(""));
console.log(`sums: dist/SHA256SUMS over ${String(RELEASE_FILES.length)} files`);
