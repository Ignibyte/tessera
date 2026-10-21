// The Playwright image the WebKit tests run in (scripts/webkit.ts). Its tag must be the pinned
// @playwright/test version, so the browser build in the image is the one that version drives;
// scripts/webkit.ts refuses to run, and test/unit/version.test.ts fails, when they drift.
export const PLAYWRIGHT_IMAGE = "mcr.microsoft.com/playwright:v1.62.1-noble";

/** The image for a version of @playwright/test. */
export function imageFor(version: string): string {
  return `mcr.microsoft.com/playwright:v${version}-noble`;
}
