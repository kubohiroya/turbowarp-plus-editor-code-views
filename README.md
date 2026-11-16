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
| `./palette-category-visibility`, `./palette-visibility-dialog` | Choose which block groups the palette shows for each sprite and the stage. The setting is kept in a palette comment, with a screen to choose |
| `./palette-category-reorder`, `./palette-category-search`, `./palette-dropdown-resize` | Reordering and searching palette categories, and resizing palette dropdowns |
| `./block-argument-text` | Shortens long text arguments and edits them in a dialog |
| `./asset-edit-session`, `./dockview-unsaved` | The asset edit session and the unsaved marks on Dockview tabs, which the host connects to the GUI's editors and layout |
| `./styles.css` | The stylesheet for all of the above |

Load `@kubohiroya/turbowarp-plus-editor-code-views/styles.css` as a global stylesheet, together with the `styles.css` of `@kubohiroya/turbowarp-plus-editor-windows`, whose icon menu and dialog actions these views use.

### What the host passes

`attachCodeWorkspace` and `attachDockedScriptLayout` take `presentationElements(injection)`, which returns the host's elements around the workspace: `wrapper`, `extensionButton` and `watermark`. The docked script layout marks the watermark with `data-code-watermark` and the extension button with `data-code-extension-button`, and the stylesheet hides them by those marks on a hover surface and in an inactive split view.

### Saved code areas

The code pane adapter (`createCodePaneAdapter`) has `serialize(pane, presentation?)` and `deserialize(pane, value)` for the workbench's saved workspace, which the Editor keeps in the SB3. A tab keeps the zoom, scroll position and script view of its code area as `{scale, x, y, scriptView?}`. Without a presentation, `serialize` reads the code area on screen without changing it. `deserialize` checks the shape with `readSavedCodePane` and returns a presentation without the copied controls of the code area, which the preview then draws without them.

React 16.14 or later is supported, because the Editor mounts these views in the GUI's React 16.

## Verification

Run `npm test` to build the package, run the unit tests, and check that the sources use no React API newer than 16.14.

## License

MPL-2.0. This code moved here from `packages/editor-views` and `packages/editor-ui` in turbowarp-plus-editor. The same author wrote it, and it changed from GPL-3.0 to MPL-2.0 in the move. The provenance audit is in the "由来の監査（7b）" section of the [migration plan in turbowarp-plus-packages](https://github.com/kubohiroya/turbowarp-plus-packages/blob/main/docs/editor-migration-plan.ja.md).

## Block groups in the palette

Each sprite and the stage can choose which block groups the palette shows: the standard groups and the groups of extensions. In TypeScript terms, the project's `extensions` are package.json and each sprite's setting is a file's import statements.

- The setting is kept where sb3-toolchain source format 2 keeps it: one palette comment per sprite or stage (`block-palette.json` in a project folder). A sprite whose setting equals its default gets no comment. The stage's comment also holds the project's applicable sets.
- A sprite or stage without a setting shows the standard groups and the groups of the extensions its code uses.
- Hiding a group never hides blocks already in the code; they stay visible and editable.

`./palette-category-visibility`

| Function | What it does |
| --- | --- |
| `visibleGroups(target, extensionIds)` | The groups shown for a target |
| `filterToolboxTree(tree, visible)` | Removes the categories a target does not show from the parsed toolbox before the palette is drawn |
| `readTargetPalette(target)`, `writeTargetPalette(target, groups, options)` | Read and write the palette comment, in the text sb3-toolchain's `formatBlockPaletteComment` writes |
| `usedGroups(target)`, `groupOfOpcode(opcode)` | The groups the code uses, and how many blocks of each |
| `paletteGroupSets(locale, projectSets)` | Standard, Expression, Variables and lists, Basic control, and the project's own sets |
| `attachPaletteMenuButton(menu, getLocale, getItems)` | Puts a ▼ button at the end of the category menu (the right end of a horizontal palette, the bottom of a vertical one). Pressing it lists the items the host gives: the group settings (`paletteVisibilityMenuLabel`) and the host's extension items |

`openPaletteVisibilityDialog(document, props)` from `./palette-visibility-dialog` opens the screen that chooses the groups. Each extension is drawn with `ExtensionRow` from `@kubohiroya/turbowarp-extension-security-dialog/react`, so it looks the same as in the screen that adds extensions. Applying passes the groups to show, and the sets added in the screen, to `onApply`.

The host installs `@kubohiroya/sb3-toolchain` (0.25.1 or later) and `@kubohiroya/turbowarp-extension-security-dialog` (0.9.0 or later), and loads security-dialog's `styles.css`. Choosing groups inside one extension comes once the VM can make a category per group.

