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
    const secondShare = second.vm.shareBlocksToTarget;
    assert.notEqual(first.vm.shareBlocksToTarget, first.original.share);
    first.stop();
    assert.equal(first.vm.duplicateSprite, first.original.duplicate);
    assert.equal(first.vm.addSprite, first.original.add);
    assert.equal(first.vm.shareBlocksToTarget, first.original.share);
    assert.equal(first.vm.shareBlocksToTargetWithReceipt, first.original.shareWithReceipt);
    assert.equal(first.registrations(), 0);
    assert.equal(first.runtimeListeners.size + first.vmListeners.size, 0);
    assert.equal(second.vm.shareBlocksToTarget, secondShare);
    assert.equal(second.registrations(), 1);
    assert.equal(second.runtimeListeners.has('PROJECT_LOADED'), true);
    second.stop();
    assert.equal(second.registrations(), 0);
});

const seedLayout = ({slice}) => slice.applyFolderUpdate({version: 1, layouts: {active: 'story', layouts: [
    {id: 'story', name: 'Story', items: [{kind: 'group', key: 'a', ref: 'events', mode: 'auto'}]},
    {id: 'other', name: 'Other', items: [{kind: 'group', key: 'b', ref: 'looks', mode: 'open'}]}
]}});
const refs = (app, id = 'story') => app.slice.capture().layouts.layouts.find(layout => layout.id === id).items
    .map(item => item.ref);

test('an imported stack adds the groups of transferred blocks to the shown palette layout', async t => {
    const app = fixture();
    t.after(app.stop);
    seedLayout(app);
    app.sprite.blocks._blocks.old = {opcode: 'looks_show'};
    const result = await app.vm.shareBlocksToTarget({
        blocks: [{opcode: 'pen_clear'}, {opcode: 'sound_stopallsounds', shadow: true}, {opcode: 'event_whenflagclicked'}],
        extensionURLs: {}
    }, app.sprite.id);
    assert.equal(result, 'legacy result');
    assert.deepEqual(refs(app), ['events', 'pen']);
    assert.deepEqual(refs(app, 'other'), ['looks']);
    assert.equal(app.changed.count, 1);
});

test('a transfer receipt adds only the committed groups and a cancelled transfer keeps the layout', async t => {
    const app = fixture();
    t.after(app.stop);
    seedLayout(app);
    const blocks = [{opcode: 'pen_clear'}];
    assert.equal(await app.vm.shareBlocksToTargetWithReceipt(blocks, app.sprite.id, {prepare: () => false}), null);
    assert.deepEqual(refs(app), ['events']);
    assert.equal(app.changed.count, 0);
    const receipt = await app.vm.shareBlocksToTargetWithReceipt(blocks, app.sprite.id);
    assert.deepEqual(receipt?.blockIds, ['1']);
    assert.deepEqual(refs(app), ['events', 'pen']);
    assert.equal(app.changed.count, 1);
});

test('an extension added from the library joins the shown layout, and nothing changes without one', t => {
    const app = fixture();
    t.after(app.stop);
    app.runtimeListeners.get('EXTENSION_ADDED')({id: 'pen'});
    assert.equal(app.slice.capture(), undefined);
    seedLayout(app);
    app.runtimeListeners.get('EXTENSION_ADDED')({id: 'pen'});
    app.runtimeListeners.get('EXTENSION_ADDED')({id: 'pen'});
    assert.deepEqual(refs(app), ['events', 'pen']);
});
