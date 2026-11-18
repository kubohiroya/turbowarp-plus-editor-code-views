// SPDX-License-Identifier: MPL-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHorizontalBlockPalette} from '../dist/horizontal-block-palette.js';

function fixture() {
    const runtimeListeners = new Map();
    const vmListeners = new Map();
    const stage = {id: 'stage', isStage: true, isOriginal: true};
    const vm = {
        editingTarget: stage,
        runtime: {targets: [stage], getTargetForStage: () => stage, emitProjectChanged() {},
            on: (event, listener) => runtimeListeners.set(event, listener),
            off: event => runtimeListeners.delete(event)},
        on: (event, listener) => vmListeners.set(event, listener),
        off: event => vmListeners.delete(event),
        duplicateSprite: async () => undefined,
        addSprite: async () => undefined
    };
    let registrations = 0;
    const api = createHorizontalBlockPalette({getScratchBlocks: () => undefined, openExtensionLibrary() {}, styles: {}});
    const original = {duplicate: vm.duplicateSprite, add: vm.addSprite};
    const stop = api.connectPaletteVisibility(vm, () => ({register() {
        registrations++;
        return () => {registrations--;};
    }, whenLoaded: async () => undefined}));
    return {vm, original, stop, runtimeListeners, vmListeners, registrations: () => registrations};
}

test('disposing one host restores its VM and leaves another editor host attached', () => {
    const first = fixture();
    const second = fixture();
    const secondDuplicate = second.vm.duplicateSprite;
    assert.notEqual(first.vm.duplicateSprite, first.original.duplicate);
    first.stop();
    assert.equal(first.vm.duplicateSprite, first.original.duplicate);
    assert.equal(first.vm.addSprite, first.original.add);
    assert.equal(first.registrations(), 0);
    assert.equal(first.runtimeListeners.size + first.vmListeners.size, 0);
    assert.equal(second.vm.duplicateSprite, secondDuplicate);
    assert.equal(second.registrations(), 1);
    assert.equal(second.runtimeListeners.has('PROJECT_LOADED'), true);
    second.stop();
    assert.equal(second.registrations(), 0);
});
