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

## Alpha node types

The public `alphaBlockTypes` map lists the authored node types accepted at mount and by `editor.replace()`. A document containing other types returns a `dom.renderer_missing` refusal with `unsupportedTypes`. On mount, `editor.ready` includes the original input bytes in `recovery.originalInput`. After a refused replacement, `editor.originalInput()` returns the attempted bytes. The live document and interaction mode stay intact.

| Profile | Node type |
| --- | --- |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/blockquote` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/bullet_list` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/code_block` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/hard_break` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/heading` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/list_item` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/media_image` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/ordered_list` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/paragraph` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/scene_break` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/task_item` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/task_list` |
| `org.klenwriter.kwdj` | `org.klenwriter.kwdj/text` |
| `org.example.notes` | `org.example.notes/document` |
| `org.example.notes` | `org.example.notes/hard_break` |
| `org.example.notes` | `org.example.notes/paragraph` |
| `org.example.notes` | `org.example.notes/text` |
