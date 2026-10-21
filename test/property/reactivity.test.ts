// Effects always catch up: after any sequence of writes, with or without waiting between them,
// every effect (reading keys directly, through `in`, through iteration, or through a computed
// value) has last seen the final state. Effects count their runs: one reading through a computed
// value never runs twice in a row on the same value.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computed, reactive, Scheduler, stop } from "../../src/reactivity.ts";
import type { ReactiveEffect } from "../../src/reactivity.ts";

const SEED = 20261020;
const KEYS = ["a", "b", "c", "d"] as const;
type StateKey = (typeof KEYS)[number];

const key = fc.constantFrom(...KEYS);
const write = fc.oneof(
  fc.record({ kind: fc.constant("set" as const), key, value: fc.integer({ min: -3, max: 3 }) }),
  fc.record({ kind: fc.constant("delete" as const), key }),
);
const batch = fc.record({ writes: fc.array(write, { maxLength: 6 }), wait: fc.boolean() });
const watcher = fc.record({
  via: fc.constantFrom("read", "in", "keys", "computed"),
  keys: fc.uniqueArray(key, { minLength: 1, maxLength: 4 }),
});

type State = Partial<Record<StateKey, number>>;

function view(state: State, via: string, keys: readonly StateKey[]): string {
  if (via === "in") return keys.map((name) => String(name in state)).join(",");
  if (via === "keys") return Object.keys(state).filter((name) => keys.includes(name as StateKey)).sort().join(",");
  return keys.map((name) => String(state[name])).join(",");
}

describe("reactivity", () => {
  it("leaves every effect having seen the final values", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(watcher, { minLength: 1, maxLength: 6 }),
        fc.array(batch, { minLength: 1, maxLength: 8 }),
        async (watchers, batches) => {
          const scheduler = new Scheduler();
          const state = reactive<State>({ a: 0, b: 0 });
          const seen: string[] = [];
          const runs: string[][] = watchers.map(() => []);
          const effects: ReactiveEffect[] = [];
          const values = watchers.map(({ via, keys }) =>
            via === "computed" ? computed(() => view(state, "read", keys)) : undefined,
          );
          watchers.forEach(({ via, keys }, index) => {
            effects.push(
              scheduler.effect(() => {
                seen[index] = values[index]?.value ?? view(state, via, keys);
                runs[index]?.push(seen[index]);
              }),
            );
          });

          for (const { writes, wait } of batches) {
            for (const change of writes) {
              if (change.kind === "set") state[change.key] = change.value;
              else Reflect.deleteProperty(state, change.key);
            }
            if (wait) await scheduler.nextUpdate();
          }
          await scheduler.nextUpdate();

          watchers.forEach(({ via, keys }, index) => {
            expect(seen[index]).toBe(view(state, via === "computed" ? "read" : via, keys));
            if (via !== "computed") return;
            const values = runs[index] ?? [];
            values.slice(1).forEach((value, run) => {
              expect(value).not.toBe(values[run]);
            });
          });
          for (const runner of effects) stop(runner);
          for (const value of values) value?.stop();
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });
});
