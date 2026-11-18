export const minimumCodeScale = 0.02;

type ZoomWorkspace = {options?: {zoomOptions?: {minScale?: number}}};
const ranges = new WeakMap<object, {users: number; previous?: number; minimum: number}>();

/** The code area and its previews share a lower zoom limit without changing Blockly's other workspaces. */
export function attachCodeZoomRange(workspace: object) {
    const options = (workspace as ZoomWorkspace).options?.zoomOptions;
    if (!options) return () => {};
    let range = ranges.get(workspace);
    if (!range) {
        range = {users: 0, previous: options.minScale, minimum: Math.min(options.minScale || 1, minimumCodeScale)};
        ranges.set(workspace, range);
        options.minScale = range.minimum;
    }
    range.users++;
    let disposed = false;
    return () => {
        if (disposed) return;
        disposed = true;
        if (--range.users) return;
        if (options.minScale === range.minimum) {
            if (range.previous === undefined) delete options.minScale;
            else options.minScale = range.previous;
        }
        ranges.delete(workspace);
    };
}
