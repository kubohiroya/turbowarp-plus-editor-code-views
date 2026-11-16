import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {blockPaletteCommentReference, extractBlockPalette, formatBlockPaletteComment} from '@kubohiroya/sb3-toolchain/browser';
import {attachPaletteMenuButton, defaultVisibleGroups, filterToolboxTree, groupOfOpcode, paletteGroupSets, paletteVisibilityMenuLabel, readTargetPalette, standardGroups,
    usedGroups, visibleGroups, writeTargetPalette} from '../dist/palette-category-visibility.js';

function target(name, {isStage = false, opcodes = [], comments = {}} = {}) {
    const blocks = Object.fromEntries(opcodes.map((opcode, index) => [`b${index}`, {opcode, shadow: opcode.endsWith('_menu')}]));
    return {
        isStage, getName: () => name, blocks: {_blocks: blocks}, comments,
        createComment(id, blockId, text, x, y, width, height, minimized) {
            this.comments[id] = {id, blockId, text, x, y, width, height, minimized};
        },
        deleteComment(id) {delete this.comments[id];}
    };
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
    assert.deepEqual(defaultVisibleGroups(cat, ['pen', 'music']), [...standardGroups, 'pen']);
    assert.deepEqual([...visibleGroups(cat, ['pen', 'music'])], [...standardGroups, 'pen']);
});

test('a sprite setting is written as the toolchain formats it, and read back', () => {
    const cat = target('Cat');
    writeTargetPalette(cat, ['events', 'control', 'pen'], {extensionIds: ['pen']});
    const [comment] = Object.values(cat.comments);
    assert.equal(comment.minimized, true);
    assert.equal(comment.text, formatBlockPaletteComment(
        {formatVersion: 1, sprites: {Cat: {groups: ['events', 'control', 'pen']}}}, {isStage: false, name: 'Cat'}));
    assert.deepEqual(readTargetPalette(cat).groups, ['events', 'control', 'pen']);
    assert.deepEqual([...visibleGroups(cat, ['pen'])], ['events', 'control', 'pen']);

    writeTargetPalette(cat, ['motion'], {extensionIds: ['pen']});
    assert.equal(Object.keys(cat.comments).length, 1, 'the same comment is updated');
    assert.deepEqual(readTargetPalette(cat).groups, ['motion']);
});

test('going back to the default removes the sprite comment', () => {
    const cat = target('Cat', {opcodes: ['pen_clear']});
    writeTargetPalette(cat, ['events'], {extensionIds: ['pen']});
    writeTargetPalette(cat, [...standardGroups, 'pen'], {extensionIds: ['pen']});
    assert.deepEqual(cat.comments, {});
});

test('the stage keeps project sets in its comment even with default groups', () => {
    const stage = target('Stage', {isStage: true});
    const sets = {logic: {name: 'ロジック専用', groups: ['events', 'control', 'operators']}};
    writeTargetPalette(stage, [...standardGroups], {sets});
    const palette = readTargetPalette(stage);
    assert.deepEqual(palette.sets, sets);
    assert.equal(palette.groups, undefined);
    assert.deepEqual(paletteGroupSets('ja', palette.sets).map(set => set.name), ['標準', '表現', '変数・リスト', '基本の制御', 'ロジック専用']);
    assert.deepEqual(paletteGroupSets('en').map(set => set.name), ['Standard', 'Expression', 'Variables and lists', 'Basic control']);
});

test('the comments written here are the ones sb3-toolchain moves into block-palette.json', () => {
    const stage = target('Stage', {isStage: true});
    const cat = target('Cat');
    writeTargetPalette(stage, ['events', 'looks'], {order: ['events', 'looks']});
    writeTargetPalette(cat, ['events', 'pen'], {extensionIds: ['pen']});
    const project = {targets: [stage, cat].map(item => ({isStage: item.isStage, name: item.getName(), comments: structuredClone(item.comments)}))};
    const {document, warnings} = extractBlockPalette(project);
    assert.deepEqual(warnings, []);
    assert.deepEqual(document, {formatVersion: 1, order: ['events', 'looks'], stage: {groups: ['events', 'looks']},
        sprites: {Cat: {groups: ['events', 'pen']}}});
    assert.equal(Object.values(project.targets[1].comments)[0].text, blockPaletteCommentReference);
});

test('a broken palette comment counts as no setting', () => {
    const cat = target('Cat', {comments: {x: {text: 'header\n{not json // _twplus_palette_'}}});
    assert.equal(readTargetPalette(cat), null);
    assert.deepEqual([...visibleGroups(cat, [])], [...standardGroups]);
});

test('the toolbox keeps only the categories the target shows', () => {
    const {window} = new JSDOM('');
    const tree = new window.DOMParser().parseFromString(
        '<xml><category id="motion"/><category id="looks"/><category id="pen"/><sep/><category/></xml>', 'text/xml').documentElement;
    filterToolboxTree(tree, new Set(['looks']));
    assert.deepEqual([...tree.children].map(child => child.getAttribute('id') ?? child.tagName), ['looks', 'sep', 'category']);
    filterToolboxTree(null, new Set());
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
