import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {createCodePaneAdapter, readSavedCodePane, readScriptRelationGraph} from '../dist/code-pane.js';
import {getCodeSession} from '../dist/workspace.js';

function setup() {
    const vm = Object.assign(new EventEmitter(), {runtime: {getTargetById: () => undefined}});
    const onScreen = {scale: 0.9, x: 120, y: -40, visible: true, chrome: {mount() {}, dispose() {}}};
    let reads = 0;
    getCodeSession(vm).bridge = {
        capturePane: (targetId: string) => {
            reads++;
            return targetId === 'hero' ? onScreen : undefined;
        },
        focusScript() {}
    } as never;
    return {adapter: createCodePaneAdapter(vm, 'en'), reads: () => reads, vm};
}

const pane = (section = 0) => ({id: 'view-1', targetId: 'hero', section});

test('the calls panel receives named script endpoints without mixing the same block id in different sprites', () => {
    const blocks = {
        same: {id: 'same', opcode: 'event_whenflagclicked', x: 12, y: 34},
        call: {id: 'call', opcode: 'procedures_call', parent: 'same', mutation: {proccode: 'jump'}},
        definition: {id: 'definition', opcode: 'procedures_definition', topLevel: true,
            inputs: {custom_block: {block: 'prototype', shadow: 'prototype'}}},
        prototype: {id: 'prototype', opcode: 'procedures_prototype', parent: 'definition', shadow: true,
            mutation: {proccode: 'jump'}},
        send: {id: 'send', opcode: 'event_broadcast', parent: 'definition',
            inputs: {BROADCAST_INPUT: {block: 'menu', shadow: 'menu'}}},
        menu: {id: 'menu', opcode: 'event_broadcast_menu', parent: 'send', shadow: true,
            fields: {BROADCAST_OPTION: {value: 'go'}}},
        unused: {id: 'unused', opcode: 'looks_show'}
    };
    const sender = {id: 'sender', isOriginal: true, getName: () => 'Sender', blocks: {_blocks: blocks}};
    const receiver = {id: 'receiver', isOriginal: true, getName: () => 'Receiver', blocks: {_blocks: {
        same: {id: 'same', opcode: 'event_whenbroadcastreceived', topLevel: true, fields: {BROADCAST_OPTION: {value: 'go'}}}
    }}};
    const before = JSON.stringify([sender.blocks, receiver.blocks]);
    const data = readScriptRelationGraph([sender, receiver, {...receiver, id: 'clone', isOriginal: false}], undefined);
    assert.deepEqual(data.scriptRelations.map(relation => relation.kind), ['function', 'message']);
    assert.deepEqual(data.scripts.map(script => [script.targetId, script.scriptId, script.label]), [
        ['sender', 'same', 'event_whenflagclicked'], ['sender', 'definition', 'jump'], ['receiver', 'same', 'go']
    ]);
    assert.equal(data.scripts[0].targetName, 'Sender');
    assert.equal(data.scripts[0].x, 12);
    assert.equal(data.scripts[0].y, 34);
    assert.equal(JSON.stringify([sender.blocks, receiver.blocks]), before);
});

test('following an arrow preserves normal mode and updates an existing one-script pane across restores', () => {
    const {adapter, vm} = setup();
    adapter.restore(pane());
    getCodeSession(vm).changed({targetId: 'hero', blockId: 'call', scriptId: 'destination'});
    assert.equal(adapter.focusedScript('view-1'), undefined, 'normal mode still shows all scripts');
    adapter.focusPane('view-1', 'original');
    getCodeSession(vm).changed({targetId: 'hero', blockId: 'call', scriptId: 'destination'});
    adapter.restore(pane());
    assert.equal(adapter.focusedScript('view-1'), 'destination', 'returning to the pane keeps the navigated script');
});

test('a tab keeps the zoom, scroll position and script view of its code area', () => {
    const {adapter} = setup();
    const snapshot = {scale: 1.25, x: 10, y: 20, visible: false, scriptView: 'z' as const, chrome: null};
    assert.deepEqual(adapter.serialize(pane(), snapshot), {scale: 1.25, x: 10, y: 20, scriptView: 'z'});
    assert.equal(adapter.serialize(pane(1), snapshot), undefined, 'the costume section has no code area');
});

test('the code area on screen is read without a snapshot', () => {
    const {adapter, reads} = setup();
    assert.deepEqual(adapter.serialize(pane()), {scale: 0.9, x: 120, y: -40});
    assert.equal(reads(), 1);
    assert.equal(adapter.serialize({...pane(), targetId: 'other'}), undefined, 'another sprite is not in the code area');
});

test('a saved code area comes back as a presentation without the chrome of the code area', () => {
    const {adapter} = setup();
    const presentation = adapter.deserialize(pane(), {scale: 1.5, x: -5, y: 7, scriptView: 'n'});
    assert.deepEqual(presentation, {scale: 1.5, x: -5, y: 7, visible: true, scriptView: 'n'});
    assert.deepEqual(adapter.serialize(pane(), presentation), {scale: 1.5, x: -5, y: 7, scriptView: 'n'},
        'saving it again writes the same values');
    assert.equal(adapter.deserialize(pane(2), {scale: 1, x: 0, y: 0}), undefined);
});

test('only a saved code area of the right shape is read', () => {
    assert.deepEqual(readSavedCodePane({scale: 1, x: 0, y: 0, scriptView: 'diagonal'}), {scale: 1, x: 0, y: 0});
    for (const value of [{scale: 0, x: 0, y: 0}, {scale: 1, x: '0', y: 0}, {scale: 1, x: 0, y: Infinity},
        {scale: 1000, x: 0, y: 0}, {x: 0, y: 0}]) {
        assert.equal(readSavedCodePane(value), undefined, JSON.stringify(value));
    }
});
