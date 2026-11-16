import assert from 'node:assert/strict';
import {test} from 'node:test';
import {installCleanUpComments, placeLooseComments, separateClusters} from '../dist/clean-up-comments.js';

const rect = (left: number, top: number, width: number, height: number) =>
    ({left, top, right: left + width, bottom: top + height});

test('scripts that cover nothing stay where the clean-up put them', () => {
    const moves = separateClusters([
        {id: 'a', x: 0, y: 0, rect: rect(0, 0, 100, 50)},
        {id: 'b', x: 0, y: 100, rect: rect(0, 100, 100, 50)}
    ]);
    assert.equal(moves.size, 0);
});

test('a script under one whose comment reaches down moves down, and the scripts below it with it', () => {
    const moves = separateClusters([
        {id: 'a', x: 0, y: 0, rect: rect(0, 0, 300, 200)},
        {id: 'b', x: 0, y: 100, rect: rect(0, 100, 100, 50)},
        {id: 'c', x: 0, y: 300, rect: rect(0, 300, 100, 50)}
    ], 32);
    assert.deepEqual(moves.get('b'), {x: 0, y: 132});
    assert.deepEqual(moves.get('c'), {x: 0, y: 132});
    assert.equal(moves.has('a'), false);
});

test('a column that a comment of the column before reaches moves right, and the columns after it with it', () => {
    const moves = separateClusters([
        {id: 'a', x: 0, y: 0, rect: rect(0, 0, 400, 50)},
        {id: 'b', x: 200, y: 0, rect: rect(200, 0, 100, 50)},
        {id: 'c', x: 500, y: 0, rect: rect(500, 0, 100, 50)}
    ], 32);
    assert.deepEqual(moves.get('b'), {x: 232, y: 0});
    assert.deepEqual(moves.get('c'), {x: 232, y: 0});
});

test('workspace comments that cover a script move into a column beside the scripts; the others stay', () => {
    const moves = placeLooseComments([rect(0, 10, 100, 100), rect(0, 200, 100, 100)], [
        {id: 'over-second', rect: rect(50, 220, 80, 40)},
        {id: 'over-first', rect: rect(10, 20, 80, 40)},
        {id: 'aside', rect: rect(150, 0, 60, 30)}
    ], 32);
    assert.equal(moves.has('aside'), false);
    // Right of the staying comment (150 + 60) and of the scripts.
    assert.deepEqual(moves.get('over-first'), {x: 242 - 10, y: 10 - 20});
    assert.deepEqual(moves.get('over-second'), {x: 242 - 50, y: 10 + 40 + 32 - 220});
});

// Shapes from scratch-blocks core/block_svg.js, scratch_block_comment.js, workspace_comment_svg.js and
// workspace_svg.js, reduced to what the patch reads. `saved` stands for the VM's copy of a comment's position,
// which scratch-blocks updates through comment move events.
function fixture() {
    const groups: (string | boolean)[] = [];
    let group = '';
    const Events = {
        FIRE_QUEUE_: [] as {group: string}[],
        getGroup: () => group,
        setGroup (value: string | boolean) {
            group = value === true ? 'cleanup-group' : value || '';
            groups.push(value);
        }
    };
    class BlockComment {
        id: string;
        block_: Block;
        workspace: Workspace;
        x: number;
        y: number;
        width: number;
        height: number;
        saved: {x: number; y: number};
        constructor (id: string, block: Block, x: number, y: number, width = 200, height = 100) {
            Object.assign(this, {id, block_: block, workspace: block.workspace, x, y, width, height});
            this.saved = {x, y};
            block.comment = this;
            block.workspace.comments.push(this);
        }
        getXY () {
            return {x: this.x, y: this.y};
        }
        getBoundingRectangle () {
            return {topLeft: {x: this.x, y: this.y}, bottomRight: {x: this.x + this.width, y: this.y + this.height}};
        }
        moveTo (x: number, y: number) {
            Object.assign(this, {x, y});
            this.saved = {x, y};
        }
        // The editor-devtools addon hides and shows a comment, which scratch-blocks puts beside its block again
        // without a move event.
        autoPosition () {
            const xy = this.block_.getRelativeToSurfaceXY();
            this.x = xy.x + this.block_.width + 32;
            this.y = xy.y;
        }
    }
    class WorkspaceComment {
        id: string;
        workspace: Workspace;
        x: number;
        y: number;
        width: number;
        height: number;
        constructor (id: string, workspace: Workspace, x: number, y: number, width = 200, height = 100) {
            Object.assign(this, {id, workspace, x, y, width, height});
            workspace.comments.push(this);
        }
        getRelativeToSurfaceXY () {
            return {x: this.x, y: this.y};
        }
        getBoundingRectangle () {
            return {topLeft: {x: this.x, y: this.y}, bottomRight: {x: this.x + this.width, y: this.y + this.height}};
        }
        moveBy (dx: number, dy: number) {
            this.x += dx;
            this.y += dy;
        }
    }
    class Block {
        comment?: BlockComment;
        parent?: Block;
        children: Block[] = [];
        id: string;
        workspace: Workspace;
        x: number;
        y: number;
        width: number;
        height: number;
        constructor (id: string, workspace: Workspace, x: number, y: number, width = 100, height = 50) {
            Object.assign(this, {id, workspace, x, y, width, height});
        }
        getRootBlock (): Block {
            return this.parent ? this.parent.getRootBlock() : this;
        }
        getRelativeToSurfaceXY () {
            return {x: this.x, y: this.y};
        }
        getBoundingRectangle () {
            return {topLeft: {x: this.x, y: this.y}, bottomRight: {x: this.x + this.width, y: this.y + this.height}};
        }
        // scratch-blocks moves an open comment's bubble with its anchor and sends a comment move event.
        moveBy (dx: number, dy: number) {
            for (const block of [this, ...this.children]) {
                block.x += dx;
                block.y += dy;
                if (block.comment) block.comment.moveTo(block.comment.x + dx, block.comment.y + dy);
            }
        }
    }
    class Workspace {
        RTL = false;
        blocks: Block[] = [];
        comments: (BlockComment | WorkspaceComment)[] = [];
        resizes: boolean[] = [];
        getTopBlocks () {
            return this.blocks.filter(block => !block.parent);
        }
        getTopComments () {
            return this.comments;
        }
        setResizesEnabled (value: boolean) {
            this.resizes.push(value);
        }
        // scratch-blocks core/workspace_svg.js: one column at x 0.
        cleanUp () {
            Events.setGroup(true);
            let cursorY = 0;
            for (const block of this.getTopBlocks()) {
                block.moveBy(-block.x, cursorY - block.y);
                cursorY = block.y + block.height + 24;
            }
            Events.FIRE_QUEUE_.push({group: Events.getGroup()});
            Events.setGroup(false);
        }
    }
    const block = (workspace: Workspace, id: string, x: number, y: number, width?: number, height?: number) => {
        const created = new Block(id, workspace, x, y, width, height);
        workspace.blocks.push(created);
        return created;
    };
    return {ScratchBlocks: {WorkspaceSvg: Workspace, Events}, Workspace, Block, BlockComment, WorkspaceComment, block,
        groups};
}

test('block comments keep their offset from their block in the scratch-blocks clean-up, and scripts do not overlap', () => {
    const {ScratchBlocks, Workspace, BlockComment, block} = fixture();
    installCleanUpComments(ScratchBlocks);
    const workspace = new Workspace();
    const first = block(workspace, 'first', 400, 300);
    const comment = new BlockComment('c1', first, 410, 330, 200, 150);
    block(workspace, 'second', 50, 900);

    workspace.cleanUp();

    assert.deepEqual(first.getRelativeToSurfaceXY(), {x: 0, y: 0});
    assert.deepEqual(comment.getXY(), {x: 10, y: 30});
    assert.deepEqual(comment.saved, {x: 10, y: 30});
    // The comment reaches down to 180; the second script starts below it.
    assert.deepEqual(workspace.blocks[1].getRelativeToSurfaceXY(), {x: 0, y: 212});
    assert.deepEqual(workspace.resizes, [false, true]);
});

test('a clean-up an addon sets later is wrapped too, and the comments it moves silently are put back and saved', () => {
    const {ScratchBlocks, Workspace, BlockComment, WorkspaceComment, block, groups} = fixture();
    installCleanUpComments(ScratchBlocks);
    const workspace = new Workspace();
    const first = block(workspace, 'first', 400, 300);
    const child = block(workspace, 'child', 400, 350);
    child.parent = first;
    first.children.push(child);
    const comment = new BlockComment('c1', child, 380, 420);
    const unmoved = block(workspace, 'unmoved', 48, 64, 100, 50);
    const unmovedComment = new BlockComment('c2', unmoved, 48, 150);
    const note = new WorkspaceComment('note', workspace, 60, 70, 100, 40);

    // Like editor-devtools: replaces the prototype's clean-up, lays scripts out in a column at 48 and shows every
    // block comment again beside its block.
    const proto = ScratchBlocks.WorkspaceSvg.prototype as any;
    const replaced = proto.cleanUp;
    proto.cleanUp = function () {
        ScratchBlocks.Events.setGroup('devtools-group');
        let cursorY = 64;
        for (const top of [unmoved, first]) {
            if (top.x !== 48 || top.y !== cursorY) top.moveBy(48 - top.x, cursorY - top.y);
            cursorY += top.height + 72;
        }
        for (const item of this.getTopComments()) if (item instanceof BlockComment) item.autoPosition();
    };
    assert.equal(typeof replaced, 'function');

    workspace.cleanUp();

    // Offsets from the blocks the comments belong to, as before the clean-up.
    const childXY = child.getRelativeToSurfaceXY();
    assert.deepEqual(comment.getXY(), {x: childXY.x - 20, y: childXY.y + 70});
    assert.deepEqual(comment.saved, comment.getXY());
    assert.deepEqual(unmovedComment.getXY(), {x: 48, y: 150});
    assert.deepEqual(unmovedComment.saved, {x: 48, y: 150});
    // The comment under `unmoved` reaches down to 250, so `first` starts below it.
    assert.deepEqual(first.getRelativeToSurfaceXY(), {x: 48, y: 282});
    // The workspace comment covered `unmoved`; it moves to the right of the scripts and their comments.
    assert.ok(note.x >= 48 + 200 + 32);
    assert.equal(note.y, 64);
    // The follow-up moves joined the clean-up's undo group.
    assert.equal(groups.at(-2), 'devtools-group');
});

test('an addon clean-up that calls the one it replaced is laid out once', () => {
    const {ScratchBlocks, Workspace, BlockComment, block} = fixture();
    installCleanUpComments(ScratchBlocks);
    const proto = ScratchBlocks.WorkspaceSvg.prototype as any;
    const replaced = proto.cleanUp;
    proto.cleanUp = function () {
        return replaced.call(this);
    };
    const workspace = new Workspace();
    const first = block(workspace, 'first', 400, 300);
    const comment = new BlockComment('c1', first, 380, 280);

    workspace.cleanUp();

    assert.deepEqual(comment.getXY(), {x: -20, y: -20});
    assert.deepEqual(workspace.resizes, [false, true]);
});

test('a workspace given its own clean-up keeps it, and deleting it brings the wrapped one back', () => {
    const {ScratchBlocks, Workspace} = fixture();
    installCleanUpComments(ScratchBlocks);
    const workspace = new Workspace() as any;
    const own = () => 'own';
    workspace.cleanUp = own;
    assert.equal(Object.prototype.hasOwnProperty.call(workspace, 'cleanUp'), true);
    assert.equal(workspace.cleanUp, own);
    assert.notEqual(new Workspace().cleanUp, own);
    delete workspace.cleanUp;
    assert.equal(workspace.cleanUp, ScratchBlocks.WorkspaceSvg.prototype.cleanUp);
});

test('right-to-left workspaces are cleaned up as before', () => {
    const {ScratchBlocks, Workspace, BlockComment, block} = fixture();
    installCleanUpComments(ScratchBlocks);
    const workspace = new Workspace();
    workspace.RTL = true;
    const first = block(workspace, 'first', 400, 300);
    const comment = new BlockComment('c1', first, 380, 280);
    workspace.cleanUp();
    assert.deepEqual(comment.getXY(), {x: -20, y: -20});
    assert.deepEqual(workspace.resizes, []);
});
