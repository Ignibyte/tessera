// The no-eval engine's syntax tree: immutable nodes, each with its span. From jqstar
// `src/csp/ast.ts`, with Tessera's scope: one node for names (resolved when the expression runs,
// as the trusted engine resolves them), `this`, a general call, and `@method(…)` actions. jqstar's
// bindings, its `$(…)` call and its named-action and helper-call nodes are gone.
import type { ActionMethod } from "../actions.ts";
import type { SourceSpan } from "./diagnostics.ts";

interface Base {
  readonly span: SourceSpan;
}

export interface ProgramNode extends Base {
  readonly kind: "program";
  readonly body: readonly StatementNode[];
}

export interface ExpressionStatementNode extends Base {
  readonly kind: "expression-statement";
  readonly expression: ExpressionNode;
}

export interface ReturnStatementNode extends Base {
  readonly kind: "return-statement";
  readonly argument: ExpressionNode | undefined;
}

export type StatementNode = ExpressionStatementNode | ReturnStatementNode;

export interface LiteralNode extends Base {
  readonly kind: "literal";
  readonly value: string | number | boolean | null;
}

export interface ArrayNode extends Base {
  readonly kind: "array";
  readonly elements: readonly ExpressionNode[];
}

export interface ObjectNode extends Base {
  readonly kind: "object";
  readonly properties: readonly { readonly key: string; readonly value: ExpressionNode; readonly span: SourceSpan }[];
}

/** A name: `el`, `evt`, a helper or a built-in, resolved when the expression runs. */
export interface IdentifierNode extends Base {
  readonly kind: "identifier";
  readonly name: string;
}

export interface ThisNode extends Base {
  readonly kind: "this";
}

export interface SignalNode extends Base {
  readonly kind: "signal";
  readonly name: string;
}

export interface MemberNode extends Base {
  readonly kind: "member";
  readonly object: ExpressionNode;
  /** A name after `.`, or an expression in `[…]`. */
  readonly property: string | ExpressionNode;
  readonly propertySpan: SourceSpan;
}

export interface CallNode extends Base {
  readonly kind: "call";
  readonly callee: ExpressionNode;
  readonly arguments: readonly ExpressionNode[];
}

export interface ActionNode extends Base {
  readonly kind: "action";
  readonly method: ActionMethod;
  readonly arguments: readonly ExpressionNode[];
}

export interface UnaryNode extends Base {
  readonly kind: "unary";
  readonly operator: "!" | "+" | "-";
  readonly argument: ExpressionNode;
}

export type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "<" | "<=" | ">" | ">=" | "===" | "!==";

export interface BinaryNode extends Base {
  readonly kind: "binary";
  readonly operator: BinaryOperator;
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
}

export interface LogicalNode extends Base {
  readonly kind: "logical";
  readonly operator: "&&" | "||" | "??";
  readonly left: ExpressionNode;
  readonly right: ExpressionNode;
}

export interface ConditionalNode extends Base {
  readonly kind: "conditional";
  readonly test: ExpressionNode;
  readonly consequent: ExpressionNode;
  readonly alternate: ExpressionNode;
}

export interface AssignmentNode extends Base {
  readonly kind: "assignment";
  readonly operator: "=" | "+=" | "-=" | "*=" | "/=" | "%=";
  readonly target: SignalNode | MemberNode;
  readonly value: ExpressionNode;
}

export interface UpdateNode extends Base {
  readonly kind: "update";
  readonly operator: "++" | "--";
  readonly target: SignalNode | MemberNode;
}

export interface AwaitNode extends Base {
  readonly kind: "await";
  readonly argument: ExpressionNode;
}

export type ExpressionNode =
  | LiteralNode
  | ArrayNode
  | ObjectNode
  | IdentifierNode
  | ThisNode
  | SignalNode
  | MemberNode
  | CallNode
  | ActionNode
  | UnaryNode
  | BinaryNode
  | LogicalNode
  | ConditionalNode
  | AssignmentNode
  | UpdateNode
  | AwaitNode;
