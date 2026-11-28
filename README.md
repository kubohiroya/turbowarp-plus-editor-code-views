# TurboWarp Plus Editor Code Views

[日本語](README.ja.md)

The code views of TurboWarp Plus Editor: code in tabs and windows that share one project and one undo history, the block palette detached into its own window, script layout and script views, the function editor, and editing of block fields that extensions draw themselves. Every function takes the VM, the Blockly workspace and `ScratchBlocks` from the host; the package imports no GUI module.

## Opening a selected script

Opening a function or hat adjusts the zoom to its rendered script and places the first block's top left 24px right and down from the code pane's top left. Automatic zoom stays between 50% and 125%, respecting stricter workspace limits. Short scripts and scripts at the zoom floor start at the same position, regardless of wider blocks farther down the script. Ordinary edits and manual zoom do not refit it.

Hosts with a separate workspace can call `fitScriptInWorkspace(workspace, scriptId, ScratchBlocks)` from the root or `./sprite-code-windows` export. It returns `false` if the viewport or block is not ready, so the host can retry after layout.

## Selecting several scripts

In the free layout, several scripts can be selected and then moved or deleted together. The selection is screen state and is not saved with the project.

- Ctrl+click (⌘+click on macOS) adds or removes the whole clicked script without running it. Ctrl+click is not used on macOS, where it opens the context menu.
- Shift+drag on the background draws a rectangle and adds the scripts it touches. Shift+Alt+drag removes them.
- Dragging a selected script moves the other selected scripts by the same distance; dropping it on the palette deletes them all. Either is undone in one step.
- Dropping a selected script on a sprite or the stage in the sprite list copies every selected script there, keeping their places relative to the dragged one. The selected scripts stay where they were.
- Delete or Backspace, or "Delete N selected scripts" in the block context menu, deletes them together. If that removes the definition of a function still in use, the whole deletion is undone with Scratch's warning.
- Escape, a click on the background, pressing an unselected script or switching sprites clears the selection.

`attachCodeWorkspace` installs it. Import `attachScriptSelection` from `@kubohiroya/turbowarp-plus-editor-code-views/script-selection` to use it on its own.

## Rearranging scripts by relationships (Editor #727)

Right-click a free-layout background and choose **Rearrange scripts by relationships**. Preview the current sprite or stage, then confirm or cancel. One Undo/Redo restores the positions and attached comments. Other targets stay fixed. Editable popouts use their existing edit lease; read-only and serial views cannot run this operation.

The existing static relationship extractor supplies function calls, named functions and messages. An iterative SCC pass groups cycles; longest-path ranks and four barycentric sweeps arrange the resulting DAG. Disconnected components occupy separate bands. These bounded, testable rank constraints do not require an additional ELK dependency. Matter.js 0.20.0 (MIT) relaxes comment-inclusive rectangles with gravity and rotation disabled. Fixed steps and canonical ID order make repeated layouts stable. Simulation yields every eight steps and stops on convergence or after 120 steps. Deterministic packing and final collision checks preserve ranks and avoid loose comments. Limits are 1000 scripts, 10000 relations and 1000 loose comments; unsupported input leaves the project unchanged.

External and unresolved links are identified in the preview. Dynamic names do not acquire invented destinations; static relationships do not guarantee execution order. Program, target or geometry changes invalidate the preview. Recalculate before applying. Native block moves own attached-comment undo; comment notifications still reach the VM and popout protocol. Failed queued moves are rolled back before dispatch.

Existing `attachDockedScriptLayout` integration enables the menu without GUI changes. Custom editable `attachScriptView` hosts pass `semanticLayout: {events, canArrange}` alongside `relations`; read-only hosts omit it. Run `npm run build`, the semantic-layout and relationship unit tests, and `node --test test/semantic-layout.browser.ts` for focused headless verification. Roll back the package and host dependency pin together. No project-format migration or new metadata is needed.

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
| `./detached-block-palette` | The block palette in its own window. Given the palette's `grouping`, it opens groups in child palettes and pins them as the palette does |
| `./palette-category-visibility`, `./palette-visibility-dialog` | The palette settings saved with the editor's screen state: the palette layouts (see `./block-palette-editor`) and the order the palette's categories and each group's members were dragged into (`createPaletteOrder`). The dialog module keeps only the prompt that offers to remove standard groups an enabled extension replaces from the shown layout |
| `./palette-layout`, `./block-palette-editor` | Palette layouts and the block palette editor that makes them. The palette's ▼ button opens the editor: every block group on a source panel, the layouts as Dockview tabs, and a preview of the chosen tab. Groups are long-pressed and dragged onto a tab, ordered, put into folders, separated, and set to be always open or to open and close automatically. The chosen tab is the palette; with none, or an empty one, the palette shows every group |
| `./palette-category-reorder`, `./palette-category-search`, `./palette-dropdown-resize` | Reordering and searching palette categories, and resizing palette dropdowns |
| `./palette-category-groups` | Shows a category of the toolbox that holds other categories as a group: clicking its icon opens a child palette of its members, floating with a shadow — a row to the right of the icon in a horizontal palette, a column below it in a vertical one — and a click outside closes it. `flattenCategoryGroups(tree)` and `filterGroupedToolboxTree(tree, groups, filter)` prepare the tree, which Scratch Blocks would otherwise drop nested categories from; `prepareGroupedToolboxTree(tree, {catalog, visible})` does both in one step, also nesting the groups extensions declare and keeping only the groups to show, and `hasCategoryGroups(tree)` tells whether a tree nests categories. `attachPaletteCategoryGroups(menu, options)` opens the child palettes; its `selectionTarget(id)` gives the category to select for a group without blocks of its own, and `syncButtons(openId)` marks the groups' icons. With `reorder: true`, a long press on a member of a group drags it among the members of the same group, in the group's child palette or where a pinned group shows its members (not to another group or level); the order is kept while the palette is drawn again (in the `order` given, such as the palette settings saved with the project), `prepare(tree, options)` draws the toolbox in it, and `arrange(categories, rank)` orders the toolbox's categories to match, each group followed by its members. A child palette has a pin at its top right: pinning the group shows its members in the palette that showed the group, right after it, and the pinned group's icon shows a pin that folds them back. The pins are kept in the same `order`, so palettes given it follow each other. `splitExtensionCategories(tree, catalog, {nested: true})` makes an extension that declares groups such a group |
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

`createHorizontalBlockPalette` accepts `showPaletteMenu` (default `true`). Passing `false` omits the trailing ▼ button and its menu while keeping category selection, reordering, and horizontal/vertical layout switching available.

## Verification

Run `npm test` to build the package, run the unit tests, and check that the sources use no React API newer than 16.14.

Run `npm run test:browser` to drive the palette's groups in Chromium with the Editor's own VM and Scratch Blocks, through the minimal editor runtime (`@kubohiroya/turbowarp-plus-editor-test-runtime`): child palettes, pins, reordering and the detached palette. `TWPE_CHROME_EXECUTABLE` names a Chromium to use instead of Playwright's own.

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
| `attachPaletteMenuButton(menu, getLocale, getItems, onPress?)` | Puts a ▼ button at the end of the category menu (the right end of a horizontal palette, the bottom of a vertical one). Pressing it lists the items the host gives, or with `onPress` calls that instead; the horizontal palette uses it to open the block palette editor (labelled by `blockPaletteEditorLabel`) |

`openBlockPaletteEditor(document, props)` from `./block-palette-editor` opens the block palette editor in a maximizable modal `<dialog>`. Its three panels are stacked for a horizontal palette and side by side for a vertical one, with splitters between them. The source panel shows each block group with a badge counting its uses in the chosen tab; a click shows its blocks, and a long press drags it to reorder the source or onto a tab. A tab's grid is arranged the same way, with folders opened in place; right-click an item for “Edit label…”, “Display” (always open / opens and closes automatically) and “Remove”, and a tab for “Edit label” and “Remove”. The ＋ speed dial adds a separator, an always-open folder or an auto-opening folder. `applyPaletteLayoutToTree` rearranges the toolbox tree into a layout, and `layoutPaletteOrder` makes reordering and pinning in the palette edit the shown layout. The per-sprite visibility screen was removed in 0.28.0. In a horizontal palette, each group set to be always open gets a block list of its own under its icon (`./kept-open-flyouts`), and space is added after the icon so no two lists overlap. A group placed more than once is drawn once per placement.

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

A group can be nested in another group of the same extension with `parent`, the `id` of that group. A parent needs no blocks of its own, so a bundle can gather the groups of the extensions it carries under one group:

```js
groups: [
    {id: 'library', name: {en: 'Libraries', ja: 'ライブラリ'}},
    {id: 'assetcache', name: 'Asset Cache', parent: 'library'},
    {id: 'asyncinput', name: 'Async Input', parent: 'library'}
]
```

- For an extension with the ID `kami`, in the palette prepared with `prepareGroupedToolboxTree` (or the groups controller's `prepare`), `kami/library` becomes a category inside the extension's category, holding `kami/assetcache` and `kami/asyncinput`, and opens them as a child palette like any group; groups can be nested more than one level deep. A parent without blocks of its own gets a category as long as a group nested in it has blocks, and it stays in the palette while one of them is shown, even when the parent itself is not chosen.
- `extensionPaletteCatalog` lists each parent before the groups nested in it, gives the nested ones `parent` (the parent's palette ID, such as `kami/library`), and marks a parent without blocks of its own `empty`. A parent with no blocks anywhere under it is left out. `usedGroups` counts the blocks of the nested groups for their parents too, so `defaultVisibleGroups` shows a parent whenever a group nested in it is in use; `paletteGroupLineage(id, catalog)` gives a group and the groups it is nested in.
- The dialog takes `parent` and `empty` with each of the extension's `groups` and indents the nested ones under their parent. The checkbox of an `empty` parent shows or hides all the groups nested in it (half checked when only some are shown), and the parent is chosen exactly when one of them is.
- A `parent` that names no other group of the extension, names the group itself or leads back to it in a cycle is ignored, and the group stays at the top level. `filterToolboxTree` without the grouped palette shows every group with blocks at the top level and leaves out a parent without blocks of its own.

