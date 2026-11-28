// SPDX-License-Identifier: MPL-2.0
import {attachPaletteCategoryReorder} from './palette-category-reorder.js';
import {attachPaletteCategorySearch, matchPaletteBlocks, paletteSearchHeight} from
    './palette-category-search.js';
import {attachPaletteDropdownResize} from './palette-dropdown-resize.js';
import {connectDetachedBlockPalette, openDetachedBlockPalette as openPaletteWindow, installGestureOwnerDocument, moveBlockWidgets} from
    './detached-block-palette.js';
import {attachPaletteMenuButton, createPaletteOrder, createPaletteVisibilityStore, defaultVisibleGroups, extensionPaletteCatalog, groupOfOpcode,
    installExtensionPaletteGroups, paletteGroupLineage, paletteGroupSets, paletteReplacementGroups, paletteScreenStateKey, paletteVisibilityMenuLabel, standardGroups, usedGroups} from './palette-category-visibility.js';
import type {PaletteCategoryInfo, PaletteTarget, PaletteVisibilityStore} from './palette-category-visibility.js';
import {openPaletteReplacementDialog, openPaletteVisibilityDialog} from './palette-visibility-dialog.js';
import {attachPaletteCategoryGroups, hasCategoryGroups} from
    './palette-category-groups.js';

/** Each editor host has its own palette state and lifecycle. */
export function createHorizontalBlockPalette({getScratchBlocks, openExtensionLibrary: openHostLibrary, styles, showPaletteMenu = true}: {
    getScratchBlocks(): {getMainWorkspace?(): object} | undefined;
    openExtensionLibrary(document: Document): void;
    styles: Record<string, string>;
    /** Whether this host offers the palette settings and extension menu. */
    showPaletteMenu?: boolean;
}) {
    const installed = new WeakSet();
    const closeOnDragExit = new WeakMap();
    const palettes = new Set<(horizontal: boolean) => void>();
    let horizontalLayout = false;

    type ImportedBlock = {opcode?: string; shadow?: boolean};
    type Share = (payload: unknown, targetId: string, fromTargetId?: string) => Promise<unknown>;
    type ShareWithReceipt = (payload: unknown, targetId: string, hooks?: any) =>
        Promise<{blockIds: readonly string[]} | null>;

    // The VM whose editing target decides which block groups the palette shows.
    type PaletteVM = {
        editingTarget?: any;
        runtime: {
            targets?: any[];
            _blockInfo?: PaletteCategoryInfo[];
            _fillExtensionCategory?(...args: any[]): unknown;
            getTargetForStage(): any;
            emitProjectChanged(): void;
            on(event: string, listener: (...args: any[]) => void): void;
            off(event: string, listener: (...args: any[]) => void): void;
        };
        on(event: string, listener: (...args: any[]) => void): void;
        off(event: string, listener: (...args: any[]) => void): void;
        addSprite?(...args: any[]): Promise<unknown>;
        duplicateSprite?(targetId: string): Promise<unknown>;
        shareBlocksToTarget?: Share;
        shareBlocksToTargetWithReceipt?: ShareWithReceipt;
    };
    /** The part of the editor's screen state the palette settings are saved with. */
    type PaletteScreenState = {
        register(key: string, slice: {capture(): unknown; applyFolderUpdate?(value: unknown): boolean | void}): () => void;
        whenLoaded(): Promise<{slices: Record<string, unknown>} | undefined>;
    };
    let paletteVM: PaletteVM | null = null;
    let paletteStore: PaletteVisibilityStore | null = null;
    const paletteRefreshers = new Set<() => void>();
    // The palettes that can ask which groups a sprite just added shows; the latest one asks.
    const newSpritePrompts: ((target: any) => void)[] = [];
    type ReplacementHost = {document: Document; getLocale(): string};
    const replacementHosts = new Map<object, ReplacementHost>();
    let replacementDialog: {host: ReplacementHost; close(): void} | undefined;

    // The groups the loaded extensions offer: one per extension, or one per group an extension declares.
    // Group names are in the editor's language, where the palette and the settings screen show them.
    const catalogOf = (vm: PaletteVM, locale?: string) => extensionPaletteCatalog(vm.runtime._blockInfo, locale);
    const extensionIds = (vm: PaletteVM) => catalogOf(vm).groups.map(group => group.id);
    const originalTargets = (vm: PaletteVM) => (vm.runtime.targets ?? []).filter(target => target.isOriginal);
    const sameGroupSet = (left: ReadonlySet<string>, right: readonly string[]) =>
        left.size === right.length && right.every(group => left.has(group));
    // Another sprite may share the same toolbox XML, in which case the GUI does not redraw the palette.
    const refreshPalettes = () => setTimeout(() => {for (const update of paletteRefreshers) update();}, 0);

    /** Called only after an explicit extension activation in the editor UI. */
    const suggestPaletteReplacements = (owner: object, enabled: readonly string[]) => {
        const vm = paletteVM;
        const store = paletteStore;
        const target = vm?.editingTarget;
        if (!showPaletteMenu || !vm || vm !== owner || !store || !target || !enabled.length) return;
        const current = () => paletteStore === store && vm.editingTarget === target && vm.runtime.targets?.includes(target);
        // Let the library or palette settings close before presenting a modal over the active workspace.
        setTimeout(() => {
            if (!current()) return;
            const workspace = getScratchBlocks()?.getMainWorkspace?.();
            const host = (workspace && replacementHosts.get(workspace)) ?? Array.from(replacementHosts.values()).at(-1);
            if (!host) return;
            const visible = store.visible(target, extensionIds(vm));
            const alternatives = (vm.runtime._blockInfo ?? []).filter(extension => enabled.includes(extension.id) &&
                extension.replacesPaletteGroups?.some(group => visible.has(group)));
            const groups = paletteReplacementGroups(alternatives.flatMap(extension => extension.replacesPaletteGroups ?? []))
                .filter(group => visible.has(group));
            if (!groups.length) return;
            replacementDialog?.close();
            replacementDialog = {host, close: openPaletteReplacementDialog(host.document, {
                locale: host.getLocale(), targetName: target.getName(), isStage: target.isStage, groups,
                extensions: alternatives.map(extension => extension.name || extension.id),
                onClose: () => { replacementDialog = undefined; },
                onHide() {
                    if (!current()) return;
                    const ids = extensionIds(vm);
                    const latest = store.visible(target, ids);
                    const next = [...latest].filter(group => !groups.some(replaced => replaced === group));
                    if (next.length === latest.size) return;
                    store.set(target, next, ids);
                    vm.runtime.emitProjectChanged();
                    refreshPalettes();
                }
            })};
        }, 0);
    };

    /**
     * Lets the palette show each sprite's and the stage's own block groups, and saves them with the editor's screen
     * state, as the tab layout is saved. Returns the function that stops it.
     */
    const connectPaletteVisibility = (vm: PaletteVM, getScreenState: () => PaletteScreenState | undefined = () => undefined) => {
        // A reordered palette is saved with the project, as the groups it shows are.
        const store = createPaletteVisibilityStore({catalog: () => catalogOf(vm), onOrderChange: () => vm.runtime.emitProjectChanged()});
        const removeExtensionGroups = installExtensionPaletteGroups(vm.runtime ?? {});
        paletteVM = vm;
        paletteStore = store;
        let unregister: (() => void) | undefined;
        const register = () => {
            if (unregister) return;
            unregister = getScreenState()?.register(paletteScreenStateKey, {
                capture: () => store.capture(originalTargets(vm)),
                applyFolderUpdate(saved) {
                    if (saved !== undefined && (!saved || typeof saved !== 'object' ||
                        (saved as {version?: unknown}).version !== 1)) return false;
                    store.apply(saved, originalTargets(vm));
                    refreshPalettes();
                }
            });
        };
        register();
        // A project opens with its own settings, or with every target at its default.
        const loaded = () => {
            replacementDialog?.close();
            register();
            store.reset();
            refreshPalettes();
            getScreenState()?.whenLoaded().then(state => {
                if (paletteStore !== store) return;
                const saved = state?.slices?.[paletteScreenStateKey];
                if (saved === undefined) return;
                store.apply(saved, originalTargets(vm));
                refreshPalettes();
            }, () => {});
        };
        const changed = () => {
            vm.runtime.emitProjectChanged();
            refreshPalettes();
        };
        // An extension added from the library shows all its groups in the sprite or stage being edited.
        const added = (info: {id?: string}) => {
            const target = vm.editingTarget;
            if (!target || !info?.id) return;
            const groups = store.visible(target, extensionIds(vm));
            const offered = catalogOf(vm).groups.filter(group => group.extensionId === info.id).map(group => group.id);
            if (offered.every(group => groups.has(group))) return;
            store.set(target, [...groups, ...offered.filter(group => !groups.has(group))], extensionIds(vm));
            changed();
        };
        const targetById = (id: string): PaletteTarget | undefined =>
            vm.runtime.targets?.find(target => target.id === id);
        const activateImportedGroups = (target: PaletteTarget, imported: Iterable<ImportedBlock | undefined>) => {
            const catalog = catalogOf(vm);
            const ids = catalog.groups.map(group => group.id);
            const offered = new Set([...standardGroups, ...ids]);
            const visible = store.visible(target, ids);
            const before = visible.size;
            for (const block of imported) {
                if (block?.shadow || !block?.opcode) continue;
                const group = groupOfOpcode(block.opcode, catalog);
                if (!group || !offered.has(group)) continue;
                for (const id of paletteGroupLineage(group, catalog)) visible.add(id);
            }
            if (visible.size === before) return;
            store.set(target, [...visible], ids);
            changed();
        };
        const originalShare = vm.shareBlocksToTarget;
        const originalShareWithReceipt = vm.shareBlocksToTargetWithReceipt;
        const hadOwnShare = Object.hasOwn(vm, 'shareBlocksToTarget');
        const hadOwnShareWithReceipt = Object.hasOwn(vm, 'shareBlocksToTargetWithReceipt');
        let watchingImports = true;
        // Legacy transfers do not return block IDs. Match the incoming opcodes against the blocks added to this target.
        const share: Share | undefined = originalShare && function (this: PaletteVM, ...args: Parameters<Share>) {
            const [payload, targetId] = args;
            const target = targetById(targetId);
            const incoming: unknown = Array.isArray(payload) ? payload : (payload as {blocks?: unknown} | null)?.blocks;
            const before = target?.blocks?._blocks;
            if (!target || !before || !Array.isArray(incoming)) return originalShare.apply(this, args);
            const opcodes = new Set(incoming.filter(block => !block?.shadow && typeof block?.opcode === 'string')
                .map(block => block.opcode));
            if (!opcodes.size) return originalShare.apply(this, args);
            const existing = new Set(Object.keys(before));
            return originalShare.apply(this, args).then(result => {
                if (watchingImports && targetById(targetId) === target) {
                    const created = Object.entries(target.blocks?._blocks ?? {})
                        .filter(([id, block]) => !existing.has(id) && opcodes.has(block?.opcode))
                        .map(([, block]) => block);
                    activateImportedGroups(target, created);
                }
                return result;
            });
        };
        const shareWithReceipt: ShareWithReceipt | undefined = originalShareWithReceipt && function (this: PaletteVM,
            ...args: Parameters<ShareWithReceipt>) {
            const [, targetId] = args;
            const target = targetById(targetId);
            return originalShareWithReceipt.apply(this, args).then(receipt => {
                if (watchingImports && target && receipt && targetById(targetId) === target) {
                    activateImportedGroups(target, receipt.blockIds.map(id => target.blocks?._blocks?.[id]));
                }
                return receipt;
            });
        };
        if (share) vm.shareBlocksToTarget = share;
        if (shareWithReceipt) vm.shareBlocksToTargetWithReceipt = shareWithReceipt;

        // The VM tells a duplicate, a new sprite and a loaded one apart only by the method that made it, and each
        // makes the new sprite the editing target.
        const originalDuplicate = vm.duplicateSprite;
        const originalAddSprite = vm.addSprite;
        // A duplicated sprite starts with the groups of the sprite it was made from.
        if (typeof originalDuplicate === 'function') {
            vm.duplicateSprite = function (targetId: string) {
                const source = vm.runtime.targets?.find(target => target.id === targetId);
                return originalDuplicate.call(this, targetId).then(result => {
                    const target = vm.editingTarget;
                    if (paletteStore === store && source && target && target !== source) {
                        store.copy(source, target);
                        refreshPalettes();
                    }
                    return result;
                });
            };
        }
        // A sprite painted, chosen, uploaded or picked by surprise asks which groups it shows, when the project has
        // extension groups to choose from or another sprite shows groups other than its default, which it can copy.
        if (typeof originalAddSprite === 'function') {
            vm.addSprite = function (...args: unknown[]) {
                const before = vm.editingTarget;
                return originalAddSprite.apply(this, args).then(result => {
                    const target = vm.editingTarget;
                    if (paletteStore !== store || !target || target === before || target.isStage) return result;
                    const ids = extensionIds(vm);
                    const customized = originalTargets(vm).some(other => !other.isStage && other !== target &&
                        !sameGroupSet(store.visible(other, ids), defaultVisibleGroups(other, ids)));
                    if (ids.length || customized) newSpritePrompts.at(-1)?.(target);
                    return result;
                });
            };
        }
        // A host that passes a VM without events still gets the filtering; only the redraws are missing.
        const listens = typeof vm.on === 'function' && typeof vm.runtime?.on === 'function';
        if (listens) {
            vm.on('workspaceUpdate', refreshPalettes);
            vm.runtime.on('PROJECT_LOADED', loaded);
            vm.runtime.on('EXTENSION_ADDED', added);
        }
        return () => {
            if (listens) {
                vm.off('workspaceUpdate', refreshPalettes);
                vm.runtime.off('PROJECT_LOADED', loaded);
                vm.runtime.off('EXTENSION_ADDED', added);
            }
            watchingImports = false;
            if (share && vm.shareBlocksToTarget === share) {
                if (hadOwnShare) vm.shareBlocksToTarget = originalShare;
                else delete vm.shareBlocksToTarget;
            }
            if (shareWithReceipt && vm.shareBlocksToTargetWithReceipt === shareWithReceipt) {
                if (hadOwnShareWithReceipt) vm.shareBlocksToTargetWithReceipt = originalShareWithReceipt;
                else delete vm.shareBlocksToTargetWithReceipt;
            }
            if (vm.duplicateSprite !== originalDuplicate) vm.duplicateSprite = originalDuplicate;
            if (vm.addSprite !== originalAddSprite) vm.addSprite = originalAddSprite;
            unregister?.();
            removeExtensionGroups();
            if (paletteVM === vm) paletteVM = null;
            if (paletteStore === store) {
                replacementDialog?.close();
                paletteStore = null;
            }
        };
    };

    const setHorizontalBlockPalette = (horizontal: boolean) => {
        horizontalLayout = horizontal;
        for (const setMode of palettes) setMode(horizontal);
    };

    const openDetachedBlockPalette = options => {
        const workspace = getScratchBlocks()?.getMainWorkspace();
        if (workspace) openPaletteWindow(workspace, options);
    };

    const attach = (ScratchBlocks, toolbox, {allowManualToggle, allowCategoryReorder}) => {
        const workspace = toolbox.workspace_;
        const flyout = toolbox.flyout_;
        const menu = toolbox.HtmlDiv;
        if (workspace.isMutator || toolbox.horizontalLayout_ || flyout.svgGroup_.tagName.toLowerCase() !== 'svg') return;

        const panel = flyout.svgGroup_;
        const body = flyout.workspace_.svgGroup_;
        const bodyTransform = body.getAttribute('transform');
        const scrollbar = flyout.scrollbar_.outerSvg_;
        const surface = workspace.getParentSvg();
        const doc = menu.ownerDocument;
        const win = doc.defaultView;
        const resizer = attachPaletteDropdownResize(panel, () => flyout.position());
        const {ContextMenu, WidgetDiv, DropDownDiv} = ScratchBlocks;
        const events = new AbortController();
        const capture = {capture: true, signal: events.signal};
        const original = {
            dispose: toolbox.dispose,
            setVisible: workspace.setVisible,
            getClientRect: toolbox.getClientRect,
            getHeight: toolbox.getHeight,
            getWidth: toolbox.getWidth,
            populate: toolbox.populate_,
            scrollToId: toolbox.scrollToCategoryById,
            scrollToName: toolbox.scrollToCategoryByName,
            showAll: toolbox.showAll_,
            getFlyoutWidth: flyout.getWidth,
            isDragTowardWorkspace: flyout.isDragTowardWorkspace,
            layout: flyout.layout_,
            position: flyout.position
        };

        let horizontal = false;
        let detached = false;
        let menuHeight: number | undefined;
        let openId = null;
        let layoutWidth;
        let scrollBeforeSearch = 0;
        const scrollPositions = new Map();
        const verticalPosition = workspace.toolboxPosition;
        // Scratch Blocks shows a workspace by setting its toolbox to display:block, overriding the
        // horizontal palette's flex layout. Let the stylesheet lay it out, then refresh its metrics.
        const restoreHorizontalDisplay = () => {
            if (!horizontal || menu.style.display !== 'block') return false;
            menu.style.removeProperty('display');
            return true;
        };
        const setVisible = workspace.setVisible = function (...args) {
            menuHeight = undefined;
            const result = original.setVisible.apply(this, args);
            if (restoreHorizontalDisplay()) workspace.resize();
            return result;
        };
        const categoryById = id => toolbox.categoryMenu_.categories_.find(category => category.id_ === id);
        const getLocale = () => ScratchBlocks.ScratchMsgs.currentLocale_ || doc.documentElement.lang;
        // A category nested in another opens from its group's child palette.
        const groups = attachPaletteCategoryGroups(menu, {
            categories: () => toolbox.categoryMenu_.categories_,
            horizontal: () => horizontal,
            rtl: workspace.RTL,
            choose: category => toolbox.setSelectedItem(category),
            onChange: () => updateCategoryButtons(),
            reorder: allowCategoryReorder,
            onReorder: () => reordered(),
            order: () => paletteOrder(),
            locale: getLocale
        });
        const search = attachPaletteCategorySearch(panel, getLocale, (query, previous) => {
            const category = categoryById(openId);
            if (!category) return;
            if (!previous) scrollBeforeSearch = flyout.getScrollPos();
            flyout.scrollTarget = null;
            if (query) showAllCategories();
            else showCategory(category, scrollBeforeSearch);
        });

        const close = () => {
            if (openId === null) return;
            resizer.close();
            scrollPositions.set(openId, search.query ? scrollBeforeSearch : flyout.getScrollPos());
            search.close();
            categoryById(openId)?.item_.setAttribute('aria-expanded', 'false');
            openId = null;
            updateCategoryButtons();
            flyout.hide();
        };

        const closeIfUnpinned = () => {
            const pin = panel.querySelector(':scope > .sa-lock-object.locked');
            if (!pin || win.getComputedStyle(pin).display === 'none') close();
        };

        const categoryLabel = category => {
            const label = doc.createElement('label');
            label.setAttribute('text', category.name_);
            label.setAttribute('web-class', 'categoryLabel');
            label.setAttribute('showStatusButton', category.showStatusButton_);
            return label;
        };
        const showContents = (contents, scroll) => {
            if (flyout.RTL) {
                layoutWidth = flyout.getWidth();
                flyout.workspace_.scrollX = 0;
            }
            flyout.show(contents);
            flyout.setScrollPos(scroll);
        };
        const showCategory = (category, scroll) => showContents([categoryLabel(category)].concat(category.getContents()), scroll);
        // A search looks through every category the palette offers, whatever group it sits in: nested groups are
        // flattened into the toolbox, and the groups the target hides are not in it.
        const showAllCategories = () => showContents(toolbox.categoryMenu_.categories_
            .flatMap(category => [categoryLabel(category)].concat(category.getContents())), 0);

        flyout.layout_ = (contents, gaps) => {
            const category = categoryById(openId);
            if (!horizontal || !category || !search.query) {
                original.layout.call(flyout, contents, gaps);
                return;
            }
            // Each category's heading leads its blocks, so a query naming a category finds all of its blocks. A name
            // broken over lines also matches with the break read as a space or as nothing.
            const heading = (text: string) => {
                const name = ScratchBlocks.utils.replaceMessageReferences(text);
                return name.includes('\n') ? `${name.replace(/\s*\n\s*/g, ' ')} ${name.replace(/\s*\n\s*/g, '')}` : name;
            };
            const matching = matchPaletteBlocks(contents, '', search.query, heading,
                (block: {inputList: {fieldRow: {getText(): string}[]}[]}) => block.inputList.flatMap(input => input.fieldRow)
                    .filter(field => field instanceof ScratchBlocks.FieldLabel)
                    .map(field => field.getText()).join(' '));
            // A heading or button stays only when a block it leads still matches: a category heading for its category,
            // any other label or button for the blocks up to the next label.
            const isCategoryHeading = item => item.type === 'button' && item.button.isLabel_ &&
                item.button.cssClass_ === 'categoryLabel';
            const leads = (start: number, isEnd: (item) => boolean) => {
                for (let index = start + 1; index < contents.length && !isEnd(contents[index]); index++) {
                    if (contents[index].type === 'block' && matching.has(contents[index].block)) return true;
                }
                return false;
            };
            const kept = [];
            const keptGaps = [];
            for (let index = 0; index < contents.length; index++) {
                const item = contents[index];
                const keep = item.type === 'block' ? matching.has(item.block) :
                    isCategoryHeading(item) ? leads(index, isCategoryHeading) :
                        leads(index, next => next.type === 'button' && next.button.isLabel_);
                if (keep) {
                    kept.push(item);
                    keptGaps.push(gaps[index]);
                } else if (item.type === 'block') {
                    item.block.dispose(false, false);
                }
            }
            flyout.permanentlyDisabled_ = flyout.permanentlyDisabled_.filter(block => matching.has(block));
            if (!matching.size) {
                const label = doc.createElement('label');
                label.setAttribute('text', search.emptyLabel);
                kept.push({type: 'button', button: new ScratchBlocks.FlyoutButton(flyout.workspace_, workspace, label, true)});
                keptGaps.push(flyout.GAP_Y);
            }
            original.layout.call(flyout, kept, keptGaps);
        };

        const open = category => {
            if (!category) return;
            if (openId === category.id_) {
                flyout.position();
                return;
            }
            close();
            openId = category.id_;
            resizer.open(openId);
            toolbox.setSelectedItem(category, false);
            category.item_.setAttribute('aria-expanded', 'true');
            updateCategoryButtons();
            showCategory(category, scrollPositions.get(category.id_) ?? 0);
        };

        const updateCategoryButtons = () => {
            for (const category of toolbox.categoryMenu_.categories_) {
                const item = category.item_;
                // A group's icon opens its child palette, which marks it itself.
                if (groups.isGroup(category.id_)) continue;
                if (horizontal) {
                    item.tabIndex = 0;
                    item.setAttribute('role', 'button');
                    item.setAttribute('aria-expanded', String(openId === category.id_));
                } else {
                    item.removeAttribute('tabindex');
                    item.removeAttribute('role');
                    item.removeAttribute('aria-expanded');
                }
            }
            groups.syncButtons(openId);
        };

        toolbox.getWidth = () => horizontal ? 0 : original.getWidth.call(toolbox);
        toolbox.getHeight = () => {
            if (!horizontal) return original.getHeight.call(toolbox);
            if (detached) return 0;
            // Blockly requests metrics for each drag step. The observed palette keeps its height until it resizes.
            if (menuHeight === undefined || !workspace.isDragging()) menuHeight = menu.offsetHeight;
            return menuHeight;
        };
        // The menu stays a drop-to-delete target even when the popover is closed.
        toolbox.getClientRect = () => {
            if (!horizontal) return original.getClientRect.call(toolbox);
            const {left, top, right, bottom, width, height} = menu.getBoundingClientRect();
            return {left, top, width, height, contains: ({x, y}) => x >= left && x <= right && y >= top && y <= bottom};
        };
        toolbox.scrollToCategoryById = id => {
            if (horizontal) open(categoryById(id));
            else original.scrollToId.call(toolbox, id);
        };
        toolbox.scrollToCategoryByName = name => {
            if (horizontal) open(toolbox.categoryMenu_.categories_.find(category => category.name_ === name));
            else original.scrollToName.call(toolbox, name);
        };
        const categories = () => {
            const {categories_, table} = toolbox.categoryMenu_;
            // Addons may split categories into separate lists.
            return categories_.every(category => category.item_.parentElement.parentElement === table) ? categories_ : [];
        };
        // The categories the menu shows: a group's members are moved with it, so only the group is ordered.
        const shownCategories = () => categories().filter(category => groups.topLevelId(category.id_) === category.id_);
        // The order is the project's, or this palette's own without a project.
        const ownOrder = createPaletteOrder();
        const paletteOrder = () => paletteStore?.order ?? ownOrder;
        const applyCategoryOrder = () => {
            const current = categories();
            const order = paletteOrder().categories();
            const ordered: typeof current = groups.arrange(current, id => {
                const index = order.indexOf(id);
                return index < 0 ? order.length : index;
            });
            if (ordered.every((category, index) => category === current[index])) return;
            current.splice(0, current.length, ...ordered);
            toolbox.categoryMenu_.table.append(...ordered.map(category => category.item_.parentElement));
        };
        const reorder = allowCategoryReorder && attachPaletteCategoryReorder(
            menu,
            () => shownCategories().map(category => category.item_),
            (from, to) => {
                const ordered = shownCategories().map(category => category.id_);
                ordered.splice(to, 0, ordered.splice(from, 1)[0]);
                paletteOrder().setCategories(ordered.concat(paletteOrder().categories().filter(id => !ordered.includes(id))));
                groups.close();
                reordered();
            }
        );
        // Lays the palette out again after its categories or a group's members were reordered.
        function reordered() {
            applyCategoryOrder();
            if (horizontal) {
                resizer.followAnchor();
                flyout.position();
            } else {
                const selected = toolbox.getSelectedItem();
                original.showAll.call(toolbox);
                if (selected) original.scrollToId.call(toolbox, selected.id_);
            }
        }

        toolbox.showAll_ = () => {
            applyCategoryOrder();
            if (!horizontal) {
                original.showAll.call(toolbox);
                return;
            }
            const category = categoryById(openId);
            if (category) showCategory(category, flyout.getScrollPos());
            else close();
        };
        // The toolbox as the GUI gave it, so the palette can be drawn again when a sprite's groups change.
        let lastTree: Element | null = null;
        const visibleNow = () => {
            const target = paletteVM?.editingTarget;
            return target && paletteStore ? paletteStore.visible(target, extensionIds(paletteVM)) : null;
        };
        const redraw = () => {
            if (lastTree) workspace.updateToolbox(lastTree.cloneNode(true));
        };
        paletteRefreshers.add(redraw);
        const replacementHost = {document: doc, getLocale};
        replacementHosts.set(workspace, replacementHost);
        const openGroupSettings = (target = paletteVM?.editingTarget, newSprite = false) => {
            const vm = paletteVM;
            const store = paletteStore;
            if (!vm || !store || !target) return;
            const catalog = catalogOf(vm, getLocale());
            const ids = catalog.groups.map(group => group.id);
            const initial = store.visible(target, ids);
            openPaletteVisibilityDialog(doc, {
                locale: getLocale(),
                targetName: target.getName(),
                isStage: target.isStage,
                newSprite,
                // A second or later sprite can copy the groups one already made shows.
                copySources: newSprite ? originalTargets(vm).filter(other => !other.isStage && other !== target)
                    .map(other => ({name: other.getName(), groups: [...store.visible(other, ids)]})) : undefined,
                initial,
                used: usedGroups(target, catalog),
                extensions: (vm.runtime._blockInfo ?? []).map(info => {
                    const groups = catalog.groups.filter(group => group.extensionId === info.id);
                    return {
                        id: info.id,
                        metadata: {name: info.name || info.id, banner: info.menuIconURI || info.blockIconURI},
                        groups: groups.some(group => group.declared) ?
                            groups.map(group => ({id: group.id, name: group.name, color: group.color1, parent: group.parent,
                                empty: group.empty})) : undefined
                    };
                }),
                sets: paletteGroupSets(getLocale(), store.sets()),
                onApply({groups, addedSets}) {
                    store.addSets(addedSets);
                    store.set(target, groups, ids);
                    vm.runtime.emitProjectChanged();
                    redraw();
                    if (vm.editingTarget === target) {
                        const previous = new Set(catalog.groups.filter(group => initial.has(group.id))
                            .map(group => group.extensionId));
                        const enabled = catalog.groups.filter(group => groups.includes(group.id) && !previous.has(group.extensionId))
                            .map(group => group.extensionId);
                        suggestPaletteReplacements(vm, enabled);
                    }
                },
                onCancel() {}
            });
        };
        const askNewSprite = (target: any) => openGroupSettings(target, true);
        newSpritePrompts.push(askNewSprite);
        const openExtensionLibrary = () => openHostLibrary(doc);
        const paletteMenu = showPaletteMenu ? attachPaletteMenuButton(menu, getLocale, locale => [
            {label: paletteVisibilityMenuLabel(locale), onSelect: () => openGroupSettings()},
            {label: /^ja(?:-|$)/i.test(locale) ? '機能拡張を追加' : 'Add Extension', separated: true, onSelect: openExtensionLibrary}
        ]) : undefined;

        // The GUI selects an extension by its ID once it is added; one shown as a group selects its first shown group.
        const selectCategoryById = toolbox.setSelectedCategoryById;
        toolbox.setSelectedCategoryById = function (id: string) {
            return selectCategoryById.call(this, groups.selectionTarget(id));
        };

        toolbox.populate_ = tree => {
            if (reorder) reorder.cancel();
            if (tree) {
                lastTree = tree.cloneNode(true) as Element;
                const found = groups.prepare(tree,
                    {catalog: paletteVM ? catalogOf(paletteVM, getLocale()) : undefined, visible: visibleNow()});
                original.populate.call(toolbox, tree);
                groups.update(found);
            } else {
                original.populate.call(toolbox, tree);
            }
            paletteMenu?.update();
            if (!horizontal) return;
            const category = categoryById(openId);
            if (category) toolbox.setSelectedItem(category, false);
            updateCategoryButtons();
        };

        const getBounds = () => {
            const surfaceRect = surface.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();
            const viewport = surface.ownerDocument.documentElement;
            return {
                surfaceLeft: surfaceRect.left,
                left: Math.max(0, menuRect.left - surfaceRect.left, -surfaceRect.left),
                right: Math.min(surface.clientWidth, menuRect.right - surfaceRect.left,
                    viewport.clientWidth - surfaceRect.left),
                top: Math.max(menu.offsetHeight, -surfaceRect.top),
                bottom: Math.min(surface.clientHeight, viewport.clientHeight - surfaceRect.top) - 4
            };
        };
        const getWidth = ({left, right}) => {
            const width = resizer.size?.width ?? original.getFlyoutWidth.call(flyout);
            return Math.max(1, Math.min(width, right - left - 8));
        };
        flyout.getWidth = () => horizontal ? getWidth(getBounds()) : original.getFlyoutWidth.call(flyout);

        flyout.position = () => {
            if (!horizontal) {
                original.position.call(flyout);
                return;
            }
            const category = categoryById(openId);
            if (!category || !flyout.isVisible()) return;

            // Keep the existing vertical flyout and scrollbar. Only their viewport and origin change.
            const bounds = getBounds();
            const {top} = bounds;
            const width = getWidth(bounds);
            const requestedHeight = resizer.size?.height ?? Math.min(360, surface.clientHeight * 0.65);
            const height = Math.max(0, Math.min(requestedHeight, bounds.bottom - top));
            const bodyHeight = height - paletteSearchHeight;
            const visible = width > flyout.SCROLLBAR_PADDING && bodyHeight > 2 * flyout.SCROLLBAR_PADDING;
            panel.style.visibility = scrollbar.style.visibility = visible ? '' : 'hidden';
            if (!visible) {
                resizer.place(null);
                search.place(null);
                return;
            }

            // A category in a group is placed under the group's icon, since its own is hidden.
            const anchor = groups.anchorOf(category).getBoundingClientRect();
            const preferredLeft = resizer.left ?? (workspace.RTL ? anchor.right - width : anchor.left) - bounds.surfaceLeft;
            const left = Math.min(Math.max(bounds.left, preferredLeft), bounds.right - width);

            flyout.width_ = width;
            flyout.height_ = bodyHeight;
            // Scratch Blocks positions RTL blocks against the width used when laying them out.
            if (flyout.RTL) flyout.workspace_.scrollX = width - layoutWidth;
            flyout.setBackgroundPath_(width, height);
            panel.setAttribute('width', width);
            panel.setAttribute('height', height);
            panel.style.transform = `translate(${left}px, ${top}px)`;
            flyout.scrollbar_.setOrigin(left, top + paletteSearchHeight);
            flyout.scrollbar_.resize();
            resizer.place({left, top, width, height});
            search.place({left, top, width});
            panel.style.opacity = '1';
        };

        const reposition = () => {
            if (openId !== null) flyout.position();
        };
        const resizeObserver = new win.ResizeObserver(entries => {
            if (entries.some(entry => entry.target === menu)) menuHeight = undefined;
            syncInputDocument();
            reposition();
        });
        resizeObserver.observe(surface);
        resizeObserver.observe(menu, {box: 'border-box'});
        win.addEventListener('resize', reposition, {signal: events.signal});

        flyout.isDragTowardWorkspace = delta => {
            if (!horizontal) return original.isDragTowardWorkspace.call(flyout, delta);
            // Leave vertical swipes available to scroll the block list on touch screens.
            const touch = workspace.currentGesture_?.mostRecentEvent_?.type.startsWith('touch');
            return Math.abs(delta.x) > Math.abs(delta.y) / 2 || (!touch && delta.y > 0);
        };
        closeOnDragExit.set(flyout, ({clientX, clientY}) => {
            if (openId === null) return;
            const {left, right, top, bottom} = panel.getBoundingClientRect();
            if (clientX < left || clientX > right || clientY < top || clientY > bottom) closeIfUnpinned();
        });

        const setMode = next => {
            if (next === horizontal) return;
            if (reorder) reorder.cancel();
            const category = toolbox.getSelectedItem();
            workspace.cancelCurrentGesture();
            groups.close();
            close();
            flyout.scrollTarget = null;
            horizontal = next;
            menuHeight = undefined;
            workspace.toolboxPosition = horizontal ? ScratchBlocks.TOOLBOX_AT_TOP : verticalPosition;
            menu.classList.toggle(styles.horizontal, horizontal);
            menu.toggleAttribute('data-horizontal-block-palette', horizontal);
            restoreHorizontalDisplay();
            panel.classList.toggle(styles.panel, horizontal);
            scrollbar.classList.toggle(styles.scrollbar, horizontal);
            if (horizontal) body.setAttribute('transform', `translate(0 ${paletteSearchHeight}) ${bodyTransform ?? ''}`);
            else if (bodyTransform === null) body.removeAttribute('transform');
            else body.setAttribute('transform', bodyTransform);
            updateCategoryButtons();
            if (horizontal) flyout.hide();
            else {
                panel.style.visibility = scrollbar.style.visibility = '';
                if (flyout.RTL) flyout.workspace_.scrollX = 0;
                toolbox.showAll_();
                if (category) toolbox.setSelectedItem(category);
            }
            workspace.resize();
        };

        const showContextMenu = event => {
            event.preventDefault();
            event.stopPropagation();
            const japanese = doc.documentElement.lang.toLowerCase().startsWith('ja');
            const text = horizontal ?
                (japanese ? 'パレットを縦表示にする' : 'Use vertical palette') :
                (japanese ? 'パレットを横表示にする' : 'Use horizontal palette');
            // The addon wrapper for ContextMenu.show expects an active Blockly gesture.
            const popup = ContextMenu.populate_([{
                text,
                twPlusMenuIcon: horizontal ? 'paletteVertical' : 'paletteHorizontal',
                enabled: true,
                callback: () => {
                    WidgetDiv.hideIfOwner(toolbox);
                    setMode(!horizontal);
                }
            }], workspace.RTL);
            WidgetDiv.show(toolbox, workspace.RTL, () => popup.dispose());
            ContextMenu.position_(popup, event, workspace.RTL);
        };
        if (allowManualToggle) {
            menu.addEventListener('contextmenu', showContextMenu, capture);
            panel.addEventListener('contextmenu', event => {
                // Keep each block's own context menu.
                if (event.target === panel || event.target === flyout.svgBackground_) showContextMenu(event);
            }, capture);
        }
        menu.addEventListener('mouseup', event => {
            if (allowManualToggle && (event.button === 2 || (event.button === 0 && event.ctrlKey))) event.stopPropagation();
        }, capture);
        menu.addEventListener('keydown', event => {
            if (!horizontal || !['Enter', ' '].includes(event.key)) return;
            const category = toolbox.categoryMenu_.categories_.find(item => item.item_ === event.target);
            if (!category) return;
            event.preventDefault();
            if (groups.isGroup(category.id_)) groups.toggle(category, true);
            else if (openId === category.id_) close();
            else open(category);
        }, capture);
        menu.addEventListener('scroll', () => {
            resizer.followAnchor();
            if (horizontal) flyout.position();
        }, {signal: events.signal});
        menu.addEventListener('wheel', event => {
            if (!horizontal || event.ctrlKey || event.deltaX || !event.deltaY || menu.scrollWidth <= menu.clientWidth) return;
            event.preventDefault();
            menu.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : 1);
        }, {passive: false, signal: events.signal});
        const onPointerDown = event => {
            if (WidgetDiv.DIV?.contains(event.target)) return;
            WidgetDiv.hideIfOwner(toolbox);
            if (openId === null || groups.contains(event.target) || resizer.contains(event.target) || search.contains(event.target) || [menu, panel, scrollbar, DropDownDiv.DIV]
                .some(element => element?.contains(event.target))) return;
            closeIfUnpinned();
        };
        const onKeyDown = event => {
            if (event.key !== 'Escape' || event.isComposing || groups.isOpen()) return;
            if (WidgetDiv.owner_ === toolbox) WidgetDiv.hideIfOwner(toolbox);
            else if (!WidgetDiv.isVisible() && !DropDownDiv.isVisible()) close();
        };
        const onWorkspaceKeyDown = event => {
            if (surface.contains(event.target)) ScratchBlocks.onKeyDown_(event);
        };
        let inputDocument: Document;
        function syncInputDocument() {
            const current = surface.ownerDocument;
            if (current === inputDocument) return;
            if (inputDocument) workspace.cancelCurrentGesture();
            moveBlockWidgets(ScratchBlocks, current);
            inputDocument?.removeEventListener('pointerdown', onPointerDown, true);
            inputDocument?.removeEventListener('keydown', onKeyDown, true);
            inputDocument?.removeEventListener('keydown', onWorkspaceKeyDown);
            inputDocument = current;
            inputDocument.addEventListener('pointerdown', onPointerDown, capture);
            inputDocument.addEventListener('keydown', onKeyDown, capture);
            if (current !== doc) inputDocument.addEventListener('keydown', onWorkspaceKeyDown, {signal: events.signal});
        }
        syncInputDocument();
        const disconnectPalette = connectDetachedBlockPalette({
            blocks: ScratchBlocks, workspace, flyout, menu,
            categories: () => toolbox.categoryMenu_.categories_.map(({id_, name_, item_}) => ({
                id: id_,
                label: ScratchBlocks.utils.replaceMessageReferences(name_),
                color: item_.querySelector('.scratchCategoryItemBubble')?.style.backgroundColor,
                image: item_.querySelector('.scratchCategoryItemIcon')?.style.backgroundImage
            })),
            grouping: () => ({groups: groups.current(), order: paletteOrder()}),
            show(id) {
                const category = categoryById(id);
                if (category) showCategory(category, 0);
            },
            setDetached(value) {
                close();
                detached = value;
                menuHeight = undefined;
                for (const element of [menu, panel, scrollbar]) element.toggleAttribute('data-detached-palette-source', value);
                if (!value) flyout.hide();
                workspace.resize();
            }
        });
        toolbox.dispose = () => {
            if (workspace.setVisible === setVisible) workspace.setVisible = original.setVisible;
            paletteRefreshers.delete(redraw);
            replacementHosts.delete(workspace);
            if (replacementDialog?.host === replacementHost) replacementDialog.close();
            newSpritePrompts.splice(newSpritePrompts.indexOf(askNewSprite) >>> 0, 1);
            paletteMenu?.dispose();
            groups.dispose();
            disconnectPalette();
            if (inputDocument !== doc) moveBlockWidgets(ScratchBlocks, doc);
            palettes.delete(setMode);
            closeOnDragExit.delete(flyout);
            resizeObserver.disconnect();
            resizer.dispose();
            search.dispose();
            if (reorder) reorder.dispose();
            events.abort();
            WidgetDiv.hideIfOwner(toolbox);
            original.dispose.call(toolbox);
        };
        // Scratch Blocks drew the first toolbox before the palette was attached, dropping the categories nested in groups.
        const firstTree = workspace.options.languageTree;
        if (hasCategoryGroups(firstTree)) toolbox.populate_(firstTree.cloneNode(true));
        palettes.add(setMode);
        setMode(horizontalLayout);
    };

    const installHorizontalBlockPalette = (ScratchBlocks,
        {allowManualToggle = false, allowCategoryReorder = false} = {}) => {
        const toolbox = ScratchBlocks.Toolbox?.prototype;
        if (!toolbox?.init || installed.has(toolbox)) return;
        installed.add(toolbox);
        installGestureOwnerDocument(ScratchBlocks);

        const gesture = ScratchBlocks.Gesture.prototype;
        const {handleMove} = gesture;
        gesture.handleMove = function (...args) {
            const result = handleMove.apply(this, args);
            if (this.isDraggingBlock_ && this.mostRecentEvent_) {
                closeOnDragExit.get(this.flyout_)?.(this.mostRecentEvent_);
            }
            return result;
        };

        const {init} = toolbox;
        toolbox.init = function (...args) {
            const result = init.apply(this, args);
            attach(ScratchBlocks, this, {allowManualToggle, allowCategoryReorder});
            return result;
        };
    };

    return {connectPaletteVisibility, suggestPaletteReplacements, setHorizontalBlockPalette, openDetachedBlockPalette, installHorizontalBlockPalette};
}
