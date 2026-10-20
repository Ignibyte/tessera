// The event-stream parser against the WHATWG HTML parsing rules and their examples, then
// jqstar's cases from `test/sse.test.ts` (the unterminated-event case inverted, as the spec has
// it).
import { describe, expect, it } from "vitest";
import { dataFields, EventStreamParser, parseEventStream } from "../../src/sse.ts";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("the spec's examples", () => {
  it("joins data lines with LF", () => {
    expect(parseEventStream("data: YHOO\ndata: +2\ndata: 10\n\n")).toEqual([
      { type: "message", data: "YHOO\n+2\n10", lastEventId: "" },
    ]);
  });

  it("carries the last event ID across events, and an empty id resets it", () => {
    expect(parseEventStream(": test stream\n\ndata: first event\nid: 1\n\ndata:second event\nid\n\ndata:  third event\n\n")).toEqual([
      { type: "message", data: "first event", lastEventId: "1" },
      { type: "message", data: "second event", lastEventId: "" },
      { type: "message", data: " third event", lastEventId: "" },
    ]);
  });

  it("fires an empty event for a bare data line, and drops a block without its blank line", () => {
    expect(parseEventStream("data\n\ndata\ndata\n\ndata:")).toEqual([
      { type: "message", data: "", lastEventId: "" },
      { type: "message", data: "\n", lastEventId: "" },
    ]);
  });

  it("removes one space after the colon, no more", () => {
    expect(parseEventStream("data:test\n\ndata: test\n\n").map(({ data }) => data)).toEqual(["test", "test"]);
  });
});

describe("the grammar", () => {
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("ends lines with %s", (_name, end) => {
    expect(parseEventStream(`event: tick${end}data: a${end}data: b${end}${end}`)).toEqual([
      { type: "tick", data: "a\nb", lastEventId: "" },
    ]);
  });

  it("mixes line endings in one stream", () => {
    expect(parseEventStream("data: a\r\ndata: b\rdata: c\n\r\n").map(({ data }) => data)).toEqual(["a\nb\nc"]);
  });

  it("ignores one leading BOM, and only at the start", () => {
    expect(parseEventStream("﻿data: a\n\n﻿data: b\n\n")).toEqual([{ type: "message", data: "a", lastEventId: "" }]);
    expect(parseEventStream("﻿﻿data: x\n\n")).toEqual([]);
  });

  it("sets the reconnection time from digits only, without an event", () => {
    const parser = new EventStreamParser();
    expect(parser.feed("retry: 2000\n\n")).toEqual([]);
    expect(parser.retry).toBe(2000);
    parser.feed("retry: 1.5\nretry: -1\nretry: 10s\nretry:\n\n");
    expect(parser.retry).toBe(2000);
    parser.feed("retry: 0\n\n");
    expect(parser.retry).toBe(0);
  });

  it("sets the last event ID from a block with no data, and ignores an id with NUL", () => {
    const parser = new EventStreamParser();
    parser.feed("id: 7\n\n");
    expect(parser.lastEventId).toBe("7");
    expect(parser.feed("id: bad\0id\ndata: x\n\n")).toEqual([{ type: "message", data: "x", lastEventId: "7" }]);
  });

  it("does not carry the event type past a blank line, and ignores unknown fields and comments", () => {
    expect(parseEventStream("event: one\n\ndata: a\nfoo: bar\n: note\n\n")).toEqual([{ type: "message", data: "a", lastEventId: "" }]);
  });

  it("reads a field without a colon as an empty value", () => {
    expect(parseEventStream("event\ndata\n\n")).toEqual([{ type: "message", data: "", lastEventId: "" }]);
  });
});

describe("chunks", () => {
  it("joins a CR at the end of one chunk with the LF starting the next", () => {
    const parser = new EventStreamParser();
    const events = [...parser.feed("data: a\r"), ...parser.feed("\ndata: b\r\n\r"), ...parser.feed("\n")];
    expect(events).toEqual([{ type: "message", data: "a\nb", lastEventId: "" }]);
  });

  it("treats a lone CR at a chunk's end as a line end when no LF follows", () => {
    const parser = new EventStreamParser();
    expect([...parser.feed("data: a\r"), ...parser.feed("\r")]).toEqual([{ type: "message", data: "a", lastEventId: "" }]);
  });

  it("decodes a multi-byte character split across chunks", () => {
    const bytes = encode("data: café 😀\n\n");
    const parser = new EventStreamParser();
    const events = [];
    for (const byte of bytes) events.push(...parser.feed(Uint8Array.of(byte)));
    expect(events).toEqual([{ type: "message", data: "café 😀", lastEventId: "" }]);
  });

  it("ignores a BOM split across byte chunks", () => {
    const parser = new EventStreamParser();
    const bytes = encode("﻿data: a\n\n");
    const events = [...parser.feed(bytes.slice(0, 2)), ...parser.feed(bytes.slice(2))];
    expect(events.map(({ data }) => data)).toEqual(["a"]);
  });

  it("replaces invalid UTF-8 with U+FFFD", () => {
    const bytes = Uint8Array.of(...encode("data: a"), 0xe2, 0x82, ...encode("b\n\n"));
    expect(parseEventStream(bytes).map(({ data }) => data)).toEqual(["a\ufffdb"]);
  });

  it("drops the incomplete event at the end, truncated character and all", () => {
    const parser = new EventStreamParser();
    expect(parser.feed(Uint8Array.of(...encode("data: a\n\ndata: b"), 0xe2, 0x82))).toEqual([
      { type: "message", data: "a", lastEventId: "" },
    ]);
    parser.end();
    expect(parser.feed("\n\n")).toEqual([]);
  });
});

describe("jqstar's cases", () => {
  it("parses chunked CRLF messages, comments, ids, retries and multi-line data", () => {
    const parser = new EventStreamParser();
    const events = [
      ...parser.feed(": heartbeat\r\nevent: tessera-patch-sign"),
      ...parser.feed("als\r\nid: patch-1\r\nretry: 1500\r\ndata: signals {count: 1}\r"),
      ...parser.feed("\n\r\nevent: custom\ndata: first\ndata: second\n\n"),
    ];
    parser.end();
    expect(events).toEqual([
      { type: "tessera-patch-signals", data: "signals {count: 1}", lastEventId: "patch-1" },
      { type: "custom", data: "first\nsecond", lastEventId: "patch-1" },
    ]);
    expect(parser.retry).toBe(1500);
  });

  it("does not dispatch a final event without its blank line (jqstar did)", () => {
    expect(parseEventStream("\n\nevent: message\ndata: final")).toEqual([]);
  });

  it("groups repeated data fields in order", () => {
    const fields = dataFields(["target content", "mode append", "elements <div>", "elements   Item", "elements </div>"].join("\n"));
    expect(fields.get("target")).toEqual(["content"]);
    expect(fields.get("elements")?.join("\n")).toBe("<div>\n  Item\n</div>");
  });

  it("ignores malformed metadata and keeps the last valid event ID", () => {
    const parser = new EventStreamParser();
    expect(parser.feed("id: valid\nid: invalid\0id\nretry: nope\nunknown\ndata: kept\r\r")).toEqual([
      { type: "message", data: "kept", lastEventId: "valid" },
    ]);
    expect(parser.retry).toBeUndefined();
    expect(parseEventStream("retry: 12\nevent: discarded\n\ndata\n\n")).toEqual([{ type: "message", data: "", lastEventId: "" }]);
    expect(dataFields("flag\nvalue ready")).toEqual(
      new Map([
        ["flag", [""]],
        ["value", ["ready"]],
      ]),
    );
  });
});
