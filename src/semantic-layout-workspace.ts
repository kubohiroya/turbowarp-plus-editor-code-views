import {readScripts, type LayoutBlock, type LayoutEvents, type LayoutWorkspace, type RenderedScript} from './script-layout-workspace.ts';
import type {ScriptBounds} from './script-layout.ts';
import type {SemanticPlacement} from './semantic-script-layout.ts';

type Point = {x: number; y: number};
export interface LayoutComment {
    id: string;
    block_?: LayoutBlock & {getRootBlock(): LayoutBlock};
    getXY?(): Point;
    getRelativeToSurfaceXY?(): Point;
    getBoundingRectangle(): {topLeft: Point; bottomRight: Point};
    moveTo?(x: number, y: number): void;
    getText?(): string;
    getSvgRoot?(): SVGElement;
    bubble_?: {bubbleGroup_?: SVGElement};
}

export type SemanticWorkspace = LayoutWorkspace & {getTopComments?(ordered: boolean): LayoutComment[]};
export type SemanticEvents = LayoutEvents & {
    FIRE_QUEUE_?: {type?: string; commentId?: string; recordUndo?: boolean}[];
    disable?(): void;
    enable?(): void;
};

export interface CommentSnapshot extends ScriptBounds {
    comment: LayoutComment;
    rootId?: string;
    origin: Point;
    text: string;
    svg?: SVGElement;
}
export interface SemanticScript extends RenderedScript {
    /** Full script rectangle before attached comments are included. */
    bounds: ScriptBounds;
}

/** Read expanded bounds without changing the user's folding or moving any comments. */
export function readSemanticWorkspace(workspace: SemanticWorkspace) {
    const scripts: SemanticScript[] = readScripts(workspace).map(script => {
        const {topLeft, bottomRight} = script.block.getBoundingRectangle();
        const bounds = {id: script.id, ...topLeft, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y};
        return {...script, ...bounds, bounds};
    });
    const byId = new Map(scripts.map(s => [s.id, s]));
    const comments: CommentSnapshot[] = (workspace.getTopComments?.(false) ?? []).map(comment => {
        const {topLeft, bottomRight} = comment.getBoundingRectangle();
        const rootId = comment.block_?.getRootBlock().id;
        if (rootId && (!comment.getXY || !comment.moveTo)) throw new Error('Comment cannot be moved safely');
        return {id: comment.id, comment, rootId, origin: comment.getXY?.() ?? comment.getRelativeToSurfaceXY?.() ?? topLeft,
            text: comment.getText?.() ?? '',
            ...topLeft, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y,
            svg: comment.getSvgRoot?.() ?? comment.bubble_?.bubbleGroup_};
    });
    for (const comment of comments) {
        const script = byId.get(comment.rootId);
        if (!script) continue;
        const right = Math.max(script.x + script.width, comment.x + comment.width);
        const bottom = Math.max(script.y + script.height, comment.y + comment.height);
        script.x = Math.min(script.x, comment.x); script.y = Math.min(script.y, comment.y);
        script.width = right - script.x; script.height = bottom - script.y;
    }
    return {scripts, comments, obstacles: comments.filter(c => !byId.has(c.rootId))};
}

/** Roll back queued native moves before any of them reach the VM or the undo stacks. */
export function applySemanticLayout(workspace: SemanticWorkspace, events: SemanticEvents,
    placements: SemanticPlacement<SemanticScript>[], comments: CommentSnapshot[]) {
    const outer = events.getGroup();
    const queue = events.FIRE_QUEUE_;
    if (!queue || !events.disable || !events.enable) throw new Error('Transactional move events are unavailable');
    const start = queue.length;
    const roots = placements.map(p => ({block: p.script.block, position: p.script.block.getRelativeToSurfaceXY()}));
    const byId = new Map(placements.map(p => [p.script.id, p]));
    events.setGroup(true);
    workspace.setResizesEnabled(false);
    try {
        for (const p of placements) {
            const dx = p.x - p.script.x, dy = p.y - p.script.y;
            if (dx || dy) p.script.block.moveBy(dx, dy);
        }
        for (const c of comments) {
            const p = byId.get(c.rootId);
            if (!p) continue;
            c.comment.moveTo!(c.origin.x + p.x - p.script.x, c.origin.y + p.y - p.script.y);
        }
        // Native block moves already carry their attached comments on undo/redo. Recording an
        // absolute comment move as well would move it twice on redo. Keep the notification for
        // the VM (including child-window serialization), but let the block own its undo step.
        const attached = new Set(comments.filter(c => byId.has(c.rootId)).map(c => c.id));
        for (const event of queue.slice(start)) {
            if (event.type === 'comment_move' && attached.has(event.commentId)) event.recordUndo = false;
        }
    } catch (error) {
        queue.splice(start);
        events.disable();
        try {
            for (const {block, position} of roots) {
                const current = block.getRelativeToSurfaceXY();
                block.moveBy(position.x - current.x, position.y - current.y);
            }
            for (const c of comments) if (byId.has(c.rootId)) c.comment.moveTo!(c.origin.x, c.origin.y);
        } finally {events.enable();}
        throw error;
    } finally {
        workspace.setResizesEnabled(true);
        events.setGroup(outer);
    }
    events.fireNow_();
}
