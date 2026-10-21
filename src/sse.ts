// The event-stream parser for Server-Sent Events, incremental: chunks may split anywhere,
// inside a CRLF pair or a multi-byte UTF-8 character. Ported from jqstar `src/sse.ts` and
// brought to the WHATWG HTML algorithm ("Server-sent events", interpreting an event stream):
// bare CR line endings, a leading BOM, `retry` as the stream's reconnection time, and no
// dispatch for an event the stream ends before its blank line.

export interface StreamEvent {
  /** The `event` field, or `message`. */
  readonly type: string;
  /** The `data` lines joined with LF. */
  readonly data: string;
  /** The last event ID when this event was dispatched; it carries over between events. */
  readonly lastEventId: string;
}

const BOM = "﻿";

export class EventStreamParser {
  readonly #decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  #buffer = "";
  #started = false;
  /** The previous chunk ended in CR, so an LF starting this one belongs to it. */
  #afterCR = false;
  #type = "";
  #data = "";
  #idBuffer = "";
  #lastEventId = "";
  #retry: number | undefined;

  /**
   * `lastEventId` carries a stream's last event ID into a new connection: the standard keeps it
   * across reconnects, so an event without `id` on the new connection does not clear it.
   */
  constructor(lastEventId = "") {
    this.#idBuffer = lastEventId;
    this.#lastEventId = lastEventId;
  }

  /** The stream's last event ID, as `Last-Event-ID` sends it on a reconnect. */
  get lastEventId(): string {
    return this.#lastEventId;
  }

  /** The reconnection time in milliseconds the stream last set with `retry`, if any. */
  get retry(): number | undefined {
    return this.#retry;
  }

  /** Parses a chunk, bytes or text, and returns the events it completed. */
  feed(chunk: Uint8Array | string): StreamEvent[] {
    const text = typeof chunk === "string" ? chunk : this.#decoder.decode(chunk, { stream: true });
    return this.#text(text);
  }

  /** Ends the stream: the decoder is flushed, and an event without its blank line is dropped. */
  end(): void {
    this.#text(this.#decoder.decode());
    this.#buffer = "";
    this.#afterCR = false;
    this.#type = "";
    this.#data = "";
  }

  #text(input: string): StreamEvent[] {
    let text = input;
    if (!this.#started && text.length > 0) {
      this.#started = true;
      if (text.startsWith(BOM)) text = text.slice(1);
    }
    if (this.#afterCR && text.startsWith("\n")) text = text.slice(1);
    if (text.length > 0) this.#afterCR = false;
    this.#buffer += text;

    const events: StreamEvent[] = [];
    let start = 0;
    for (let index = 0; index < this.#buffer.length; index++) {
      const character = this.#buffer[index];
      if (character !== "\n" && character !== "\r") continue;
      const line = this.#buffer.slice(start, index);
      if (character === "\r") {
        if (index + 1 === this.#buffer.length) this.#afterCR = true;
        else if (this.#buffer[index + 1] === "\n") index++;
      }
      start = index + 1;
      const event = this.#line(line);
      if (event) events.push(event);
    }
    this.#buffer = this.#buffer.slice(start);
    return events;
  }

  #line(line: string): StreamEvent | undefined {
    if (line === "") return this.#dispatch();
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.#type = value;
    else if (field === "data") this.#data += `${value}\n`;
    else if (field === "id") {
      if (!value.includes("\0")) this.#idBuffer = value;
    } else if (field === "retry" && /^[0-9]+$/.test(value)) this.#retry = Number(value);
    return undefined;
  }

  #dispatch(): StreamEvent | undefined {
    this.#lastEventId = this.#idBuffer;
    if (this.#data === "") {
      this.#type = "";
      return undefined;
    }
    const event: StreamEvent = {
      type: this.#type || "message",
      data: this.#data.endsWith("\n") ? this.#data.slice(0, -1) : this.#data,
      lastEventId: this.#lastEventId,
    };
    this.#type = "";
    this.#data = "";
    return event;
  }
}

/** Parses a whole stream. */
export function parseEventStream(source: Uint8Array | string): StreamEvent[] {
  const parser = new EventStreamParser();
  const events = parser.feed(source);
  parser.end();
  return events;
}

/**
 * The protocol's `data: KEY VALUE` lines (docs/protocol.md, section 7.2), grouped by key in
 * order: `KEY` up to the first space, the rest after it. From jqstar `sseDataFields`.
 */
export function dataFields(data: string): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  for (const line of data.split("\n")) {
    const space = line.indexOf(" ");
    const key = space < 0 ? line : line.slice(0, space);
    const value = space < 0 ? "" : line.slice(space + 1);
    const values = fields.get(key);
    if (values) values.push(value);
    else fields.set(key, [value]);
  }
  return fields;
}
