// `npm run serve:test`: starts the reference server and prints its URL. It takes a free port
// unless `--port N` names one, and stops on Ctrl-C.
import { startServer } from "./server.ts";

const flag = process.argv.indexOf("--port");
const value = flag >= 0 ? process.argv[flag + 1] : "0";
if (value === undefined || !/^\d+$/.test(value) || Number(value) > 65_535) {
  console.error("usage: node test/server/main.ts [--port N]");
  process.exit(2);
}

const running = await startServer({ port: Number(value) });
console.log(`Tessera reference server: ${running.url}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void running.close().then(() => process.exit(0));
  });
}
