/**
 * Comments in "Clean up blocks".
 *
 * The code area's "Clean up blocks" runs `WorkspaceSvg.prototype.cleanUp`. In the GUI that is the editor-devtools
 * addon's column layout unless the user turned it off, and scratch-blocks' single column otherwise. Neither keeps
 * the comments in step with the scripts: the addon hides and shows every block comment so that scratch-blocks puts
 * it again at its default place beside the block, which the VM does not hear of, and both lay the scripts out by
 * the blocks alone, so a comment can cover the next script. Workspace comments are not moved at all.
 *
 * This wraps whichever `cleanUp` is in place, now or later. Before it runs, every block comment's offset from its
 * block is read. After it runs, the scripts are pushed apart where a script and its comments would cover the next
 * one, every block comment is put back at its offset from its block, and a workspace comment that covers a script
 * is moved to a column beside the scripts. Every move goes through scratch-blocks, so the VM hears of it and the
 * saved project keeps the positions.
 */

interface Point {
    x: number;
    y: number;
}

export interface Rect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** A script with its block comments, as it stands after the wrapped clean-up. */
export interface ScriptCluster {
    id: string;
    /** Where the wrapped clean-up put the top block. */
    x: number;
    y: number;
    /** The script and its block comments together. */
    rect: Rect;
}

export interface LooseComment {
    id: string;
    rect: Rect;
}

/** Room left between a script and what it would otherwise cover. */
export const cleanUpGap = 32;

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const shifted = (rect: Rect, dx: number, dy: number): Rect =>
    ({left: rect.left + dx, top: rect.top + dy, right: rect.right + dx, bottom: rect.bottom + dy});

/**
 * How far to move each script so that no script with its comments covers another.
 * The clean-up's columns are kept: scripts that start at the same x form a column, read from left to right and
 * each from top to bottom. A script that would cover the one above it moves down, and every script below it with
 * it; a column that would cover the columns to its left moves right, and every column after it with it. Where
 * nothing is covered nothing moves, so the clean-up's own spacing stays.
 * @param {ScriptCluster[]} clusters The scripts after the clean-up.
 * @param {number} gap Room left between a script and the next.
 * @returns {Map<string, Point>} The offset of each script that moves.
 */
export function separateClusters(clusters: readonly ScriptCluster[], gap = cleanUpGap): Map<string, Point> {
    const columns = new Map<number, ScriptCluster[]>();
    for (const cluster of clusters) {
        const column = columns.get(cluster.x);
        if (column) column.push(cluster);
        else columns.set(cluster.x, [cluster]);
    }
    const moves = new Map<string, Point>();
    let shiftX = 0;
    let rightEdge = -Infinity;
    for (const x of [...columns.keys()].sort((a, b) => a - b)) {
        const column = columns.get(x).sort((a, b) => a.y - b.y || a.rect.top - b.rect.top || (a.id < b.id ? -1 : 1));
        const left = Math.min(...column.map(cluster => cluster.rect.left));
        if (left + shiftX < rightEdge + gap) shiftX = rightEdge + gap - left;
        let shiftY = 0;
        let bottomEdge = -Infinity;
        for (const cluster of column) {
            if (cluster.rect.top + shiftY < bottomEdge + gap) shiftY = bottomEdge + gap - cluster.rect.top;
            bottomEdge = cluster.rect.bottom + shiftY;
            rightEdge = Math.max(rightEdge, cluster.rect.right + shiftX);
            if (shiftX || shiftY) moves.set(cluster.id, {x: shiftX, y: shiftY});
        }
    }
    return moves;
}

/**
 * Where to put the workspace comments that cover a script.
 * A comment that covers nothing stays. The others go, in reading order, into a column to the right of the scripts
 * and of the comments that stay, from the top of the scripts down.
 * @param {Rect[]} scripts The scripts with their block comments, where they end up.
 * @param {LooseComment[]} comments The workspace comments.
 * @param {number} gap Room left around a moved comment.
 * @returns {Map<string, Point>} The offset of each comment that moves.
 */
export function placeLooseComments(scripts: readonly Rect[], comments: readonly LooseComment[], gap = cleanUpGap) {
    const moves = new Map<string, Point>();
    const covering = comments.filter(comment => scripts.some(script => overlaps(script, comment.rect)));
    if (!covering.length) return moves;
    const staying = comments.filter(comment => !covering.includes(comment)).map(comment => comment.rect);
    const occupied = [...scripts, ...staying];
    const x = Math.max(...occupied.map(rect => rect.right)) + gap;
    let y = scripts.length ? Math.min(...scripts.map(rect => rect.top)) : 0;
    const ordered = [...covering].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left ||
        (a.id < b.id ? -1 : 1));
    for (const comment of ordered) {
        moves.set(comment.id, {x: x - comment.rect.left, y: y - comment.rect.top});
        y += comment.rect.bottom - comment.rect.top + gap;
    }
    return moves;
}

// Shapes from scratch-blocks core/block_svg.js, scratch_block_comment.js and workspace_comment_svg.js, reduced to
// what the wrapper reads.
interface Bounds {
    topLeft: Point;
    bottomRight: Point;
}

interface CleanUpBlock {
    id: string;
    workspace: unknown;
    getRelativeToSurfaceXY(): Point;
    getBoundingRectangle(): Bounds;
    getRootBlock(): CleanUpBlock;
    moveBy(dx: number, dy: number): void;
}

interface CleanUpComment {
    id: string;
    workspace: unknown;
    /** Only a block comment has its block. */
    block_?: CleanUpBlock;
    getXY?(): Point;
    getRelativeToSurfaceXY?(): Point;
    getBoundingRectangle(): Bounds;
    moveTo?(x: number, y: number): void;
    moveBy?(dx: number, dy: number): void;
}

interface CleanUpWorkspace {
    RTL?: boolean;
    isFlyout?: boolean;
    getTopBlocks(ordered: boolean): CleanUpBlock[];
    getTopComments?(ordered: boolean): CleanUpComment[];
    setResizesEnabled?(enabled: boolean): void;
}

interface CleanUpEvents {
    getGroup(): string;
    setGroup(group: string | boolean): void;
    FIRE_QUEUE_?: {group?: string}[];
}

type CleanUp = (this: CleanUpWorkspace, ...args: unknown[]) => unknown;

const toRect = ({topLeft, bottomRight}: Bounds): Rect =>
    ({left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y});
const union = (a: Rect, b: Rect): Rect => ({left: Math.min(a.left, b.left), top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom)});
const alive = (item: {workspace: unknown} | undefined) => Boolean(item?.workspace);
const isBlockComment = (comment: CleanUpComment) => Boolean(comment.block_);

interface Attached {
    comment: CleanUpComment;
    block: CleanUpBlock;
    offset: Point;
}

/**
 * Read each block comment's offset from its block.
 * @param {object} workspace The workspace about to be cleaned up.
 * @returns {Attached[]} The block comments with their offsets.
 */
function readAttached(workspace: CleanUpWorkspace): Attached[] {
    return (workspace.getTopComments?.(false) ?? []).flatMap(comment => {
        const block = comment.block_;
        if (!block || !alive(block) || !comment.getXY || !comment.moveTo) return [];
        const commentXY = comment.getXY();
        const blockXY = block.getRelativeToSurfaceXY();
        return [{comment, block, offset: {x: commentXY.x - blockXY.x, y: commentXY.y - blockXY.y}}];
    });
}

/**
 * Lay out the scripts and comments again after the wrapped clean-up.
 * @param {object} workspace The cleaned-up workspace.
 * @param {Attached[]} attached The block comments read before the clean-up.
 * @param {object} events `ScratchBlocks.Events`.
 */
function followUp(workspace: CleanUpWorkspace, attached: Attached[], events: CleanUpEvents | undefined) {
    const kept = attached.filter(({comment, block}) => alive(comment) && alive(block));
    const placed = (item: Attached) => {
        const blockXY = item.block.getRelativeToSurfaceXY();
        return {x: blockXY.x + item.offset.x, y: blockXY.y + item.offset.y};
    };
    const commentRect = (item: Attached): Rect => {
        const rect = toRect(item.comment.getBoundingRectangle());
        const {x, y} = placed(item);
        return {left: x, top: y, right: x + rect.right - rect.left, bottom: y + rect.bottom - rect.top};
    };

    const scripts = workspace.getTopBlocks(false).filter(alive);
    const clusters = scripts.map(block => {
        const {x, y} = block.getRelativeToSurfaceXY();
        let rect = toRect(block.getBoundingRectangle());
        for (const item of kept) {
            if (item.block.getRootBlock() === block) rect = union(rect, commentRect(item));
        }
        return {id: block.id, x, y, rect, block};
    });
    const scriptMoves = separateClusters(clusters);

    // Join the clean-up's undo group, which scratch-blocks has already closed by now, so that one undo takes back
    // the clean-up and these moves together.
    const outer = events?.getGroup() ?? '';
    const group = outer || events?.FIRE_QUEUE_?.at(-1)?.group || true;
    events?.setGroup(group);
    workspace.setResizesEnabled?.(false);
    try {
        for (const cluster of clusters) {
            const move = scriptMoves.get(cluster.id);
            if (move) cluster.block.moveBy(move.x, move.y);
        }
        // scratch-blocks moves an open comment with its block, but the addon's clean-up puts it back beside the
        // block; put every one back where it was from its block, which also tells the VM where it is.
        for (const item of kept) {
            const {x, y} = placed(item);
            item.comment.moveTo(x, y);
        }
        const loose = (workspace.getTopComments?.(false) ?? [])
            .filter(comment => alive(comment) && !isBlockComment(comment) && comment.moveBy);
        const looseMoves = placeLooseComments(
            clusters.map(({id, rect}) => {
                const move = scriptMoves.get(id);
                return move ? shifted(rect, move.x, move.y) : rect;
            }),
            loose.map(comment => ({id: comment.id, rect: toRect(comment.getBoundingRectangle())}))
        );
        for (const comment of loose) {
            const move = looseMoves.get(comment.id);
            if (move) comment.moveBy(move.x, move.y);
        }
    } finally {
        workspace.setResizesEnabled?.(true);
        events?.setGroup(outer);
    }
}

const installed = new WeakSet<object>();

/**
 * Keep comments with their scripts in "Clean up blocks".
 * `WorkspaceSvg.prototype.cleanUp` becomes an accessor, so a `cleanUp` that an addon puts there later is wrapped
 * too. A workspace that is given its own `cleanUp` keeps it as its own, unwrapped. Workspaces laid out right to
 * left are cleaned up as before.
 * @param {object} ScratchBlocks The loaded ScratchBlocks.
 */
export const installCleanUpComments = ScratchBlocks => {
    const prototype = ScratchBlocks?.WorkspaceSvg?.prototype;
    if (!prototype || installed.has(prototype) || typeof prototype.cleanUp !== 'function') return;
    installed.add(prototype);

    const events: CleanUpEvents | undefined = ScratchBlocks.Events;
    const wrappers = new WeakMap<CleanUp, CleanUp>();
    let running = false;
    const wrap = (cleanUp: CleanUp): CleanUp => {
        if (typeof cleanUp !== 'function') return cleanUp;
        let wrapper = wrappers.get(cleanUp);
        if (wrapper) return wrapper;
        wrapper = function (this: CleanUpWorkspace, ...args: unknown[]) {
            // An addon's clean-up can call the one it replaced, which is wrapped as well.
            if (running || this.RTL || this.isFlyout) return cleanUp.apply(this, args);
            const attached = readAttached(this);
            running = true;
            let result: unknown;
            try {
                result = cleanUp.apply(this, args);
            } finally {
                running = false;
            }
            followUp(this, attached, events);
            return result;
        };
        wrappers.set(cleanUp, wrapper);
        return wrapper;
    };

    let current: CleanUp = prototype.cleanUp;
    Object.defineProperty(prototype, 'cleanUp', {
        configurable: true,
        enumerable: false,
        get () {
            return wrap(current);
        },
        set (value: CleanUp) {
            if (this === prototype) {
                current = value;
                return;
            }
            // Assigning to a workspace gives it its own clean-up, as it did before this accessor.
            Object.defineProperty(this, 'cleanUp', {value, writable: true, configurable: true, enumerable: true});
        }
    });
};
