// Request and response shapes shared by the reference server's modules.
import type { IncomingHttpHeaders, ServerResponse } from "node:http";

/** Section 8: every response from a URL that answers Tessera requests carries this. */
export const VARY = "Tessera-Request, Tessera-Protocol, Tessera-Targets, Tessera-Layout";

/** A request with its body read, so a held request can be answered as another URL later. */
export interface FixtureRequest {
  readonly method: string;
  readonly url: URL;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface FixtureResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Buffer;
  /** Destroy the connection instead of answering: the client sees a network failure. */
  readonly drop?: boolean;
}

/** The secrets of one server instance: the props signing key and the CSRF token. */
export interface Secrets {
  readonly key: string;
  readonly csrf: string;
}

/** One server instance's state: its secrets, the `/counter` counts and the write ids it saw. */
export interface ServerState extends Secrets {
  readonly counts: Map<string, number>;
  /** Each Tessera write that carried `Tessera-Write-Id`, in arrival order. */
  readonly arrivals: { readonly path: string; readonly id: string; readonly repeat: boolean }[];
  /** The first answer to each write id, kept for the protocol's window (section 5.8). */
  readonly writes: Map<string, { readonly response: FixtureResponse; readonly at: number }>;
  /** The ticks of `/poll/tick`, per key. */
  readonly ticks: Map<string, number>;
  /** Each connection to `/events/stream` that named a `key`, in arrival order. */
  readonly streams: StreamConnection[];
}

export interface StreamConnection {
  readonly key: string;
  /** The `Last-Event-ID` it sent, or null. */
  readonly lastEventId: string | null;
  /** Whether the connection has closed, from either end. */
  closed: boolean;
}

/** One header's value, with repeated headers joined as HTTP joins them. */
export function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(", ") : value;
}

export function isTessera(request: FixtureRequest): boolean {
  return header(request.headers, "tessera-request") !== undefined;
}

export function text(status: number, body: string): FixtureResponse {
  return { status, headers: { "Content-Type": "text/plain; charset=utf-8" }, body: `${body}\n` };
}

export function json(status: number, value: unknown): FixtureResponse {
  return {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: `${JSON.stringify(value)}\n`,
  };
}

export function send(res: ServerResponse, response: FixtureResponse): void {
  if (response.drop) {
    res.socket?.destroy();
    res.destroy();
    return;
  }
  res.writeHead(response.status, { Vary: VARY, ...response.headers });
  res.end(response.body);
}
