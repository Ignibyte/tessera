---
number: 32
uuid: 1965b78a-9880-49dc-9112-139fde7c1cb1
title: "A component patch resets the form fields beside it"
type: bug
status: open
tags: 
created: 2026-10-27T09:32:23Z
updated: 2026-10-27T09:32:23Z
---

Found by Lotline run 9 (AIC #168, aic-demo ticket 9, 2026-10-27). morphRange() patches a component target by morphing the markers' parent against a copy in which every child outside the range is child.cloneNode(true). A clone carries attributes, not live form state, and Idiomorph's value sync writes value and selected back from the clones, so every field beside the target returns to its server-rendered value: on Lotline's inventory page the filter form's selections are lost each time the table refreshes. Only the nodes between the target's markers may change. Fix: Idiomorph leaves the children outside the range unmorphed. Test: a component patch beside an unfocused select and input keeps what the user set.
