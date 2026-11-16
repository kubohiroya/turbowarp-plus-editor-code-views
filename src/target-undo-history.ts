/**
 * Keep the code area's undo history for each sprite and the stage.
 *
 * The GUI reloads the code area for every editing target change and calls `clearUndo()` right after,
 * so switching to another sprite and back loses what could be undone. This keeps the stacks the code
 * area had for the target it showed, and gives them back when that target is shown again.
 *
 * Undo events find blocks by ID in the reloaded code area, so a history is given back only when the
 * target's code is still what it was when the history was put aside. Anything that changed the code
 * meanwhile, such as an edit in a code window, a script dropped onto the sprite or a renamed
 * variable, drops that history, as the GUI always did.
 */

interface UndoEvent {
    group?: string;
}

export interface UndoWorkspace {
    undoStack_: UndoEvent[];
    redoStack_: UndoEvent[];
    listeners_?: unknown[];
    clearUndo(): void;
}

interface HistoryTarget {
    id: string;
    isStage?: boolean;
    blocks: {toXML(comments: Record<string, unknown>): string};
    comments: Record<string, {blockId: string | null; toXML(): string}>;
    variables: Record<string, {type?: string; toXML(local?: boolean): string}>;
}

export interface UndoHistoryVM {
    editingTarget: HistoryTarget | null;
    blockListener: unknown;
    runtime: {
        getTargetById(id: string): HistoryTarget | undefined;
        getTargetForStage(): HistoryTarget | undefined;
    };
}

export interface UndoHistoryBlocks {
    Workspace: {prototype: Pick<UndoWorkspace, 'clearUndo'>};
}

interface StoredHistory {
    workspace: UndoWorkspace;
    signature: string;
    undo: UndoEvent[];
    redo: UndoEvent[];
}

/**
 * What a target's undo events depend on: its blocks and comments, and the variables they name.
 * Broadcast messages are left out, because the VM removes unused ones whenever it reloads the code area.
 */
export function historySignature(vm: Pick<UndoHistoryVM, 'runtime'>, target: HistoryTarget) {
    const stage = vm.runtime.getTargetForStage();
    const variables = (owner: HistoryTarget | undefined, local: boolean) => owner ?
        Object.entries(owner.variables).filter(([, variable]) => variable.type !== 'broadcast_msg')
            .map(([id, variable]) => `${id}:${variable.toXML(local)}`).join('') : '';
    const workspaceComments = Object.values(target.comments).filter(comment => comment.blockId === null)
        .map(comment => comment.toXML()).join('');
    return [
        target.blocks.toXML(target.comments),
        workspaceComments,
        variables(stage, false),
        target.isStage ? '' : variables(target, true)
    ].join('\n');
}

/**
 * Patch `clearUndo()` of the given ScratchBlocks so the code area connected to `vm` keeps one undo
 * history per target. Only the workspace that sends its events to `vm.blockListener` is affected;
 * the palette, previews and code windows keep the original behaviour.
 * @returns Something to dispose, which puts the original `clearUndo()` back.
 */
export function installTargetUndoHistory(vm: UndoHistoryVM, ScratchBlocks: UndoHistoryBlocks) {
    const prototype = ScratchBlocks.Workspace.prototype;
    const clearUndo = prototype.clearUndo;
    const histories = new WeakMap<HistoryTarget, StoredHistory>();
    // The target each code area showed when its history was last cleared.
    const shown = new WeakMap<UndoWorkspace, HistoryTarget>();
    const exists = (target: HistoryTarget) => vm.runtime.getTargetById(target.id) === target;

    const patched = function (this: UndoWorkspace) {
        if (!this.listeners_?.includes(vm.blockListener)) return clearUndo.call(this);
        const previous = shown.get(this);
        const next = vm.editingTarget;
        if (previous && previous !== next && exists(previous) &&
                (this.undoStack_.length || this.redoStack_.length)) {
            histories.set(previous, {
                workspace: this,
                signature: historySignature(vm, previous),
                undo: this.undoStack_.slice(),
                redo: this.redoStack_.slice()
            });
        }
        clearUndo.call(this);
        if (!next) {
            shown.delete(this);
            return;
        }
        shown.set(this, next);
        // Reloading the same target means its code changed under the code area: start over, as before.
        if (next === previous) return;
        const stored = histories.get(next);
        histories.delete(next);
        if (stored?.workspace === this && stored.signature === historySignature(vm, next)) {
            this.undoStack_.push(...stored.undo);
            this.redoStack_.push(...stored.redo);
        }
    };
    prototype.clearUndo = patched;
    return {
        dispose() {
            if (prototype.clearUndo === patched) prototype.clearUndo = clearUndo;
        }
    };
}

/**
 * Keep the code area's undo history per target once ScratchBlocks has loaded. This takes the context
 * the GUI hands to the host's `attachToWorkspace`.
 * @returns Something to dispose.
 */
export function attachTargetUndoHistory({vm, getBlockly, onError = error => console.error(error)}: {
    vm: UndoHistoryVM;
    getBlockly(): Promise<UndoHistoryBlocks>;
    onError?: (error: unknown) => void;
}) {
    let disposed = false;
    let installed: {dispose(): void} | undefined;
    const ready = Promise.resolve().then(getBlockly).then(ScratchBlocks => {
        if (!disposed) installed = installTargetUndoHistory(vm, ScratchBlocks);
    }, onError);
    return {
        ready,
        dispose() {
            disposed = true;
            installed?.dispose();
            installed = undefined;
        }
    };
}
