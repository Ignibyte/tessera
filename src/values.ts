// Value checks shared across the runtime. Ported from jqstar `src/value-checks.ts`.

/** A plain object: `{}` or `Object.create(null)`, not an array, a class instance or a node. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    ((typeof value === "object" && value !== null) || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  );
}

/** A deep copy of plain objects and arrays; any other value is kept as it is. */
export function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)])) as T;
  }
  return value;
}

/**
 * How a value shows as text: nothing for `null` and `undefined`, JSON for plain objects and
 * arrays, and the value's own `toString` for anything else.
 */
export function toText(value: unknown): string {
  if (value === null || value === undefined || typeof value === "function") return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value) || isPlainRecord(value)) return JSON.stringify(value);
  return (value as { toString(): string }).toString();
}
