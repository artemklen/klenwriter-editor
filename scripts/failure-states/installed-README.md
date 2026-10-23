# OSR-67 installed observation source

The installed Chrome config reuses all eleven AC1 rows and the two genuine
compiled-runtime cases. It uses the installed Google Chrome executable in a
headed Playwright session and a fresh blocked-service-worker context per case.
The report records the actual CDP product/version/command line and the declared
executable bytes/hash. This is programmatic fixture evaluation and selected
string input. It supplies no physical-input or OS-clipboard evidence.

The AC1 observer remains the frozen exact observer. The runtime observer adds a
source-authored graph for four document epochs per case: initial document,
explicit recovery, reload before disposition, reload after disposition. Every
bootstrap requires each declared resource exactly once, plus the optional
declared 204 favicon. Operation and cleanup requests are forbidden. Requests
are recorded before routing; unexpected attempts are recorded, aborted and fail
the case. Each response is compared with current producer bytes, MIME/status
and the exact static server CSP. CSP/errors/rejections/dialogs are retained from
before navigation. Every document has ready/terminal checkpoints and a fixed
two-frame plus 250 ms terminal window. Final cleanup has its own window.

`installed-runtime-assets.mjs` is a data-only producer, not a build or browser
launcher. Its graph comes from its source recipe, current fixture host literals
and generated static import literals. It refuses external/generated imports
outside the registered snippets tree. It verifies the coherent production and
isolated fixture identities and artifacts before binding. No URL is learned
from traffic. The shared runtime spec requires this binding in bundled runs too.

After root reviews/freezes these sources and the coherent build has actually
closed, root must materialize both bindings before either browser config:

```sh
node scripts/failure-states/bind-assets.mjs
node scripts/failure-states/installed-runtime-assets.mjs
```

The runtime binding is created with `wx`; an old receipt is not overwritten.
An identical existing binding is verified and reused on the same source/build/HEAD.
Retain an existing original and use root's normal fresh-artifact preparation
before re-materializing after any source/build/HEAD change. These commands have
not been run as part of source preparation. The installed entry is:

```sh
npx playwright test --config scripts/failure-states/installed-chrome.config.mjs
```

No screenshot, video or trace is configured. Browser request records, response
hashes and fixture JSON are the evidence. The Safari capability module is an
explicit `NOT_RUN`/`BLOCKED` source disposition for the currently exposed MCP and
Apple Events interfaces; it does not create an installed observation, relax the
frozen method or infer an owner decision. Root owns any next Safari decision.
