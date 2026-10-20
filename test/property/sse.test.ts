// The event-stream parser under any chunking (fixed seed): bytes split anywhere, inside CRLF
// pairs and multi-byte characters, give the same events, last event ID and retry as the whole
// stream; serialised events parse back; and the counterexamples in regressions.json replay.
// The chunk-boundary and data-field properties are ported from jqstar
// `test/property/sse.property.test.ts`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { dataFields, EventStreamParser, parseEventStream } from "../../src/sse.ts";
import type { StreamEvent } from "../../src/sse.ts";
import regressions from "./regressions.json";

const SEED = 20261020;
const RUNS = { seed: SEED, numRuns: 300 };

/** The characters of a set, by code point. */
const chars = (set: string): string[] => Array.from(set);

const text = fc.string({ unit: fc.constantFrom(...chars("abz 09:-_é€😀\0")), maxLength: 12 });
const ending = fc.constantFrom("\n", "\r\n", "\r");
const field = fc.oneof(
  fc.tuple(fc.constant("data"), text),
  fc.tuple(fc.constant("event"), text),
  fc.tuple(fc.constant("id"), text),
  fc.tuple(fc.constant("retry"), fc.oneof(fc.nat({ max: 99_999 }).map(String), text)),
  fc.tuple(fc.constant(""), text),
  fc.tuple(fc.constant("other"), text),
);
const line = fc.tuple(field, fc.boolean(), ending).map(([[name, value], spaced, end]) =>
  `${name === "" ? ":" : name}${name === "" ? "" : spaced ? ": " : ":"}${value}${end}`,
);
const block = fc.tuple(fc.array(line, { maxLength: 5 }), ending).map(([lines, end]) => `${lines.join("")}${end}`);
const stream = fc
  .tuple(fc.boolean(), fc.array(block, { maxLength: 6 }), fc.array(line, { maxLength: 2 }))
  .map(([bom, blocks, tail]) => `${bom ? "﻿" : ""}${blocks.join("")}${tail.join("")}`);

interface Outcome {
  events: StreamEvent[];
  lastEventId: string;
  retry: number | undefined;
}

function feedAll(chunks: readonly (Uint8Array | string)[]): Outcome {
  const parser = new EventStreamParser();
  const events = chunks.flatMap((chunk) => parser.feed(chunk));
  parser.end();
  return { events, lastEventId: parser.lastEventId, retry: parser.retry };
}

function splitAt<T extends Uint8Array | string>(whole: T, cuts: readonly number[]): T[] {
  const positions = [...new Set(cuts.map((cut) => cut % (whole.length + 1)))].sort((left, right) => left - right);
  const pieces: T[] = [];
  let start = 0;
  for (const position of [...positions, whole.length]) {
    pieces.push(whole.slice(start, position) as T);
    start = position;
  }
  return pieces;
}

function splitAtSizes(source: string, sizes: readonly number[]): string[] {
  const chunks: string[] = [];
  for (let offset = 0, index = 0; offset < source.length; index++) {
    const size = sizes[index % sizes.length] ?? 1;
    chunks.push(source.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

describe("chunking", () => {
  it("gives the same outcome for bytes split anywhere", () => {
    fc.assert(
      fc.property(stream, fc.array(fc.nat(), { maxLength: 40 }), (source, cuts) => {
        const bytes = new TextEncoder().encode(source);
        expect(feedAll(splitAt(bytes, cuts))).toEqual(feedAll([bytes]));
      }),
      RUNS,
    );
  });

  it("gives the same outcome for text split anywhere, surrogate pairs included", () => {
    fc.assert(
      fc.property(stream, fc.array(fc.nat(), { maxLength: 40 }), (source, cuts) => {
        expect(feedAll(splitAt(source, cuts))).toEqual(feedAll([source]));
      }),
      RUNS,
    );
  });

  it("parses the same messages across transport chunk sizes (from jqstar)", () => {
    const lineText = fc.string({ unit: fc.constantFrom(...chars("abcdefghijklmnopqrstuvwxyz0123456789 -_:")), maxLength: 40 });
    fc.assert(
      fc.property(
        fc.array(lineText, { minLength: 1, maxLength: 12 }),
        fc.array(fc.integer({ min: 1, max: 17 }), { minLength: 1, maxLength: 12 }),
        ending,
        (data, sizes, end) => {
          const source = `${data.map((value) => `data: ${value}`).join(end)}${end}${end}`;
          expect(feedAll(splitAtSizes(source, sizes)).events).toEqual(parseEventStream(source));
        },
      ),
      RUNS,
    );
  });
});

describe("round trip", () => {
  const value = fc.string({ unit: fc.constantFrom(...chars("abz 09:é😀")), maxLength: 10 });
  const event = fc.record({
    type: fc.stringMatching(/^[a-z][a-z-]{0,8}$/),
    lines: fc.array(value, { minLength: 1, maxLength: 4 }),
    id: fc.option(value, { nil: undefined }),
  });

  it("parses serialised events back to themselves", () => {
    fc.assert(
      fc.property(fc.array(event, { maxLength: 6 }), ending, (events, end) => {
        let lastEventId = "";
        const expected: StreamEvent[] = [];
        let source = "";
        for (const { type, lines, id } of events) {
          source += `event: ${type}${end}`;
          if (id !== undefined) {
            source += `id: ${id}${end}`;
            lastEventId = id;
          }
          for (const data of lines) source += `data: ${data}${end}`;
          source += end;
          expected.push({ type, data: lines.join("\n"), lastEventId });
        }
        expect(parseEventStream(source)).toEqual(expected);
      }),
      RUNS,
    );
  });
});

describe("data fields", () => {
  it("keeps repeated keys in order (from jqstar)", () => {
    const key = fc.string({ unit: fc.constantFrom(...chars("abcdefghijklmnopqrstuvwxyz")), minLength: 1, maxLength: 12 });
    const lineText = fc.string({ unit: fc.constantFrom(...chars("abcdefghijklmnopqrstuvwxyz0123456789 -_:")), maxLength: 40 });
    fc.assert(
      fc.property(fc.array(fc.tuple(key, lineText), { minLength: 1, maxLength: 30 }), (entries) => {
        const expected = new Map<string, string[]>();
        for (const [name, value] of entries) expected.set(name, [...(expected.get(name) ?? []), value]);
        expect(dataFields(entries.map(([name, value]) => `${name} ${value}`).join("\n"))).toEqual(expected);
      }),
      RUNS,
    );
  });
});

describe("regressions", () => {
  it("replays the CRLF split from jqstar", () => {
    const { source, chunks } = regressions["sse-crlf-boundary"];
    expect(feedAll(splitAtSizes(source, chunks)).events).toEqual([{ type: "update", data: "first\nsecond", lastEventId: "" }]);
  });

  it("replays a bare CR ending a chunk", () => {
    const { source, chunks } = regressions["sse-cr-at-chunk-end"];
    expect(feedAll(splitAtSizes(source, chunks)).events).toEqual([{ type: "message", data: "a\nb", lastEventId: "" }]);
  });
});
