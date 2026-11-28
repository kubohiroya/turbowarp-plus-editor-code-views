import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {activePaletteLayout, applyPaletteLayoutToTree, folderCategoryId, insertLayoutItem, layoutPaletteOrder, layoutUsage,
    moveLayoutItem, parsePaletteLayouts, withDefaultLayout, materializePaletteLayout, duplicatePaletteLayout, reorderLayoutByCategories, resolvePaletteLayout, updateLayoutItem} from '../dist/palette-layout.js';
import {createPaletteOrder} from '../dist/palette-category-visibility.js';

const group = (key, ref, mode = 'auto', label = undefined) => ({kind: 'group', key, ref, mode, ...(label ? {label} : {})});
const layout = items => ({id: 'l', name: 'L', items});
const shape = value => value.items.map(item => item.kind === 'folder' ? `[${item.key}:${item.items.map(child => child.key).join(',')}]` :
    item.kind === 'separator' ? '|' : item.key).join(' ');

test('saved layouts keep what is well formed and give unique keys', () => {
    const parsed = parsePaletteLayouts({active: 'b', sourceOrder: ['looks'], layouts: [
        {id: 'a', name: 'A', items: [group('x', 'motion'), group('x', 'looks', 'open'), {kind: 'nope'}, {kind: 'separator', key: 's'}]},
        {id: 'b', name: 'B', items: [{kind: 'folder', key: 'f', label: 'F', mode: 'open', items: [group('y', 'pen'), {kind: 'separator'}]}]},
        'junk'
    ]});
    assert.equal(parsed.active, 'b');
    assert.deepEqual(parsed.sourceOrder, ['looks']);
    assert.equal(parsed.layouts.length, 2);
    const [a, b] = parsed.layouts;
    assert.equal(a.items.length, 3);
    assert.notEqual(a.items[0].key, a.items[1].key);
    assert.equal(a.items[1].mode, 'open');
    assert.deepEqual(b.items[0].items.map(item => item.ref), ['pen']);
    assert.equal(parsePaletteLayouts({layouts: 'no'}), undefined);
    assert.equal(parsePaletteLayouts({layouts: [], active: 'missing'}).active, undefined);
});

test('an empty or unchosen layout leaves the palette showing every group', () => {
    assert.equal(activePaletteLayout(undefined), undefined);
    assert.equal(activePaletteLayout({layouts: [layout([{kind: 'separator', key: 's'}])], active: 'l'}), undefined);
    assert.equal(activePaletteLayout({layouts: [layout([group('a', 'motion')])]}), undefined);
    assert.equal(activePaletteLayout({layouts: [layout([group('a', 'motion')])], active: 'l'}).id, 'l');
});

test('usage counts references in folders too', () => {
    const usage = layoutUsage(layout([group('a', 'motion'), {kind: 'folder', key: 'f', label: '', mode: 'auto',
        items: [group('b', 'motion'), group('c', 'pen')]}]));
    assert.deepEqual([...usage], [['motion', 2], ['pen', 1]]);
});

test('items move before others, into and out of folders, and folders never nest', () => {
    const base = layout([group('a', 'motion'), group('b', 'looks'), {kind: 'folder', key: 'f', label: 'F', mode: 'auto', items: []},
        {kind: 'separator', key: 's'}]);
    let next = moveLayoutItem(base, 'b', {before: 'a'});
    assert.equal(shape(next), 'b a [f:] |');
    next = moveLayoutItem(next, 'a', {into: 'f'});
    assert.equal(shape(next), 'b [f:a] |');
    next = moveLayoutItem(next, 'b', {before: 'a'});
    assert.equal(shape(next), '[f:b,a] |');
    next = moveLayoutItem(next, 'a', {end: true});
    assert.equal(shape(next), '[f:b] | a');
    // A separator dropped in a folder lands before the folder.
    next = moveLayoutItem(next, 's', {before: 'b'});
    assert.equal(shape(next), '| [f:b] a');
    // A folder never goes into itself, and dropping an item on itself changes nothing.
    assert.equal(moveLayoutItem(next, 'f', {into: 'f'}), next);
    assert.equal(moveLayoutItem(next, 'a', {before: 'a'}), next);
    next = moveLayoutItem(next, 'a', {end: true, folder: 'f'});
    assert.equal(shape(next), '| [f:b,a]');
    assert.equal(shape(base), 'a b [f:] |', 'the layout given is left as it was');
    assert.equal(shape(insertLayoutItem(next, group('n', 'pen'), {before: 'missing'})), '| [f:b,a] n');
});

test('labels and modes change, and an empty label returns a group to its own name', () => {
    let next = updateLayoutItem(layout([group('a', 'motion')]), {index: 0}, {label: 'Move', mode: 'open'});
    assert.deepEqual(next.items[0], group('a', 'motion', 'open', 'Move'));
    next = updateLayoutItem(next, {index: 0}, {label: '  '});
    assert.equal(next.items[0].label, undefined);
});

const toolbox = () => new JSDOM(`<xml>
    <category id="motion" name="Motion" colour="#4C97FF"><block type="motion_movesteps"/></category>
    <category id="looks" name="Looks"><block type="looks_show"/></category>
    <sep/>
    <category id="kami" name="Kami"><block type="kami_a"/>
        <category id="kami/scene" name="Scene"><block type="kami_b"/></category>
        <category id="kami/actor" name="Actor"><block type="kami_c"/></category>
    </category>
    <category id="pen" name="Pen"><block type="pen_clear"/></category>
</xml>`, {contentType: 'text/xml'}).window.document.documentElement;
const tops = tree => Array.from(tree.children).map(child => child.tagName === 'category' ?
    `${child.getAttribute('id')}${child.querySelector('category') ? `(${Array.from(child.children).filter(item => item.tagName === 'category')
        .map(item => item.getAttribute('id')).join(',')})` : ''}` : child.tagName);

test('a layout rearranges the toolbox: its order, folders, labels, open items and separators', () => {
    const tree = toolbox();
    const folder = {kind: 'folder', key: 'f', label: 'Tools', mode: 'open', items: [group('p', 'pen'), group('m', 'motion')]};
    const applied = applyPaletteLayoutToTree(tree, layout([
        group('k', 'kami', 'open'), {kind: 'separator', key: 's1'}, group('l', 'looks', 'auto', 'Look'), group('dup', 'looks'),
        group('gone', 'missing'), folder, {kind: 'separator', key: 's2'}
    ]));
    assert.deepEqual(tops(tree), ['kami(kami/scene,kami/actor)', 'looks', 'looks~2', `${folderCategoryId(folder)}(pen,motion)`]);
    assert.equal(tree.querySelector('[id="looks"]').getAttribute('name'), 'Look');
    assert.deepEqual([...applied.pinned].sort(), [folderCategoryId(folder), 'kami'].sort());
    assert.deepEqual(applied.separatorsBefore, ['looks', null]);
    assert.deepEqual([...applied.folders], [folderCategoryId(folder)]);
    assert.equal(applied.placed.get('looks'), 'l');
    assert.equal(applied.placed.get('looks~2'), 'dup', 'a group referenced again is drawn again, as a copy');
    assert.equal(tree.querySelector('[id="looks~2"]').getAttribute('name'), 'Looks');
    assert.equal(tree.querySelector('[id="looks~2"] block').getAttribute('type'), 'looks_show');
});

test('a nested group the layout places itself leaves the group it was in', () => {
    const tree = toolbox();
    applyPaletteLayoutToTree(tree, layout([group('k', 'kami'), group('s', 'kami/scene')]));
    assert.deepEqual(tops(tree), ['kami(kami/actor)', 'kami/scene']);
});

test('while a layout is shown, the palette order reads and edits the layout', () => {
    const base = createPaletteOrder();
    base.setPinned('kami/scene', true);
    let current = layout([group('k', 'kami', 'open'), {kind: 'separator', key: 's'}, group('l', 'looks'),
        {kind: 'folder', key: 'f', label: 'F', mode: 'auto', items: [group('p', 'pen'), group('m', 'motion')]}]);
    const tree = toolbox();
    const applied = applyPaletteLayoutToTree(tree, current);
    const order = layoutPaletteOrder(base, {layout: () => current, applied: () => applied, change: next => { current = next; }});
    assert.deepEqual(order.categories(), []);
    assert.equal(order.isPinned('kami'), true);
    assert.equal(order.isPinned('looks'), false);
    assert.equal(order.isPinned('kami/scene'), true, 'groups the layout does not place keep the project order');
    order.setPinned('looks', true);
    assert.equal(current.items[2].mode, 'open');
    order.setCategories(['looks', folderCategoryId({key: 'f'}), 'kami']);
    assert.equal(shape(current), 'l | f k'.replace('f', '[f:p,m]'));
    order.setMembers(folderCategoryId({key: 'f'}), ['motion', 'pen']);
    assert.deepEqual(current.items.find(item => item.kind === 'folder').items.map(item => item.ref), ['motion', 'pen']);
    order.setMembers('kami', ['kami/actor', 'kami/scene']);
    assert.deepEqual(base.members('kami'), ['kami/actor', 'kami/scene']);
});

test('reordering by categories keeps separators where they were', () => {
    const next = reorderLayoutByCategories(layout([group('a', 'motion'), {kind: 'separator', key: 's'}, group('b', 'looks')]),
        ['looks', 'motion']);
    assert.equal(shape(next), 'b | a');
});

test('the preview leaves out what the palette leaves out, and nested groups follow the layout', () => {
    const offered = [{id: 'motion'}, {id: 'kami'}, {id: 'kami/scene', parent: 'kami'}, {id: 'kami/actor', parent: 'kami'}];
    const current = layout([{kind: 'separator', key: 's0'}, group('a', 'motion'), {kind: 'separator', key: 's1'},
        {kind: 'separator', key: 's2'}, group('b', 'motion'), group('c', 'gone'), group('k', 'kami'),
        {kind: 'folder', key: 'f', label: 'F', mode: 'auto', items: [group('d', 'gone')]}, group('e', 'kami/actor')]);
    const {omitted, nested} = resolvePaletteLayout(current, offered);
    assert.deepEqual(Object.fromEntries(omitted), {s0: 'separator', s2: 'separator', c: 'missing', d: 'missing', f: 'empty'});
    assert.deepEqual(nested('kami'), ['kami/scene']);
    // The same layout drawn into a toolbox agrees.
    const tree = toolbox();
    const applied = applyPaletteLayoutToTree(tree, current);
    assert.deepEqual(tops(tree), ['motion', 'motion~2', 'kami(kami/scene)', 'kami/actor']);
    assert.deepEqual(applied.separatorsBefore, ['motion~2']);
});

test('a copy of a group brings its own nested groups, and reordering and pinning in the palette edit the right reference', () => {
    let current = layout([group('k1', 'kami', 'open'), group('s', 'kami/scene'), group('k2', 'kami')]);
    const tree = toolbox();
    const applied = applyPaletteLayoutToTree(tree, current);
    assert.deepEqual(tops(tree), ['kami(kami/actor)', 'kami/scene', 'kami~2(kami/actor~2)']);
    assert.deepEqual([...applied.pinned], ['kami']);
    const order = layoutPaletteOrder(createPaletteOrder(), {layout: () => current, applied: () => applied, change: next => { current = next; }});
    assert.equal(order.isPinned('kami~2'), false);
    order.setPinned('kami~2', true);
    assert.deepEqual(current.items.map(item => item.mode), ['open', 'auto', 'open']);
    order.setCategories(['kami~2', 'kami/scene', 'kami']);
    assert.deepEqual(current.items.map(item => item.key), ['k2', 's', 'k1']);
});

test('the default layout comes first, holds every group in source order, and its copies are ordinary layouts', () => {
    const saved = withDefaultLayout({layouts: [layout([group('a', 'motion')])], active: 'l'}, 'Standard');
    assert.deepEqual(saved.layouts.map(item => [item.id, item.builtin ?? false]), [['default', true], ['l', false]]);
    assert.equal(saved.active, 'l');
    assert.equal(withDefaultLayout(undefined, 'Standard').active, 'default');
    assert.equal(withDefaultLayout(saved, 'Standard').layouts.length, 2, 'it is added once');
    const builtin = saved.layouts[0];
    const items = materializePaletteLayout(builtin, ['motion', 'looks', 'pen'], ['pen']).items;
    assert.deepEqual(items.map(item => item.ref), ['pen', 'motion', 'looks']);
    assert.equal(activePaletteLayout({...saved, active: 'default'}), undefined, 'without the groups it is left out');
    assert.equal(activePaletteLayout({...saved, active: 'default'}, ['motion']).items.length, 1);
    const copy = duplicatePaletteLayout({...builtin, items}, 'Copy');
    assert.equal(copy.builtin, undefined);
    assert.notEqual(copy.id, builtin.id);
    assert.deepEqual(copy.items.map(item => item.ref), ['pen', 'motion', 'looks']);
    assert.ok(copy.items.every((item, index) => item.key !== items[index].key));
    const parsed = parsePaletteLayouts({layouts: [{id: 'default', name: 'S', builtin: true, items: []}, {id: 'x', builtin: true}]});
    assert.deepEqual(parsed.layouts.map(item => item.builtin ?? false), [true, false]);
});
