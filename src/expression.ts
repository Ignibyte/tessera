// The trusted expression engine: Datastar-style expressions compiled with `new Function` and
// evaluated in a closed scope. Ported from jqstar `src/expression.ts` and
// `src/expression-types.ts`, without jQuery, with a scope that never falls through to the
// page's globals, and with actions allowed anywhere in an expression.
//
// The engine sits behind a four-method seam (`ExpressionEngine`) so the no-eval engine of
// jqstar `src/csp/` can replace it.
import { ACTION_METHODS } from "./actions.ts";
import type { ActionMethod } from "./actions.ts";
import { ExpressionError, EXPRESSION_BUILTINS, invokeAction, unknownIdentifier } from "./expression-shared.ts";
import type { ExpressionContext, ExpressionEngine, ExpressionLocation, StatementEvaluator, ValueEvaluator } from "./expression-shared.ts";
import { isThenable } from "./values.ts";

export { ExpressionError, EXPRESSION_BUILTINS } from "./expression-shared.ts";
export type {
  ExpressionContext,
  ExpressionEngine,
  ExpressionLocation,
  HelperScope,
  StatementEvaluator,
  ValueEvaluator,
} from "./expression-shared.ts";

/** The fixed binding an `@method(` rewrites to. */
const ACTION_BINDING = "__tesseraAction";

function skipQuoted(source: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") index += 2;
    else if (character === quote) return index + 1;
    else index++;
  }
  return source.length;
}

/**
 * Rewrites each `@method(` outside string literals, template literals and comments into a
 * call on the action binding. Inside a template literal's `${…}` an action is not rewritten,
 * so it fails to compile rather than run.
 */
export function rewriteActions(source: string): string {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? "";
    const next = source[index + 1];
    let end: number;
    if (character === "'" || character === '"' || character === "`") {
      end = skipQuoted(source, index, character);
    } else if (character === "/" && next === "/") {
      const newline = source.indexOf("\n", index);
      end = newline < 0 ? source.length : newline;
    } else if (character === "/" && next === "*") {
      const close = source.indexOf("*/", index + 2);
      end = close < 0 ? source.length : close + 2;
    } else if (character === "@") {
      const action = /^@([A-Za-z_$][\w$]*)\s*\(/.exec(source.slice(index));
      const name = action?.[1];
      if (!action || name === undefined) {
        throw new SyntaxError("An action is a call: @get(…), @post(…), @put(…), @patch(…) or @delete(…).");
      }
      if (!(ACTION_METHODS as readonly string[]).includes(name)) {
        throw new SyntaxError(`Unknown action @${name}; the actions are @${ACTION_METHODS.join(", @")}.`);
      }
      output += `${ACTION_BINDING}(${JSON.stringify(name)}, `;
      index += action[0].length;
      continue;
    } else {
      end = index + 1;
    }
    output += source.slice(index, end);
    index = end;
  }
  return output;
}

function isSignalName(key: string): boolean {
  return key.length > 1 && key.startsWith("$");
}

/**
 * The closed scope: every name resolves here, so none reaches the global object. The `with`
 * block sits inside the compiled function, so its own `scope` and `element` parameters are
 * read before the proxy sees any name.
 */
function scopeFor(context: ExpressionContext): object {
  const fixed = Object.assign(Object.create(null) as Record<string, unknown>, context.helpers ?? {}, {
    el: context.element,
    evt: context.event,
    [ACTION_BINDING]: (method: ActionMethod, ...args: unknown[]) => invokeAction(context, method, args),
  });
  const globals = globalThis as unknown as Record<string, unknown>;

  return new Proxy(fixed, {
    has(_target, key) {
      return key !== Symbol.unscopables;
    },
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (Object.hasOwn(target, key)) return target[key];
      if (isSignalName(key)) return context.signals[key.slice(1)];
      if (EXPRESSION_BUILTINS.has(key)) return globals[key];
      throw unknownIdentifier(key);
    },
    set(_target, key, value) {
      if (typeof key === "string" && isSignalName(key)) {
        context.signals[key.slice(1)] = value;
        return true;
      }
      throw new TypeError(`Cannot assign to ${String(key)}: an expression assigns only to signals ($name).`);
    },
  });
}

function wrapError(
  error: unknown,
  source: string,
  phase: "compile" | "evaluate",
  location: ExpressionLocation | undefined,
  element?: Element,
): ExpressionError {
  return error instanceof ExpressionError ? error : new ExpressionError(source, phase, error, location, element);
}

function wrapResult(result: unknown, source: string, location: ExpressionLocation | undefined, element: Element): unknown {
  if (!isThenable(result)) return result;
  return Promise.resolve(result).catch((error: unknown) => {
    throw wrapError(error, source, "evaluate", location, element);
  });
}

function cacheKey(source: string, location: ExpressionLocation | undefined): string {
  return JSON.stringify([source, location?.attribute ?? null, location?.line ?? null, location?.column ?? null]);
}

export function createTrustedExpressionEngine(): ExpressionEngine {
  const values = new Map<string, ValueEvaluator>();
  const statements = new Map<string, StatementEvaluator>();
  let disposed = false;

  const assertActive = (): void => {
    if (disposed) throw new Error("This Tessera expression engine has been disposed.");
  };

  const compile = <Evaluator>(
    cache: Map<string, Evaluator>,
    source: string,
    inputLocation: ExpressionLocation | undefined,
    body: (rewritten: string) => string,
  ): Evaluator => {
    assertActive();
    const location = inputLocation ? Object.freeze({ ...inputLocation }) : undefined;
    const key = cacheKey(source, location);
    const cached = cache.get(key);
    if (cached) return cached;

    let evaluator: (scope: object, element: Element) => unknown;
    try {
      evaluator = new Function("scope", "element", body(rewriteActions(source))) as typeof evaluator;
    } catch (error) {
      throw wrapError(error, source, "compile", location);
    }
    const compiled = ((context: ExpressionContext): unknown => {
      assertActive();
      try {
        return wrapResult(evaluator(scopeFor(context), context.element), source, location, context.element);
      } catch (error) {
        throw wrapError(error, source, "evaluate", location, context.element);
      }
    }) as Evaluator;
    cache.set(key, compiled);
    return compiled;
  };

  return {
    compileValue: (source, location) =>
      compile(values, source, location, (code) => `return (function () { with (scope) { return (${code}); } }).call(element);`),
    compileStatement: (source, location) =>
      compile(statements, source.trim(), location, (code) => `return (async function () { with (scope) {\n${code}\n} }).call(element);`),
    clearCache() {
      assertActive();
      values.clear();
      statements.clear();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      values.clear();
      statements.clear();
    },
  };
}
