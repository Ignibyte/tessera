import { describe, expect, it } from "vitest";
import { version } from "../../src/index.ts";
import pkg from "../../package.json" with { type: "json" };

describe("version", () => {
  it("matches package.json", () => {
    expect(version).toBe(pkg.version);
  });
});
