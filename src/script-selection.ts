// SPDX-License-Identifier: MPL-2.0
/**
 * Select several scripts in the free layout and move or delete them together.
 *
 * - Ctrl+click (⌘+click on macOS, where Ctrl+click is the context menu) adds or removes the clicked script.
 * - Shift+drag on the background draws a rectangle; scripts it touches are added. Shift+Alt+drag removes them.
 * - Dragging a selected script moves the others by the same distance; dropping it on the palette deletes them all.
 * - Delete or Backspace, or the block context menu, deletes every selected script as one undoable edit.
 * - Escape, a plain click on the background or a plain press on an unselected script clears the selection.
 *
 * The selection is screen state only; it is never saved with the project.
 */

type Point = {x: number; y: number};
type Rect = {left: number; top: number; right: number; bottom: number};

interface SelectableBlock {
    id: string;
    type: string;
    workspace: object;
    getParent(): SelectableBlock | null;
    getRootBlock(): SelectableBlock;
    getSvgRoot(): SVGGElement | null;
    getRelativeToSurfaceXY(): Point;
    translate(x: number, y: number): void;
    moveBy(dx: number, dy: number): void;
    isDeletable(): boolean;
    isMovable?(): boolean;
    dispose(healStack?: boolean, animate?: boolean): void;
    getDescendants(ordered: boolean): SelectableBlock[];
    getProcCode?(): string;
}

const selectedClass = 'tw-plus-script-selected';
const marqueeClass = 'tw-plus-script-marquee';
const installed = new WeakSet<object>();
/** The attachment that receives drags and context menus of a workspace's blocks. */
const owners = new WeakMap<object, ReturnType<typeof createSelection>>();
/** The workspace whose selection the keyboard acts on: the one last pressed in. */
let activeWorkspace: object | null = null;

export const isMacPlatform = (navigator: {platform?: string; userAgent?: string} | undefined) =>
    /Mac|iPhone|iPad|iPod/.test(navigator?.platform || navigator?.userAgent || '');

/** Whether a press toggles a script: ⌘ on macOS, Ctrl elsewhere. */
export const isToggleClick = (event: {ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; button: number},
    mac: boolean) => event.button === 0 && !event.shiftKey && !event.altKey && (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

/** Normalise two corners into a rectangle. */
export const rectFromCorners = (a: Point, b: Point): Rect => ({
    left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y)
});

/** Whether two rectangles overlap, touching edges included. */
export const intersects = (a: Rect, b: Rect) => a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;

const labels = (locale: string, count: number) => /^ja(?:-|$)/i.test(locale) ?
    {remove: `選択した${count}個のスクリプトを削除`} :
    {remove: count === 1 ? 'Delete 1 selected script' : `Delete ${count} selected scripts`};

/** Procedure codes called by a block but defined nowhere: the calls a deletion would leave behind. */
function orphanCalls(workspace): Set<string> {
    const defined = new Set<string>();
    const called = new Set<string>();
    for (const block of workspace.getAllBlocks(false) as SelectableBlock[]) {
        if (block.type === 'procedures_prototype') defined.add(block.getProcCode?.() ?? '');
        else if (block.type === 'procedures_call') called.add(block.getProcCode?.() ?? '');
    }
    return new Set([...called].filter(code => !defined.has(code)));
}

function installHooks(blocks) {
    const dragger = blocks.BlockDragger?.prototype;
    if (dragger && !installed.has(dragger)) {
        installed.add(dragger);
        const {startBlockDrag, dragBlock, endBlockDrag} = dragger;
        dragger.startBlockDrag = function (...args) {
            const result = startBlockDrag.apply(this, args);
            try {
                owners.get(this.workspace_)?.dragStarted(this);
            } catch (error) {
                owners.get(this.workspace_)?.onError(error);
            }
            return result;
        };
        dragger.dragBlock = function (event, delta) {
            const result = dragBlock.call(this, event, delta);
            owners.get(this.workspace_)?.dragMoved(this, delta);
            return result;
        };
        dragger.endBlockDrag = function (event, delta) {
            const owner = owners.get(this.workspace_);
            // Move or delete the other scripts in the drag's event group, which the original call closes.
            try {
                owner?.dragEnding(this, event, delta);
            } catch (error) {
                owner?.onError(error);
            }
            return endBlockDrag.call(this, event, delta);
        };
    }
    const block = blocks.BlockSvg?.prototype;
    if (block?.showContextMenu_ && !installed.has(block)) {
        installed.add(block);
        const {showContextMenu_} = block;
        block.showContextMenu_ = function (event) {
            const extra = owners.get(this.workspace)?.blockMenuOption(this);
            if (!extra) return showContextMenu_.call(this, event);
            const {show} = blocks.ContextMenu;
            blocks.ContextMenu.show = (menuEvent, options, rtl) => show.call(blocks.ContextMenu, menuEvent, [...options, extra], rtl);
            try {
                return showContextMenu_.call(this, event);
            } finally {
                blocks.ContextMenu.show = show;
            }
        };
    }
}

function createSelection({workspace, blocks, onError, getLocale}) {
    const svg: SVGSVGElement = workspace.getParentSvg();
    const injection: HTMLElement = workspace.getInjectionDiv();
    const document = injection.ownerDocument;
    const window = document.defaultView;
    const mac = isMacPlatform(window.navigator);
    const selected = new Set<string>();
    let companions: {block: SelectableBlock; start: Point}[] = [];
    let marquee: {start: Point; element: HTMLDivElement; remove: boolean; abort: AbortController} | undefined;
    let pendingClear: {start: Point} | undefined;

    const readOnly = () => Boolean(workspace.options?.readOnly);
    const blockAt = (target: EventTarget | null): SelectableBlock | undefined => {
        const node = (target as Element | null)?.closest?.('[data-id]');
        const id = node?.getAttribute('data-id');
        const block = id ? workspace.getBlockById(id) as SelectableBlock | null : null;
        return block && !block.getSvgRoot()?.closest('[data-tw-plus-hidden]') ? block.getRootBlock() : undefined;
    };
    const isBackground = (target: EventTarget | null) => {
        const element = target as Element | null;
        return element === svg || Boolean(element?.classList?.contains('blocklyMainBackground'));
    };
    const visibleTops = () => (workspace.getTopBlocks(false) as SelectableBlock[]).filter(block => {
        const root = block.getSvgRoot();
        return root && root.getClientRects().length && !root.closest('[data-tw-plus-hidden]');
    });

    function paint() {
        for (const element of svg.querySelectorAll(`.${selectedClass}`)) {
            const id = element.getAttribute('data-id');
            if (!id || !selected.has(id)) element.classList.remove(selectedClass);
        }
        for (const id of selected) workspace.getBlockById(id)?.getSvgRoot()?.classList.add(selectedClass);
        injection.toggleAttribute('data-tw-plus-script-selection', selected.size > 0);
    }

    /** Keep only scripts that are still on the workspace and still start a stack. */
    function prune() {
        let changed = false;
        for (const id of [...selected]) {
            const block = workspace.getBlockById(id) as SelectableBlock | null;
            if (!block || block.getParent()) {
                selected.delete(id);
                changed = true;
            }
        }
        if (changed) paint();
    }

    function set(ids: Iterable<string>) {
        selected.clear();
        for (const id of ids) selected.add(id);
        paint();
    }

    function toggle(block: SelectableBlock) {
        if (selected.has(block.id)) selected.delete(block.id);
        else selected.add(block.id);
        paint();
    }

    const clear = () => {
        if (selected.size) set([]);
    };

    function deletable(): SelectableBlock[] {
        prune();
        return [...selected].map(id => workspace.getBlockById(id) as SelectableBlock | null)
            .filter((block): block is SelectableBlock => Boolean(block?.isDeletable()));
    }

    /** Undo an edit that left calls to a function without its definition, as Scratch does for one script. */
    function rollBackOrphans(before: Set<string>) {
        window.setTimeout(() => {
            const after = orphanCalls(workspace);
            if (![...after].some(code => !before.has(code))) return;
            window.alert(blocks.Msg?.PROCEDURE_USED ?? 'This function is in use.');
            workspace.undo(false);
        });
    }

    function deleteSelected() {
        const targets = deletable();
        if (!targets.length || readOnly()) return;
        const before = orphanCalls(workspace);
        blocks.hideChaff?.();
        blocks.Events.setGroup(true);
        try {
            for (const block of targets) block.dispose(false, true);
        } finally {
            blocks.Events.setGroup(false);
        }
        set([]);
        rollBackOrphans(before);
    }

    function startMarquee(event: MouseEvent) {
        const abort = new window.AbortController();
        const element = document.createElement('div');
        element.className = marqueeClass;
        element.setAttribute('aria-hidden', 'true');
        injection.append(element);
        marquee = {start: {x: event.clientX, y: event.clientY}, element, remove: event.altKey, abort};
        const place = (point: Point) => {
            const rect = rectFromCorners(marquee.start, point);
            const origin = injection.getBoundingClientRect();
            Object.assign(element.style, {left: `${rect.left - origin.left}px`, top: `${rect.top - origin.top}px`,
                width: `${rect.right - rect.left}px`, height: `${rect.bottom - rect.top}px`});
            return rect;
        };
        place(marquee.start);
        const options = {capture: true, signal: abort.signal};
        document.addEventListener('mousemove', move => {
            move.preventDefault();
            place({x: move.clientX, y: move.clientY});
        }, options);
        document.addEventListener('mouseup', up => {
            up.preventDefault();
            up.stopPropagation();
            finishMarquee(place({x: up.clientX, y: up.clientY}));
        }, options);
        window.addEventListener('blur', () => finishMarquee(undefined), options);
    }

    function finishMarquee(rect: Rect | undefined) {
        if (!marquee) return;
        const {element, remove, abort} = marquee;
        marquee = undefined;
        abort.abort();
        element.remove();
        if (!rect || (rect.right - rect.left < 3 && rect.bottom - rect.top < 3)) return;
        const hits = visibleTops().filter(block => intersects(rect, block.getSvgRoot().getBoundingClientRect())).map(block => block.id);
        if (remove) for (const id of hits) selected.delete(id);
        else for (const id of hits) selected.add(id);
        paint();
    }

    function onMouseDown(event: MouseEvent) {
        if (readOnly() || event.button !== 0) return;
        activeWorkspace = workspace;
        prune();
        if (isToggleClick(event, mac)) {
            const block = blockAt(event.target);
            if (!block) return;
            // Keep Blockly from starting a gesture, which would run the script on click.
            event.preventDefault();
            event.stopPropagation();
            blocks.hideChaff?.();
            toggle(block);
            return;
        }
        if (event.shiftKey && isBackground(event.target)) {
            event.preventDefault();
            event.stopPropagation();
            blocks.hideChaff?.();
            startMarquee(event);
            return;
        }
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
        const block = blockAt(event.target);
        if (block) {
            if (!selected.has(block.id)) clear();
        } else if (isBackground(event.target)) {
            // Dragging the background scrolls; only a click clears.
            pendingClear = {start: {x: event.clientX, y: event.clientY}};
        }
    }

    function onMouseUp(event: MouseEvent) {
        if (!pendingClear) return;
        const {start} = pendingClear;
        pendingClear = undefined;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) clear();
    }

    function onKeyDown(event: KeyboardEvent) {
        if (activeWorkspace !== workspace || !selected.size || !svg.isConnected || !svg.getClientRects().length) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
        if (event.key === 'Escape') {
            clear();
            return;
        }
        if ((event.key !== 'Delete' && event.key !== 'Backspace') || event.ctrlKey || event.metaKey || event.altKey) return;
        if (readOnly() || workspace.isDragging?.() || !deletable().length) return;
        // Blockly's own handler would delete only its selected block.
        event.preventDefault();
        event.stopImmediatePropagation();
        deleteSelected();
    }

    const abort = new window.AbortController();
    svg.addEventListener('mousedown', onMouseDown, {capture: true, signal: abort.signal});
    document.addEventListener('mouseup', onMouseUp, {capture: true, signal: abort.signal});
    window.addEventListener('keydown', onKeyDown, {capture: true, signal: abort.signal});
    const listener = workspace.addChangeListener(() => prune());

    return {
        onError,
        get ids() {
            prune();
            return [...selected];
        },
        set,
        clear,
        deleteSelected,
        dragStarted(dragger) {
            companions = [];
            const dragged = dragger.draggingBlock_ as SelectableBlock;
            if (!selected.has(dragged.id) || dragged.getParent()) {
                // Dragging an unselected script, or a part pulled out of a selected one, moves only that.
                if (!selected.has(dragged.id)) clear();
                return;
            }
            prune();
            companions = [...selected].filter(id => id !== dragged.id)
                .map(id => workspace.getBlockById(id) as SelectableBlock | null)
                .filter((block): block is SelectableBlock => Boolean(block && block.isMovable?.() !== false))
                .map(block => ({block, start: block.getRelativeToSurfaceXY()}));
        },
        dragMoved(dragger, delta: Point) {
            if (!companions.length) return;
            const offset = dragger.pixelsToWorkspaceUnits_(delta);
            for (const {block, start} of companions) block.translate(start.x + offset.x, start.y + offset.y);
        },
        dragEnding(dragger, event, delta: Point) {
            const moving = companions;
            companions = [];
            if (!moving.length) return;
            // The original call refreshes this state first; do the same so the decision matches.
            dragger.dragBlock(event, delta);
            const offset = dragger.pixelsToWorkspaceUnits_(delta);
            for (const {block, start} of moving) block.translate(start.x, start.y);
            if (dragger.wouldDeleteBlock_) {
                const before = orphanCalls(workspace);
                for (const {block} of moving) if (block.isDeletable()) block.dispose(false, true);
                set([]);
                rollBackOrphans(before);
            } else {
                // A drop outside the blocks area is undone as one group by Blockly, these moves included.
                for (const {block} of moving) block.moveBy(offset.x, offset.y);
            }
        },
        blockMenuOption(block: SelectableBlock) {
            if (readOnly() || !selected.has(block.getRootBlock().id)) return undefined;
            const count = deletable().length;
            if (!count) return undefined;
            return {text: labels(getLocale(), count).remove, enabled: true, callback: deleteSelected};
        },
        dispose() {
            finishMarquee(undefined);
            abort.abort();
            workspace.removeChangeListener(listener);
            set([]);
            injection.removeAttribute('data-tw-plus-script-selection');
            if (activeWorkspace === workspace) activeWorkspace = null;
        }
    };
}

/** Lets scripts in a free-layout workspace be selected, moved and deleted together. */
export function attachScriptSelection({workspace, ScratchBlocks: blocks, vm, onError = (error: unknown) => console.error(error),
    getLocale = () => blocks.ScratchMsgs?.currentLocale_ ?? ''}: {
    workspace; ScratchBlocks; onError?: (error: unknown) => void; getLocale?: () => string;
    /** Clears the selection when the workspace loads another sprite or the stage. */
    vm?: {on(name: string, listener: () => void): void; removeListener(name: string, listener: () => void): void};
}) {
    installHooks(blocks);
    owners.get(workspace)?.dispose();
    const selection = createSelection({workspace, blocks, onError, getLocale});
    owners.set(workspace, selection);
    const clearOnLoad = () => selection.clear();
    vm?.on('workspaceUpdate', clearOnLoad);
    return {
        /** The ids of the selected scripts' top blocks. */
        get selected() {
            return selection.ids;
        },
        select(ids: Iterable<string>) {
            selection.set(ids);
        },
        clear: selection.clear,
        deleteSelected: selection.deleteSelected,
        dispose() {
            vm?.removeListener('workspaceUpdate', clearOnLoad);
            if (owners.get(workspace) !== selection) return;
            owners.delete(workspace);
            selection.dispose();
        }
    };
}
