// Signals: Proxies over plain objects and arrays that record which effects read which keys,
// and re-run those effects in a microtask after a write. Ported from jqstar
// `src/reactivity.ts`, with `in` and key iteration tracked, array mutators that do not track,
// memoized computed values, and one scheduler per runtime instead of one per realm. Only plain
// objects and arrays read from a reactive object come back reactive; DOM nodes, class
// instances, Maps and Sets come back as themselves.
//
// Computed values are push-pull, as in Vue 3.4 and Preact Signals: a write pushes marks only
// (`dirty` to what read the written key, `check` beyond a computed value), and a value is pulled
// when read. A computed value that recomputes to an `Object.is`-equal value keeps its version, so
// what read it neither recomputes nor re-runs.
import { isPlainRecord } from "./values.ts";

type Key = PropertyKey;

/** The key an iteration (`Object.keys`, `for…in`, spread) of a plain object depends on. */
const ITERATE = Symbol("iterate");

/** How many flush rounds in a row may still leave work queued before the queue is dropped. */
const MAX_ROUNDS = 100;

/**
 * What a change tells a subscriber: `dirty`, a key it read was written; `check`, a computed value
 * it read may have changed, which only pulling that value can tell.
 */
type Notice = "dirty" | "check";

/** A computed value as its readers see it: brought up to date by `refresh`, versioned. */
interface Source {
  /** Goes up each time a recomputation gives a value not `Object.is`-equal to the last. */
  readonly version: number;
  /** Recomputes if needed; throws what the getter threw. */
  refresh(): void;
}

/** The version a reader records for a source whose evaluation failed: it never matches. */
const FAILED = -1;

/** Anything that depends on reactive reads: an effect, or a computed value's evaluation. */
interface Subscriber {
  active: boolean;
  dependencies: Set<Subscriber>[];
  /** The computed values read on the last run, with the version each had then. */
  sources: Map<Source, number>;
  notify(notice: Notice): void;
}

export interface EffectOptions {
  owner?: string;
  onError?: (error: unknown, effect: ReactiveEffect) => void;
}

export interface ReactiveEffect extends Subscriber {
  (): void;
  owner: string | undefined;
  onError: EffectOptions["onError"];
}

export interface Computed<T> {
  /** The value, recomputed only when a dependency changed since the last read. */
  readonly value: T;
  readonly active: boolean;
  /** Drops the dependencies; later reads compute afresh without caching or tracking. */
  stop(): void;
}

const dependencies = new WeakMap<object, Map<Key, Set<Subscriber>>>();
const proxies = new WeakMap<object, object>();
const rawValues = new WeakMap<object, object>();
const arrayMutators = new Set<Key>(["push", "pop", "shift", "unshift", "splice"]);

let currentSubscriber: Subscriber | undefined;
let trackingPaused = 0;

function cleanup(subscriber: Subscriber): void {
  for (const dependency of subscriber.dependencies) dependency.delete(subscriber);
  subscriber.dependencies.length = 0;
  subscriber.sources.clear();
}

/** Whether a computed value the subscriber read has a new version since; a failure counts. */
function sourcesChanged(subscriber: Subscriber): boolean {
  for (const [source, seen] of subscriber.sources) {
    try {
      source.refresh();
    } catch {
      return true;
    }
    if (source.version !== seen) return true;
  }
  return false;
}

function tracking(): Subscriber | undefined {
  return trackingPaused > 0 || !currentSubscriber?.active ? undefined : currentSubscriber;
}

function track(target: object, key: Key): void {
  const subscriber = tracking();
  if (!subscriber) return;

  let byKey = dependencies.get(target);
  if (!byKey) {
    byKey = new Map();
    dependencies.set(target, byKey);
  }
  let subscribers = byKey.get(key);
  if (!subscribers) {
    subscribers = new Set();
    byKey.set(key, subscribers);
  }
  if (!subscribers.has(subscriber)) {
    subscribers.add(subscriber);
    subscriber.dependencies.push(subscribers);
  }
}

function trigger(target: object, key: Key, notice: Notice = "dirty"): void {
  const subscribers = dependencies.get(target)?.get(key);
  if (!subscribers) return;
  for (const subscriber of Array.from(subscribers)) subscriber.notify(notice);
}

/** Runs `fn` with `subscriber` collecting the reads, replacing what it depended on before. */
function collect<T>(subscriber: Subscriber, fn: () => T): T {
  cleanup(subscriber);
  const previous = currentSubscriber;
  currentSubscriber = subscriber;
  try {
    return fn();
  } finally {
    currentSubscriber = previous;
  }
}

/** Tells the effects reading `key` of `target` (a proxy or its raw object) that it changed. */
export function notifyPropertyChange(target: object, key: Key): void {
  trigger(rawValues.get(target) ?? target, key);
}

/** How many subscribers depend on `target`, on one key or on all of them. For diagnostics. */
export function dependentCount(target: object, key?: Key): number {
  const byKey = dependencies.get(rawValues.get(target) ?? target);
  if (!byKey) return 0;
  if (key !== undefined) return byKey.get(key)?.size ?? 0;
  let count = 0;
  for (const subscribers of byKey.values()) count += subscribers.size;
  return count;
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isIndex(key: Key): key is string {
  return typeof key === "string" && /^(0|[1-9]\d*)$/.test(key);
}

/** The raw object behind a reactive proxy, or the value itself. */
export function toRaw<T>(value: T): T {
  return isObject(value) ? ((rawValues.get(value) as T | undefined) ?? value) : value;
}

export function reactive<T extends object>(target: T): T {
  if (rawValues.has(target)) return target;
  const existing = proxies.get(target);
  if (existing) return existing as T;

  const proxy = new Proxy(target, {
    get(source, key, receiver) {
      const value = Reflect.get(source, key, receiver) as unknown;
      if (Array.isArray(source) && arrayMutators.has(key) && typeof value === "function") {
        // A mutator reads `length` while it writes it; tracking that read would make an
        // effect that pushes re-run itself.
        return function (this: unknown, ...args: unknown[]): unknown {
          trackingPaused++;
          try {
            return (value as (...values: unknown[]) => unknown).apply(this, args);
          } finally {
            trackingPaused--;
          }
        };
      }
      track(source, key);
      return Array.isArray(value) || isPlainRecord(value) ? reactive(value) : value;
    },

    set(source, key, value, receiver) {
      const isArray = Array.isArray(source);
      const hadKey = isArray && isIndex(key) ? Number(key) < source.length : Object.hasOwn(source, key);
      const oldLength = isArray ? source.length : 0;
      const oldValue = Reflect.get(source, key, receiver) as unknown;
      const rawValue = toRaw(value as unknown);
      const changed = !Object.is(oldValue, rawValue);
      const updated = Reflect.set(source, key, rawValue, receiver);
      if (!updated) return false;

      if (changed || !hadKey) trigger(source, key);
      if (!isArray) {
        if (!hadKey) trigger(source, ITERATE);
      } else if (source.length !== oldLength) {
        trigger(source, "length");
        for (let index = source.length; index < oldLength; index++) trigger(source, String(index));
      }
      return true;
    },

    deleteProperty(source, key) {
      const existed = Object.hasOwn(source, key);
      const deleted = Reflect.deleteProperty(source, key);
      if (deleted && existed) {
        trigger(source, key);
        if (!Array.isArray(source)) trigger(source, ITERATE);
      }
      return deleted;
    },

    has(source, key) {
      track(source, key);
      return Reflect.has(source, key);
    },

    ownKeys(source) {
      track(source, Array.isArray(source) ? "length" : ITERATE);
      return Reflect.ownKeys(source);
    },
  });

  proxies.set(target, proxy);
  rawValues.set(proxy, target);
  return proxy;
}

export function stop(effect: ReactiveEffect): void {
  if (!effect.active) return;
  effect.active = false;
  cleanup(effect);
}

/**
 * A value derived from reactive reads, cached until one of them changes. Reading `value`
 * inside an effect or another computed value makes it a dependency there. A recomputation that
 * gives an `Object.is`-equal value changes nothing for what read it.
 */
export function computed<T>(getter: () => T): Computed<T> {
  let state: "clean" | "check" | "dirty" = "dirty";
  let failed = false;
  let evaluated = false;
  let version = 0;
  let cached: T;
  const evaluation: Subscriber = {
    active: true,
    dependencies: [],
    sources: new Map(),
    notify: (notice) => {
      // Readers were told when this value left `clean`; a failed one tells them again.
      const passOn = state === "clean" || failed;
      if (notice === "dirty") state = "dirty";
      else if (state === "clean") state = "check";
      if (passOn) trigger(handle, "value", "check");
    },
  };
  const source: Source = {
    get version() {
      return version;
    },
    refresh() {
      if (state === "clean" || !evaluation.active) return;
      if (state === "check" && !sourcesChanged(evaluation)) {
        state = "clean";
        return;
      }
      let value: T;
      try {
        value = collect(evaluation, getter);
      } catch (error) {
        state = "dirty";
        failed = true;
        throw error;
      }
      failed = false;
      state = "clean";
      if (!evaluated || !Object.is(value, cached)) {
        cached = value;
        evaluated = true;
        version++;
      }
    },
  };
  const handle: Computed<T> = {
    get value() {
      track(handle, "value");
      if (!evaluation.active) return getter();
      const reader = tracking();
      reader?.sources.set(source, FAILED);
      source.refresh();
      reader?.sources.set(source, version);
      return cached;
    },
    get active() {
      return evaluation.active;
    },
    stop() {
      evaluation.active = false;
      cleanup(evaluation);
    },
  };
  return handle;
}

/**
 * One runtime's effect queue: its effects re-run in a microtask after the writes they read,
 * and `nextUpdate` waits for this queue alone and reports its failures.
 */
export class Scheduler {
  /** Each pending effect with its strongest notice: a `check` one runs only if a source changed. */
  readonly #pending = new Map<ReactiveEffect, Notice>();
  readonly #errors: unknown[] = [];
  #flushPending = false;
  #rounds = 0;

  /** Runs `fn` now and again after any write to what it read. */
  effect(fn: () => void, options: EffectOptions = {}): ReactiveEffect {
    const runner = (() => {
      if (!runner.active) return;
      collect(runner, fn);
    }) as ReactiveEffect;
    runner.active = true;
    runner.dependencies = [];
    runner.sources = new Map();
    runner.owner = options.owner;
    runner.onError = options.onError;
    runner.notify = (notice) => {
      this.#schedule(runner, notice);
    };
    try {
      runner();
    } catch (error) {
      stop(runner);
      throw error;
    }
    return runner;
  }

  /** Resolves once this queue is empty; rejects with what its unowned effects threw. */
  async nextUpdate(): Promise<void> {
    do {
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
    } while (this.#flushPending || this.#pending.size > 0);
    if (this.#errors.length > 0) {
      const errors = this.#errors.splice(0);
      throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Reactive effect updates failed.");
    }
  }

  #schedule(effect: ReactiveEffect, notice: Notice): void {
    if (!effect.active) return;
    if (this.#pending.get(effect) !== "dirty") this.#pending.set(effect, notice);
    this.#requestFlush();
  }

  #requestFlush(): void {
    if (this.#flushPending) return;
    this.#flushPending = true;
    queueMicrotask(() => {
      this.#flush();
    });
  }

  #flush(): void {
    this.#flushPending = false;
    const effects = Array.from(this.#pending);
    this.#pending.clear();

    for (const [effect, notice] of effects) {
      if (!effect.active || (notice === "check" && !sourcesChanged(effect))) continue;
      try {
        effect();
      } catch (error) {
        if (effect.onError) {
          try {
            effect.onError(error, effect);
          } catch (reportingError) {
            this.#errors.push(error, reportingError);
          }
        } else {
          this.#errors.push(error);
        }
      }
    }

    if (this.#pending.size === 0) {
      this.#rounds = 0;
      return;
    }
    if (++this.#rounds >= MAX_ROUNDS) {
      const owners = [...new Set(Array.from(this.#pending.keys(), (effect) => effect.owner ?? "unowned"))];
      this.#pending.clear();
      this.#rounds = 0;
      this.#errors.push(
        new Error(
          `Reactive effects did not settle after ${MAX_ROUNDS} rounds; still queued: ${owners.join(", ")}.`,
        ),
      );
      return;
    }
    this.#requestFlush();
  }
}
