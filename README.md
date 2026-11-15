# TurboWarp Plus Editor Code Views

[日本語](README.ja.md)

The code views of TurboWarp Plus Editor: code in tabs and windows that share one project and one undo history, the block palette detached into its own window, script layout and script views, the function editor, and editing of block fields that extensions draw themselves. Every function takes the VM, the Blockly workspace and `ScratchBlocks` from the host; the package imports no GUI module.

## Entry points

| Import | Contents |
| --- | --- |
| `.` | `createCodeSession` (an editable view of a target, kept in step with the VM and the other views), `refreshExternalBlockViews`, `attachDockedCodeExtensions`, `attachStageCodePrewarm` |
| `./sprite-code-windows` | Code windows and panes inside a sprite tab (`attachCodeWorkspace`, `useSpriteCodeWindows`, `SpriteCodeProvider` and the code pane adapter) |
| `./script-layout` | Script layout and script views (`attachDockedScriptLayout`, `attachScriptView`) |
| `./code-extensions` | The extension palette and field action dialog of a code view |
| `./procedure-editor` | The function editor dialog |
| `./variable-references` | Variable references scoped to the edited target |
| `./target-combobox` | The target picker of a code window |
| `./detached-block-palette` | The block palette in its own window |
| `./palette-category-reorder`, `./palette-category-search`, `./palette-dropdown-resize` | Reordering and searching palette categories, and resizing palette dropdowns |
| `./block-argument-text` | Shortens long text arguments and edits them in a dialog |
| `./asset-edit-session`, `./dockview-unsaved` | The asset edit session and the unsaved marks on Dockview tabs, which the host connects to the GUI's editors and layout |
| `./styles.css` | The stylesheet for all of the above |

Load `@kubohiroya/turbowarp-plus-editor-code-views/styles.css` as a global stylesheet, together with the `styles.css` of `@kubohiroya/turbowarp-plus-editor-windows`, whose icon menu and dialog actions these views use.

### What the host passes

`attachCodeWorkspace` and `attachDockedScriptLayout` take `presentationElements(injection)`, which returns the host's elements around the workspace: `wrapper`, `extensionButton` and `watermark`. The docked script layout marks the watermark with `data-code-watermark` and the extension button with `data-code-extension-button`, and the stylesheet hides them by those marks on a hover surface and in an inactive split view.

React 16.14 or later is supported, because the Editor mounts these views in the GUI's React 16.

## Verification

Run `npm test` to build the package, run the unit tests, and check that the sources use no React API newer than 16.14.

## License

MPL-2.0. This code moved here from `packages/editor-views` and `packages/editor-ui` in turbowarp-plus-editor. The same author wrote it, and it changed from GPL-3.0 to MPL-2.0 in the move. The provenance audit is in the "由来の監査（7b）" section of the [migration plan in turbowarp-plus-packages](https://github.com/kubohiroya/turbowarp-plus-packages/blob/main/docs/editor-migration-plan.ja.md).
