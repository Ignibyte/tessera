import { test } from "@playwright/test";

/**
 * A name for server-side state (a controller channel, a log key) that belongs to this test
 * alone. A worker runs tests from several files one after another, so a name built from the
 * worker index is shared by any two tests that pick the same `name`; the test id is not.
 */
export function testName(name: string): string {
  return `${name}-${test.info().testId}-${String(test.info().retry)}`;
}
