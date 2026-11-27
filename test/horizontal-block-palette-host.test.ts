// SPDX-License-Identifier: MPL-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHorizontalBlockPalette} from '../dist/horizontal-block-palette.js';

function fixture() {
    const runtimeListeners = new Map();
    const vmListeners = new Map();
    const stage = {id: 'stage', isStage: true, isOriginal: true, getName: () => 'Stage', blocks: {_blocks: {}}};
    const sprite = {id: 'sprite', isStage: false, isOriginal: true, getName: () => 'Sprite', blocks: {_blocks: {}}};
    const changed = {count: 0};
    let next = 0;
    const addBlocks = (blocks, id) => {
        const target = id === stage.id ? stage : sprite;
        return blocks.map(block => {
            const blockId = String(++next);
            target.blocks._blocks[blockId] = block;
            return blockId;
        });
    };
    const vm = {
        editingTarget: stage,
        runtime: {targets: [stage, sprite], _blockInfo: [{id: 'pen', name: 'Pen', blocks: [{json: {type: 'pen_clear'}}]}],
            getTargetForStage: () => stage, emitProjectChanged() {changed.count++;},
            on: (event, listener) => runtimeListeners.set(event, listener),
            off: event => runtimeListeners.delete(event)},
        on: (event, listener) => vmListeners.set(event, listener),
        off: event => vmListeners.delete(event),
        duplicateSprite: async () => undefined,
        addSprite: async () => undefined,
        shareBlocksToTarget: async (payload, id) => {
            addBlocks(Array.isArray(payload) ? payload : payload.blocks, id);
            return 'legacy result';
        },
        shareBlocksToTargetWithReceipt: async (blocks, id, hooks?) => hooks?.prepare?.(blocks) === false ?
            null : {blockIds: addBlocks(blocks, id)}
    };
    let registrations = 0;
    const api = createHorizontalBlockPalette({getScratchBlocks: () => undefined, openExtensionLibrary() {}, styles: {}});
    const original = {duplicate: vm.duplicateSprite, add: vm.addSprite, share: vm.shareBlocksToTarget,
        shareWithReceipt: vm.shareBlocksToTargetWithReceipt};
    let slice;
    const stop = api.connectPaletteVisibility(vm, () => ({register(_key, registered) {
        slice = registered;
        registrations++;
        return () => {registrations--;};
    }, whenLoaded: async () => undefined}));
    return {vm, original, stop, runtimeListeners, vmListeners, stage, sprite, changed, slice,
        registrations: () => registrations};
}

test('disposing one host restores its VM and leaves another editor host attached', () => {
    const first = fixture();
    const second = fixture();
    const secondDuplicate = second.vm.duplicateSprite;
    assert.notEqual(first.vm.duplicateSprite, first.original.duplicate);
    first.stop();
    assert.equal(first.vm.duplicateSprite, first.original.duplicate);
    assert.equal(first.vm.addSprite, first.original.add);
    assert.equal(first.vm.shareBlocksToTarget, first.original.share);
    assert.equal(first.vm.shareBlocksToTargetWithReceipt, first.original.shareWithReceipt);
    assert.equal(first.registrations(), 0);
    assert.equal(first.runtimeListeners.size + first.vmListeners.size, 0);
    assert.equal(second.vm.duplicateSprite, secondDuplicate);
    assert.equal(second.registrations(), 1);
    assert.equal(second.runtimeListeners.has('PROJECT_LOADED'), true);
    second.stop();
    assert.equal(second.registrations(), 0);
});

const seedVisibility = ({slice}) => slice.applyFolderUpdate({version: 1,
    stage: {groups: ['events']}, sprites: {Sprite: {groups: ['events']}}});

test('an imported stack only enables the groups of transferred blocks on its destination', async t => {
    const app = fixture();
    t.after(app.stop);
    seedVisibility(app);
    app.sprite.blocks._blocks.old = {opcode: 'looks_show'};
    const result = await app.vm.shareBlocksToTarget({
        blocks: [{opcode: 'pen_clear'}, {opcode: 'sound_stopallsounds', shadow: true}], extensionURLs: {}
    }, app.sprite.id);
    assert.equal(result, 'legacy result');
    assert.deepEqual(app.slice.capture().sprites.Sprite.groups, ['events', 'pen']);
    assert.deepEqual(app.slice.capture().stage.groups, ['events']);
    assert.equal(app.changed.count, 1);
});

test('a transfer receipt enables only the committed groups and a cancelled transfer keeps its settings', async t => {
    const app = fixture();
    t.after(app.stop);
    seedVisibility(app);
    const blocks = [{opcode: 'pen_clear'}];
    assert.equal(await app.vm.shareBlocksToTargetWithReceipt(blocks, app.sprite.id, {prepare: () => false}), null);
    assert.deepEqual(app.slice.capture().sprites.Sprite.groups, ['events']);
    assert.equal(app.changed.count, 0);
    const receipt = await app.vm.shareBlocksToTargetWithReceipt(blocks, app.sprite.id);
    assert.deepEqual(receipt?.blockIds, ['1']);
    assert.deepEqual(app.slice.capture().sprites.Sprite.groups, ['events', 'pen']);
    assert.equal(app.changed.count, 1);
});
