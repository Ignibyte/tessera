// The no-eval engine's parser: a recursive descent over a closed grammar, ported from jqstar
// `src/csp/parser.ts`. A value is one expression; a statement is expressions and an optional last
// `return`, separated by `;`. Anything outside the grammar fails to compile. Changed for Tessera:
// names stay names until the expression runs, any expression can be called (what a call may do
// is the evaluator's capability table), `@method(…)` is an action anywhere, and `this` is the
// element.
import { ACTION_METHODS } from "../actions.ts";
import type { ActionMethod } from "../actions.ts";
import type { ExpressionLocation } from "../expression-shared.ts";
import type {
  ActionNode,
  AssignmentNode,
  BinaryNode,
  BinaryOperator,
  ExpressionNode,
  LogicalNode,
  MemberNode,
  ObjectNode,
  ProgramNode,
  StatementNode,
} from "./ast.ts";
import { NOEVAL_LIMITS, NoEvalError, sourceSpan } from "./diagnostics.ts";
import type { NoEvalDiagnostic, SourceSpan } from "./diagnostics.ts";
import { tokenize } from "./tokenizer.ts";
import type { Token } from "./tokenizer.ts";

export type EntryKind = "value" | "statement";

/** Words that start syntax the grammar leaves out; any of them fails to compile. */
const UNSUPPORTED_WORDS = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "let",
  "new",
  "of",
  "super",
  "switch",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);
const ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%="]);
/** Keys no object literal may set, as no member access may read them. */
export const MAGIC_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "apply",
  "arguments",
  "bind",
  "call",
  "callee",
  "caller",
  "constructor",
  "eval",
  "prototype",
]);

class Parser {
  readonly #source: string;
  readonly #entry: EntryKind;
  readonly #tokens: readonly Token[];
  readonly #location: ExpressionLocation | undefined;
  readonly #paths = new WeakMap<object, number>();
  #index = 0;
  #nesting = 0;
  #nodes = 0;

  constructor(source: string, entry: EntryKind, tokens: readonly Token[], location: ExpressionLocation | undefined) {
    this.#source = source;
    this.#entry = entry;
    this.#tokens = tokens;
    this.#location = location;
  }

  parse(): ExpressionNode | ProgramNode {
    this.#rejectUnsupported();
    if (this.#entry === "value") {
      const expression = this.#assignment();
      if (!this.#is("eof")) this.#fail("trailingInput", this.#current().span.startOffset, this.#source.length);
      return expression;
    }
    const body: StatementNode[] = [];
    let returned = false;
    while (!this.#is("eof")) {
      if (this.#take(";")) continue;
      if (returned) this.#failAll("unsupportedSyntax");
      const statement = this.#statement();
      body.push(statement);
      returned = statement.kind === "return-statement";
      if (this.#take(";")) continue;
      if (!this.#is("eof")) this.#fail("expectedToken", this.#current().span.startOffset, this.#current().span.endOffset);
    }
    if (body.length === 0) this.#fail("unexpectedToken", 0, this.#source.length);
    const first = body[0];
    const last = body.at(-1);
    return this.#node({ kind: "program", body: Object.freeze(body), span: this.#span(first?.span.startOffset ?? 0, last?.span.endOffset ?? 0) });
  }

  #rejectUnsupported(): void {
    for (const [index, token] of this.#tokens.entries()) {
      const next = this.#tokens[index + 1];
      if (
        (token.kind === "identifier" && UNSUPPORTED_WORDS.has(String(token.value))) ||
        (token.kind === "operator" && ["=>", "??=", "==", "!="].includes(String(token.value))) ||
        (token.kind === "punctuator" && token.value === "." && next?.value === ".") ||
        (token.kind === "punctuator" && token.value === "?" && next?.kind === "punctuator" && next.value === ".")
      ) {
        this.#failAll("unsupportedSyntax");
      }
    }
  }

  #statement(): StatementNode {
    if (this.#take("return")) {
      const start = this.#previous();
      const argument = this.#is(";") || this.#is("eof") ? undefined : this.#assignment();
      return this.#node({ kind: "return-statement", argument, span: this.#span(start.span.startOffset, argument?.span.endOffset ?? start.span.endOffset) });
    }
    const expression = this.#assignment();
    return this.#node({ kind: "expression-statement", expression, span: expression.span });
  }

  #assignment(): ExpressionNode {
    const target = this.#conditional();
    const current = this.#current();
    if (current.kind !== "operator" || !ASSIGNMENT_OPERATORS.has(String(current.value))) return target;
    this.#index++;
    if (target.kind === "array" || target.kind === "object") this.#failAll("unsupportedSyntax");
    if (target.kind !== "signal" && target.kind !== "member") this.#fail("invalidLvalue", target.span.startOffset, target.span.endOffset);
    const value = this.#assignment();
    return this.#node<AssignmentNode>({
      kind: "assignment",
      operator: String(current.value) as AssignmentNode["operator"],
      target,
      value,
      span: this.#span(target.span.startOffset, value.span.endOffset),
    });
  }

  #conditional(): ExpressionNode {
    const test = this.#logical("??", () => this.#logical("||", () => this.#logical("&&", () => this.#equality())));
    if (!this.#take("?")) return test;
    const consequent = this.#assignment();
    this.#consume(":");
    const alternate = this.#assignment();
    return this.#node({ kind: "conditional", test, consequent, alternate, span: this.#span(test.span.startOffset, alternate.span.endOffset) });
  }

  #equality(): ExpressionNode {
    return this.#binary(["===", "!=="], () => this.#binary(["<", "<=", ">", ">="], () => this.#additive()));
  }

  #additive(): ExpressionNode {
    return this.#binary(["+", "-"], () => this.#binary(["*", "/", "%"], () => this.#unary()));
  }

  #logical(operator: LogicalNode["operator"], lower: () => ExpressionNode): ExpressionNode {
    let left = lower();
    while (this.#take(operator)) {
      const right = lower();
      left = this.#node({ kind: "logical", operator, left, right, span: this.#span(left.span.startOffset, right.span.endOffset) });
    }
    return left;
  }

  #binary(operators: readonly BinaryOperator[], lower: () => ExpressionNode): ExpressionNode {
    let left = lower();
    for (;;) {
      const current = this.#current();
      if (current.kind !== "operator" || !operators.includes(current.value as BinaryOperator)) return left;
      this.#index++;
      const right = lower();
      left = this.#node<BinaryNode>({
        kind: "binary",
        operator: current.value as BinaryOperator,
        left,
        right,
        span: this.#span(left.span.startOffset, right.span.endOffset),
      });
    }
  }

  #unary(): ExpressionNode {
    if (this.#is("++") || this.#is("--")) this.#failAll("unsupportedSyntax");
    const current = this.#current();
    if (current.kind === "operator" && (current.value === "!" || current.value === "+" || current.value === "-")) {
      this.#index++;
      const argument = this.#unary();
      return this.#node({ kind: "unary", operator: current.value, argument, span: this.#span(current.span.startOffset, argument.span.endOffset) });
    }
    if (this.#take("await")) {
      if (this.#entry !== "statement") this.#failAll("unsupportedSyntax");
      const argument = this.#unary();
      return this.#node({ kind: "await", argument, span: this.#span(current.span.startOffset, argument.span.endOffset) });
    }
    const target = this.#member();
    const operator = this.#current();
    if (operator.kind !== "operator" || (operator.value !== "++" && operator.value !== "--")) return target;
    this.#index++;
    if (target.kind !== "signal" && target.kind !== "member") this.#fail("invalidLvalue", target.span.startOffset, target.span.endOffset);
    return this.#node({ kind: "update", operator: operator.value, target, span: this.#span(target.span.startOffset, operator.span.endOffset) });
  }

  #member(): ExpressionNode {
    let value = this.#primary();
    for (;;) {
      if (this.#take(".")) {
        const dot = this.#previous();
        const name = this.#current();
        if (name.kind !== "identifier" && name.kind !== "keyword") this.#fail("expectedToken", name.span.startOffset, name.span.endOffset);
        this.#index++;
        value = this.#withPath(
          this.#node<MemberNode>({ kind: "member", object: value, property: String(name.value), propertySpan: name.span, span: this.#span(value.span.startOffset, name.span.endOffset) }),
          this.#extendPath(value, this.#span(dot.span.startOffset, name.span.endOffset)),
        );
      } else if (this.#is("[")) {
        const open = this.#open("[");
        const property = this.#assignment();
        const close = this.#close("]");
        value = this.#withPath(
          this.#node<MemberNode>({ kind: "member", object: value, property, propertySpan: property.span, span: this.#span(value.span.startOffset, close.span.endOffset) }),
          this.#extendPath(value, this.#span(open.span.startOffset, close.span.endOffset)),
        );
      } else if (this.#is("(")) {
        const args = this.#arguments();
        value = this.#withPath(this.#node({ kind: "call", callee: value, arguments: args, span: this.#span(value.span.startOffset, this.#previous().span.endOffset) }), this.#paths.get(value) ?? 0);
      } else {
        return value;
      }
    }
  }

  #primary(): ExpressionNode {
    const token = this.#current();
    if (token.kind === "eof" && this.#nesting > 0) this.#fail("expectedToken", token.span.startOffset, token.span.endOffset);
    if (token.kind === "number" || token.kind === "string" || typeof token.value === "boolean" || token.value === null) {
      this.#index++;
      return this.#node({ kind: "literal", value: token.value, span: token.span });
    }
    if (token.kind === "signal") {
      this.#index++;
      return this.#node({ kind: "signal", name: String(token.value), span: token.span });
    }
    if (token.kind === "keyword" && token.value === "this") {
      this.#index++;
      return this.#node({ kind: "this", span: token.span });
    }
    if (token.kind === "identifier") {
      this.#index++;
      return this.#node({ kind: "identifier", name: String(token.value), span: token.span });
    }
    if (this.#is("@")) return this.#action();
    if (this.#is("(")) {
      this.#open("(");
      const expression = this.#assignment();
      this.#close(")");
      return expression;
    }
    if (this.#is("[")) {
      const open = this.#open("[");
      const elements: ExpressionNode[] = [];
      if (!this.#is("]")) {
        do {
          elements.push(this.#assignment());
          if (elements.length > NOEVAL_LIMITS.literalEntries) this.#failAll("literalLimit");
        } while (this.#take(","));
      }
      const close = this.#close("]");
      return this.#node({ kind: "array", elements: Object.freeze(elements), span: this.#span(open.span.startOffset, close.span.endOffset) });
    }
    if (this.#is("{")) return this.#object();
    return this.#fail("unexpectedToken", token.span.startOffset, token.span.endOffset);
  }

  #action(): ActionNode {
    const at = this.#consume("@");
    const name = this.#current();
    if (name.kind !== "identifier" || !(ACTION_METHODS as readonly string[]).includes(String(name.value)) || !this.#tokenIs(this.#index + 1, "(")) {
      this.#fail("unknownAction", at.span.startOffset, name.span.endOffset);
    }
    this.#index++;
    const args = this.#arguments();
    return this.#node({ kind: "action", method: String(name.value) as ActionMethod, arguments: args, span: this.#span(at.span.startOffset, this.#previous().span.endOffset) });
  }

  #object(): ObjectNode {
    const open = this.#open("{");
    const properties: { key: string; value: ExpressionNode; span: SourceSpan }[] = [];
    const keys = new Set<string>();
    if (!this.#is("}")) {
      do {
        const key = this.#current();
        if (key.kind !== "identifier" && key.kind !== "string" && key.kind !== "keyword") this.#fail("expectedToken", key.span.startOffset, key.span.endOffset);
        this.#index++;
        const name = String(key.value);
        if (MAGIC_KEYS.has(name)) this.#fail("unsupportedSyntax", key.span.startOffset, key.span.endOffset);
        if (keys.has(name)) this.#fail("duplicateKey", key.span.startOffset, key.span.endOffset);
        keys.add(name);
        this.#consume(":");
        const value = this.#assignment();
        properties.push(Object.freeze({ key: name, value, span: this.#span(key.span.startOffset, value.span.endOffset) }));
        this.#count();
        if (properties.length > NOEVAL_LIMITS.literalEntries) this.#failAll("literalLimit");
      } while (this.#take(","));
    }
    const close = this.#close("}");
    return this.#node({ kind: "object", properties: Object.freeze(properties), span: this.#span(open.span.startOffset, close.span.endOffset) });
  }

  #arguments(): readonly ExpressionNode[] {
    this.#open("(");
    const args: ExpressionNode[] = [];
    if (!this.#is(")")) {
      do {
        const argument = this.#assignment();
        args.push(argument);
        if (args.length > NOEVAL_LIMITS.callArguments) this.#fail("argumentLimit", argument.span.startOffset, argument.span.endOffset);
      } while (this.#take(","));
    }
    this.#close(")");
    return Object.freeze(args);
  }

  #extendPath(value: ExpressionNode, span: SourceSpan): number {
    const next = (this.#paths.get(value) ?? 0) + 1;
    if (next > NOEVAL_LIMITS.pathSegments) this.#fail("pathLimit", span.startOffset, span.endOffset);
    return next;
  }

  #withPath<Node extends ExpressionNode>(node: Node, length: number): Node {
    this.#paths.set(node, length);
    return node;
  }

  #open(value: string): Token {
    const token = this.#consume(value);
    this.#nesting++;
    if (this.#nesting > NOEVAL_LIMITS.nesting) this.#fail("nestingLimit", token.span.startOffset, token.span.endOffset);
    return token;
  }

  #close(value: string): Token {
    const token = this.#consume(value);
    this.#nesting--;
    return token;
  }

  #consume(value: string): Token {
    const current = this.#current();
    if (!this.#is(value)) this.#fail("expectedToken", current.span.startOffset, current.span.endOffset);
    this.#index++;
    return current;
  }

  #take(value: string): boolean {
    if (!this.#is(value)) return false;
    this.#index++;
    return true;
  }

  #is(value: string): boolean {
    return this.#tokenIs(this.#index, value);
  }

  #tokenIs(index: number, value: string): boolean {
    const token = this.#tokens[index] ?? this.#tokens.at(-1);
    if (!token) return false;
    if (value === "eof") return token.kind === "eof";
    if (token.kind === "string" || token.kind === "number" || token.kind === "signal" || token.kind === "eof") return false;
    return token.value === value;
  }

  #current(): Token {
    const token = this.#tokens[this.#index] ?? this.#tokens.at(-1);
    if (!token) throw new Error("The token list is empty.");
    return token;
  }

  #previous(): Token {
    return this.#tokens[Math.max(0, this.#index - 1)] ?? this.#current();
  }

  #count(): void {
    this.#nodes++;
    if (this.#nodes > NOEVAL_LIMITS.astNodes) this.#failAll("nodeLimit");
  }

  #node<Node extends ExpressionNode | ProgramNode | StatementNode>(fields: Node): Node {
    this.#count();
    return Object.freeze(fields);
  }

  #span(start: number, end: number): SourceSpan {
    return sourceSpan(this.#source, start, end, this.#location);
  }

  #fail(diagnostic: NoEvalDiagnostic, start: number, end: number): never {
    throw new NoEvalError(diagnostic, this.#span(start, end));
  }

  #failAll(diagnostic: NoEvalDiagnostic): never {
    return this.#fail(diagnostic, 0, this.#source.length);
  }
}

/** Parses a value or a statement. Throws a `NoEvalError`. */
export function parse(source: string, entry: EntryKind, location?: ExpressionLocation): ExpressionNode | ProgramNode {
  return new Parser(source, entry, tokenize(source, location), location).parse();
}
