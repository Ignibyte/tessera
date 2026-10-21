// Signals, effects, computed values and the per-runtime scheduler. The first block is ported
// from jqstar `test/reactivity.test.ts`, each case on its own scheduler; the rest is new.
import { describe, expect, it, vi } from "vitest";
import { Kernel } from "../../src/kernel.ts";
import {
  computed,
  dependentCount,
  notifyPropertyChange,
  reactive,
  Scheduler,
  stop,
  toRaw,
} from "../../src/reactivity.ts";

describe("reactive effect lifecycle (from jqstar)", () => {
  it("allows reading reactive state without a running effect", () => {
    const state = reactive({ value: 1 });
    expect(state.value).toBe(1);
    state.value = 2;
    expect(state.value).toBe(2);
  });

  it("removes dependencies when the initial effect run fails", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ value: 0 });
    const runs = vi.fn(() => {
      void state.value;
      throw new Error("initial failure");
    });

    expect(() => scheduler.effect(runs)).toThrow("initial failure");
    state.value = 1;
    await scheduler.nextUpdate();

    expect(runs).toHaveBeenCalledOnce();
    expect(dependentCount(state)).toBe(0);
  });

  it("reports an owned failure and still runs every later scheduled effect", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ value: 0 });
    const failure = new Error("owned failure");
    const reported = vi.fn();
    const observed: number[] = [];
    const failing = scheduler.effect(
      () => {
        if (state.value === 1) throw failure;
      },
      { owner: "mount:test", onError: reported },
    );
    const succeeding = scheduler.effect(() => observed.push(state.value), { owner: "mount:other" });

    state.value = 1;
    await scheduler.nextUpdate();

    expect(failing.owner).toBe("mount:test");
    expect(reported).toHaveBeenCalledWith(failure, failing);
    expect(observed).toEqual([0, 1]);
    stop(failing);
    stop(succeeding);
  });

  it("rejects the barrier after all unowned failing effects run", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ value: 0 });
    const first = new Error("first failure");
    const second = new Error("second failure");
    const later = vi.fn();
    scheduler.effect(() => {
      if (state.value === 1) throw first;
    });
    scheduler.effect(() => {
      if (state.value === 1) throw second;
    });
    scheduler.effect(() => {
      void state.value;
      later();
    });

    state.value = 1;
    await expect(scheduler.nextUpdate()).rejects.toMatchObject({
      message: "Reactive effect updates failed.",
      errors: [first, second],
    });
    expect(later).toHaveBeenCalledTimes(2);
  });

  it("preserves both the effect and reporter failures", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ fail: false });
    const effectFailure = new Error("effect failed");
    const reporterFailure = new Error("reporter failed");
    scheduler.effect(
      () => {
        if (state.fail) throw effectFailure;
      },
      {
        onError: () => {
          throw reporterFailure;
        },
      },
    );

    state.fail = true;
    await expect(scheduler.nextUpdate()).rejects.toMatchObject({
      message: "Reactive effect updates failed.",
      errors: [effectFailure, reporterFailure],
    });
  });

  it("flushes effects queued by another scheduled effect", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ first: 0, second: 0 });
    const observations: number[] = [];
    scheduler.effect(() => {
      state.second = state.first;
    });
    scheduler.effect(() => observations.push(state.second));

    state.first = 1;
    await scheduler.nextUpdate();
    expect(observations).toEqual([0, 1]);
  });

  it("tracks only the active branch after an effect switches dependencies", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ useLeft: true, left: 0, right: 0 });
    const observed: number[] = [];
    scheduler.effect(() => observed.push(state.useLeft ? state.left : state.right));
    expect(observed).toEqual([0]);

    state.useLeft = false;
    await scheduler.nextUpdate();
    expect(observed).toEqual([0, 0]);

    state.left = 1;
    await scheduler.nextUpdate();
    expect(observed).toEqual([0, 0]);

    state.right = 2;
    await scheduler.nextUpdate();
    expect(observed).toEqual([0, 0, 2]);
  });

  it("does not rerun effects for unchanged or rejected writes", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ value: 1 });
    const observed: number[] = [];
    scheduler.effect(() => observed.push(state.value));

    state.value = 1;
    await scheduler.nextUpdate();
    expect(observed).toEqual([1]);

    state.value = 2;
    await scheduler.nextUpdate();
    expect(observed).toEqual([1, 2]);

    Object.defineProperty(state, "value", { writable: false });
    expect(Reflect.set(state, "value", 3)).toBe(false);
    await scheduler.nextUpdate();
    expect(observed).toEqual([1, 2]);
  });

  it("notifies only when a present reactive property is deleted", async () => {
    const scheduler = new Scheduler();
    const state = reactive<{ value?: number }>({ value: 1 });
    const observed: (number | undefined)[] = [];
    scheduler.effect(() => observed.push(state.value));

    expect(Reflect.deleteProperty(state, "value")).toBe(true);
    await scheduler.nextUpdate();
    expect(observed).toEqual([1, undefined]);

    expect(Reflect.deleteProperty(state, "value")).toBe(true);
    await scheduler.nextUpdate();
    expect(observed).toEqual([1, undefined]);
  });

  it("removes a stopped effect from an already scheduled batch", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ value: 0 });
    const runs = vi.fn(() => void state.value);
    const runner = scheduler.effect(runs);

    state.value = 1;
    stop(runner);
    await scheduler.nextUpdate();

    expect(runs).toHaveBeenCalledOnce();
    runner();
    expect(runs).toHaveBeenCalledOnce();
    state.value = 2;
    await scheduler.nextUpdate();
    expect(runs).toHaveBeenCalledOnce();
  });

  it("skips a scheduled effect whose lifecycle is inactive", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ value: 0 });
    const runs = vi.fn(() => void state.value);
    const runner = scheduler.effect(runs);

    state.value = 1;
    runner.active = false;
    await scheduler.nextUpdate();
    expect(runs).toHaveBeenCalledOnce();
    stop(runner);
  });

  it("rejects with the original error when exactly one effect fails", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ fail: false });
    const failure = new Error("single failure");
    scheduler.effect(() => {
      if (state.fail) throw failure;
    });

    state.fail = true;
    await expect(scheduler.nextUpdate()).rejects.toBe(failure);
  });
});

describe("traps", () => {
  it("tracks `in` checks, including for a key that does not exist yet", async () => {
    const scheduler = new Scheduler();
    const state = reactive<Record<string, number>>({});
    const observed: boolean[] = [];
    scheduler.effect(() => observed.push("x" in state));

    state.x = 1;
    await scheduler.nextUpdate();
    delete state.x;
    await scheduler.nextUpdate();
    expect(observed).toEqual([false, true, false]);
  });

  it("tracks key iteration: adding or deleting a key reruns, changing a value does not", async () => {
    const scheduler = new Scheduler();
    const state = reactive<Record<string, number>>({ a: 1 });
    const observed: string[][] = [];
    scheduler.effect(() => observed.push(Object.keys(state)));

    state.a = 2;
    await scheduler.nextUpdate();
    state.b = 3;
    await scheduler.nextUpdate();
    delete state.a;
    await scheduler.nextUpdate();
    expect(observed).toEqual([["a"], ["a", "b"], ["b"]]);
  });

  it("tracks for…in and spreads like Object.keys", async () => {
    const scheduler = new Scheduler();
    const state = reactive<Record<string, number>>({ a: 1 });
    const loops: number[] = [];
    const spreads: number[] = [];
    scheduler.effect(() => {
      let count = 0;
      for (const key in state) if (key) count++;
      loops.push(count);
    });
    scheduler.effect(() => spreads.push(Object.keys({ ...state }).length));

    state.b = 2;
    await scheduler.nextUpdate();
    expect(loops).toEqual([1, 2]);
    expect(spreads).toEqual([1, 2]);
  });

  it("makes nested objects reactive through the same cached proxy", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ user: { name: "Ada", tags: ["a"] } });
    const observed: string[] = [];
    scheduler.effect(() => observed.push(`${state.user.name}:${state.user.tags.join(",")}`));

    expect(state.user).toBe(state.user);
    state.user.name = "Grace";
    await scheduler.nextUpdate();
    state.user.tags[1] = "b";
    await scheduler.nextUpdate();
    state.user = { name: "Edsger", tags: [] };
    await scheduler.nextUpdate();
    expect(observed).toEqual(["Ada:a", "Grace:a", "Grace:a,b", "Edsger:"]);
  });

  it("stores raw objects, not proxies, when a proxy is assigned", () => {
    const state = reactive<{ inner?: { n: number } }>({});
    const inner = reactive({ n: 1 });
    state.inner = inner;
    expect(toRaw(state).inner).toBe(toRaw(inner));
    expect(toRaw(state).inner).not.toBe(inner);
    expect(state.inner).toBe(inner);
  });

  it("tracks array length, iteration and index writes", async () => {
    const scheduler = new Scheduler();
    const items = reactive<number[]>([1, 2, 3]);
    const lengths: number[] = [];
    const sums: number[] = [];
    const firsts: (number | undefined)[] = [];
    scheduler.effect(() => lengths.push(items.length));
    scheduler.effect(() => sums.push(items.reduce((total, item) => total + item, 0)));
    scheduler.effect(() => firsts.push(items[0]));

    items.push(4);
    await scheduler.nextUpdate();
    items[1] = 20;
    await scheduler.nextUpdate();
    items.length = 0;
    await scheduler.nextUpdate();
    expect(lengths).toEqual([3, 4, 0]);
    expect(sums).toEqual([6, 10, 28, 0]);
    expect(firsts).toEqual([1, undefined]);
  });

  it("tracks iteration of an array with for…of", async () => {
    const scheduler = new Scheduler();
    const items = reactive(["a"]);
    const observed: string[] = [];
    scheduler.effect(() => {
      const seen: string[] = [];
      for (const item of items) seen.push(item);
      observed.push(seen.join(""));
    });

    items.unshift("z");
    await scheduler.nextUpdate();
    items.splice(1, 1);
    await scheduler.nextUpdate();
    expect(observed).toEqual(["a", "za", "z"]);
  });

  it("lets an effect push into an array without rerunning itself", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ trigger: 0 });
    const log = reactive<number[]>([]);
    const runs = vi.fn(() => {
      log.push(state.trigger);
    });
    scheduler.effect(runs);

    state.trigger = 1;
    await scheduler.nextUpdate();
    expect(runs).toHaveBeenCalledTimes(2);
    expect([...log]).toEqual([0, 1]);
  });

  it("notifies on a property defined outside the proxy traps", async () => {
    const scheduler = new Scheduler();
    const state = reactive<Record<string, number>>({ base: 2 });
    const observed: (number | undefined)[] = [];
    scheduler.effect(() => observed.push(state.double));

    Object.defineProperty(state, "double", { configurable: true, enumerable: true, get: () => 4 });
    notifyPropertyChange(state, "double");
    await scheduler.nextUpdate();
    expect(observed).toEqual([undefined, 4]);
  });
});

describe("effects and the scheduler", () => {
  it("batches writes within a microtask into one rerun", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ a: 0, b: 0 });
    const observed: string[] = [];
    scheduler.effect(() => observed.push(`${state.a}${state.b}`));

    state.a = 1;
    state.b = 1;
    state.a = 2;
    expect(observed).toEqual(["00"]);
    await scheduler.nextUpdate();
    expect(observed).toEqual(["00", "21"]);
  });

  it("leaves no dependencies behind once an effect is stopped", () => {
    const scheduler = new Scheduler();
    const state = reactive({ a: 1, b: 2, nested: { c: 3 } });
    const runner = scheduler.effect(() => {
      void state.a;
      void ("b" in state);
      void Object.keys(state);
      void state.nested.c;
    });
    // a, "b" in, the iteration key and nested; c is on state.nested.
    expect(dependentCount(state)).toBe(4);
    expect(dependentCount(state.nested, "c")).toBe(1);

    stop(runner);
    expect(dependentCount(state)).toBe(0);
    expect(dependentCount(state.nested)).toBe(0);
  });

  it("drops the dependencies of a branch it no longer reads", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ on: true, value: 1 });
    scheduler.effect(() => {
      if (state.on) void state.value;
    });
    expect(dependentCount(state, "value")).toBe(1);
    state.on = false;
    await scheduler.nextUpdate();
    expect(dependentCount(state, "value")).toBe(0);
  });

  it("keeps two schedulers' queues and failures apart", async () => {
    const first = new Scheduler();
    const second = new Scheduler();
    const state = reactive({ value: 0 });
    const failure = new Error("first scheduler's effect failed");
    const seen: number[] = [];
    first.effect(() => {
      if (state.value === 1) throw failure;
    });
    second.effect(() => seen.push(state.value));

    state.value = 1;
    await expect(second.nextUpdate()).resolves.toBeUndefined();
    expect(seen).toEqual([0, 1]);
    await expect(first.nextUpdate()).rejects.toBe(failure);
  });

  it("waits until effects queued by effects have run, however deep", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ a: 0, b: 0, c: 0, d: 0 });
    scheduler.effect(() => {
      state.b = state.a;
    });
    scheduler.effect(() => {
      state.c = state.b;
    });
    scheduler.effect(() => {
      state.d = state.c;
    });

    state.a = 1;
    await scheduler.nextUpdate();
    expect(state.d).toBe(1);
  });

  it("drops and reports a queue that does not settle", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ n: 0 });
    const runs = vi.fn(() => {
      state.n = state.n + 1;
    });
    scheduler.effect(runs, { owner: "mount:counter" });
    state.n = 10;

    await expect(scheduler.nextUpdate()).rejects.toThrow(
      "Reactive effects did not settle after 100 rounds; still queued: mount:counter.",
    );
    const settled = runs.mock.calls.length;
    await scheduler.nextUpdate();
    expect(runs).toHaveBeenCalledTimes(settled);
  });
});

describe("computed values", () => {
  it("computes lazily and only again after a dependency changed", () => {
    const state = reactive({ a: 1, b: 2 });
    const getter = vi.fn(() => state.a + state.b);
    const sum = computed(getter);

    expect(getter).not.toHaveBeenCalled();
    expect(sum.value).toBe(3);
    expect(sum.value).toBe(3);
    expect(getter).toHaveBeenCalledOnce();

    state.a = 10;
    state.b = 20;
    expect(getter).toHaveBeenCalledOnce();
    expect(sum.value).toBe(30);
    expect(getter).toHaveBeenCalledTimes(2);
  });

  it("does not recompute for a write that changes nothing", () => {
    const state = reactive({ a: 1 });
    const getter = vi.fn(() => state.a * 2);
    const double = computed(getter);
    void double.value;
    state.a = 1;
    void double.value;
    expect(getter).toHaveBeenCalledOnce();
  });

  it("reruns the effects that read it when a dependency changes", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ items: [1, 2] });
    const total = computed(() => state.items.reduce((sum, item) => sum + item, 0));
    const observed: number[] = [];
    scheduler.effect(() => observed.push(total.value));

    state.items.push(3);
    await scheduler.nextUpdate();
    expect(observed).toEqual([3, 6]);
  });

  it("chains through another computed value", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ n: 2 });
    const innerGetter = vi.fn(() => state.n * 2);
    const inner = computed(innerGetter);
    const outer = computed(() => inner.value + 1);
    const observed: number[] = [];
    scheduler.effect(() => observed.push(outer.value));

    state.n = 5;
    await scheduler.nextUpdate();
    expect(observed).toEqual([5, 11]);
    expect(innerGetter).toHaveBeenCalledTimes(2);
  });

  it("recomputes after a failed evaluation once a dependency changes", () => {
    const state = reactive({ fail: true, n: 1 });
    const value = computed(() => {
      if (state.fail) throw new Error("not yet");
      return state.n;
    });
    expect(() => value.value).toThrow("not yet");
    state.fail = false;
    expect(value.value).toBe(1);
  });

  it("drops its dependencies when stopped and computes afresh afterwards", () => {
    const state = reactive({ n: 1 });
    const getter = vi.fn(() => state.n);
    const value = computed(getter);
    void value.value;
    expect(dependentCount(state, "n")).toBe(1);

    value.stop();
    expect(value.active).toBe(false);
    expect(dependentCount(state, "n")).toBe(0);
    state.n = 2;
    expect(value.value).toBe(2);
    expect(value.value).toBe(2);
    expect(getter).toHaveBeenCalledTimes(3);
    expect(dependentCount(state, "n")).toBe(0);
  });
});

describe("computed values that recompute to an equal value", () => {
  it("do not re-run the effects that read them", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ n: 2 });
    const getter = vi.fn(() => state.n % 2 === 0);
    const even = computed(getter);
    const runs = vi.fn(() => even.value);
    scheduler.effect(runs);

    state.n = 4;
    await scheduler.nextUpdate();
    expect(getter).toHaveBeenCalledTimes(2);
    expect(runs).toHaveBeenCalledOnce();
  });

  it("stop a chain: an outer value whose inner one is unchanged neither recomputes nor re-runs its effect", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ n: 2 });
    const innerGetter = vi.fn(() => state.n % 2 === 0);
    const outerGetter = vi.fn(() => (inner.value ? "even" : "odd"));
    const inner = computed(innerGetter);
    const outer = computed(outerGetter);
    const runs = vi.fn(() => outer.value);
    scheduler.effect(runs);

    state.n = 6;
    await scheduler.nextUpdate();
    expect(innerGetter).toHaveBeenCalledTimes(2);
    expect(outerGetter).toHaveBeenCalledOnce();
    expect(runs).toHaveBeenCalledOnce();
  });

  it("run the effect when the value changes after an equal recomputation", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ n: 2 });
    const even = computed(() => state.n % 2 === 0);
    const observed: boolean[] = [];
    scheduler.effect(() => observed.push(even.value));

    state.n = 4;
    await scheduler.nextUpdate();
    state.n = 5;
    await scheduler.nextUpdate();
    expect(observed).toEqual([true, false]);
  });

  it("still re-run an effect that also read a written key directly", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ n: 2, label: "a" });
    const even = computed(() => state.n % 2 === 0);
    const observed: string[] = [];
    scheduler.effect(() => observed.push(`${state.label}:${String(even.value)}`));

    state.n = 4;
    state.label = "b";
    await scheduler.nextUpdate();
    expect(observed).toEqual(["a:true", "b:true"]);
  });

  it("keep batching: several writes in one microtask cost one evaluation", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ a: 1, b: 1 });
    const getter = vi.fn(() => state.a + state.b);
    const sum = computed(getter);
    const runs = vi.fn(() => sum.value);
    scheduler.effect(runs);

    state.a = 2;
    state.b = 3;
    state.a = 4;
    await scheduler.nextUpdate();
    expect(getter).toHaveBeenCalledTimes(2);
    expect(runs).toHaveBeenCalledTimes(2);
  });

  it("keep laziness: a value nobody reads is not evaluated by a write", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ n: 1 });
    const innerGetter = vi.fn(() => state.n * 2);
    const inner = computed(innerGetter);
    const outerGetter = vi.fn(() => inner.value + 1);
    const outer = computed(outerGetter);
    expect(outer.value).toBe(3);

    state.n = 2;
    state.n = 3;
    await scheduler.nextUpdate();
    expect(innerGetter).toHaveBeenCalledOnce();
    expect(outerGetter).toHaveBeenCalledOnce();
    expect(outer.value).toBe(7);
    expect(innerGetter).toHaveBeenCalledTimes(2);
    expect(outerGetter).toHaveBeenCalledTimes(2);
  });

  it("re-run an effect whose read failed once the value can be computed, even if it equals the old one", async () => {
    const scheduler = new Scheduler();
    const state = reactive({ fail: false, n: 1 });
    const value = computed(() => {
      if (state.fail) throw new Error("not now");
      return state.n;
    });
    const observed: number[] = [];
    const errors: unknown[] = [];
    scheduler.effect(() => observed.push(value.value), { onError: (error) => errors.push(error) });

    state.fail = true;
    await scheduler.nextUpdate();
    state.fail = false;
    await scheduler.nextUpdate();
    expect(errors).toHaveLength(1);
    expect(observed).toEqual([1, 1]);
  });
});

describe("with the kernel", () => {
  function frameDocument(): { document: Document; remove: () => void } {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const owner = frame.contentDocument;
    if (!owner) throw new Error("no frame document");
    owner.body.innerHTML = "<main></main>";
    return {
      document: owner,
      remove: () => {
        frame.remove();
      },
    };
  }

  it("holds the render barrier until effects scheduled right after commit have run", async () => {
    const { document: owner, remove } = frameDocument();
    const scheduler = new Scheduler();
    const kernel = new Kernel(owner, { flush: () => scheduler.nextUpdate() });
    const state = reactive({ value: 0 });
    let observed = 0;
    scheduler.effect(() => {
      observed = state.value;
    });
    const main = owner.querySelector("main");
    if (!main) throw new Error("no main");

    const transaction = kernel.beginRender(main);
    const enhanced = kernel.whenEnhanced();
    transaction.commit();
    state.value = 1;
    await enhanced;

    expect(observed).toBe(1);
    kernel.dispose();
    remove();
  });

  it("reports an effect failure through whenEnhanced, once", async () => {
    const { document: owner, remove } = frameDocument();
    const scheduler = new Scheduler();
    const kernel = new Kernel(owner, { flush: () => scheduler.nextUpdate() });
    const state = reactive({ fail: false });
    const failure = new Error("enhancement failed");
    scheduler.effect(() => {
      if (state.fail) throw failure;
    });

    state.fail = true;
    await expect(kernel.whenEnhanced()).rejects.toThrow(failure);
    await expect(kernel.whenEnhanced()).resolves.toBeUndefined();
    kernel.dispose();
    remove();
  });
});
