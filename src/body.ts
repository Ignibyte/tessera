// The body lease: a response body read once, as text or as a stream of chunks, and cancelled
// when the request is aborted or the reader is done without reading it all. Ported from the
// body lease in jqstar `src/protocol.ts` (`createBodyLease`), without the profile registry. A body
// shorter than its Content-Length is a failure here even where the browser reports it complete:
// WebKit resolves such a body as if it had ended (found by the navigation matrix, #18).

export interface BodyLease {
  readonly claimed: boolean;
  /** The bytes read so far, as they arrived (after any content decoding the browser did). */
  readonly bytes: number;
  /** Reads the whole body as UTF-8 text. */
  text(): Promise<string>;
  /** Hands each chunk to `consume` as it arrives. */
  stream(consume: (chunk: Uint8Array) => void | Promise<void>): Promise<void>;
  /** Cancels what is left unread; call it when done with the response. */
  release(): Promise<void>;
}

function abortError(): DOMException {
  return new DOMException("The request was aborted.", "AbortError");
}

/** The body's promised length in bytes, when the bytes read can be held to it (no encoding). */
function promisedLength(response: Response): number | undefined {
  const encoding = (response.headers.get("Content-Encoding") ?? "identity").trim().toLowerCase();
  const length = response.headers.get("Content-Length");
  if (encoding !== "identity" || length === null || !/^\d+$/.test(length.trim())) return undefined;
  return Number(length);
}

export function leaseBody(response: Response, signal: AbortSignal): BodyLease {
  let claimed = false;
  let complete = false;
  let received = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancellation: Promise<void> | undefined;

  const cancel = (): Promise<void> => {
    cancellation ??= (async () => {
      try {
        if (reader) await reader.cancel();
        else if (!response.bodyUsed) await response.body?.cancel();
      } catch {
        // Cleanup must not replace the request's own outcome.
      }
    })();
    return cancellation;
  };
  const aborted = (): void => {
    void cancel();
  };
  signal.addEventListener("abort", aborted, { once: true });

  const claim = (): void => {
    if (signal.aborted || cancellation) throw abortError();
    if (claimed) throw new Error("A response body can be read only once.");
    claimed = true;
  };

  const read = async (consume: (chunk: Uint8Array) => void | Promise<void>): Promise<void> => {
    if (!response.body) {
      complete = true;
      return;
    }
    reader = response.body.getReader();
    const promised = promisedLength(response);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        await consume(value);
        if (signal.aborted) throw abortError();
      }
      if (promised !== undefined && received < promised) {
        throw new TypeError(`The answer ended after ${String(received)} of its ${String(promised)} bytes.`);
      }
      complete = true;
    } finally {
      reader.releaseLock();
      reader = undefined;
    }
  };

  return {
    get claimed() {
      return claimed;
    },
    get bytes() {
      return received;
    },
    async text() {
      claim();
      const decoder = new TextDecoder();
      let text = "";
      await read((chunk) => {
        text += decoder.decode(chunk, { stream: true });
      });
      return text + decoder.decode();
    },
    async stream(consume) {
      claim();
      await read(consume);
    },
    async release() {
      signal.removeEventListener("abort", aborted);
      if (!complete) await cancel();
    },
  };
}
