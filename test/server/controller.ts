// The controllable endpoint: tests decide when, and in which order, responses go. Every request
// to `/controlled/CHANNEL/…` is captured and held; `POST /_control/CHANNEL/release` answers the
// oldest held request, or the oldest held one with the given path and method. Strict like the
// FIFO response controller of jqstar's testing kit (jqstar `src/testing/responses.ts`): nothing
// passes through, and a release that finds no held request fails rather than guessing. The
// channel keeps tests running in parallel apart.
import type { ServerResponse } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { json, send, text } from "./http.ts";
import type { FixtureRequest, FixtureResponse } from "./http.ts";

export const CHANNEL = /^[A-Za-z0-9_-]{1,64}$/;

/** What `GET /_control/CHANNEL/requests` reports for each captured request. */
export interface Captured {
  seq: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  state: "held" | "answered" | "aborted" | "dropped";
}

/** A release: which held request to answer, and with what. */
export interface Release {
  path?: string;
  method?: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  serve?: string;
  /** Destroys the held connection instead of answering: the client sees a network failure. */
  drop?: boolean;
  timeout?: number;
}

interface Held {
  record: Captured;
  request: FixtureRequest;
  res: ServerResponse;
}

interface Waiter {
  release: Release;
  res: ServerResponse;
  cancel: AbortController;
}

interface Channel {
  seq: number;
  captured: Held[];
  waiters: Waiter[];
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

/** Checks a release body; returns the release or what is wrong with it. */
export function parseRelease(body: string): Release | string {
  let value: unknown;
  try {
    value = JSON.parse(body === "" ? "{}" : body);
  } catch {
    return "the body must be JSON";
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "the body must be a JSON object";
  }
  const input = value as Record<string, unknown>;
  const known = ["path", "method", "status", "headers", "body", "serve", "drop", "timeout"];
  const unknown = Object.keys(input).filter((name) => !known.includes(name));
  if (unknown.length > 0) return `unknown fields: ${unknown.join(", ")}`;
  const release: Release = {};
  for (const name of ["path", "method", "body", "serve"] as const) {
    const field = input[name];
    if (field === undefined) continue;
    if (typeof field !== "string") return `${name} must be a string`;
    release[name] = field;
  }
  if (input.status !== undefined) {
    if (!Number.isInteger(input.status) || (input.status as number) < 200 || (input.status as number) > 599) {
      return "status must be an integer from 200 to 599";
    }
    release.status = input.status as number;
  }
  if (input.timeout !== undefined) {
    if (!Number.isInteger(input.timeout) || (input.timeout as number) < 0 || (input.timeout as number) > 30_000) {
      return "timeout must be an integer from 0 to 30000";
    }
    release.timeout = input.timeout as number;
  }
  if (input.headers !== undefined) {
    if (!isStringRecord(input.headers)) return "headers must be an object of strings";
    release.headers = input.headers;
  }
  if (release.serve !== undefined && (release.status !== undefined || release.headers !== undefined || release.body !== undefined)) {
    return "serve cannot be combined with status, headers or body";
  }
  if (input.drop !== undefined) {
    if (typeof input.drop !== "boolean") return "drop must be a boolean";
    if (input.drop && Object.keys(input).some((name) => !["path", "method", "drop", "timeout"].includes(name))) {
      return "drop cannot be combined with status, headers, body or serve";
    }
    release.drop = input.drop;
  }
  return release;
}

function flatHeaders(request: FixtureRequest): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

export class Controller {
  readonly #channels = new Map<string, Channel>();
  readonly #serve: (request: FixtureRequest) => Promise<FixtureResponse>;

  /** `serve` answers a request as the server would, for a release with `serve`. */
  constructor(serve: (request: FixtureRequest) => Promise<FixtureResponse>) {
    this.#serve = serve;
  }

  #channel(name: string): Channel {
    let channel = this.#channels.get(name);
    if (!channel) {
      channel = { seq: 0, captured: [], waiters: [] };
      this.#channels.set(name, channel);
    }
    return channel;
  }

  /** Captures and holds a request to `/controlled/CHANNEL/…`. */
  capture(name: string, request: FixtureRequest, res: ServerResponse): void {
    const channel = this.#channel(name);
    const record: Captured = {
      seq: ++channel.seq,
      method: request.method,
      url: `${request.url.pathname}${request.url.search}`,
      headers: flatHeaders(request),
      body: request.body,
      state: "held",
    };
    res.on("close", () => {
      if (record.state === "held") record.state = "aborted";
    });
    channel.captured.push({ record, request, res });
    this.#match(channel);
  }

  /** Handles `/_control/CHANNEL/ACTION`. */
  async api(name: string, action: string, request: FixtureRequest, res: ServerResponse): Promise<void> {
    if (action === "requests" && request.method === "GET") {
      const channel = this.#channels.get(name);
      send(res, json(200, { requests: channel?.captured.map((held) => held.record) ?? [] }));
    } else if (action === "reset" && request.method === "POST") {
      send(res, json(200, { held: this.#reset(name) }));
    } else if (action === "release" && request.method === "POST") {
      const release = parseRelease(request.body);
      if (typeof release === "string") {
        send(res, text(400, release));
        return;
      }
      await this.#release(name, release, res);
    } else {
      send(res, text(404, "Control actions: GET requests, POST release, POST reset."));
    }
  }

  async #release(name: string, release: Release, res: ServerResponse): Promise<void> {
    const channel = this.#channel(name);
    const waiter: Waiter = { release, res, cancel: new AbortController() };
    channel.waiters.push(waiter);
    this.#match(channel);
    if (!channel.waiters.includes(waiter)) return;
    try {
      await sleep(release.timeout ?? 5000, undefined, { signal: waiter.cancel.signal, ref: false });
    } catch {
      return; // matched, or the channel was reset
    }
    channel.waiters.splice(channel.waiters.indexOf(waiter), 1);
    const held = channel.captured.filter((entry) => entry.record.state === "held");
    send(res, json(408, { error: "no held request matches", held: held.map((entry) => entry.record) }));
  }

  /** Pairs waiting releases with held requests: each release takes the oldest that matches. */
  #match(channel: Channel): void {
    for (const waiter of [...channel.waiters]) {
      const { path, method } = waiter.release;
      const held = channel.captured.find(
        (entry) =>
          entry.record.state === "held" &&
          (path === undefined || entry.record.url === path) &&
          (method === undefined || entry.record.method === method.toUpperCase()),
      );
      if (!held) continue;
      held.record.state = "answered";
      channel.waiters.splice(channel.waiters.indexOf(waiter), 1);
      waiter.cancel.abort();
      void this.#answer(held, waiter);
    }
  }

  async #answer(held: Held, waiter: Waiter): Promise<void> {
    const { serve, status, headers, body, drop } = waiter.release;
    if (drop) {
      held.record.state = "dropped";
      held.res.socket?.destroy();
      held.res.destroy();
      const { seq, method, url } = held.record;
      send(waiter.res, json(200, { seq, method, url, dropped: true }));
      return;
    }
    let response: FixtureResponse;
    try {
      response =
        serve === undefined
          ? { status: status ?? 200, headers: headers ?? {}, body: body ?? "" }
          : await this.#serve({ ...held.request, url: new URL(serve, held.request.url) });
    } catch (error) {
      response = text(500, `The server failed: ${String(error)}`);
    }
    send(held.res, response);
    const { seq, method, url } = held.record;
    send(waiter.res, json(200, { seq, method, url, status: response.status }));
  }

  #reset(name: string): number {
    const channel = this.#channels.get(name);
    if (!channel) return 0;
    this.#channels.delete(name);
    let held = 0;
    for (const entry of channel.captured) {
      if (entry.record.state !== "held") continue;
      held++;
      entry.record.state = "answered";
      send(entry.res, text(503, "The controller was reset."));
    }
    for (const waiter of channel.waiters) {
      waiter.cancel.abort();
      send(waiter.res, text(409, "The controller was reset."));
    }
    return held;
  }

  /** Ends every wait, for a server that is closing. */
  dispose(): void {
    for (const name of [...this.#channels.keys()]) this.#reset(name);
  }
}
