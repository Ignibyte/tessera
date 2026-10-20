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
}

/** The secrets of one server instance: the props signing key and the CSRF token. */
export interface Secrets {
  readonly key: string;
  readonly csrf: string;
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
  res.writeHead(response.status, { Vary: VARY, ...response.headers });
  res.end(response.body);
}
