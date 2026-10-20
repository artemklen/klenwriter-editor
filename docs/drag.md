# Moving blocks with the optional drag UI

`@klenwriter/editor-ui` supports a pointer handle when the host supplies
`UiProfile.drag.move`. The callback receives the captured native source header,
full stamp/context, and a measured destination. It returns an existing profile
command or a localized `UiUnavailable`; the UI does not infer a profile's schema.

For KWDJ, return `kwdjCommand({kind: 'move', node: captured.source.id,
parent: destination.parent, before_index: destination.before_index})`. The index
uses the native tree **before removal**. Native `query_command` decides whether
the move is allowed. Only the original pointer release can consume the captured
host request, execute the same command with isolated history, and return its
original `Submission` and focus promise.

The pointer must be an unmodified primary left mouse pointer. Movement below
four CSS pixels cancels without executing. A held pointer previews a destination
without changing the document, selection or history. Ordinary blocks offer their
upper/lower halves; containers offer their upper/lower quarters. The container's
middle waits for an explicit parent choice. While holding the pointer, Right/Left
cycles the labelled list of genuine containing parents; an explicit inside move
appends to that parent's pre-removal children. The line is shown only when its
entire endpoint fits the supported clip.

Escape, capture loss, foreign focus/pointer, native publication, selection/input,
composition, mode changes and disposal retire the gesture. A pointer drop keeps
the existing mapped editor focus/range. Enter or Space on the handle opens the
keyboard Move menu; completing that alternative returns focus to its initiating
control. Missing drag support leaves that keyboard alternative available and
explains the unavailable pointer action.

If the host replaces the document while the original mouse gesture is still
held, its later release cannot import a browser-created caret into the new view.
The DOM adapter leaves that range untouched and waits for fresh owned pointer,
selection-navigation or input intent before automatically importing selection
again. Explicit model selection remains available; ordinary replacements with
no observed held pointer retain their existing selection behavior.

Autoscroll accepts one ordinary vertical inner scroll owner plus the page.
The edge band is 24 CSS pixels, with at most 20 pixels per animation frame,
600 pixels/second, 10 seconds, 600 ticks and 6,000 total pixels. A gesture also
has a 30-second lifetime and at most 128 candidate changes. Smooth/snapped or
transformed scroll owners are refused. Scrolling and all presentation stop when
the original gesture retires.

The additive `MountedEditor.geometry.read({kind: 'drag', ...})` is one coherent,
read-only measurement. It returns compact native headers and boxes, never DOM
objects, copied NodeViews, a catalog or schema permission. Source and target
share limits of 1,024 distinct objects/child slots, 128 ancestors and 256 raw
rectangles, including final validation. Unsupported, clipped, foreign, cloned,
detached, fragmented or incoherent objects do not become fallback destinations.
Existing geometry request types and behavior remain available.

HTML drag events are separate from the pointer feature. Mounted hosts prevent
cancelable `dragstart`, `dragover`, `drop`, `insertFromDrop` and `deleteByDrag`
defaults. They do not read transfer contents or import text, HTML, URIs or files.
Noncancelable events retain their actual status; unexpected browser mutation
uses the existing recovery boundary. Ordinary clipboard policy still applies.

The source-authored contracts are in [contracts/drag/v1](../contracts/drag/v1).
`npm run test:drag` runs the native/sealed-WASM semantic lane and controlled
ownership/declaration checks. `npm run test:drag:browser` runs mounted geometry,
pointer, keyboard and lifecycle checks in all three configured engines. Installed
Chrome/Safari input and manual usability have their own finite protocol and
receipts; passing automated browser checks alone does not establish CMS cutover
readiness.
