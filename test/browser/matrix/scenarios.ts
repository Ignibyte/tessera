// The navigation matrix's 28 scenarios, frozen in jqstar `quality/navigation-decision.json`
// (contract revision 1): id, flow key, the assertions each flow must pass, and whether it applies
// without JavaScript. `differences` lists the observation fields Tessera may change against the
// no-JavaScript baseline, each with the reason; every other field must match. A declared field may
// still match in some engines (Firefox keeps the page after a lost POST, for one).
// docs/navigation-matrix.md says how each scenario was ported and which engines differ where.

/** What the matrix compares between the baseline and Tessera at the end of a flow. */
export type ObservationField = "url" | "content" | "focus" | "historyLength";

export interface Scenario {
  readonly id: string;
  readonly key: string;
  /** `javascript`: the scenario is about something only a script can do, so it has no baseline. */
  readonly applicability: "all" | "javascript";
  readonly assertions: readonly string[];
  readonly differences?: Readonly<Partial<Record<ObservationField, string>>>;
}

const HEADING =
  "an enhanced visit moves focus to the main heading of what arrived (decision #14), where the browser leaves it on the body";
const IN_PLACE = "a 422 or 409 renders the form's errors in place and adds no history entry (decisions #12 and #15)";
const LOST =
  "a write whose answer was lost: Tessera keeps the page and shows its indeterminate message, focus staying on the button (#15), where the browser shows its error page";

export const SCENARIOS: readonly Scenario[] = [
  { id: "NAV-01", key: "direct", applicability: "all", assertions: ["canonicalDocument", "accessibleLandmarks", "nativeDisclosure", "ownedRoots"] },
  {
    id: "NAV-02",
    key: "visit",
    applicability: "all",
    assertions: ["canonicalURL", "canonicalTitle", "oneRead", "zeroWrites", "canonicalDocument"],
    differences: { focus: HEADING },
  },
  { id: "NAV-03", key: "local-anchor", applicability: "all", assertions: ["zeroReads", "zeroWrites", "anchorVisible"] },
  { id: "NAV-04", key: "remote-anchor", applicability: "all", assertions: ["oneRead", "anchorVisible", "canonicalURL"] },
  {
    id: "NAV-05",
    key: "history",
    applicability: "all",
    assertions: ["canonicalHistory", "restoredScroll", "reloadIsGET", "cacheFacts"],
  },
  { id: "NAV-06", key: "eligibility", applicability: "all", assertions: ["browserOwnedTarget", "unchangedOriginalDocument", "zeroWrites"] },
  {
    id: "NAV-07",
    key: "redirect",
    applicability: "all",
    assertions: ["twoReads", "canonicalURL", "canonicalTitle", "canonicalDocument"],
    differences: { focus: HEADING },
  },
  { id: "NAV-08", key: "http-errors", applicability: "all", assertions: ["authoritativeStatus", "visibleError", "accessibleError", "zeroWrites"] },
  { id: "NAV-09", key: "content-types", applicability: "all", assertions: ["downloadReceived", "nonHTMLReceived", "zeroWrites"] },
  { id: "NAV-10", key: "head", applicability: "all", assertions: ["canonicalHead", "canonicalStyle", "canonicalScript", "fullDocumentBoundary"] },
  {
    id: "NAV-11",
    key: "get-form",
    applicability: "all",
    assertions: ["canonicalQuery", "submitterIncluded", "disabledExcluded", "zeroWrites"],
    differences: { focus: HEADING },
  },
  { id: "NAV-12", key: "validation", applicability: "all", assertions: ["zeroDispatch", "invalidFocus"] },
  {
    id: "NAV-13",
    key: "write",
    applicability: "all",
    assertions: ["oneWrite", "multipartFile", "submitterIncluded", "disabledExcluded", "revisionAdvanced", "redirectIsGET", "reloadIsGET"],
  },
  {
    id: "NAV-14",
    key: "preview",
    applicability: "all",
    assertions: ["previewSubmitter", "zeroCommittedWrites", "authoritativePreview"],
    differences: { focus: HEADING },
  },
  {
    id: "NAV-15",
    key: "server-validation",
    applicability: "all",
    assertions: ["authoritativeStatus", "revisionUnchanged", "visibleError", "accessibleError"],
    differences: { url: IN_PLACE, historyLength: IN_PLACE },
  },
  {
    id: "NAV-16",
    key: "write-loss",
    applicability: "all",
    assertions: ["oneWrite", "noAutomaticReplay", "visibleRecovery"],
    differences: { url: LOST, content: LOST, focus: LOST, historyLength: LOST },
  },
  {
    id: "NAV-17",
    key: "region",
    applicability: "all",
    assertions: ["canonicalRegion", "unrelatedContentRetainedWhenEnhanced", "regionAsDocumentWithoutEnhancement"],
    differences: {
      content: "the region link updates the activity region alone and leaves the rest of the page as it was; the browser loads the region's whole document",
      focus:
        "WebKit on macOS does not focus a clicked link but its nearest focusable ancestor, #main, which lies outside the activity region, so Tessera keeps focus there (decision #14), where the browser's new page leaves it on the body; elsewhere the clicked link is in what changed and focus goes to the body",
    },
  },
  {
    id: "NAV-18",
    key: "region-mismatch",
    applicability: "all",
    assertions: ["noWrongTargetCommit", "visibleRecovery", "canonicalFallback"],
    differences: { focus: HEADING },
  },
  {
    id: "NAV-19",
    key: "supersession",
    applicability: "all",
    assertions: ["lastIntentWins", "noStaleCommit", "requestCancellationFacts", "zeroWrites"],
    differences: { focus: HEADING },
  },
  { id: "NAV-20", key: "cancel-intent", applicability: "javascript", assertions: ["zeroDispatch", "outgoingRootsRemainLive"] },
  {
    id: "NAV-21",
    key: "network-error",
    applicability: "all",
    assertions: ["visibleRecovery", "zeroWrites", "outgoingRootsRemainLiveWithoutMutation"],
    differences: {
      focus:
        "both end on the browser's own error page, Tessera by loading the URL itself after its retries; Firefox's error page focuses its card after that load, and leaves focus on the body after a click",
    },
  },
  { id: "NAV-22", key: "no-content", applicability: "all", assertions: ["zeroMutation", "zeroWrites", "unchangedDocument"] },
  {
    id: "NAV-23",
    key: "preservation",
    applicability: "all",
    assertions: ["preservedIdentityWhenEnhanced", "canonicalServerStateForFullDocument"],
    differences: { focus: HEADING },
  },
  {
    id: "NAV-24",
    key: "lifecycle",
    applicability: "javascript",
    assertions: ["noDuplicateApplications", "orderedBridgePhases", "createdReleasedLiveReconcile", "zeroFailedDisposal", "zeroRemainingDisposal"],
  },
  { id: "NAV-25", key: "progress", applicability: "all", assertions: ["visibleProgress", "keyboardContinuity", "settledBusyState"] },
  {
    id: "NAV-26",
    key: "private-cache",
    applicability: "all",
    assertions: ["privateResponsePolicy", "restorationRequestFacts", "noPrivateWebStorage"],
    differences: { focus: "Back restores focus to the element that had it when the entry was left (decision #14), where the browser leaves it on the body" },
  },
  { id: "NAV-27", key: "prefetch", applicability: "all", assertions: ["zeroIncidentalRequests", "zeroWrites"] },
  { id: "NAV-28", key: "accessibility", applicability: "all", assertions: ["keyboardDisclosure", "visibleFocus", "noHorizontalOverflow", "accessibleError"] },
  // Tessera's own, not jqstar's: no frozen scenario answers a write with a real redirect, so
  // a Tessera that followed one went unnoticed (ticket #18).
  {
    id: "TES-01",
    key: "write-307",
    applicability: "all",
    assertions: ["noRedirectReplay", "visibleRecovery"],
    differences: {
      url: "Tessera never sends a write twice: it reports a write answered by a 307 as indeterminate and stays (protocol 4.5), where the browser sends the body again to the new address",
      content: "the same: Tessera stays on the page with its indeterminate message",
      focus: "the same: focus stays on the button",
      historyLength: "the same: Tessera adds no entry",
    },
  },
  // Tessera's own, for `data-push="off"` (ticket #28): a region link that leaves history as it
  // was, where NAV-17's region link pushes the region's URL.
  {
    id: "TES-02",
    key: "region-push-off",
    applicability: "all",
    assertions: ["canonicalRegion", "unrelatedContentRetainedWhenEnhanced", "urlKeptWhenEnhanced", "historyKeptWhenEnhanced"],
    differences: {
      url: "a link under data-push=\"off\" updates its region and keeps the page's URL (protocol 3), where the browser follows the plain link",
      content: "the region link updates the activity region alone and leaves the rest of the page as it was; the browser loads the region's whole document",
      focus: "Tessera moves neither focus nor scroll for a visit that adds no entry, so focus stays on the link the region kept where the engine focuses a clicked link; the browser leaves it on the body",
      historyLength: "the visit adds no entry; the browser's plain link adds one",
    },
  },
];
