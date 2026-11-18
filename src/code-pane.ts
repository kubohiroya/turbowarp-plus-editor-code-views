import {getCodeSession} from './workspace.ts';
import type {AttachPreviewMinimap, AttachWorkspaceNavigation} from './workspace.ts';
import {getDockedScriptLayout, setDockedRelationVisibility, type ScriptView} from './script-layout-view.ts';
import {readScriptRelations, type RelationTarget} from './script-relations.ts';
import type {ScriptRelationVisibility} from './script-arrows.ts';

type Pane = {id: string; targetId: string; section: number};
type Bridge = NonNullable<ReturnType<typeof getCodeSession>['bridge']>;
type Presentation = NonNullable<ReturnType<Bridge['capturePane']>>;

/** The code area of a tab as a saved workspace keeps it: zoom, scroll position and script view. */
// A type alias, not an interface, so it fits the workbench's `Record<string, unknown>` for a serialized pane.
export type SavedCodePane = {
    scale: number;
    x: number;
    y: number;
    scriptView?: ScriptView;
    relationVisibility?: ScriptRelationVisibility;
};

const scriptViews: readonly ScriptView[] = ['free', 'z', 'n'];
const finite = (value: unknown, limit: number): value is number =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

/** Read a saved code area back, or nothing if it does not have the shape `serialize` writes. */
export function readSavedCodePane(value: Record<string, unknown>): SavedCodePane | undefined {
    const {scale, x, y, scriptView, relationVisibility} = value;
    if (!finite(scale, 100) || scale <= 0 || !finite(x, 1e7) || !finite(y, 1e7)) return;
    const visibility = relationVisibility as Partial<ScriptRelationVisibility> | null;
    return {scale, x, y, ...(scriptViews.includes(scriptView as ScriptView) && {scriptView: scriptView as ScriptView}),
        ...(visibility && typeof visibility.function === 'boolean' && typeof visibility.message === 'boolean' &&
            {relationVisibility: {function: visibility.function, message: visibility.message}})};
}

export function createCodePaneAdapter(vm, locale: string, attachMinimap?: AttachPreviewMinimap) {
    const session = getCodeSession(vm);
    const label = /^ja(?:-|$)/i.test(locale) ? 'このペインでコードを編集' : 'Edit code in this pane';
    const views = new Map<string, ScriptView>();
    const visibilities = new Map<string, ScriptRelationVisibility>();
    const visibilityListeners = new Set<() => void>();
    const getVisibility = (paneId: string): ScriptRelationVisibility =>
        ({...visibilities.get(paneId) ?? {function: true, message: true}});
    // Views that show one script, a hat or a function, by pane id; `onLost` runs when that script is deleted.
    const focused = new Map<string, {scriptId: string; onLost?: () => void}>();
    // The code pane the code area is in, which shows its script there.
    let current: string | undefined;
    const applyFocus = (paneId?: string, refit = false) => {
        const focus = paneId === undefined ? undefined : focused.get(paneId);
        session.bridge?.focusScript(focus?.scriptId, focus && (() => focus.onLost?.()), refit);
    };
    let pending: {frame: number; pane: Pane; presentation: Presentation} | undefined;
    // The GUI can attach the code area again, with a new bridge; the view it is in still shows its script.
    let attached = session.bridge;
    session.subscribe(navigation => {
        const focus = current === undefined ? undefined : focused.get(current);
        if (navigation && focus) focus.scriptId = navigation.scriptId;
        if (session.bridge === attached) return;
        attached = session.bridge;
        if (current !== undefined) applyFocus(current);
    });
    const costumeUpdates = new Set<() => void>();
    const updateCostumes = () => costumeUpdates.forEach(update => update());

    function watchCostume(image: HTMLImageElement, readTarget) {
        let shownAsset;
        image.removeAttribute('src');
        function update() {
            const target = readTarget();
            const asset = target?.getCostumes()[target.currentCostume]?.asset;
            if (shownAsset === asset) return;
            shownAsset = asset;
            if (asset) image.src = asset.encodeDataURI();
            else image.removeAttribute('src');
        }
        if (!costumeUpdates.size) vm.on('targetsUpdate', updateCostumes);
        costumeUpdates.add(update);
        update();
        return () => {
            costumeUpdates.delete(update);
            if (!costumeUpdates.size) vm.removeListener('targetsUpdate', updateCostumes);
        };
    }

    return {
        /** Independent arrow filters belong to a code pane, including when its workspace is parked. */
        relations: {
            getVisibility,
            setVisibility(paneId: string, value: ScriptRelationVisibility) {
                const before = getVisibility(paneId);
                if (before.function === value.function && before.message === value.message) return;
                visibilities.set(paneId, {...value});
                if (current === paneId) setDockedRelationVisibility(vm, value);
                for (const listener of visibilityListeners) listener();
                session.changed();
            },
            subscribe(listener: () => void) {
                visibilityListeners.add(listener);
                return () => visibilityListeners.delete(listener);
            }
        },
        /**
         * Make a code view show one script, a hat or a function, or every script again without `scriptId`.
         * The code area shows it while it is in that view, and the view's preview shows it otherwise.
         */
        focusPane(paneId: string, scriptId?: string, onLost?: () => void) {
            if (scriptId) focused.set(paneId, {scriptId, onLost});
            else focused.delete(paneId);
            if (current === paneId) applyFocus(paneId, true);
            // Previews of other views redraw with their script.
            session.changed();
        },
        focusedScript: (paneId: string) => focused.get(paneId)?.scriptId,
        /** Forget a view that has closed. */
        forgetPane(paneId: string) {
            focused.delete(paneId);
            views.delete(paneId);
            visibilities.delete(paneId);
            if (current === paneId) {
                current = undefined;
                setDockedRelationVisibility(vm, {function: true, message: true});
                applyFocus(undefined);
            }
        },
        ownsClick: (element: EventTarget) => Boolean((element as Element)?.closest?.('[data-code-view-control]')),
        watchEditingCostume: (image: HTMLImageElement) => watchCostume(image, () => vm.editingTarget),
        capture(pane: Pane) {
            if (pane.section !== 0) return;
            if (pending?.pane.id === pane.id) {
                const {frame, presentation} = pending;
                cancelAnimationFrame(frame);
                pending = undefined;
                return presentation;
            }
            views.set(pane.id, getDockedScriptLayout(vm)?.view.view ?? 'free');
            return session.bridge?.capturePane(pane.targetId);
        },
        /**
         * The code area of a tab for a saved workspace. Without a presentation, the code area on screen is read; a
         * presentation still waiting to be applied is what that tab shows.
         */
        serialize(pane: Pane, presentation?: Presentation): SavedCodePane | undefined {
            if (pane.section !== 0) return;
            const shown = presentation ?? (pending?.pane.id === pane.id ? pending.presentation :
                session.bridge?.capturePane(pane.targetId));
            if (!shown) return;
            const scriptView = presentation ? presentation.scriptView : views.get(pane.id) ??
                getDockedScriptLayout(vm)?.view.view;
            const relationVisibility = visibilities.get(pane.id) ?? shown.relationVisibility;
            return {scale: shown.scale, x: shown.x, y: shown.y, ...(scriptView && {scriptView}),
                ...(relationVisibility && {relationVisibility: {...relationVisibility}})};
        },
        /** A presentation from a saved code area. The preview draws it without the chrome of the code area. */
        deserialize(pane: Pane, value: Record<string, unknown>): Presentation | undefined {
            if (pane.section !== 0) return;
            const saved = readSavedCodePane(value);
            if (!saved) return;
            if (saved.scriptView) views.set(pane.id, saved.scriptView);
            if (saved.relationVisibility) visibilities.set(pane.id, {...saved.relationVisibility});
            else visibilities.delete(pane.id);
            for (const listener of visibilityListeners) listener();
            return {scale: saved.scale, x: saved.x, y: saved.y, visible: true, ...(saved.scriptView && {scriptView: saved.scriptView}),
                ...(saved.relationVisibility && {relationVisibility: {...saved.relationVisibility}})};
        },
        restore(pane: Pane, presentation?: Presentation) {
            if (pending) cancelAnimationFrame(pending.frame);
            pending = undefined;
            if (pane.section !== 0) return;
            current = pane.id;
            if (!visibilities.has(pane.id) && presentation?.relationVisibility) {
                visibilities.set(pane.id, {...presentation.relationVisibility});
                for (const listener of visibilityListeners) listener();
            }
            setDockedRelationVisibility(vm, getVisibility(pane.id));
            applyFocus(pane.id);
            getDockedScriptLayout(vm)?.view.setView(views.get(pane.id) ?? 'free');
            if (!presentation) return;
            const frame = requestAnimationFrame(() => {
                pending = undefined;
                session.bridge?.restorePane(pane.targetId, presentation);
                // A picked script owns its initial viewport, including after a saved pane is restored.
                if (focused.has(pane.id)) applyFocus(pane.id, true);
            });
            pending = {frame, pane, presentation};
        },
        renderInactive(container: HTMLElement, pane: Pane, presentation?: Presentation) {
            if (pane.section !== 0) return;
            const target = vm.runtime.getTargetById(pane.targetId);
            if (!target) return;
            const document = container.ownerDocument;
            const surface = document.createElement('div');
            surface.dataset.codePreview = '';
            surface.dataset.codeHoverSurface = '';
            surface.tabIndex = 0;
            surface.setAttribute('role', 'button');
            surface.setAttribute('aria-label', label);
            surface.addEventListener('keydown', event => {
                if (event.target !== surface || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                event.stopPropagation();
                surface.click();
            });

            const blocks = document.createElement('div');
            const chrome = document.createElement('div');
            chrome.className = 'tw-code-preview-chrome';
            for (const child of [blocks, chrome]) child.setAttribute('inert', '');
            const watermark = document.createElement('div');
            watermark.dataset.dockviewCostumeThumbnail = '';
            const image = document.createElement('img');
            image.alt = '';
            watermark.appendChild(image);
            chrome.appendChild(watermark);
            surface.append(blocks, chrome);
            container.appendChild(surface);

            const stopCostume = watchCostume(image, () => target);
            let bridge: Bridge | null;
            let preview: ReturnType<Bridge['preview']> | undefined;
            let shownScript: string | undefined;
            function update() {
                if (bridge !== session.bridge || shownScript !== focused.get(pane.id)?.scriptId) {
                    preview?.dispose();
                    bridge = session.bridge;
                    shownScript = focused.get(pane.id)?.scriptId;
                    preview = bridge?.preview(blocks, chrome, {target, presentation, attachMinimap, watermark, locale, dropElement: surface,
                        scriptView: views.get(pane.id), onScriptViewChange: view => views.set(pane.id, view),
                        relationVisibility: getVisibility(pane.id),
                        scriptId: focused.get(pane.id)?.scriptId});
                }
                preview?.setRelationVisibility(getVisibility(pane.id));
                preview?.update();
            }
            const unsubscribe = session.subscribe(update);
            update();
            return () => {
                stopCostume();
                unsubscribe();
                preview?.dispose();
                surface.remove();
            };
        }
    };
}

/**
 * Mount an editor of one custom block definition in `element`, for the functions section.
 * It follows the code area: when the GUI replaces its workspace, the editor is rebuilt on the new one.
 */
export function mountProcedureEditor(vm, locale: string, element: HTMLElement, targetId: string, definitionId: string,
    {editable, attachNavigation, focusBlock}: {editable: boolean; attachNavigation?: AttachWorkspaceNavigation; focusBlock?: string}) {
    const session = getCodeSession(vm);
    const notice = element.ownerDocument.createElement('p');
    notice.className = 'tw-sprite-functions__empty';
    notice.textContent = /^ja(?:-|$)/i.test(locale) ? 'コード領域の準備ができるまで待っています…' : 'Waiting for the code area…';
    let bridge: Bridge | null | undefined;
    let editor: {dispose(): void; showBlock(id: string): void} | undefined;
    // A block to show waits for the editor, which waits for the code area.
    let pendingBlock = focusBlock;
    function update() {
        if (bridge === session.bridge) return;
        editor?.dispose();
        editor = undefined;
        bridge = session.bridge;
        const target = vm.runtime.getTargetById(targetId);
        if (!bridge || !target) {
            element.appendChild(notice);
            return;
        }
        notice.remove();
        try {
            editor = bridge.editProcedure(element, {target, definitionId, editable, attachNavigation, locale, focusBlock: pendingBlock});
            pendingBlock = undefined;
        } catch (error) {
            bridge.onError?.(error);
        }
    }
    const unsubscribe = session.subscribe(update);
    update();
    return Object.assign(() => {
        unsubscribe();
        editor?.dispose();
        notice.remove();
    }, {
        /** Show one block of the script, such as a call picked in the list of a function's uses. */
        showBlock(id: string) {
            if (editor) editor.showBlock(id);
            else pendingBlock = id;
        }
    });
}

export interface HatScript {
    id: string;
    label: string;
    x: number;
    y: number;
    thumbnail?: SVGSVGElement;
}

const svgNamespace = 'http://www.w3.org/2000/svg';
const hatDrawings = new WeakMap<object, {workspace; drawings: Map<string, SVGSVGElement>}>();

/**
 * Draw a hat block as a standalone SVG, for the list of hats. ScratchBlocks renders it in a hidden workspace of
 * its own; the drawing keeps the block's shapes and images and carries the text styles the page gives them.
 * Drawings are kept by the hat's XML, so an unchanged hat is drawn once.
 */
function drawHat(ScratchBlocks, xml: string): SVGSVGElement | undefined {
    let state = hatDrawings.get(ScratchBlocks);
    if (!state) {
        const main = ScratchBlocks.getMainWorkspace?.();
        if (!main?.options) return undefined;
        const document = main.getInjectionDiv().ownerDocument as Document;
        const host = document.createElement('div');
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:fixed;left:-10000px;top:0;inline-size:600px;block-size:200px;visibility:hidden;pointer-events:none';
        document.body.appendChild(host);
        const workspace = ScratchBlocks.inject(host, {readOnly: true, media: main.options.pathToMedia, scrollbars: false,
            sounds: false, zoom: {startScale: 1}});
        // Injecting focuses the new workspace; the GUI keeps reading the code area as the main one.
        main.markFocused();
        state = {workspace, drawings: new Map()};
        hatDrawings.set(ScratchBlocks, state);
    }
    const kept = state.drawings.get(xml);
    if (kept) return kept;
    const {workspace} = state;
    const block = ScratchBlocks.Xml.domToBlock(ScratchBlocks.Xml.textToDom(`<xml>${xml}</xml>`).firstElementChild, workspace);
    try {
        const root = block.getSvgRoot() as SVGGElement;
        const box = root.getBBox();
        if (!box.width || !box.height) return undefined;
        const document = root.ownerDocument;
        const drawing = document.createElementNS(svgNamespace, 'svg') as SVGSVGElement;
        drawing.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
        drawing.setAttribute('width', String(box.width));
        drawing.setAttribute('height', String(box.height));
        const copy = root.cloneNode(true) as SVGGElement;
        copy.removeAttribute('transform');
        copy.removeAttribute('id');
        for (const node of copy.querySelectorAll('[id]')) node.removeAttribute('id');
        const texts = root.querySelectorAll('text');
        copy.querySelectorAll('text').forEach((text, index) => {
            const style = document.defaultView.getComputedStyle(texts[index]);
            for (const name of ['fill', 'font-family', 'font-size', 'font-weight']) {
                text.setAttribute(name, style.getPropertyValue(name));
            }
        });
        drawing.appendChild(copy);
        if (state.drawings.size > 500) state.drawings.clear();
        state.drawings.set(xml, drawing);
        return drawing;
    } finally {
        block.dispose(false);
    }
}

/**
 * Read the scripts of a target that start with a hat, such as “when green flag clicked”, leaving out `skip`
 * (its function definitions). A script is a hat script when its top block has nothing to attach above it or
 * to plug it into; its label is how ScratchBlocks spells that block.
 */
export function readHatScripts(target, ScratchBlocks, skip: ReadonlySet<string> = new Set()): HatScript[] {
    const blocks = target.blocks._blocks as Record<string, {id: string; topLevel?: boolean; shadow?: boolean; x?: number; y?: number}>;
    const tops = Object.values(blocks).filter(block => block.topLevel && !block.shadow && !skip.has(block.id));
    if (!tops.length || !ScratchBlocks?.Workspace) return [];
    const flag = /^ja(?:-|$)/i.test(ScratchBlocks.ScratchMsgs?.currentLocale_ ?? '') ? '緑の旗' : 'green flag';
    const workspace = new ScratchBlocks.Workspace();
    ScratchBlocks.Events.disable();
    try {
        const hats: HatScript[] = [];
        for (const top of tops) {
            try {
                const dom = ScratchBlocks.Xml.textToDom(`<xml>${target.blocks.blockToXML(top.id, {})}</xml>`).firstElementChild;
                // Only the hat itself is spelled and drawn; the rest of the script is not needed.
                for (const child of [...dom.children]) if (child.tagName.toLowerCase() === 'next') child.remove();
                const hatXml = ScratchBlocks.Xml.domToText(dom);
                const block = ScratchBlocks.Xml.domToBlock(dom, workspace);
                // The green flag is an image whose text is its alt, “flag”; read it as the flag's name.
                for (const field of block.inputList.flatMap(input => input.fieldRow)) {
                    if (field instanceof ScratchBlocks.FieldImage && /green-flag/.test(field.src_ ?? '')) field.text_ = flag;
                }
                if (!block.previousConnection && !block.outputConnection) {
                    hats.push({id: top.id, label: block.toString().replace(/\s+/g, ' ').trim(), x: top.x ?? 0, y: top.y ?? 0,
                        thumbnail: drawHat(ScratchBlocks, hatXml)});
                }
            } catch {
                // A block whose definition is not loaded, such as one of a missing extension, is left out.
            }
            workspace.clear();
        }
        return hats;
    } finally {
        ScratchBlocks.Events.enable();
        workspace.dispose();
    }
}

/** Supply the calls panel with the same relations and native hat labels as the code workspace. */
export function readScriptRelationGraph(targets: readonly RelationTarget[], ScratchBlocks) {
    const scriptRelations = readScriptRelations(targets);
    const used = new Map<string, Set<string>>();
    for (const relation of scriptRelations) {
        for (const endpoint of [relation.source, relation.destination]) {
            if (!endpoint) continue;
            if (!used.has(endpoint.targetId)) used.set(endpoint.targetId, new Set());
            used.get(endpoint.targetId).add(endpoint.scriptId);
        }
    }
    const scripts: {targetId: string; scriptId: string; label: string; targetName?: string; isStage?: boolean; x?: number; y?: number}[] = [];
    for (const target of targets) {
        if (target.isOriginal === false || !used.has(target.id)) continue;
        const hats = new Map(readHatScripts(target, ScratchBlocks).map(hat => [hat.id, hat]));
        for (const scriptId of used.get(target.id)) {
            const block = target.blocks._blocks[scriptId];
            if (!block) continue;
            const prototype = target.blocks._blocks[block.inputs?.custom_block?.block ?? ''];
            const label = hats.get(scriptId)?.label ?? String(prototype?.mutation?.proccode ??
                block.fields?.BROADCAST_OPTION?.value ?? block.opcode);
            scripts.push({targetId: target.id, scriptId, label, targetName: target.getName?.(),
                isStage: Boolean(target.isStage), x: block.x ?? 0, y: block.y ?? 0});
        }
    }
    return {scriptRelations, scripts};
}

/**
 * Add “Show this function” at the top of the menu of every block that calls a function, in the code area and
 * in the script editors. `find` names the function a block calls, if any; `open` shows it.
 * With `scriptEditor`, free-layout blocks first offer to edit their own containing script.
 */
export function attachFunctionCallMenu(ScratchBlocks, {label, find, open, scriptEditor}: {
    label(): string;
    find(blockId: string): string | undefined;
    open(functionId: string): void;
    scriptEditor?: {vm: any; locale: string;
        open(scriptId: string, blockId: string, section: 'functions' | 'calls'): void};
}) {
    const prototype = ScratchBlocks.BlockSvg.prototype;
    const showContextMenu = prototype.showContextMenu_;
    const patched = function (event) {
        const functionId = this.isInFlyout ? undefined : find(this.id);
        const target = scriptEditor?.vm.editingTarget;
        const layout = scriptEditor && getDockedScriptLayout(scriptEditor.vm);
        const script = scriptEditor && !this.isInFlyout && !this.workspace.options.readOnly &&
            this.workspace === ScratchBlocks.getMainWorkspace?.() && layout?.view.view === 'free' &&
            layout.canArrange() && !getCodeSession(scriptEditor.vm).bridge?.focusedScript ? this.getRootBlock() : undefined;
        const scriptId = script && target?.blocks._blocks[script.id] ? script.id : undefined;
        if (!functionId && !scriptId) return showContextMenu.call(this, event);
        const blockId = this.id;
        const japanese = scriptEditor && /^ja(?:-|$)/i.test(scriptEditor.locale);
        const scriptOptions = scriptId ? [
            {section: 'functions' as const, text: japanese ?
                'このスクリプトを個別の画面で編集する' : 'Edit this script in a separate view'},
            {section: 'calls' as const, text: japanese ?
                'このスクリプトの呼び出し関係を開く' : 'Open relationships for this script'}
        ].map(({section, text}) => ({text, twPlusMenuIcon: section, separator: false, enabled: true, callback() {
            if (scriptEditor.vm.editingTarget === target && target.blocks._blocks[scriptId]) {
                scriptEditor.open(scriptId, blockId, section);
            }
        }})) : [];
        const owned = Object.prototype.hasOwnProperty.call(this, 'customContextMenu');
        const custom = this.customContextMenu;
        this.customContextMenu = function (options) {
            custom?.call(this, options);
            if (functionId) options.unshift({text: label(), enabled: true, callback: () => open(functionId)});
            options.unshift(...scriptOptions);
        };
        const {ContextMenu} = ScratchBlocks;
        const populate = scriptOptions.length ? ContextMenu.populate_ : undefined;
        if (scriptOptions.length) ContextMenu.populate_ = function (options, rtl) {
            // Addons reorder ContextMenu.show's options after customContextMenu. Prioritize the final list,
            // in place so their separator indices and the host's icon decoration still use the same order.
            for (const priority of [...scriptOptions].reverse()) {
                const index = options.findIndex(option => option.callback === priority.callback);
                if (index > 0) options.unshift(...options.splice(index, 1));
            }
            for (const option of scriptOptions) option.separator = false;
            if (options.length > 2) options[2].separator = true;
            const menu = populate.call(this, options, rtl);
            menu.getChildAt(2)?.getElement().classList.add('tw-script-editor-menu-divider');
            return menu;
        };
        try {
            return showContextMenu.call(this, event);
        } finally {
            if (scriptOptions.length) ContextMenu.populate_ = populate;
            if (owned) this.customContextMenu = custom;
            else delete this.customContextMenu;
        }
    };
    prototype.showContextMenu_ = patched;
    return () => {
        if (prototype.showContextMenu_ === patched) prototype.showContextMenu_ = showContextMenu;
    };
}

/** Add a function definition of this name to a target through the code area's bridge. Resolves with the new hat's id. */
export async function createFunction(vm, targetId: string, kind: 'procedure' | 'named', name: string,
    options: {loadNamedFunctions?(): Promise<void>} = {}) {
    const bridge = getCodeSession(vm).bridge;
    const target = vm.runtime.getTargetById(targetId);
    if (!bridge || !target) throw Object.assign(new Error('The code area is not ready'), {code: 'unavailable'});
    return bridge.createFunction(target, kind, name, options);
}
