// The kernel: one per Document. It owns every resource the runtime acquires (listeners,
// observers, effects, tasks), tears down what leaves the page deepest first inside a render
// transaction, keeps preserved roots and their focus across a render, and disposes everything
// once. Ported from jqstar `src/kernel.ts` without jQuery, the plugin host, actions, protocols,
// request middleware, the operation hub, the expression engine and the metadata seam.
// jqstar's applications (booted roots) are mounts here.
import { createDisposalReport, DisposalError } from "./disposal.ts";
import type { DisposalReport, DisposalReportController, DisposalResource } from "./disposal.ts";
import { isElementNode } from "./dom.ts";
import { attempt, throwCollectedErrors } from "./errors.ts";

export type ResourceKind = "effect" | "listener" | "observer" | "service" | "subscription" | "task";

export interface ResourceSummary {
  readonly kind: ResourceKind;
  readonly owner: string;
}

/** Something the runtime started at a root element, torn down when that root leaves. */
export interface Mount {
  readonly root: Element;
  readonly destroyed: boolean;
  /** Tears the mount down; it calls `kernel.untrack(mount)` when done. */
  destroy(): void;
}

/** Lets a surviving mount drop what it holds for a subtree removed from inside it. */
export interface MountLifecycle {
  releaseTree(tree: Element, preservedRoots: readonly Element[]): void;
}

export interface OwnedObserver {
  readonly observer: MutationObserver;
  readonly release: () => void;
}

export interface RenderTransaction {
  readonly operationId: number;
  /** The preserved roots inside `node`, which must be inside the render root. */
  preservedWithin(node: Node): readonly Element[];
  /** Tears down what lives in `node`, deepest first, while it is still connected. */
  beforeRemove(node: Node): void;
  /** Ends the render: boots incoming roots, restores focus, throws collected errors. */
  commit(incomingRoots?: Iterable<Element>): void;
  /** Ends the render after the host failed, and rethrows. */
  fail(error: unknown): never;
}

export interface RenderOptions {
  /** Starts a mount at an incoming root that has none. */
  readonly boot?: (root: Element) => void;
  /** Roots the host promises to keep as the same live nodes through the render. */
  readonly preserveRoots?: Iterable<Element>;
}

export interface KernelOptions {
  /**
   * Resolves once the runtime's pending reactive work has run, rejecting with what failed.
   * The render barrier and `whenEnhanced` wait on it. Default: one microtask.
   */
  readonly flush?: () => Promise<void>;
}

interface ResourceRecord extends ResourceSummary {
  readonly root: Element | undefined;
  readonly release: () => void;
}

interface MountRecord {
  readonly mount: Mount;
  readonly lifecycle: MountLifecycle | undefined;
  readonly owner: string;
}

const claimedDocuments = new WeakMap<Document, Kernel>();

function microtask(): Promise<void> {
  return new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });
}

/** Sort order putting a descendant before its ancestor; unrelated elements compare equal. */
export function compareElementDepth(left: Element, right: Element): number {
  if (right.contains(left)) return -1;
  if (left.contains(right)) return 1;
  return 0;
}

function deepestFirst(left: MountRecord, right: MountRecord): number {
  return compareElementDepth(left.mount.root, right.mount.root);
}

function containsAny(roots: Iterable<Node>, node: Node): boolean {
  for (const root of roots) if (root.contains(node)) return true;
  return false;
}

function focusable(element: Element): ((options?: FocusOptions) => void) | undefined {
  return (element as Element & { focus?: (options?: FocusOptions) => void }).focus;
}

export class Kernel {
  readonly document: Document;
  readonly window: Window;

  readonly #flush: () => Promise<void>;
  readonly #mounts = new Map<Mount, MountRecord>();
  readonly #pendingEnhancements = new Set<Promise<void>>();
  readonly #pendingTasks = new Set<Promise<void>>();
  readonly #activePreservedRoots = new Map<Element, number>();
  readonly #enhancementErrors: unknown[] = [];
  readonly #resources = new Set<ResourceRecord>();
  readonly #removalScopes = new Map<ReadonlySet<Element>, readonly Element[]>();
  readonly #removedNodes = new Set<Node>();
  #resourceRemovalObserver: MutationObserver | undefined;
  #mountId = 0;
  #renderOperationId = 0;
  #disposed = false;
  #disposalController: DisposalReportController | undefined;
  #disposalError: DisposalError | undefined;
  #disposalInProgress = false;

  constructor(document: Document, options: KernelOptions = {}) {
    const window = document.defaultView;
    if (!window) throw new Error("Tessera needs a Document attached to a Window.");
    if (claimedDocuments.has(document)) {
      throw new Error("This Document is already claimed by a Tessera kernel.");
    }
    this.document = document;
    this.window = window;
    this.#flush = options.flush ?? microtask;
    claimedDocuments.set(document, this);
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Whether disposal has run to its end (it may have failed). */
  get disposalSettled(): boolean {
    return this.#disposalController !== undefined && !this.#disposalInProgress;
  }

  assertActive(operation: string): void {
    if (this.#disposed) {
      throw new Error(`This Tessera kernel has been disposed and cannot ${operation}.`);
    }
  }

  // --- Mounts ------------------------------------------------------------------------------

  track<M extends Mount>(mount: M, lifecycle?: MountLifecycle): M {
    this.assertActive("track mounts");
    if (this.#mounts.has(mount)) throw new Error("This mount is already tracked by its kernel.");
    this.#mounts.set(mount, { mount, lifecycle, owner: `mount:${++this.#mountId}` });
    return mount;
  }

  /** Forgets a mount; its `destroy` calls this, and calling it twice does nothing. */
  untrack(mount: Mount): void {
    this.#mounts.delete(mount);
  }

  mountCount(): number {
    return this.#mounts.size;
  }

  /** The preserved roots of renders in progress that lie inside `tree`. */
  preservedRootsWithin(tree: Element): readonly Element[] {
    return [...this.#activePreservedRoots.keys()].filter((preserved) => tree.contains(preserved));
  }

  // --- Render transactions -----------------------------------------------------------------

  beginRender(root: Element, options: RenderOptions = {}): RenderTransaction {
    this.assertActive("render");
    if (!isElementNode(root) || root.ownerDocument !== this.document) {
      throw new Error("A render root must belong to this Tessera kernel's Document.");
    }
    if (!root.isConnected) throw new Error("A render root must be connected when rendering begins.");

    const preservedRoots = [...new Set(options.preserveRoots ?? [])];
    for (const preserved of preservedRoots) {
      if (!isElementNode(preserved) || preserved.ownerDocument !== this.document) {
        throw new Error("A preserved root must belong to this Tessera kernel's Document.");
      }
      if (!preserved.isConnected) {
        throw new Error("A preserved root must be connected when rendering begins.");
      }
      if (!root.contains(preserved)) {
        throw new Error("A preserved root must be contained by the render root.");
      }
    }

    const activeElement = this.document.activeElement;
    const preservedFocus =
      activeElement && containsAny(preservedRoots, activeElement) ? activeElement : undefined;
    const preservedOwners = new Map(
      preservedRoots.map((preserved) => [
        preserved,
        [...this.#mounts.values()].filter(
          ({ mount }) => mount.root !== preserved && mount.root.contains(preserved),
        ),
      ]),
    );
    for (const preserved of preservedRoots) {
      this.#activePreservedRoots.set(preserved, (this.#activePreservedRoots.get(preserved) ?? 0) + 1);
    }

    const operationId = ++this.#renderOperationId;
    const errors: unknown[] = [];
    const releasedMounts = new Set<Mount>();
    const removalBoundaries = new Set<Element>();
    this.#removalScopes.set(removalBoundaries, preservedRoots);
    let finished = false;
    let resolveBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      resolveBarrier = resolve;
    });
    this.#pendingEnhancements.add(barrier);
    let focusRetryAnchor: Element | null | undefined;

    const releasePreservation = (): void => {
      for (const preserved of preservedRoots) {
        const count = this.#activePreservedRoots.get(preserved) ?? 0;
        if (count <= 1) this.#activePreservedRoots.delete(preserved);
        else this.#activePreservedRoots.set(preserved, count - 1);
      }
      this.#releaseRemovedResources();
    };

    // After commit: let reactive work run twice, retry focus once if the first restore did not
    // take (only for the latest render), then release preservation and the barrier.
    const settle = (): void => {
      void (async () => {
        try {
          await microtask();
          await this.#flush();
          await microtask();
          await this.#flush();
          if (
            focusRetryAnchor !== undefined &&
            !this.#disposed &&
            this.#renderOperationId === operationId &&
            preservedFocus?.isConnected &&
            preservedFocus.ownerDocument === this.document &&
            this.document.activeElement === focusRetryAnchor
          ) {
            focusRetryAnchor = undefined;
            focusable(preservedFocus)?.call(preservedFocus, { preventScroll: true });
          }
        } catch (error) {
          this.#enhancementErrors.push(error);
        } finally {
          releasePreservation();
          this.#pendingEnhancements.delete(barrier);
          resolveBarrier();
        }
      })();
    };

    const abandon = (): void => {
      if (finished) return;
      finished = true;
      this.#removalScopes.delete(removalBoundaries);
      releasePreservation();
      this.#pendingEnhancements.delete(barrier);
      resolveBarrier();
    };
    // Disposal abandons a render still open.
    const releaseOperation = this.own("task", `render:${operationId}`, abandon);
    const finish = (): void => {
      if (finished) return;
      finished = true;
      this.#removalScopes.delete(removalBoundaries);
      releaseOperation();
      settle();
    };

    const validateBoundary = (node: Node, label: string): Element => {
      if (!isElementNode(node) || node.ownerDocument !== this.document) {
        throw new Error(`${label} must belong to this Tessera kernel's Document.`);
      }
      if (!root.contains(node)) throw new Error(`${label} must be contained by the render root.`);
      return node;
    };

    const preservedWithin = (node: Node): readonly Element[] => {
      const element = validateBoundary(node, "A preservation boundary");
      return Object.freeze(preservedRoots.filter((preserved) => element.contains(preserved)));
    };

    const releaseRecords = (records: readonly MountRecord[]): void => {
      for (const { mount } of records) {
        if (releasedMounts.has(mount)) continue;
        releasedMounts.add(mount);
        attempt(errors, () => {
          mount.destroy();
        });
        attempt(errors, () => {
          this.untrack(mount);
        });
      }
    };

    const releaseAncestors = (
      tree: Element,
      records: Iterable<MountRecord>,
      protectedRoots: readonly Element[] = [],
    ): void => {
      for (const { mount, lifecycle } of records) {
        if (
          !lifecycle ||
          mount.destroyed ||
          releasedMounts.has(mount) ||
          containsAny(protectedRoots, mount.root)
        )
          continue;
        attempt(errors, () => {
          lifecycle.releaseTree(tree, protectedRoots);
        });
      }
    };

    // A preserved root the host did not keep is torn down after all, and reported.
    const releaseMissingPreservedRoots = (): void => {
      const missing = preservedRoots.filter(
        (preserved) => !preserved.isConnected || preserved.ownerDocument !== this.document,
      );
      if (missing.length === 0) return;
      this.#removalScopes.set(
        removalBoundaries,
        preservedRoots.filter((preserved) => !missing.includes(preserved)),
      );
      for (const preserved of missing) removalBoundaries.add(preserved);
      const records = [...this.#mounts.values()]
        .filter(({ mount }) => containsAny(missing, mount.root))
        .sort(deepestFirst);
      releaseRecords(records);
      for (const preserved of missing) {
        this.#releaseScopedResources((scope) => preserved.contains(scope), errors);
        releaseAncestors(preserved, preservedOwners.get(preserved) ?? []);
      }
      const plural = missing.length === 1 ? "" : "s";
      errors.push(
        new Error(
          `Tessera render operation ${operationId} did not retain ${missing.length} promised preserved root${plural}.`,
        ),
      );
    };

    const bootIncomingRoots = (incomingRoots: Iterable<Element> | undefined): void => {
      let incoming: Element[];
      try {
        incoming = [...new Set(incomingRoots ?? [])];
      } catch (error) {
        errors.push(error);
        return;
      }
      const valid: Element[] = [];
      for (const candidate of incoming) {
        if (!isElementNode(candidate) || candidate.ownerDocument !== this.document) {
          errors.push(new Error("An incoming root must belong to this Tessera kernel's Document."));
        } else if (!candidate.isConnected) {
          errors.push(new Error("An incoming root must be connected before commit."));
        } else {
          valid.push(candidate);
        }
      }
      const { boot } = options;
      if (!boot) return;
      for (const candidate of valid) {
        const mounted = [...this.#mounts.values()].some(({ mount }) => mount.root === candidate);
        if (!mounted)
          attempt(errors, () => {
            boot(candidate);
          });
      }
    };

    const restorePreservedFocus = (): void => {
      if (
        this.#disposed ||
        this.#renderOperationId !== operationId ||
        !preservedFocus?.isConnected ||
        preservedFocus.ownerDocument !== this.document
      ) {
        return;
      }
      const focus = focusable(preservedFocus);
      if (!focus) return;
      attempt(errors, () => {
        const before = this.document.activeElement;
        const observation = { receivedFocus: false };
        const received = (): void => {
          observation.receivedFocus = true;
        };
        try {
          preservedFocus.addEventListener("focus", received, true);
          if (this.#disposed || this.#renderOperationId !== operationId) return;
          focus.call(preservedFocus, { preventScroll: true });
          if (
            !observation.receivedFocus &&
            before !== preservedFocus &&
            this.document.activeElement === before
          )
            focusRetryAnchor = before;
        } finally {
          attempt(errors, () => {
            preservedFocus.removeEventListener("focus", received, true);
          });
        }
      });
    };

    return {
      operationId,
      preservedWithin,
      beforeRemove: (node) => {
        if (!isElementNode(node)) return;
        const element = validateBoundary(node, "A removal boundary");
        if (containsAny(preservedRoots, element) || containsAny(removalBoundaries, element)) return;
        removalBoundaries.add(element);
        const records = [...this.#mounts.values()].sort(deepestFirst);
        const protectedRoots = preservedWithin(element);
        this.#releaseScopedResources(
          (scope) => element.contains(scope) && !containsAny(protectedRoots, scope),
          errors,
          protectedRoots,
        );
        const outgoing = records.filter(
          ({ mount }) => element.contains(mount.root) && !containsAny(protectedRoots, mount.root),
        );
        releaseRecords(outgoing);
        releaseAncestors(
          element,
          records.filter(({ mount }) => mount.root.contains(element)),
          protectedRoots,
        );
      },
      commit: (incomingRoots) => {
        releaseMissingPreservedRoots();
        bootIncomingRoots(incomingRoots);
        restorePreservedFocus();
        finish();
        throwCollectedErrors(errors, `Tessera render operation ${operationId} failed.`);
      },
      fail: (error) => {
        if (finished) throw error;
        errors.push(error);
        releaseMissingPreservedRoots();
        restorePreservedFocus();
        finish();
        throwCollectedErrors(errors, `Tessera render operation ${operationId} failed.`);
        throw error;
      },
    };
  }

  /** Resolves once no render or task is pending, rejecting with what failed meanwhile. */
  async whenEnhanced(): Promise<void> {
    const errors: unknown[] = [];
    for (;;) {
      try {
        await this.#flush();
      } catch (error) {
        errors.push(error);
      }
      const pending = [...this.#pendingEnhancements, ...this.#pendingTasks];
      if (pending.length === 0) break;
      await Promise.all(pending);
    }
    errors.push(...this.#enhancementErrors.splice(0));
    throwCollectedErrors(errors, "Tessera enhancement failed.");
  }

  // --- The resource ledger -----------------------------------------------------------------

  resourceSummary(): readonly ResourceSummary[] {
    return [...this.#resources].map(({ kind, owner }) => ({ kind, owner }));
  }

  /**
   * Whether `root` may acquire resources: it belongs to this Document and is not inside a
   * subtree being removed, unless a preserved root there holds it.
   */
  canOwn(root: Element, connected = false): boolean {
    return (
      !this.#disposed &&
      (!connected || root.isConnected) &&
      root.ownerDocument === this.document &&
      [...this.#removalScopes].every(
        ([boundaries, preserved]) => !containsAny(boundaries, root) || containsAny(preserved, root),
      )
    );
  }

  /**
   * Records a resource and returns its release. The record leaves the ledger before `cleanup`
   * runs, so cleanup runs at most once. With a `root`, the resource is also released when the
   * root leaves the document or a render removes it.
   */
  own(kind: ResourceKind, owner: string, cleanup: () => void, root?: Element): () => void {
    this.assertActive("own resources");
    if (root) {
      const connected = root.isConnected;
      if (!this.canOwn(root)) throw new Error("This root cannot acquire resources in this Document.");
      if (this.#resourceRemovalObserver) {
        this.#releaseRemovedResources();
      } else {
        const candidate = this.observe(
          "document:resource-removal",
          this.document,
          (records) => {
            this.#releaseRemovedResources(records);
          },
          { childList: true, subtree: true },
        );
        this.#resourceRemovalObserver ??= candidate.observer;
        if (this.#resourceRemovalObserver !== candidate.observer) candidate.release();
      }
      if (!this.canOwn(root, connected)) {
        throw new Error("This root cannot acquire resources in this Document.");
      }
    }
    const record: ResourceRecord = {
      kind,
      owner,
      root,
      release: () => {
        if (!this.#resources.delete(record)) return;
        cleanup();
      },
    };
    this.#resources.add(record);
    return record.release;
  }

  /** An owned event listener: removed on release, at disposal, or when `root` leaves. */
  listen(
    owner: string,
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
    root?: Element,
  ): () => void {
    const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
    const release = this.own(
      "listener",
      owner,
      () => {
        target.removeEventListener(type, listener, capture);
      },
      root,
    );
    try {
      target.addEventListener(type, listener, options);
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }

  /** An owned MutationObserver from this Document's Window. */
  observe(
    owner: string,
    target: Node,
    callback: MutationCallback,
    options: MutationObserverInit,
  ): OwnedObserver {
    this.assertActive("install observers");
    const lifetime = { active: true };
    let observer: MutationObserver | undefined;
    const release = this.own("observer", owner, () => {
      lifetime.active = false;
      observer?.disconnect();
    });
    try {
      const Observer = (this.window as Window & typeof globalThis).MutationObserver;
      this.assertActive("install observers");
      observer = new Observer((records, observed) => {
        if (lifetime.active && !this.#disposed) callback.call(observed, records, observed);
      });
      this.assertActive("install observers");
      observer.observe(target, options);
      this.assertActive("install observers");
    } catch (error) {
      try {
        if (lifetime.active) release();
        else observer?.disconnect();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Observer setup and cleanup failed.", {
          cause: cleanupError,
        });
      }
      throw error;
    }
    return { observer, release };
  }

  /**
   * An owned task: `whenEnhanced` waits for it, and its failure goes to `onError` and to the
   * next `whenEnhanced`. Releasing it stops both.
   */
  task(owner: string, task: PromiseLike<unknown>, onError: (error: unknown) => void): () => void {
    this.assertActive("register tasks");
    let active = true;
    const barrier = Promise.resolve(task).then(
      () => undefined,
      (error: unknown) => {
        if (!active) return;
        try {
          onError(error);
        } catch (reportingError) {
          this.#enhancementErrors.push(error, reportingError);
          return;
        }
        this.#enhancementErrors.push(error);
      },
    );
    this.#pendingTasks.add(barrier);
    const release = this.own("task", owner, () => {
      active = false;
      this.#pendingTasks.delete(barrier);
    });
    void barrier.then(release);
    return release;
  }

  #releaseScopedResources(
    matches: (root: Element) => boolean,
    errors: unknown[],
    preserved: readonly Element[] = [],
  ): void {
    const records = [...this.#resources].filter(
      (record): record is ResourceRecord & { root: Element } =>
        record.root !== undefined && matches(record.root),
    );
    const boundaries = new Set(records.map(({ root }) => root));
    this.#removalScopes.set(boundaries, preserved);
    try {
      for (const record of records.reverse()) attempt(errors, record.release);
    } finally {
      this.#removalScopes.delete(boundaries);
    }
  }

  // Releases resources whose root left the document outside a render. A preserved root that
  // is detached while its render is open waits until the render ends.
  #releaseRemovedResources(records = this.#resourceRemovalObserver?.takeRecords() ?? []): void {
    for (const record of records) for (const node of record.removedNodes) this.#removedNodes.add(node);
    if (this.#removedNodes.size === 0) return;
    const preserved = [...this.#activePreservedRoots.keys()];
    this.#releaseScopedResources(
      (root) =>
        (!root.isConnected || root.ownerDocument !== this.document) &&
        containsAny(this.#removedNodes, root) &&
        !containsAny(preserved, root),
      this.#enhancementErrors,
      preserved,
    );
    const deferred = preserved.filter(
      (root) =>
        (!root.isConnected || root.ownerDocument !== this.document) &&
        containsAny(this.#removedNodes, root),
    );
    this.#removedNodes.clear();
    for (const root of deferred) this.#removedNodes.add(root);
  }

  // --- Disposal ----------------------------------------------------------------------------

  /**
   * Destroys every mount, releases every resource newest first and gives up the Document.
   * Every step is attempted; failures are reported and thrown together as a `DisposalError`.
   * Later calls return the same report, or throw the same error.
   */
  dispose(): DisposalReport {
    if (this.#disposalController) {
      if (this.#disposalInProgress) return this.#disposalController.report;
      if (this.#disposalError) throw this.#disposalError;
      return this.#disposalController.report;
    }
    this.#disposed = true;
    this.#disposalInProgress = true;
    const controller = createDisposalReport();
    this.#disposalController = controller;
    const errors: unknown[] = [];
    const run = (resource: DisposalResource, cleanup: () => void): void => {
      controller.attempt(resource);
      try {
        cleanup();
        controller.release(resource);
      } catch (error) {
        errors.push(error);
        controller.fail(resource, error);
      }
    };

    for (const { mount, owner } of [...this.#mounts.values()]) {
      run({ category: "mount", owner }, () => {
        mount.destroy();
      });
      this.untrack(mount);
    }
    this.#mounts.clear();

    for (const record of [...this.#resources].reverse()) {
      run({ category: record.kind, owner: record.owner }, record.release);
    }
    this.#removedNodes.clear();
    this.#removalScopes.clear();

    if (claimedDocuments.get(this.document) === this) claimedDocuments.delete(this.document);
    this.#disposalInProgress = false;
    if (errors.length > 0) {
      this.#disposalError = new DisposalError(errors, controller.report);
      throw this.#disposalError;
    }
    return controller.report;
  }
}

export function kernelFor(document: Document): Kernel | undefined {
  return claimedDocuments.get(document);
}
