// The body lease: read once, as text or as chunks, and cancelled when aborted or left unread.
import { describe, expect, it, vi } from "vitest";
import { leaseBody } from "../../src/body.ts";

function streamed(chunks: string[]): { response: Response; cancelled: () => boolean } {
  let cancelled = false;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(encoder.encode(next));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { response: new Response(body), cancelled: () => cancelled };
}

describe("the body lease", () => {
  it("reads the body as text once", async () => {
    const lease = leaseBody(new Response("café"), new AbortController().signal);
    expect(await lease.text()).toBe("café");
    expect(lease.claimed).toBe(true);
    await expect(lease.text()).rejects.toThrow("A response body can be read only once.");
  });

  it("hands chunks to a stream consumer as they arrive", async () => {
    const { response } = streamed(["a", "b", "c"]);
    const lease = leaseBody(response, new AbortController().signal);
    const seen: string[] = [];
    await lease.stream((chunk) => {
      seen.push(new TextDecoder().decode(chunk));
    });
    expect(seen).toEqual(["a", "b", "c"]);
  });

  it("cancels a body left unread on release", async () => {
    const { response, cancelled } = streamed(["a"]);
    await leaseBody(response, new AbortController().signal).release();
    expect(cancelled()).toBe(true);
  });

  it("stops reading and cancels the body when the request is aborted", async () => {
    const { response, cancelled } = streamed(["a", "b", "c"]);
    const controller = new AbortController();
    const lease = leaseBody(response, controller.signal);
    const consume = vi.fn(() => {
      controller.abort(new DOMException("superseded", "AbortError"));
    });
    await expect(lease.stream(consume)).rejects.toMatchObject({ name: "AbortError" });
    expect(consume).toHaveBeenCalledOnce();
    await lease.release();
    expect(cancelled()).toBe(true);
  });

  it("refuses to start reading after an abort", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(leaseBody(new Response("x"), controller.signal).text()).rejects.toMatchObject({ name: "AbortError" });
  });
});
