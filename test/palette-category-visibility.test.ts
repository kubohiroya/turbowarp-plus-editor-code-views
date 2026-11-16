import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {attachPaletteMenuButton, createPaletteVisibilityStore, defaultVisibleGroups, extensionPaletteCatalog, filterToolboxTree, groupOfOpcode,
    installExtensionPaletteGroups, paletteGroupSets, paletteVisibilityMenuLabel, standardGroups, usedGroups} from '../dist/palette-category-visibility.js';

function target(name, {isStage = false, opcodes = [], id = name} = {}) {
    const blocks = Object.fromEntries(opcodes.map((opcode, index) => [`b${index}`, {opcode, shadow: opcode.endsWith('_menu')}]));
    return {id, isStage, getName: () => name, blocks: {_blocks: blocks}};
}

test('blocks map to the palette groups that offer them', () => {
    assert.equal(groupOfOpcode('motion_movesteps'), 'motion');
    assert.equal(groupOfOpcode('event_whenflagclicked'), 'events');
    assert.equal(groupOfOpcode('operator_add'), 'operators');
    assert.equal(groupOfOpcode('data_setvariableto'), 'variables');
    assert.equal(groupOfOpcode('data_addtolist'), 'lists');
    assert.equal(groupOfOpcode('data_itemoflist'), 'lists');
    assert.equal(groupOfOpcode('procedures_call'), 'myBlocks');
    assert.equal(groupOfOpcode('argument_reporter_string_number'), 'myBlocks');
    assert.equal(groupOfOpcode('pen_clear'), 'pen');
    assert.equal(groupOfOpcode('nounderscore'), null);
});

test('used groups count the code blocks and leave menus out', () => {
    const cat = target('Cat', {opcodes: ['pen_clear', 'pen_clear', 'pen_menu_colorParam_menu', 'data_addtolist', 'motion_movesteps']});
    assert.deepEqual(Object.fromEntries(usedGroups(cat)), {pen: 2, lists: 1, motion: 1});
});

test('without a setting, a target shows the standard groups and the extensions its code uses', () => {
    const cat = target('Cat', {opcodes: ['pen_clear']});
    const store = createPaletteVisibilityStore();
    assert.deepEqual(defaultVisibleGroups(cat, ['pen', 'music']), [...standardGroups, 'pen']);
    assert.deepEqual([...store.visible(cat, ['pen', 'music'])], [...standardGroups, 'pen']);
    assert.equal(store.capture([cat]), undefined, 'nothing to save');
});

test('settings are kept by target, saved by sprite name, and follow a renamed sprite', () => {
    const stage = target('Stage', {isStage: true, id: 's'});
    let name = 'Cat';
    const cat = {...target('Cat', {id: 'c'}), getName: () => name};
    const store = createPaletteVisibilityStore();
    store.set(cat, ['events', 'control', 'pen'], ['pen']);
    store.set(stage, ['looks', 'events'], []);
    assert.deepEqual([...store.visible(cat, ['pen'])], ['events', 'control', 'pen']);
    name = 'Kitten';
    assert.deepEqual(store.capture([stage, cat]), {version: 1, stage: {groups: ['looks', 'events']},
        sprites: {Kitten: {groups: ['events', 'control', 'pen']}}});
});

test('going back to the default forgets the setting', () => {
    const cat = target('Cat', {opcodes: ['pen_clear']});
    const store = createPaletteVisibilityStore();
    store.set(cat, ['events'], ['pen']);
    store.set(cat, [...standardGroups, 'pen'], ['pen']);
    assert.equal(store.capture([cat]), undefined);
});

test('a duplicate starts with the setting of the sprite it was made from', () => {
    const cat = target('Cat', {id: 'c'});
    const copy = target('Cat2', {id: 'c2'});
    const store = createPaletteVisibilityStore();
    store.set(cat, ['events'], []);
    store.copy(cat, copy);
    assert.deepEqual([...store.visible(copy, [])], ['events']);
});

test('a saved slice comes back by sprite name, with the project sets', () => {
    const stage = target('Stage', {isStage: true, id: 'new-s'});
    const cat = target('Cat', {id: 'new-c'});
    const dog = target('Dog', {id: 'new-d'});
    const store = createPaletteVisibilityStore();
    store.apply({version: 1, stage: {groups: ['looks']}, sprites: {Cat: {groups: ['events']}, Gone: {groups: ['sound']}},
        sets: {logic: {name: 'ロジック専用', groups: ['events', 'control']}, broken: {name: 3}}}, [stage, cat, dog]);
    assert.deepEqual([...store.visible(stage, [])], ['looks']);
    assert.deepEqual([...store.visible(cat, [])], ['events']);
    assert.deepEqual([...store.visible(dog, [])], [...standardGroups]);
    assert.deepEqual(store.sets(), {logic: {name: 'ロジック専用', groups: ['events', 'control']}});
    assert.deepEqual(paletteGroupSets('ja', store.sets()).map(set => set.name), ['標準', '表現', '変数・リスト', '基本の制御', 'ロジック専用']);
    assert.deepEqual(paletteGroupSets('en').map(set => set.name), ['Standard', 'Expression', 'Variables and lists', 'Basic control']);
    store.addSets([{id: 'more', name: 'More', groups: ['sound']}]);
    assert.deepEqual(store.capture([stage, cat, dog]), {version: 1, stage: {groups: ['looks']}, sprites: {Cat: {groups: ['events']}},
        sets: {logic: {name: 'ロジック専用', groups: ['events', 'control']}, more: {name: 'More', groups: ['sound']}}});
});

test('a value that is not a saved slice, or a reset, leaves every target at its default', () => {
    const cat = target('Cat');
    const store = createPaletteVisibilityStore();
    store.set(cat, ['events'], []);
    store.apply({version: 2, sprites: {Cat: {groups: ['looks']}}}, [cat]);
    assert.deepEqual([...store.visible(cat, [])], [...standardGroups]);
    store.set(cat, ['events'], []);
    store.addSets([{id: 'x', name: 'X', groups: []}]);
    store.reset();
    assert.equal(store.capture([cat]), undefined);
});

test('the toolbox keeps only the categories the target shows', () => {
    const {window} = new JSDOM('');
    const tree = new window.DOMParser().parseFromString(
        '<xml><category id="motion"/><category id="looks"/><category id="pen"/><sep/><category/></xml>', 'text/xml').documentElement;
    filterToolboxTree(tree, new Set(['looks']));
    assert.deepEqual([...tree.children].map(child => child.getAttribute('id') ?? child.tagName), ['looks', 'sep', 'category']);
    filterToolboxTree(null, new Set());
});

// The category info the VM keeps for an extension that declares a geometry group and an untouched block.
function geometryRuntime() {
    const runtime = {
        _blockInfo: [],
        _fillExtensionCategory(categoryInfo, extensionInfo) {
            categoryInfo.blocks = extensionInfo.blocks.map(info => ({
                info, json: {type: `${extensionInfo.id}_${info.opcode}`, colour: '#000000', colourSecondary: '#111111'}
            }));
        }
    };
    const remove = installExtensionPaletteGroups(runtime);
    const categoryInfo = {id: 'shapes', name: 'Shapes', color1: '#0fbd8c', color2: '#0da57a'};
    runtime._fillExtensionCategory(categoryInfo, {
        id: 'shapes',
        groups: [{id: 'geometry', name: 'Geometry', color1: '#ff0000'}, {id: 'text', name: 'Text'}, {id: 'bad id', name: 'x'},
            {id: 'geometry', name: 'again'}, {id: 'unused', name: 'Unused'}],
        blocks: [{opcode: 'circle', paletteGroup: 'geometry'}, {opcode: 'square', paletteGroup: 'geometry', color1: '#00ff00'},
            {opcode: 'write', paletteGroup: 'text'}, {opcode: 'reset'}, {opcode: 'odd', paletteGroup: 'nowhere'}]
    });
    runtime._blockInfo.push(categoryInfo, {id: 'pen', name: 'Pen', blocks: [{info: {}, json: {type: 'pen_clear'}}]});
    return {runtime, categoryInfo, remove};
}

test('an extension that declares groups offers each of them, and its unmarked blocks as one more group', () => {
    const {runtime, categoryInfo, remove} = geometryRuntime();
    const catalog = extensionPaletteCatalog(runtime._blockInfo);
    assert.deepEqual(catalog.groups.map(group => [group.id, group.name, group.declared, group.color1]), [
        ['shapes', 'Shapes', false, '#0fbd8c'],
        ['shapes/geometry', 'Geometry', true, '#ff0000'],
        ['shapes/text', 'Text', true, '#0fbd8c'],
        ['pen', 'Pen', false, undefined]
    ]);
    assert.equal(groupOfOpcode('shapes_circle', catalog), 'shapes/geometry');
    assert.equal(groupOfOpcode('shapes_reset', catalog), 'shapes');
    assert.equal(groupOfOpcode('shapes_odd', catalog), 'shapes');
    // A group's colour draws its blocks unless a block has its own.
    assert.deepEqual(categoryInfo.blocks.map(block => block.json.colour), ['#ff0000', '#000000', '#000000', '#000000', '#000000']);
    const cat = target('Cat', {opcodes: ['shapes_circle', 'shapes_write', 'shapes_write']});
    assert.deepEqual(Object.fromEntries(usedGroups(cat, catalog)), {'shapes/geometry': 1, 'shapes/text': 2});
    const ids = catalog.groups.map(group => group.id);
    assert.deepEqual(defaultVisibleGroups(cat, ids, catalog), [...standardGroups, 'shapes/geometry', 'shapes/text']);
    const store = createPaletteVisibilityStore({catalog: () => catalog});
    assert.deepEqual([...store.visible(cat, ids)], [...standardGroups, 'shapes/geometry', 'shapes/text']);
    remove();
    assert.equal(Object.hasOwn(runtime, '_fillExtensionCategory'), true);
    assert.equal(installExtensionPaletteGroups({})(), undefined, 'a VM without the method is left alone');
});

test('the toolbox splits an extension into its groups before it keeps the shown ones', () => {
    const {runtime} = geometryRuntime();
    const catalog = extensionPaletteCatalog(runtime._blockInfo);
    const {window} = new JSDOM('');
    const parse = () => new window.DOMParser().parseFromString(
        '<xml><category id="motion"/><category id="shapes" name="Shapes" colour="#0fbd8c" showStatusButton="true" iconURI="i.svg">' +
        '<button text="Docs"/><label text="Draw"/><block type="shapes_circle"/><block type="shapes_square"/><sep gap="36"/>' +
        '<block type="shapes_reset"/><block type="shapes_write"/><sep/></category><category id="pen"/></xml>',
        'text/xml').documentElement;
    const tree = parse();
    filterToolboxTree(tree, new Set(['motion', 'shapes', 'shapes/geometry', 'shapes/text', 'pen']), catalog);
    const categories = [...tree.children].map(category => ({
        id: category.getAttribute('id'), name: category.getAttribute('name'), colour: category.getAttribute('colour'),
        status: category.getAttribute('showStatusButton'), icon: category.getAttribute('iconURI'),
        items: [...category.children].map(item => item.getAttribute('type') ?? item.tagName)
    }));
    assert.deepEqual(categories, [
        {id: 'motion', name: null, colour: null, status: null, icon: null, items: []},
        {id: 'shapes', name: 'Shapes', colour: '#0fbd8c', status: 'true', icon: 'i.svg', items: ['sep', 'shapes_reset']},
        {id: 'shapes/geometry', name: 'Geometry', colour: '#ff0000', status: null, icon: 'i.svg',
            items: ['button', 'label', 'shapes_circle', 'shapes_square']},
        {id: 'shapes/text', name: 'Text', colour: '#0fbd8c', status: null, icon: 'i.svg', items: ['shapes_write', 'sep']},
        {id: 'pen', name: null, colour: null, status: null, icon: null, items: []}
    ]);
    const hidden = parse();
    filterToolboxTree(hidden, new Set(['shapes/text']), catalog);
    assert.deepEqual([...hidden.children].map(category => category.getAttribute('id')), ['shapes/text']);
});

test('the ▼ button sits after the categories and lists the host items without pressing a category', () => {
    const {window} = new JSDOM('<body><div id="menu"><table><tr><td>Motion</td></tr></table></div></body>');
    const document = window.document;
    const menu = document.getElementById('menu');
    let presses = 0;
    menu.addEventListener('mousedown', () => {presses++;});
    const chosen = [];
    let locale = 'ja';
    const attached = attachPaletteMenuButton(menu, () => locale, current => [
        {label: paletteVisibilityMenuLabel(current), onSelect: () => chosen.push('groups')},
        {label: current === 'ja' ? '機能拡張を追加' : 'Add extension', separated: true, onSelect: () => chosen.push('extension')}
    ]);
    const {button} = attached;
    assert.equal(menu.lastElementChild, button);
    assert.equal(button.textContent, '▼');
    assert.equal(button.getAttribute('aria-label'), 'パレットのメニュー');
    button.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true}));
    button.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
    assert.equal(presses, 0);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    const items = () => [...document.querySelectorAll('.tw-palette-menu [role="menuitem"]')];
    assert.deepEqual(items().map(item => item.textContent), ['ブロックグループの表示・非表示の設定', '機能拡張を追加']);
    assert.equal(document.querySelectorAll('.tw-palette-menu [role="separator"]').length, 1);
    assert.equal(document.activeElement, items()[0]);
    document.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'ArrowDown'}));
    assert.equal(document.activeElement, items()[1]);
    items()[0].dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
    assert.deepEqual(chosen, ['groups']);
    assert.equal(document.querySelector('.tw-palette-menu'), null);
    assert.equal(button.getAttribute('aria-expanded'), 'false');

    button.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
    document.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape'}));
    assert.equal(document.querySelector('.tw-palette-menu'), null);
    assert.equal(document.activeElement, button);
    button.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
    document.body.dispatchEvent(new window.MouseEvent('pointerdown', {bubbles: true}));
    assert.equal(document.querySelector('.tw-palette-menu'), null, 'a press outside closes the menu');

    menu.append(document.createElement('table'));
    locale = 'en';
    attached.update();
    assert.equal(menu.lastElementChild, button);
    assert.equal(button.title, 'Palette menu');
    attached.dispose();
    assert.equal(menu.querySelector('button'), null);
});
