import assert from 'node:assert/strict';
import test from 'node:test';
import {attachTargetUndoHistory, installTargetUndoHistory} from '../dist/target-undo-history.js';

function setup() {
    // The parts of Blockly.Workspace that keep the undo history.
    class Workspace {
        undoStack_ = [];
        redoStack_ = [];
        listeners_ = [];
        clearUndo() {
            this.undoStack_.length = 0;
            this.redoStack_.length = 0;
        }
    }
    const nativeClearUndo = Workspace.prototype.clearUndo;
    const target = (id: string, xml = `<block id="${id}"/>`) => {
        const made = {id, isStage: false, xml, comments: {}, variables: {}, blocks: {toXML: () => made.xml}};
        return made;
    };
    const stage = target('stage', '');
    stage.isStage = true;
    const a = target('a');
    const b = target('b');
    const targets = [stage, a, b];
    const vm = {
        editingTarget: a,
        blockListener() {},
        runtime: {
            getTargetById: (id: string) => targets.find(candidate => candidate.id === id),
            getTargetForStage: () => stage
        }
    };
    const workspace = new Workspace();
    workspace.listeners_.push(vm.blockListener);
    // What the GUI does on each workspace update: reload, then clear the undo history.
    const show = (next: typeof a) => {
        vm.editingTarget = next;
        workspace.clearUndo();
    };
    const installed = installTargetUndoHistory(vm, {Workspace});
    show(a);
    return {Workspace, nativeClearUndo, vm, workspace, show, a, b, stage, targets, installed};
}

test('switching to another target and back gives the code area its undo and redo history back', () => {
    const {workspace, show, a, b} = setup();
    workspace.undoStack_.push({group: 'move'}, {group: 'create'});
    workspace.redoStack_.push({group: 'delete'});
    show(b);
    assert.deepEqual(workspace.undoStack_, []);
    assert.deepEqual(workspace.redoStack_, []);
    workspace.undoStack_.push({group: 'b-edit'});
    show(a);
    assert.deepEqual(workspace.undoStack_, [{group: 'move'}, {group: 'create'}]);
    assert.deepEqual(workspace.redoStack_, [{group: 'delete'}]);
    show(b);
    assert.deepEqual(workspace.undoStack_, [{group: 'b-edit'}]);
});

test('a history is dropped when the target code changed while another target was shown', () => {
    const {workspace, show, a, b} = setup();
    workspace.undoStack_.push({group: 'move'});
    show(b);
    a.xml = '<block id="a"/><block id="dropped"/>';
    show(a);
    assert.deepEqual(workspace.undoStack_, []);
});

test('a history is dropped when a variable it names changed', () => {
    const {workspace, show, a, b, stage} = setup();
    let name = 'score';
    stage.variables = {v: {type: '', toXML: () => `<variable id="v">${name}</variable>`}};
    workspace.undoStack_.push({group: 'set'});
    show(b);
    name = 'points';
    show(a);
    assert.deepEqual(workspace.undoStack_, []);
});

test('unused broadcast messages removed by the VM do not drop the history', () => {
    const {workspace, show, a, b, stage} = setup();
    stage.variables = {m: {type: 'broadcast_msg', toXML: () => '<variable type="broadcast_msg" id="m">go</variable>'}};
    workspace.undoStack_.push({group: 'move'});
    show(b);
    stage.variables = {};
    show(a);
    assert.deepEqual(workspace.undoStack_, [{group: 'move'}]);
});

test('reloading the same target clears the history, as the GUI always did', () => {
    const {workspace, show, a} = setup();
    workspace.undoStack_.push({group: 'move'});
    show(a);
    assert.deepEqual(workspace.undoStack_, []);
});

test('a history is not given back to a target that replaced a deleted one', () => {
    const {workspace, show, a, b, targets} = setup();
    workspace.undoStack_.push({group: 'move'});
    show(b);
    const restored = {...a};
    targets[1] = restored;
    show(restored);
    assert.deepEqual(workspace.undoStack_, []);
});

test('other workspaces, such as the palette or a code window, keep the native behaviour', () => {
    const {Workspace, show, b} = setup();
    const other = new Workspace();
    other.undoStack_.push({group: 'move'});
    other.clearUndo();
    show(b);
    assert.deepEqual(other.undoStack_, []);
});

test('disposing puts the native clearUndo back', () => {
    const {Workspace, nativeClearUndo, installed} = setup();
    assert.notEqual(Workspace.prototype.clearUndo, nativeClearUndo);
    installed.dispose();
    assert.equal(Workspace.prototype.clearUndo, nativeClearUndo);
});

test('attachTargetUndoHistory installs once ScratchBlocks has loaded, and not after it is disposed', async () => {
    class Workspace {clearUndo() {}}
    const nativeClearUndo = Workspace.prototype.clearUndo;
    const vm = {editingTarget: null, blockListener() {}, runtime: {getTargetById() {}, getTargetForStage() {}}};
    const attached = attachTargetUndoHistory({vm, getBlockly: async () => ({Workspace})});
    await attached.ready;
    assert.notEqual(Workspace.prototype.clearUndo, nativeClearUndo);
    attached.dispose();
    assert.equal(Workspace.prototype.clearUndo, nativeClearUndo);

    const early = attachTargetUndoHistory({vm, getBlockly: async () => ({Workspace})});
    early.dispose();
    await early.ready;
    assert.equal(Workspace.prototype.clearUndo, nativeClearUndo);
});
