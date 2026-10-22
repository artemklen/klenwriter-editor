# Optional KWDJ typography

Typography is off when `typing_rules` is omitted or null. Enable it explicitly
before opening an ABI2 session. The [frozen contract](typography.md) defines the
rules, resource ceilings and input/history behavior.

Use the separate renderer catalog and select its native extension binding in
the consumer's existing KWDJ registry descriptor:

```ts
import { createKwdjTypingRenderers } from '@klenwriter/editor-kwdj/dom';

const renderers = createKwdjTypingRenderers();
const profile = renderers.definition.binding.profile;
const registry = { ...baseKwdjRegistry, selected_extensions: profile.extensions };
const profileOptions = {
  identities: { media: [], references: [] },
  limits: null,
  typing_rules: {
    version: 1,
    locale: 'en',
    rules: ['spaced_em_dash', 'double_quotes'],
    limits: null,
  },
};
// Supply renderers to mountEditor, and profile, registry_json:
// JSON.stringify(registry), profile_options_json: JSON.stringify(profileOptions)
// to its existing ABI2 open options with the matching SDK build_id.
```

`baseKwdjRegistry` is the consumer's existing native-compatible descriptor. The
typing extension adds two compiled commands and no nodes or marks. Native open
validates the complete registry, profile, configuration and capability binding;
renderer metadata does not install schema behavior.

`rules: null` selects the locale defaults. RU enables spaced em dashes, paired
double quotes and Cyrillic one-letter NBSP; EN enables the first two. `rules: []`
keeps the explicit configured session literal. Feature names are unique and
ordered by native priority. EN rejects `cyrillic_nbsp`. Numeric limit members may
only lower the documented ceilings; missing members use defaults, and explicit
null numeric members are invalid. Changing configuration requires a new session.

The mounted owner routes admitted single-scalar typing and an owned final
composition commit through native input planning. Paste, imports and explicit
`kwdjCommand({ kind: 'insert_text', text })` remain literal. The basic renderer
retains its original catalog and behavior.

One Undo reverses a complete typography edit. Immediate Backspace after a quote
or em dash restores the raw trigger text as a separate history unit. Undo then
returns to the cooked state; a second Undo returns to the pre-trigger state.
Navigation, focus changes, other edits or history retire the private reversal
slot. NBSP uses ordinary Backspace. Native refusal retains bounded input recovery
and never retries the edit through another mutation.

Run `npm run test:typography` after a coherent build. Its compiled test probe,
controlled owner tests and production sealed-SDK browser checks record separate
evidence. Installed Chrome/Safari use the finite driver under
`scripts/typography-installed/` from the already authorized Terminal context.
