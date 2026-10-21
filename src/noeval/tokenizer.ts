// The no-eval engine's tokenizer, ported from jqstar `src/csp/tokenizer.ts`: strings with JSON's
// escapes, decimal numbers, identifiers, `$name` signals, and a closed set of operators. Comments,
// template literals and regular expressions are refused outright. Changed for Tessera: `$name` is
// always a signal (jqstar read `$el` and `$root` as bindings), and `this` is a keyword.
import type { ExpressionLocation } from "../expression-shared.ts";
import { NOEVAL_LIMITS, NoEvalError, sourceSpan } from "./diagnostics.ts";
import type { NoEvalDiagnostic, SourceSpan } from "./diagnostics.ts";

export type TokenKind = "identifier" | "signal" | "number" | "string" | "keyword" | "punctuator" | "operator" | "eof";

export interface Token {
  readonly kind: TokenKind;
  readonly value: string | number | boolean | null;
  readonly span: SourceSpan;
}

const KEYWORDS = new Set(["await", "false", "null", "return", "this", "true"]);
const PUNCTUATORS = new Set(["(", ")", "[", "]", "{", "}", ",", ".", ";", ":", "?", "@"]);
// Longest first, so `===` is never read as `==` and `=`.
const OPERATORS = [
  "===",
  "!==",
  "??=",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "=>",
  "==",
  "!=",
  "=",
  "!",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
] as const;
const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "\\": "\\",
  "'": "'",
  '"': '"',
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
});

const isIdentifierStart = (character: string | undefined): boolean => character !== undefined && /[A-Za-z_]/.test(character);
const isIdentifierPart = (character: string | undefined): boolean => character !== undefined && /[A-Za-z0-9_]/.test(character);
const isDigit = (character: string | undefined): boolean => character !== undefined && character >= "0" && character <= "9";
const isHex = (character: string | undefined): boolean => character !== undefined && /[0-9A-Fa-f]/.test(character);
const isWhitespace = (character: string | undefined): boolean =>
  character === " " || character === "\t" || character === "\n" || character === "\r";

class Tokenizer {
  readonly #source: string;
  readonly #location: ExpressionLocation | undefined;
  readonly #tokens: Token[] = [];
  #index = 0;

  constructor(source: string, location: ExpressionLocation | undefined) {
    this.#source = source;
    this.#location = location;
  }

  run(): readonly Token[] {
    const source = this.#source;
    if (source.length > NOEVAL_LIMITS.sourceLength) this.#fail("sourceLength", NOEVAL_LIMITS.sourceLength, source.length);
    while (this.#index < source.length) {
      const character = source[this.#index];
      if (isWhitespace(character)) {
        this.#index++;
        continue;
      }
      const start = this.#index;
      const next = source[start + 1];
      if (character === "`" || (character === "/" && (next === "/" || next === "*"))) this.#fail("unsupportedSyntax", 0, source.length);
      // A slash where an operand is due starts a regular expression.
      if (character === "/" && this.#expectsOperand()) this.#fail("unsupportedSyntax", 0, source.length);
      if (character === "'" || character === '"') {
        this.#push("string", this.#string(start), start, this.#index);
      } else if (isDigit(character) || (character === "." && isDigit(next))) {
        this.#push("number", this.#number(start), start, this.#index);
      } else if (character === "$" && isIdentifierStart(next)) {
        this.#index += 2;
        while (isIdentifierPart(source[this.#index])) this.#index++;
        this.#push("signal", source.slice(start + 1, this.#index), start, this.#index);
      } else if (isIdentifierStart(character)) {
        this.#index++;
        while (isIdentifierPart(source[this.#index])) this.#index++;
        const word = source.slice(start, this.#index);
        if (KEYWORDS.has(word)) {
          this.#push("keyword", word === "true" ? true : word === "false" ? false : word === "null" ? null : word, start, this.#index);
        } else this.#push("identifier", word, start, this.#index);
      } else if (character === "$") {
        this.#index++;
        this.#push("identifier", "$", start, this.#index);
      } else {
        const operator = OPERATORS.find((candidate) => source.startsWith(candidate, start));
        if (operator) {
          this.#index += operator.length;
          this.#push("operator", operator, start, this.#index);
        } else if (character !== undefined && PUNCTUATORS.has(character)) {
          this.#index++;
          this.#push("punctuator", character, start, this.#index);
        } else this.#fail("invalidCharacter", start, start + 1);
      }
    }
    this.#tokens.push(Object.freeze({ kind: "eof", value: "", span: sourceSpan(source, source.length, source.length, this.#location) }));
    return Object.freeze(this.#tokens);
  }

  #expectsOperand(): boolean {
    const last = this.#tokens.at(-1);
    if (!last) return true;
    if (last.kind === "operator") return true;
    return last.kind === "punctuator" && last.value !== ")" && last.value !== "]" && last.value !== "}";
  }

  #push(kind: TokenKind, value: Token["value"], start: number, end: number): void {
    if (this.#tokens.length >= NOEVAL_LIMITS.tokens - 1) this.#fail("tokenLimit", 0, Math.min(1, this.#source.length));
    this.#tokens.push(Object.freeze({ kind, value, span: sourceSpan(this.#source, start, end, this.#location) }));
  }

  #string(start: number): string {
    const source = this.#source;
    const quote = source[start];
    let value = "";
    let index = start + 1;
    while (index < source.length) {
      const current = source[index] ?? "";
      if (current === quote) {
        this.#index = index + 1;
        return value;
      }
      const code = source.charCodeAt(index);
      if (code < 0x20 || code === 0x7f) this.#fail("invalidCharacter", index, index + 1);
      if (current !== "\\") {
        if (code >= 0xd800 && code <= 0xdbff) {
          const low = source.charCodeAt(index + 1);
          if (!(low >= 0xdc00 && low <= 0xdfff)) this.#fail("invalidCharacter", index, index + 1);
          value += source.slice(index, index + 2);
          index += 2;
          continue;
        }
        if (code >= 0xdc00 && code <= 0xdfff) this.#fail("invalidCharacter", index, index + 1);
        value += current;
        index++;
        continue;
      }
      const escaped = source[index + 1];
      if (escaped !== undefined && Object.hasOwn(ESCAPES, escaped)) {
        value += ESCAPES[escaped] ?? "";
        index += 2;
        continue;
      }
      const unit = this.#unicodeEscape(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const low = source[index + 6] === "\\" ? this.#unicodeEscape(index + 6, index) : -1;
        if (low < 0xdc00 || low > 0xdfff) this.#fail("invalidEscape", index, Math.min(source.length, index + 6));
        value += String.fromCharCode(unit, low);
        index += 12;
        continue;
      }
      if (unit >= 0xdc00 && unit <= 0xdfff) this.#fail("invalidEscape", index, index + 6);
      value += String.fromCharCode(unit);
      index += 6;
    }
    return this.#fail("unterminatedString", start, source.length);
  }

  /** The code unit of a `\uXXXX` at `index`; a failure is reported from `reportAt`. */
  #unicodeEscape(index: number, reportAt = index): number {
    const source = this.#source;
    if (source[index + 1] !== "u" || ![2, 3, 4, 5].every((offset) => isHex(source[index + offset]))) {
      this.#fail("invalidEscape", reportAt, Math.min(source.length, reportAt + 2));
    }
    return Number.parseInt(source.slice(index + 2, index + 6), 16);
  }

  #number(start: number): number {
    const source = this.#source;
    let index = start;
    while (isDigit(source[index])) index++;
    if (source[start] === "0" && index - start > 1) {
      while (isIdentifierPart(source[index])) index++;
      this.#fail("numberFormat", start, index);
    }
    if (source[index] === "." && isDigit(source[index + 1])) {
      index += 2;
      while (isDigit(source[index])) index++;
    }
    if (source[index] === "e" || source[index] === "E") {
      index++;
      if (source[index] === "+" || source[index] === "-") index++;
      const exponent = index;
      while (isDigit(source[index])) index++;
      if (index === exponent) this.#fail("numberFormat", start, index);
    }
    if (isIdentifierStart(source[index])) {
      while (isIdentifierPart(source[index])) index++;
      this.#fail("numberFormat", start, index);
    }
    const value = Number(source.slice(start, index));
    if (!Number.isFinite(value)) this.#fail("numberFormat", start, index);
    this.#index = index;
    return value;
  }

  #fail(diagnostic: NoEvalDiagnostic, start: number, end: number): never {
    throw new NoEvalError(diagnostic, sourceSpan(this.#source, start, end, this.#location));
  }
}

/** Splits an expression into tokens, ending with `eof`. Throws a `NoEvalError`. */
export function tokenize(source: string, location?: ExpressionLocation): readonly Token[] {
  return new Tokenizer(source, location).run();
}
