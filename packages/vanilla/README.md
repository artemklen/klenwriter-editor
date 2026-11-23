# KlenWriter Editor

Load `@klenwriter/editor/style.css` as a stylesheet through the host's asset resolver. The stylesheet applies to the mounted editor surface.

## Theme hooks

Set a custom property on the editor element in the host stylesheet.

| Custom property | Default | Applies to |
| --- | --- | --- |
| `--editor-focus-color` | `Highlight` | Color of the visible keyboard focus outline |

## Editor UI language

To attach the editor UI, pass `ui: { slots, profile }` to `mount`. The three slots are connected elements outside the editor. The profile supplies the available editor actions.

Pass `locale: 'ru'` or `locale: 'en'` to select the initial language. The default is English. Once `editor.uiReady` resolves successfully, call `update(editor, { locale: 'en' })` to change the language on the mounted UI.

Load `@klenwriter/editor-ui/style.css` for the UI controls. Either `destroy(editor)` or `editor.destroy()` retires the attached UI together with the editor.
