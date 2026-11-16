/**
 * Let "Restore Sprite" go back through more than the last deleted sprite.
 *
 * The GUI keeps one restore function in `scratchGui.restoreDeletion` and replaces it on every deletion,
 * so only the last deleted sprite can be restored. This keeps the restore functions of earlier sprite
 * deletions, and when the menu has used one and cleared the slot, it puts the previous one back.
 * Nothing is added to the project: each restore function holds the deleted sprite itself.
 */

export const RESTORE_UPDATE = 'scratch-gui/restore-deletion/RESTORE_UPDATE';
const sprite = 'Sprite';

/** How many deleted sprites can be restored, the one in the GUI's slot included. */
export const spriteRestoreLimit = 10;

type RestoreFunction = () => unknown;
interface RestoreDeletion {
    restoreFun: RestoreFunction | null;
    deletedItem: string;
}

export interface RestoreStore {
    getState(): {scratchGui: {restoreDeletion: RestoreDeletion}};
    dispatch(action: {type: string; state: RestoreDeletion}): unknown;
    subscribe(listener: () => void): () => void;
}

interface ProjectEvents {
    runtime: {
        on(event: 'PROJECT_LOADED', listener: () => void): unknown;
        removeListener(event: 'PROJECT_LOADED', listener: () => void): unknown;
    };
}

/**
 * Keep up to `limit` sprite restore functions for the GUI's store. Pass `vm` to forget the earlier ones
 * when another project is loaded; the one in the GUI's slot stays, as it did before.
 * @returns Something to dispose, plus `count()` for the number of sprites that can be restored.
 */
export function attachSpriteRestoreHistory({store, vm, limit = spriteRestoreLimit}: {
    store: RestoreStore;
    vm?: ProjectEvents;
    limit?: number;
}) {
    const read = () => store.getState().scratchGui.restoreDeletion;
    // Oldest first. The last one is the one in the GUI's slot, or the next to put back there.
    const stack: RestoreFunction[] = [];
    let last = read();
    if (last.restoreFun && last.deletedItem === sprite) stack.push(last.restoreFun);

    const update = () => {
        const current = read();
        if (current.restoreFun === last.restoreFun && current.deletedItem === last.deletedItem) return;
        const previous = last;
        last = current;
        if (current.restoreFun) {
            if (current.deletedItem !== sprite) return;
            const index = stack.indexOf(current.restoreFun);
            if (index >= 0) {
                // A restore function already kept came back to the slot: TurboWarp's delete
                // confirmation puts the slot back as it was when the user cancels. The ones kept
                // after it belong to deletions that did not happen.
                stack.splice(index + 1);
                return;
            }
            stack.push(current.restoreFun);
            if (stack.length > Math.max(1, limit)) stack.splice(0, stack.length - Math.max(1, limit));
            return;
        }
        // The menu restored what the slot held and cleared it.
        const used = previous.restoreFun ? stack.indexOf(previous.restoreFun) : -1;
        if (used >= 0) stack.splice(used, 1);
        const next = stack.at(-1);
        if (next) store.dispatch({type: RESTORE_UPDATE, state: {restoreFun: next, deletedItem: sprite}});
    };
    const unsubscribe = store.subscribe(update);

    const projectLoaded = () => {
        const {restoreFun} = read();
        stack.length = 0;
        if (restoreFun && read().deletedItem === sprite) stack.push(restoreFun);
    };
    vm?.runtime.on('PROJECT_LOADED', projectLoaded);

    return {
        count: () => stack.length,
        dispose() {
            unsubscribe();
            vm?.runtime.removeListener('PROJECT_LOADED', projectLoaded);
            stack.length = 0;
        }
    };
}
