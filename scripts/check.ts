// The gate every ticket passes: typecheck, lint, test, build and size, in that
// order, stopping at the first failure.
import { spawnSync } from "node:child_process";

const steps = ["typecheck", "lint", "test", "build", "size"];

for (const step of steps) {
  console.log(`\n== check: ${step}`);
  const result = spawnSync("npm", ["run", "--silent", step], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\ncheck: ${step} failed`);
    process.exit(result.status ?? 1);
  }
}
console.log(`\ncheck: passed (${steps.join(", ")})`);
