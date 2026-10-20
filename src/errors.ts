// Error collection for cleanup that must attempt every step. Ported from jqstar `src/errors.ts`,
// with `errorFields` from jqstar `src/value-checks.ts`.

/** Throws nothing for no errors, the error itself for one, an `AggregateError` for more. */
export function throwCollectedErrors(errors: readonly unknown[], message: string): void {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}

/** Runs `callback`, collecting what it throws instead of stopping. */
export function attempt(errors: unknown[], callback: () => void): void {
  try {
    callback();
  } catch (error) {
    errors.push(error);
  }
}

/**
 * The name and message of a thrown value, reading each accessor once and surviving hostile
 * ones. A non-Error value is named `ThrownValue` and described by `describeThrown`.
 */
export function errorFields(
  error: unknown,
  fallback: string,
  describeThrown: (value: unknown) => string,
  keepEmptyMessage = true,
): { name: string; message: string } {
  let name = "ThrownValue";
  let message = fallback;
  try {
    if (error instanceof Error) {
      name = "Error";
      try {
        const value: unknown = error.name;
        if (typeof value === "string" && value) name = value;
      } catch {
        // Read each accessor once without replacing the original failure.
      }
      try {
        const value: unknown = error.message;
        if (typeof value === "string" && (keepEmptyMessage || value)) message = value;
      } catch {
        // A hostile message must not discard a readable name.
      }
    } else {
      message = describeThrown(error);
    }
  } catch {
    // Prototype traps and thrown-value conversion can fail too.
  }
  return { name, message };
}
