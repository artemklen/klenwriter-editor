# Keep an already selected input source

The installed43 coordinator reads fresh input-source status before each request
to ensure a layout. It first requires a coherent selected, enabled and selectable
current source in both the current-source record and the existing-source list.
If that exact source is already requested, it records `keep-existing-source`
and does not call `TISSelectInputSource` again. The existing per-action coherent
source checks still run before and after physical input.

A real source change retains the existing selection call, 250 ms wait and fresh
coherent readback. Original-source restoration still requires five coherent
readbacks. This changes no key, native action guard, semantic fixture or frozen
installed-v1 file.

Chrome attempt02 at `3c2486e` is preserved as FAILED. Its Enter attempt and its
single release attempt lack completion acknowledgements; both remain unknown.
The saved Swift preflights found the expected focused root while AppleScript
refused its exact front-window-title guard. An additional AX window was counted
but not described. Calling source selection between the preceding character and
Enter is known ordering, not evidence that it caused that window or the refusal.
The idempotent path removes an unnecessary source-selection operation; it does
not treat the failed attempt as accepted evidence or weaken either window guard.
