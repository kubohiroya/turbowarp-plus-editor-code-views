import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';
import {RESTORE_UPDATE, attachSpriteRestoreHistory} from '../dist/sprite-restore-history.js';

// The GUI's restore-deletion slice with Redux's dispatch and subscribe, nested dispatches included.
function createStore() {
    let restoreDeletion = {restoreFun: null, deletedItem: ''};
    const listeners = new Set<() => void>();
    const store = {
        getState: () => ({scratchGui: {restoreDeletion}}),
        dispatch(action) {
            if (action.type === RESTORE_UPDATE) restoreDeletion = {...restoreDeletion, ...action.state};
            for (const listener of [...listeners]) listener();
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
    const restored: string[] = [];
    // What the target pane does when a sprite is deleted.
    const deleteSprite = (name: string, deletedItem = 'Sprite') => store.dispatch({type: RESTORE_UPDATE,
        state: {restoreFun: () => restored.push(name), deletedItem}});
    // What Edit → Restore does: run the function, then clear the slot.
    const restore = () => {
        const {restoreFun} = store.getState().scratchGui.restoreDeletion;
        if (typeof restoreFun !== 'function') return false;
        restoreFun();
        store.dispatch({type: RESTORE_UPDATE, state: {restoreFun: null, deletedItem: ''}});
        return true;
    };
    const slot = () => store.getState().scratchGui.restoreDeletion;
    return {store, deleteSprite, restore, restored, slot, listeners};
}

test('Restore Sprite goes back through earlier deleted sprites, newest first', () => {
    const {store, deleteSprite, restore, restored, slot} = createStore();
    attachSpriteRestoreHistory({store});
    deleteSprite('Cat');
    deleteSprite('Dog');
    deleteSprite('Bat');
    assert.ok(restore());
    assert.deepEqual(slot().deletedItem, 'Sprite');
    assert.ok(restore());
    assert.ok(restore());
    assert.equal(restore(), false);
    assert.deepEqual(restored, ['Bat', 'Dog', 'Cat']);
    assert.equal(slot().restoreFun, null);
});

test('at most the limit of deleted sprites are kept', () => {
    const {store, deleteSprite, restore, restored} = createStore();
    const history = attachSpriteRestoreHistory({store, limit: 2});
    deleteSprite('Cat');
    deleteSprite('Dog');
    deleteSprite('Bat');
    assert.equal(history.count(), 2);
    while (restore());
    assert.deepEqual(restored, ['Bat', 'Dog']);
});

test('a deleted costume takes the slot, and the sprites come back after it is restored', () => {
    const {store, deleteSprite, restore, restored, slot} = createStore();
    attachSpriteRestoreHistory({store});
    deleteSprite('Cat');
    deleteSprite('costume1', 'Costume');
    assert.equal(slot().deletedItem, 'Costume');
    assert.ok(restore());
    assert.equal(slot().deletedItem, 'Sprite');
    assert.ok(restore());
    assert.deepEqual(restored, ['costume1', 'Cat']);
});

test('loading another project forgets the earlier sprites but leaves the slot as it was', () => {
    const {store, deleteSprite, restore, restored} = createStore();
    const runtime = new EventEmitter();
    const history = attachSpriteRestoreHistory({store, vm: {runtime}});
    deleteSprite('Cat');
    deleteSprite('Dog');
    runtime.emit('PROJECT_LOADED');
    assert.equal(history.count(), 1);
    while (restore());
    assert.deepEqual(restored, ['Dog']);
});

test('disposing stops the history and leaves the GUI with its single slot', () => {
    const {store, deleteSprite, restore, restored, listeners} = createStore();
    const runtime = new EventEmitter();
    const history = attachSpriteRestoreHistory({store, vm: {runtime}});
    deleteSprite('Cat');
    history.dispose();
    assert.equal(listeners.size, 0);
    assert.equal(runtime.listenerCount('PROJECT_LOADED'), 0);
    deleteSprite('Dog');
    while (restore());
    assert.deepEqual(restored, ['Dog']);
});
