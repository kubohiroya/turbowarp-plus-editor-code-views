import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readScriptRelations, type RelationBlock, type RelationTarget} from '../src/script-relations.ts';

const block = (id: string, opcode: string, values: Partial<RelationBlock> = {}): RelationBlock => ({id, opcode, ...values});
const target = (id: string, blocks: RelationBlock[], values: Partial<RelationTarget> = {}): RelationTarget =>
    ({id, isOriginal: true, blocks: {_blocks: Object.fromEntries(blocks.map(value => [value.id, value]))}, ...values});
const field = (value: unknown) => ({value});
const input = (id: string) => ({block: id, shadow: id});
const definition = (id: string, code: string) => [
    block(id, 'procedures_definition', {topLevel: true, inputs: {custom_block: input(`${id}-prototype`)}}),
    block(`${id}-prototype`, 'procedures_prototype', {parent: id, shadow: true, mutation: {proccode: code}})
];
const call = (id: string, code: string, parent?: string) =>
    block(id, 'procedures_call', {parent, mutation: {proccode: code}});
const send = (id: string, name: string, wait = false, parent?: string) => [
    block(id, wait ? 'event_broadcastandwait' : 'event_broadcast', {parent, inputs: {BROADCAST_INPUT: input(`${id}-message`)}}),
    block(`${id}-message`, 'event_broadcast_menu', {parent: id, shadow: true, fields: {BROADCAST_OPTION: field(name)}})
];
const receive = (id: string, name: string) =>
    block(id, 'event_whenbroadcastreceived', {topLevel: true, fields: {BROADCAST_OPTION: field(name)}});
const named = (id: string, name: string, scope?: string) => [
    block(id, 'kubohiroyanamedfunctions_defineFunction', {
        topLevel: true, inputs: {NAME: input(`${id}-name`)}, fields: scope ? {SCOPE: field(scope)} : {}
    }),
    block(`${id}-name`, 'text', {parent: id, shadow: true, fields: {TEXT: field(name)}})
];
const namedCall = (id: string, name: string, start = false) => [
    block(id, `kubohiroyanamedfunctions_${start ? 'startFunction' : 'callFunction'}`, {inputs: {NAME: input(`${id}-name`)}}),
    block(`${id}-name`, 'text', {parent: id, shadow: true, fields: {TEXT: field(name)}})
];

test('custom blocks resolve within their target, including calls nested in control blocks and definitions', () => {
    const sprite = target('sprite', [block('flag', 'event_whenflagclicked'),
        block('loop', 'control_repeat', {parent: 'flag'}), call('nested-call', 'jump %s', 'loop'),
        ...definition('jump', 'jump %s'), call('recursive-call', 'jump %s', 'jump')]);
    const other = target('other', [...definition('other-jump', 'jump %s'), call('other-call', 'jump %s')]);
    const relations = readScriptRelations([sprite, other]);
    assert.deepEqual(relations.map(({source, destination}) => [source.blockId, source.scriptId, destination?.targetId,
        destination?.blockId]), [
        ['nested-call', 'flag', 'sprite', 'jump'], ['recursive-call', 'jump', 'sprite', 'jump'],
        ['other-call', 'other-call', 'other', 'other-jump']
    ]);
    assert.ok(relations.every(relation => relation.kind === 'function' && relation.wait && !relation.unresolved));
});

test('broadcasts fan out across original targets and use the VM case-insensitive matching', () => {
    const sender = target('sender', [...send('send', 'Hello'), ...send('wait', 'hELLO', true), receive('self', 'hello')]);
    const receiver = target('receiver', [receive('r1', 'HELLO'), receive('r2', 'Hello')]);
    const clone = {...receiver, id: 'clone', isOriginal: false};
    const relations = readScriptRelations([sender, receiver, clone, receiver]);
    assert.equal(relations.length, 6);
    for (const source of ['send', 'wait']) {
        assert.deepEqual(relations.filter(relation => relation.source.blockId === source).map(relation => relation.destination?.blockId),
            ['self', 'r1', 'r2']);
    }
    assert.ok(relations.every(relation => relation.kind === 'message' && relation.wait === (relation.source.blockId === 'wait')));
});

test('broadcast matching uses upper case, including non-ASCII names', () => {
    const relations = readScriptRelations([target('sprite', [...send('send', 'straße'), receive('receive', 'STRASSE')])]);
    assert.equal(relations[0].destination?.blockId, 'receive');
});

test('an active reporter never resolves to the menu or text shadow that it covers', () => {
    const blocks = [...send('message', 'literal'), ...namedCall('function', 'literal'),
        block('message-expression', 'operator_join', {parent: 'message'}),
        block('function-expression', 'data_variable', {parent: 'function'})];
    blocks.find(value => value.id === 'message')!.inputs!.BROADCAST_INPUT.block = 'message-expression';
    blocks.find(value => value.id === 'function')!.inputs!.NAME.block = 'function-expression';
    const relations = readScriptRelations([target('sprite', [...blocks, receive('receive', 'literal'), ...named('definition', 'literal')])]);
    assert.deepEqual(relations.map(relation => [relation.source.blockId, relation.unresolved, relation.destination]),
        [['message', 'dynamic', undefined], ['function', 'dynamic', undefined]]);
});

test('named functions respect sprite and global scope, including legacy global hats', () => {
    const a = target('a', [...named('a-local', 'local', 'sprite'), ...namedCall('a-call', 'local'),
        ...named('global', 'shared', 'global'), ...named('legacy', 'legacy')]);
    const b = target('b', [...named('b-local', 'local', 'sprite'), ...namedCall('b-call', 'local'),
        ...namedCall('b-global', 'shared'), ...namedCall('b-legacy', 'legacy'), ...namedCall('start', 'shared', true)]);
    const c = target('c', [...namedCall('hidden-local', 'local')]);
    const relations = readScriptRelations([a, b, c]);
    assert.deepEqual(relations.map(relation => [relation.source.blockId, relation.destination?.blockId, relation.unresolved]), [
        ['a-call', 'a-local', undefined], ['b-call', 'b-local', undefined], ['b-global', 'global', undefined],
        ['b-legacy', 'legacy', undefined], ['start', 'global', undefined], ['hidden-local', undefined, 'missing']
    ]);
    assert.equal(relations.find(relation => relation.source.blockId === 'start')!.wait, false);
    assert.equal(relations.find(relation => relation.source.blockId === 'b-global')!.wait, true);
});

test('fixed function menus name the same definitions as literal named calls', () => {
    const relations = readScriptRelations([target('sprite', [...named('fn', 'jump'),
        block('menu-call', 'kubohiroyanamedfunctions_callFunctionFromMenu', {fields: {FUNCTION: field('jump')}})])]);
    assert.equal(relations.length, 1);
    assert.equal(relations[0].destination?.blockId, 'fn');
    assert.equal(relations[0].label, 'jump');
});

test('a named definition with a reporter in NAME is not treated as a callable literal definition', () => {
    const blocks = [...named('definition', 'hidden-name'), ...namedCall('call', 'hidden-name')];
    blocks.find(value => value.id === 'definition')!.inputs!.NAME.block = 'expression';
    blocks.push(block('expression', 'operator_join', {parent: 'definition'}));
    const relations = readScriptRelations([target('sprite', blocks)]);
    assert.equal(relations.length, 1);
    assert.equal(relations[0].unresolved, 'missing');
    assert.equal(relations[0].destination, undefined);
});

test('duplicate function definitions stay ambiguous rather than claiming a destination', () => {
    const sprite = target('sprite', [...definition('one', 'jump'), ...definition('two', 'jump'), call('call', 'jump'),
        ...named('local', 'shared', 'sprite'), ...namedCall('named-call', 'shared')]);
    const other = target('other', [...named('global', 'shared', 'global')]);
    assert.deepEqual(readScriptRelations([sprite, other]).map(relation => [relation.source.blockId, relation.unresolved,
        relation.destination]), [['call', 'ambiguous', undefined], ['named-call', 'ambiguous', undefined]]);
});

test('missing definitions and empty inputs do not invent destinations', () => {
    const relations = readScriptRelations([target('sprite', [call('unknown', 'not defined'),
        block('empty', 'event_broadcast'), ...send('no-receiver', 'not received')])]);
    assert.deepEqual(relations.map(relation => [relation.source.blockId, relation.unresolved, relation.label]), [
        ['unknown', 'missing', 'not defined'], ['empty', 'missing', ''], ['no-receiver', 'missing', 'not received']
    ]);
});

test('folding changes no relations, and extraction does not modify serialized project data', () => {
    const sprite = target('sprite', [...definition('fn', 'jump'), call('call', 'jump', 'fn'),
        ...send('send', 'ready', false, 'fn'), receive('receive', 'ready')]);
    const before = readScriptRelations([sprite]);
    sprite.blocks._blocks.fn.mutation = {'tw-plus-folded': 'true'};
    sprite.blocks._blocks.receive.mutation = {'tw-plus-folded': 'true'};
    const snapshot = structuredClone(sprite);
    assert.deepEqual(readScriptRelations([sprite]), before);
    assert.deepEqual(sprite, snapshot);
});

test('malformed parent cycles and dangling parents stop traversal without inventing roots', () => {
    const sprite = target('sprite', [...definition('fn', 'jump'), call('cycle-one', 'jump', 'cycle-two'),
        block('cycle-two', 'control_repeat', {parent: 'cycle-one'}), call('dangling', 'jump', 'absent'), call('valid', 'jump')]);
    assert.deepEqual(readScriptRelations([sprite]).map(relation => relation.source.blockId), ['valid']);
});
