---
number: 45
uuid: 16b275e0-43ce-4e71-9bc9-9d9e946c626f
title: "data-mount: a module script mounted on an element, again after each patch"
type: feature
status: in-progress
tags: 
created: 2026-11-19T23:42:30Z
updated: 2026-11-19T23:55:18Z
phase: "check"
---

A server-rendered app that mounts a client library on an element (a chart, a map, an editor, a calendar) has no way to start it on an element a fragment brings, or to stop it before the element goes: a page script loads everywhere and runs once.

Shape (a directive, so the existing mount, update and cleanup lifecycle carries it):
- data-mount="URL" on an element: Tessera imports the module at URL (a same-origin module script, once per URL, through a dynamic import, so a page loads a library only when an element names it) and calls its export mount(element, data). data is JSON.parse of the element's data-mount-data attribute, or null without one. mount may return a cleanup function.
- Before the element leaves the page (a morph, an inner patch, a remove, a whole-document visit), Tessera calls the cleanup, then the module's unmount(element) export if it has one.
- A morph keeps a mounted element's children as they are (they are the library's) and updates its attributes; a changed data-mount or data-mount-data unmounts and mounts again with the new data.
- On start, every data-mount element on the page mounts; after each patch, every one the patch brought.
- An import or mount that fails is reported as other directive errors are; the rest of the page goes on. A module without a mount export is an error.
- CSP: a dynamic import of a same-origin URL needs no unsafe-eval; the CSP build must carry it too.

Acceptance: unit tests for mount, unmount on removal, remount on a data change, children kept across a morph; a browser test on the reference server: a fixture element mounted on load, again after a fragment brings a new one, its library DOM kept through a morph, unmounted before a remove. docs/protocol.md section 3 (a data-mount row), README's attribute list, CHANGELOG. Release as 0.4.6 for AIC's pin.

## Comments

### 2026-11-19T23:45:41Z

Plan. A built-in directive data-mount in src/builtins.ts (key forbidden, no modifiers). Its mount resolves the value against the element's base URL and refuses another origin or an empty value, parses data-mount-data as JSON (null without it; bad JSON is an error), then in a task imports the module through one promise per absolute URL (a failed import leaves the cache, so a later element retries), checks for a mount export and calls mount(element, data). A function it returns is the cleanup; anything else but undefined is reported. Released, the directive calls the cleanup, then the module's unmount(element) if it exports one. Released before the import settles, it calls nothing. The directive registry gains an internal remountOn list: src/attributes.ts remounts a directive when one of those attributes on its element changes value, so a changed data-mount-data unmounts and mounts again; a changed data-mount already remounts, as the directive has no update. src/patch.ts: in a morph (fragment or whole-document), an old element with data-mount whose incoming counterpart also has data-mount gets its attributes from the counterpart and keeps its children (beforeNodeMorphed copies the attributes and returns false); it joins the refreshed elements. A counterpart without data-mount morphs as usual. inner, append and prepend on the element itself act on its children as asked. The import loader is a parameter of registerBuiltins so unit tests give a fake one; the build keeps import(url). CSP: a dynamic import of a same-origin URL needs no unsafe-eval; the browser test runs the csp-iife release under script-src 'self'. Tests: test/unit/mount.test.ts (mount with data and null, import once per URL, cleanup then unmount on removal by a morph, a remove and a node removal, remount on a data-mount-data and a data-mount change, children kept and attributes updated across a morph, errors: no mount export, failed import, other origin, bad JSON); test/browser/mount.spec.ts on a fixture page /mount with /assets/mount-widget.js: mounted on load, a fragment bringing a new one mounts it, the library DOM kept through a morph, unmount before a remove while the element is still connected, the csp-iife build under CSP. Bite: revert src/ and run both. Docs: protocol.md section 3 row, README attribute list, CHANGELOG, decisions.md entry (Provisional) for the choices above. The size budget should hold.

### 2026-11-19T23:55:18Z

Check: npm run check passed (828 unit and property tests; default build 33,962 bytes gzipped, csp 41,760, budgets unchanged). npm run test:browser passed, 282 of 282 (Chromium and Firefox) at load average 36. Firefox would not launch at first: its install directory held a stale lock symlink from 2026-11-03 (a dead process), so every Firefox test failed with 'ENOENT ... firefox-1538/firefox/lock', on main's smoke spec too; npx playwright install --force firefox fixed it. Bite: with src/ from main, 17 of the 18 unit tests and all 12 browser tests fail (the one left asserts nothing is called after an early removal). With src/patch.ts alone from main, the 4 children-kept tests fail; without the remountOn handling in src/attributes.ts, the 2 data-mount-data remount tests fail. One change from the plan: a morph whose incoming element drops data-mount now releases the directive before Idiomorph morphs the children (a patcher option, release(element, attribute), wired to a new AttributesMount.release), since releasing after the morph handed unmount the server's children.
