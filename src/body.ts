// The body lease: a response body read once, as text or as a stream of chunks, and cancelled
// when the request is aborted or the reader is done without reading it all. Ported from the
// body lease in jqstar `src/protocol.ts` (`createBodyLease`), without the profile registry.

export interface BodyLease {
  readonly claimed: boolean;
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

export function leaseBody(response: Response, signal: AbortSignal): BodyLease {
  let claimed = false;
  let complete = false;
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
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await consume(value);
        if (signal.aborted) throw abortError();
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
