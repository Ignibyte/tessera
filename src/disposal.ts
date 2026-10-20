// The report a kernel's disposal returns: what it attempted, released and failed to release.
// Frozen, JSON-safe, and the same object on every later call. Ported from jqstar
// `src/disposal.ts`.
import { errorFields } from "./errors.ts";
import type { ResourceKind } from "./kernel.ts";

export type DisposalCategory = ResourceKind | "mount";

export interface DisposalResource {
  readonly category: DisposalCategory;
  readonly owner: string;
}

export interface DisposalFailure extends DisposalResource {
  readonly error: {
    readonly message: string;
    readonly name: string;
  };
}

export interface DisposalReport {
  readonly schema: "tessera-disposal/1";
  readonly attempted: readonly DisposalResource[];
  readonly released: readonly DisposalResource[];
  readonly failed: readonly DisposalFailure[];
  readonly remaining: readonly DisposalResource[];
}

export interface DisposalReportController {
  readonly report: DisposalReport;
  attempt(resource: DisposalResource): void;
  fail(resource: DisposalResource, error: unknown): void;
  release(resource: DisposalResource): void;
  remain(resource: DisposalResource): void;
}

function normalizedError(error: unknown): Readonly<{ message: string; name: string }> {
  const { name, message } = errorFields(error, "Cleanup failed.", String, false);
  return Object.freeze({ name: name.slice(0, 120), message: message.slice(0, 1_024) });
}

function snapshot<Resource extends DisposalResource>(
  resources: readonly Resource[],
): readonly Readonly<Resource>[] {
  return Object.freeze(resources.map((resource) => Object.freeze({ ...resource })));
}

export function createDisposalReport(): DisposalReportController {
  const attempted: DisposalResource[] = [];
  const released: DisposalResource[] = [];
  const failed: DisposalFailure[] = [];
  const remaining: DisposalResource[] = [];
  const report = Object.freeze<DisposalReport>({
    schema: "tessera-disposal/1",
    get attempted() {
      return snapshot(attempted);
    },
    get released() {
      return snapshot(released);
    },
    get failed() {
      return snapshot(failed);
    },
    get remaining() {
      return snapshot(remaining);
    },
  });
  return {
    report,
    attempt: (resource) => attempted.push(resource),
    release: (resource) => released.push(resource),
    fail: (resource, error) => failed.push({ ...resource, error: normalizedError(error) }),
    remain: (resource) => remaining.push(resource),
  };
}

export class DisposalError extends AggregateError {
  override readonly name = "DisposalError";
  readonly report: DisposalReport;

  constructor(errors: readonly unknown[], report: DisposalReport) {
    super(errors, "Tessera kernel disposal failed.");
    this.report = report;
  }
}
