---
number: 45
uuid: 16b275e0-43ce-4e71-9bc9-9d9e946c626f
title: "data-mount: a module script mounted on an element, again after each patch"
type: feature
status: open
tags: 
created: 2026-11-19T23:42:30Z
updated: 2026-11-19T23:42:30Z
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
