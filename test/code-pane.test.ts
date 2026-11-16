import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import {createCodePaneAdapter, readSavedCodePane} from '../dist/code-pane.js';
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
    return {adapter: createCodePaneAdapter(vm, 'en'), reads: () => reads};
}

const pane = (section = 0) => ({id: 'view-1', targetId: 'hero', section});

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
