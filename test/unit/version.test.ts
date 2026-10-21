import { describe, expect, it } from "vitest";
import { version } from "../../src/index.ts";
import pkg from "../../package.json" with { type: "json" };
import { imageFor, PLAYWRIGHT_IMAGE } from "../../scripts/webkit-image.ts";

describe("version", () => {
  it("matches package.json", () => {
    expect(version).toBe(pkg.version);
  });

  it("pins the WebKit image to the @playwright/test version", () => {
    expect(PLAYWRIGHT_IMAGE).toBe(imageFor(pkg.devDependencies["@playwright/test"]));
  });
});
