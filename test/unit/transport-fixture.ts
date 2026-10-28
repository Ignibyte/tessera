// A kernel, attributes, a patcher and a transport over a fake fetch, in jsdom's own document,
// for the transport and coordination tests.
import { vi } from "vitest";
import { createActionRecorder } from "../../src/actions.ts";
import { mountAttributes } from "../../src/attributes.ts";
import { registerBuiltins } from "../../src/builtins.ts";
import { createDirectiveRegistry } from "../../src/directive.ts";
import { createTrustedExpressionEngine } from "../../src/expression.ts";
import { Kernel } from "../../src/kernel.ts";
import { createPatcher } from "../../src/patch.ts";
import { Scheduler } from "../../src/reactivity.ts";
import { createTransport } from "../../src/transport.ts";
import type { TransportOptions } from "../../src/transport.ts";

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  redirect: string | undefined;
  signal: AbortSignal;
}

export type Responder = (call: Call) => Response | Promise<Response>;

let kernel: Kernel | undefined;

/** Disposes the fixture's kernel and clears the document; call it from afterEach. */
export function disposeTransport(): void {
  vi.useRealTimers();
  if (kernel && !kernel.disposed) kernel.dispose();
  kernel = undefined;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
}

export const ORIGIN = window.location.origin;

export function fragments(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: { "Content-Type": "text/vnd.tessera+html; charset=utf-8", "Tessera-Protocol": "2", ...init.headers },
  });
}

export function empty(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

/** A responder that never answers, until the request is aborted. */
export const hang: Responder = (call) =>
  new Promise((_resolve, reject) => {
    call.signal.addEventListener("abort", () => {
      reject(call.signal.reason as Error);
    });
  });

export const networkFailure: Responder = () => Promise.reject(new TypeError("Failed to fetch"));

export function bodyText(body: unknown): string {
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    return new URLSearchParams(Array.from(body, ([name, value]) => [name, typeof value === "string" ? value : value.name])).toString();
  }
  return typeof body === "string" ? body : "";
}

export function setup(html: string, options: Partial<TransportOptions> = {}, head = `<meta name="tessera-layout" content="app"><meta name="tessera-csrf-token" content="tok">`) {
  document.head.innerHTML = head;
  document.body.innerHTML = html;
  const scheduler = new Scheduler();
  const current = new Kernel(document, { flush: () => scheduler.nextUpdate() });
  kernel = current;
  const registry = createDirectiveRegistry();
  registerBuiltins(registry);
  const mount = mountAttributes(document.body, {
    kernel: current,
    scheduler,
    expressions: createTrustedExpressionEngine(),
    registry,
    actions: createActionRecorder().seam,
    report: () => undefined,
  });
  const patcher = createPatcher({ kernel: current, scopes: mount.scopes, refresh: (elements) => { mount.refresh(elements); } });
  const calls: Call[] = [];
  const responders: Responder[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers)),
      body: init.body,
      redirect: init.redirect,
      signal: init.signal ?? new AbortController().signal,
    };
    calls.push(call);
    const respond = responders.shift() ?? (() => fragments(""));
    return respond(call);
  });
  const navigated: string[] = [];
  const pushed: string[] = [];
  const reported: unknown[] = [];
  const transport = createTransport({
    kernel: current,
    patcher,
    scopes: mount.scopes,
    fetch,
    navigate: (url) => navigated.push(url),
    history: {
      capture: () => undefined,
      commit: (url) => {
        pushed.push(url);
      },
    },
    report: (error) => reported.push(error),
    reload: vi.fn(),
    confirm: vi.fn(() => false),
    bufferMs: 0,
    retryDelayMs: 1,
    ...options,
  });
  const find = (selector: string): HTMLElement => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`no ${selector}`);
    return element;
  };
  const form = (selector: string): HTMLFormElement => find(selector) as HTMLFormElement;
  const respond = (...next: Responder[]): void => {
    responders.push(...next);
  };
  return { kernel: current, mount, patcher, transport, calls, respond, fetch, navigated, pushed, reported, find, form };
}

