// The no-eval expression engine: the ExpressionEngine seam over the tokenizer, parser and
// evaluator in this directory, for pages whose Content-Security-Policy refuses 'unsafe-eval'.
// Ported from jqstar `src/csp/engine.ts` (the bounded LRU cache, disposal). Nothing here compiles
// code from strings, and nothing imports the trusted engine (docs/decisions.md, ticket #22).
import { ExpressionError } from "../expression-shared.ts";
import type { ExpressionContext, ExpressionEngine, ExpressionLocation, StatementEvaluator, ValueEvaluator } from "../expression-shared.ts";
import { isThenable } from "../values.ts";
import type { ExpressionNode, ProgramNode } from "./ast.ts";
import { evaluate } from "./evaluator.ts";
import { parse } from "./parser.ts";
import type { EntryKind } from "./parser.ts";

export { NOEVAL_LIMITS, NoEvalError } from "./diagnostics.ts";

/** jqstar's cache bounds: at most this many compiled expressions, and about this many bytes of source. */
export const NOEVAL_CACHE_LIMITS = Object.freeze({ entries: 128, bytes: 262_144 });

interface Entry {
  readonly bytes: number;
  readonly evaluator: ValueEvaluator | StatementEvaluator;
}

export function createNoEvalExpressionEngine(): ExpressionEngine {
  const cache = new Map<string, Entry>();
  let cacheBytes = 0;
  let disposed = false;
  const active = (): boolean => !disposed;

  const assertActive = (): void => {
    if (disposed) throw new Error("This Tessera expression engine has been disposed.");
  };

  const compile = (entry: EntryKind, input: string, inputLocation: ExpressionLocation | undefined): ValueEvaluator | StatementEvaluator => {
    assertActive();
    const source = entry === "statement" ? input.trim() : input;
    const location = inputLocation ? Object.freeze({ ...inputLocation }) : undefined;
    const key = JSON.stringify([entry, source, location?.attribute ?? null, location?.line ?? null, location?.column ?? null]);
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.evaluator;
    }

    let root: ExpressionNode | ProgramNode;
    try {
      root = parse(source, entry, location);
    } catch (error) {
      throw new ExpressionError(source, "compile", error, location);
    }
    const run = (context: ExpressionContext): unknown => {
      assertActive();
      return evaluate(root, source, context, location, active);
    };
    const fail = (error: unknown, context: ExpressionContext): ExpressionError =>
      error instanceof ExpressionError ? error : new ExpressionError(source, "evaluate", error, location, context.element);

    // A statement settles as a promise, as the trusted engine's async function does; a value
    // throws at once, and only a promise it returns rejects later.
    const evaluator =
      entry === "statement"
        ? (context: ExpressionContext): Promise<unknown> =>
            new Promise((resolve) => {
              resolve(run(context));
            }).catch((error: unknown) => {
              throw fail(error, context);
            })
        : (context: ExpressionContext): unknown => {
            let result: unknown;
            try {
              result = run(context);
            } catch (error) {
              throw fail(error, context);
            }
            if (!isThenable(result)) return result;
            return Promise.resolve(result).catch((error: unknown) => {
              throw fail(error, context);
            });
          };

    const bytes = (source.length + key.length) * 2;
    if (bytes <= NOEVAL_CACHE_LIMITS.bytes) {
      cache.set(key, { bytes, evaluator });
      cacheBytes += bytes;
      while (cache.size > NOEVAL_CACHE_LIMITS.entries || cacheBytes > NOEVAL_CACHE_LIMITS.bytes) {
        const [oldest] = cache.keys();
        if (oldest === undefined) break;
        cacheBytes -= cache.get(oldest)?.bytes ?? 0;
        cache.delete(oldest);
      }
    }
    return evaluator;
  };

  return Object.freeze<ExpressionEngine>({
    compileValue: (source, location) => compile("value", source, location),
    compileStatement: (source, location) => compile("statement", source, location),
    clearCache() {
      assertActive();
      cache.clear();
      cacheBytes = 0;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cache.clear();
      cacheBytes = 0;
    },
  });
}
