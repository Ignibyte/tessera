// The no-eval engine's limits and diagnostics: every failure names a code, a phase and the span of
// source it concerns. Ported from jqstar `src/csp/contract.ts` and `src/csp/diagnostics.ts`,
// without the codes of jqstar's jQuery, computed and store capabilities.
import type { ExpressionLocation } from "../expression-shared.ts";

/** jqstar's limits, unchanged: an expression is bounded in size and in the work it may do. */
export const NOEVAL_LIMITS = Object.freeze({
  sourceLength: 2_048,
  tokens: 512,
  nesting: 16,
  astNodes: 256,
  literalEntries: 64,
  pathSegments: 8,
  callArguments: 8,
  evaluationSteps: 128,
  collectionSize: 128,
  asyncChain: 8,
});

export const NOEVAL_DIAGNOSTICS = Object.freeze({
  sourceLength: { code: "NOEVAL_LIMIT_SOURCE_LENGTH", phase: "compile", detail: "the expression is longer than 2,048 characters" },
  invalidCharacter: { code: "NOEVAL_TOKEN_INVALID_CHARACTER", phase: "compile", detail: "a character the grammar does not use" },
  invalidEscape: { code: "NOEVAL_TOKEN_INVALID_ESCAPE", phase: "compile", detail: "an escape the grammar does not know" },
  numberFormat: { code: "NOEVAL_TOKEN_NUMBER", phase: "compile", detail: "a number the grammar does not read" },
  unterminatedString: { code: "NOEVAL_TOKEN_UNTERMINATED_STRING", phase: "compile", detail: "a string without its closing quote" },
  unexpectedToken: { code: "NOEVAL_PARSE_UNEXPECTED_TOKEN", phase: "compile", detail: "an unexpected token" },
  expectedToken: { code: "NOEVAL_PARSE_EXPECTED_TOKEN", phase: "compile", detail: "a missing token" },
  trailingInput: { code: "NOEVAL_PARSE_TRAILING_INPUT", phase: "compile", detail: "input after the end of the expression" },
  unsupportedSyntax: {
    code: "NOEVAL_PARSE_UNSUPPORTED_SYNTAX",
    phase: "compile",
    detail: "syntax the no-eval engine does not support (docs/decisions.md lists what it leaves out)",
  },
  duplicateKey: { code: "NOEVAL_PARSE_DUPLICATE_KEY", phase: "compile", detail: "a key given twice" },
  unknownAction: { code: "NOEVAL_PARSE_ACTION", phase: "compile", detail: "an action is a call: @get(…), @post(…), @put(…), @patch(…) or @delete(…)" },
  invalidLvalue: { code: "NOEVAL_CAPABILITY_LVALUE", phase: "compile", detail: "only a signal, its data or an element's writable property can be assigned" },
  unknownIdentifier: { code: "NOEVAL_CAPABILITY_IDENTIFIER", phase: "evaluate", detail: "a name not in scope" },
  unavailableBuiltin: { code: "NOEVAL_CAPABILITY_BUILTIN", phase: "evaluate", detail: "a built-in the no-eval engine does not offer" },
  deniedProperty: { code: "NOEVAL_CAPABILITY_PROPERTY", phase: "evaluate", detail: "a property this value does not offer" },
  deniedCall: { code: "NOEVAL_CAPABILITY_CALL", phase: "evaluate", detail: "a call this value does not offer" },
  deniedAccessor: { code: "NOEVAL_CAPABILITY_ACCESSOR", phase: "evaluate", detail: "a property defined by an accessor" },
  deniedValue: { code: "NOEVAL_CAPABILITY_VALUE", phase: "evaluate", detail: "a value the no-eval engine does not pass on" },
  deniedWrite: { code: "NOEVAL_CAPABILITY_WRITE", phase: "evaluate", detail: "a property this value does not let an expression write" },
  propertyAbsent: { code: "NOEVAL_PROPERTY_ABSENT", phase: "evaluate", detail: "a property of null or undefined" },
  numericResult: { code: "NOEVAL_EVALUATE_NUMBER", phase: "evaluate", detail: "arithmetic needs finite numbers and gives one" },
  operandType: { code: "NOEVAL_EVALUATE_TYPE", phase: "evaluate", detail: "operands of types this operator does not combine" },
  asyncValue: { code: "NOEVAL_ASYNC_VALUE", phase: "evaluate", detail: "a promise used where a value is needed, or await of a value that is no promise" },
  asyncRejection: { code: "NOEVAL_ASYNC_REJECTION", phase: "evaluate", detail: "an awaited promise rejected" },
  engineDisposed: { code: "NOEVAL_ENGINE_DISPOSED", phase: "evaluate", detail: "the engine has been disposed" },
  tokenLimit: { code: "NOEVAL_LIMIT_TOKENS", phase: "compile", detail: "more than 512 tokens" },
  nestingLimit: { code: "NOEVAL_LIMIT_NESTING", phase: "compile", detail: "brackets nested deeper than 16" },
  nodeLimit: { code: "NOEVAL_LIMIT_AST_NODES", phase: "compile", detail: "more than 256 syntax nodes" },
  literalLimit: { code: "NOEVAL_LIMIT_LITERAL_ENTRIES", phase: "compile", detail: "an array or object literal with more than 64 entries" },
  pathLimit: { code: "NOEVAL_LIMIT_PATH_SEGMENTS", phase: "compile", detail: "a path of more than 8 segments" },
  argumentLimit: { code: "NOEVAL_LIMIT_CALL_ARGUMENTS", phase: "compile", detail: "a call with more than 8 arguments" },
  stepLimit: { code: "NOEVAL_LIMIT_EVALUATION_STEPS", phase: "evaluate", detail: "more than 128 evaluation steps" },
  collectionLimit: { code: "NOEVAL_LIMIT_COLLECTION_SIZE", phase: "evaluate", detail: "a collection of more than 128 items" },
  asyncLimit: { code: "NOEVAL_LIMIT_ASYNC_CHAIN", phase: "evaluate", detail: "more than 8 asynchronous steps" },
} as const);

export type NoEvalDiagnostic = keyof typeof NOEVAL_DIAGNOSTICS;
export type NoEvalCode = (typeof NOEVAL_DIAGNOSTICS)[NoEvalDiagnostic]["code"];

export interface SourceSpan {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

function lineColumn(source: string, offset: number, location: ExpressionLocation | undefined): { line: number; column: number } {
  let line = location?.line ?? 1;
  let column = location?.column ?? 1;
  for (let index = 0; index < offset; index++) {
    if (source[index] === "\r" && source[index + 1] === "\n") {
      index++;
      line++;
      column = 1;
    } else if (source[index] === "\r" || source[index] === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

export function sourceSpan(source: string, startOffset: number, endOffset: number, location?: ExpressionLocation): SourceSpan {
  const start = lineColumn(source, startOffset, location);
  const end = lineColumn(source, endOffset, location);
  return Object.freeze({ startOffset, endOffset, startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column });
}

/** A failure of the no-eval engine; an `ExpressionError` carries it as its cause. */
export class NoEvalError extends Error {
  readonly code: NoEvalCode;
  readonly phase: "compile" | "evaluate";
  readonly span: SourceSpan;

  constructor(diagnostic: NoEvalDiagnostic, span: SourceSpan, detail?: string) {
    const { code, phase, detail: fallback } = NOEVAL_DIAGNOSTICS[diagnostic];
    super(`${detail ?? fallback} (${code}, at ${String(span.startLine)}:${String(span.startColumn)})`);
    this.name = "NoEvalError";
    this.code = code;
    this.phase = phase;
    this.span = span;
  }
}
