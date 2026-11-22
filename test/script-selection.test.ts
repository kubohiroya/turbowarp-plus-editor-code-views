import assert from 'node:assert/strict';
import {test} from 'node:test';
import {addCompanions, copyScript} from '../dist/script-selection.js';

const records = {
    a: {id: 'a', opcode: 'event_whenflagclicked', topLevel: true, x: 10, y: 20, next: 'a2', inputs: {}, comment: 'note'},
    a2: {id: 'a2', opcode: 'motion_movesteps', topLevel: false, next: null,
        inputs: {STEPS: {name: 'STEPS', block: 'n', shadow: 'n'}}},
    n: {id: 'n', opcode: 'math_number', topLevel: false, next: null, inputs: {}},
    other: {id: 'other', opcode: 'looks_show', topLevel: true, x: 0, y: 0, next: null, inputs: {}}
};

test('copyScript copies a script with its inputs, top block first, leaving comments and other scripts', () => {
    const copies = copyScript(records, 'a');
    assert.deepEqual(copies.map(block => block.id), ['a', 'a2', 'n']);
    assert.equal(copies[0].comment, undefined);
    assert.equal(records.a.comment, 'note', 'the source is untouched');
    copies[1].inputs.STEPS.block = 'changed';
    assert.equal(records.a2.inputs.STEPS.block, 'n');
});

/** A drop of the script `other`, with `a` selected too. */
const drop = () => ({source: 'sprite', opcode: 'looks_show', size: 1, origin: {x: 0, y: 0}, scripts: [copyScript(records, 'a')]});

test('addCompanions keeps each script where it was relative to the dragged one', () => {
    // The GUI's copy of the dragged script carries new ids.
    const payload = [{id: 'new', opcode: 'looks_show', topLevel: true, x: 30, y: 30}];
    assert.equal(addCompanions(payload, drop()), true);
    assert.deepEqual(payload.map(block => block.id), ['new', 'a', 'a2', 'n']);
    assert.deepEqual([payload[1].x, payload[1].y], [40, 50]);
    assert.deepEqual([records.a.x, records.a.y], [10, 20]);
    const wrapped = {blocks: [{id: 'new', opcode: 'looks_show', topLevel: true, x: 0, y: 0}], extensionURLs: {}};
    assert.equal(addCompanions(wrapped, drop()), true);
    assert.equal(wrapped.blocks.length, 4);
});

test('addCompanions leaves a copy of another script alone, told apart by its top opcode and size', () => {
    const payload = [{id: 'x', opcode: 'event_whenflagclicked', topLevel: true, x: 0, y: 0}];
    assert.equal(addCompanions(payload, drop()), false);
    assert.equal(payload.length, 1);
    const longer = [{id: 'x', opcode: 'looks_show', topLevel: true, x: 0, y: 0}, {id: 'y', opcode: 'looks_hide'}];
    assert.equal(addCompanions(longer, drop()), false);
    assert.equal(longer.length, 2);
});
