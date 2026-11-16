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
| `./variable-merge` | Merges a variable or list into another one on rename, and moves one between this sprite and all sprites from the palette |
| `./target-combobox` | The target picker of a code window |
| `./detached-block-palette` | The block palette in its own window |
| `./palette-category-visibility`, `./palette-visibility-dialog` | Choose which block groups the palette shows for each sprite and the stage. The setting is saved with the editor's screen state, with a screen to choose |
| `./palette-category-reorder`, `./palette-category-search`, `./palette-dropdown-resize` | Reordering and searching palette categories, and resizing palette dropdowns |
| `./palette-category-groups` | Shows a category of the toolbox that holds other categories as a group: clicking its icon opens a child palette of its members, floating with a shadow — a row to the right of the icon in a horizontal palette, a column below it in a vertical one — and a click outside closes it. `flattenCategoryGroups(tree)` and `filterGroupedToolboxTree(tree, groups, filter)` prepare the tree, which Scratch Blocks would otherwise drop nested categories from; `prepareGroupedToolboxTree(tree, {catalog, visible})` does both in one step, also nesting the groups extensions declare and keeping only the groups to show, and `hasCategoryGroups(tree)` tells whether a tree nests categories. `attachPaletteCategoryGroups(menu, options)` opens the child palettes; its `selectionTarget(id)` gives the category to select for a group without blocks of its own, and `syncButtons(openId)` marks the groups' icons. `splitExtensionCategories(tree, catalog, {nested: true})` makes an extension that declares groups such a group |
| `./block-argument-text` | Shortens long text arguments and edits them in a dialog. Shift+Enter in a text argument continues in the dialog with a line break |
| `./block-number-input` | Converts full-width digits and signs typed into number arguments to half-width |
| `./clean-up-comments` | Keeps comments with their scripts in "Clean up blocks": block comments keep their offset from the block, scripts with their comments do not cover one another, and workspace comments that cover a script move beside the scripts (`installCleanUpComments(ScratchBlocks)`) |
| `./target-undo-history` | Keeps the code area's undo and redo history for each sprite and the stage across target switches (`attachTargetUndoHistory({vm, getBlockly})`). A history comes back only while the target's code is unchanged since it was put aside |
| `./sprite-restore-history` | Lets Edit → Restore Sprite go back through the last 10 deleted sprites, not only the last one (`attachSpriteRestoreHistory({store, vm})`, with the GUI's Redux store) |
| `./sprite-copy-notice` | `attachSpriteCopyNotice`: when a script dropped on the sprite list is copied into a sprite or the stage, marks its tile and shows a notice naming it, with Undo to remove the copy |
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

- The setting belongs to the editor, not to the project's code, and is saved with the same screen state as the tab layout: the `blockPalette` slice of `tw-plus/workspace.json` in an SB3, or `.tw-plus/workspace.json` in a project folder. Sprites are recorded by name, as the tab layout records them, and the stage as `stage`.
- A sprite or stage without a setting shows the standard groups and the groups of the extensions its code uses.
- Hiding a group never hides blocks already in the code; they stay visible and editable.

`./palette-category-visibility`

| Function | What it does |
| --- | --- |
| `createPaletteVisibilityStore({catalog})` | One project's settings, by runtime target ID, so a renamed sprite keeps its setting: `visible`, `set`, `copy` (for a duplicate), `sets`, `addSets`, `capture(targets)` and `apply(value, targets)` for the screen-state slice, and `reset` |
| `paletteScreenStateKey` | The name of the screen-state slice (`blockPalette`) |
| `filterToolboxTree(tree, visible, catalog)` | Removes the categories a target does not show from the parsed toolbox before the palette is drawn. With a catalog, an extension that declares groups is first split into one category per group (`splitExtensionCategories`) |
| `installExtensionPaletteGroups(runtime)`, `extensionPaletteCatalog(runtime._blockInfo)` | Keep the groups each extension declares on the VM's category info, and list the groups of the loaded extensions with the group of each block |
| `usedGroups(target, catalog)`, `groupOfOpcode(opcode, catalog)`, `defaultVisibleGroups(target, extensionGroups, catalog)` | The groups the code uses and how many blocks of each, and the groups shown for a target without a setting |
| `paletteGroupSets(locale, projectSets)` | Standard, Expression, Variables and lists, Basic control, and the project's own sets |
| `attachPaletteMenuButton(menu, getLocale, getItems)` | Puts a ▼ button at the end of the category menu (the right end of a horizontal palette, the bottom of a vertical one). Pressing it lists the items the host gives: the group settings (`paletteVisibilityMenuLabel`) and the host's extension items |

`openPaletteVisibilityDialog(document, props)` from `./palette-visibility-dialog` opens the screen that chooses the groups. Each extension is drawn with `ExtensionRow` from `@kubohiroya/turbowarp-extension-security-dialog/react`, so it looks the same as in the screen that adds extensions. The screen puts “Setting shortcuts” (sets such as Standard and Expression) and “Copy settings from” side by side under “Choose several at once”, above the checkboxes of the standard and extension block groups. Pointing at or focusing a shortcut or the copy source gives the checkboxes it would choose the same background as pointing at them. Confirm passes the groups to show, and the shortcuts added in the screen, to `onApply` and closes. With `newSprite`, the screen asks about a sprite just added and names it as a new sprite. Given `copySources` too (the sprites already in the project, each with the groups it shows), “Copy settings from” offers a list to choose one, starting at “Choose a sprite”, and “Copy”. While a sprite is chosen, the checkboxes it would choose stay marked. “Copy” checks that sprite's groups, as far as this sprite is offered them. The screen stays open; the person adds or removes checks and presses Confirm.

The host installs `@kubohiroya/turbowarp-extension-security-dialog` (0.9.0 or later) and loads its `styles.css`, and registers the store as a screen-state slice.

### Groups inside one extension

An extension can split its blocks into groups that are shown and hidden on their own. It declares them in `getInfo()` and marks each block with `paletteGroup`:

```js
getInfo() {
    return {
        id: 'shapes', name: 'Shapes', color1: '#0fbd8c',
        groups: [{id: 'geometry', name: 'Geometry', color1: '#ff8c1a', color2: '#db6e00', color3: '#c26200'}, {id: 'text', name: 'Text'}],
        blocks: [
            {opcode: 'circle', blockType: 'command', text: 'circle', paletteGroup: 'geometry'},
            {opcode: 'write', blockType: 'command', text: 'write [TEXT]', paletteGroup: 'text', arguments: {/* ... */}},
            {opcode: 'reset', blockType: 'command', text: 'reset'}
        ]
    };
}
```

- Each group is the palette category `shapes/geometry`, named after the group, and the settings name it by that ID. Blocks without `paletteGroup` (or naming a group not declared) stay in the category `shapes`.
- A group's `id` names it in the settings and stays the same in every language; its `name` is what people read. `name` is one text or one per locale, such as `{en: 'Speech\nand text', ja: 'セリフと\n文字'}`: the editor shows the one for its locale, then for its language, then English, then the first. A `\n` starts a new line in the category menu and the settings screen (`resolveGroupName(name, locale)`; pass the locale to `extensionPaletteCatalog`).
- `color1`, `color2`, `color3` and `menuIconURI` of a group are optional, and default to the extension's. A block's own colour wins over its group's.
- A label, separator or button goes with the block after it. The opcodes stay `shapes_circle` and so on, so the SB3 does not change: standard TurboWarp and Scratch ignore `groups` and `paletteGroup` and show one category.
- The host calls `installExtensionPaletteGroups(vm.runtime)` before extensions load, and passes `extensionPaletteCatalog(vm.runtime._blockInfo)` to the store, `filterToolboxTree` and `usedGroups`. The dialog takes the groups of such an extension as `groups` of its entry and shows a checkbox for each inside the extension's row.

