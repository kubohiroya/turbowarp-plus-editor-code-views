import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {dom} from './jsdom-globals.ts';
import {openPaletteVisibilityDialog} from '../dist/palette-visibility-dialog.js';
import {paletteGroupSets, standardGroups} from '../dist/palette-category-visibility.js';

// jsdom's window keeps timers alive until it is closed.
after(() => dom.window.close());

function open(overrides = {}) {
    // A test that failed may leave its dialog open; never read it in the next one.
    for (const left of document.querySelectorAll('dialog')) left.remove();
    let choice;
    let cancelled = 0;
    const close = openPaletteVisibilityDialog(document, {
        locale: 'ja', targetName: 'ネコ', isStage: false,
        initial: new Set(['motion', 'looks', 'sound', 'events', 'control', 'sensing', 'operators', 'myBlocks', 'pen']),
        used: new Map([['lists', 2], ['pen', 1]]),
        extensions: [{id: 'pen', metadata: {name: 'Pen Plus', author: 'Creator', version: '2.0.0'}},
            {id: 'nameddata', metadata: {name: '名前付きデータ'}}],
        sets: paletteGroupSets('ja'),
        onApply: value => {choice = value;},
        onCancel: () => {cancelled++;},
        ...overrides
    });
    const dialog = document.querySelector('dialog.tw-palette-visibility-dialog');
    const click = element => element.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));
    return {
        dialog, close, click,
        get choice() {return choice;},
        get cancelled() {return cancelled;},
        text: () => dialog.textContent,
        group: id => dialog.querySelector(`[data-group="${id}"] input[type="checkbox"]`),
        set: id => dialog.querySelector(`[data-set="${id}"]`),
        button: label => [...dialog.querySelectorAll('button')].find(button => button.textContent.trim() === label)
    };
}

test('the screen uses the agreed headings and wording', () => {
    const view = open();
    const text = view.text();
    for (const words of ['パレット内のブロックグループの表示・非表示の設定', 'スプライト「ネコ」',         'まとめて選ぶ', '設定のショートカット', '＋設定のショートカットを追加', '標準のブロックグループ', '機能拡張のブロックグループ', 'キャンセル', '確定']) {
        assert.ok(text.includes(words), words);
    }
    assert.ok(text.includes('使用中 2'), 'a hidden group that the code uses is marked');
    assert.ok(text.includes('非表示中・使用中 1 件'));
    assert.equal(view.dialog.querySelector('[data-group="pen"] .twextsec-head strong').textContent, 'Pen Plus');
    view.close();
    assert.equal(document.querySelector('dialog'), null);
});

test('checking groups and applying returns the shown groups in palette order', () => {
    const view = open();
    view.click(view.group('lists'));
    view.click(view.group('motion'));
    view.click(view.group('nameddata'));
    assert.ok(!view.text().includes('非表示中・使用中'), 'nothing in use is hidden any more');
    view.click(view.button('確定'));
    assert.deepEqual(view.choice, {groups: ['looks', 'sound', 'events', 'control', 'sensing', 'operators', 'lists', 'myBlocks',
        'pen', 'nameddata'], addedSets: []});
    assert.equal(document.querySelector('dialog'), null);
});

test('a set switches its groups together and shows whether all of them are shown', () => {
    const view = open();
    const expression = () => view.set('expression');
    assert.equal(expression().getAttribute('aria-pressed'), 'true');
    view.click(expression());
    for (const group of ['motion', 'looks', 'sound', 'sensing']) assert.equal(view.group(group).checked, false, group);
    assert.equal(expression().getAttribute('aria-pressed'), 'false');
    view.click(view.set('data'));
    assert.equal(view.group('variables').checked, true);
    assert.equal(view.group('lists').checked, true);
    view.close();
});

test('the current choice can be kept as a new applicable set', () => {
    const view = open();
    view.click(view.button('＋設定のショートカットを追加'));
    const input = view.dialog.querySelector('.tw-palette-visibility-naming input');
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'ロジック専用');
    input.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    view.click(view.button('追加'));
    assert.ok(view.text().includes('ロジック専用'));
    view.click(view.button('確定'));
    assert.equal(view.choice.addedSets.length, 1);
    assert.equal(view.choice.addedSets[0].name, 'ロジック専用');
    assert.deepEqual(view.choice.addedSets[0].groups, view.choice.groups);
});

test('the stage has no motion group, and cancel or Escape leaves without applying', () => {
    const stage = open({isStage: true, targetName: 'Stage', locale: 'en', sets: paletteGroupSets('en')});
    assert.equal(stage.group('motion'), null);
    assert.ok(stage.text().includes('Block groups shown in the palette'));
    assert.equal(standardGroups.filter(group => stage.group(group)).length, standardGroups.length - 1);
    stage.click(stage.button('Cancel'));
    assert.equal(stage.cancelled, 1);
    assert.equal(stage.choice, undefined);

    // The stage that owns scripts is "ステージ"; "背景" names only its backdrop images.
    const japaneseStage = open({isStage: true, targetName: 'Stage'});
    assert.ok(japaneseStage.text().includes('ステージ'));
    assert.equal(japaneseStage.text().includes('背景'), false);
    japaneseStage.close();

    const escaped = open();
    escaped.dialog.dispatchEvent(new dom.window.Event('cancel', {cancelable: true}));
    assert.equal(escaped.cancelled, 1);
    assert.equal(document.querySelector('dialog'), null);
});

test('for a new sprite the screen names it as new and offers nothing else to decide', () => {
    const view = open({newSprite: true, targetName: 'スプライト2'});
    assert.ok(view.text().includes('新しいスプライト「スプライト2」'));
    assert.equal(view.dialog.querySelectorAll('footer input').length, 0);
    view.click(view.button('確定'));
    assert.deepEqual(Object.keys(view.choice), ['groups', 'addedSets']);
});

test('a new sprite copies the groups an existing sprite shows into its choices, which are adjusted and applied', () => {
    const view = open({newSprite: true, targetName: 'スプライト3', copySources: [
        {name: 'スプライト1', groups: ['events', 'control', 'pen']},
        {name: 'スプライト2', groups: ['looks', 'nameddata', 'unknownExt']}
    ]});
    assert.ok(view.text().includes('設定のコピー元'));
    const select = view.dialog.querySelector('.tw-palette-visibility-copy select');
    assert.deepEqual([...select.options].map(option => option.textContent), ['スプライトを選ぶ', 'スプライト1', 'スプライト2']);
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set;
    setter.call(select, '1');
    select.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    view.click(view.button('コピー'));
    // The copy is shown and nothing is applied yet.
    assert.notEqual(document.querySelector('dialog'), null);
    assert.equal(view.choice, undefined);
    assert.equal(view.group('looks').checked, true);
    assert.equal(view.group('nameddata').checked, true);
    assert.equal(view.group('events').checked, false);
    assert.equal(view.group('pen').checked, false);
    // The person adds and removes checks, then applies.
    view.click(view.group('events'));
    view.click(view.group('nameddata'));
    view.click(view.button('確定'));
    assert.deepEqual(view.choice, {groups: ['looks', 'events'], addedSets: []});
    assert.equal(document.querySelector('dialog'), null);
});

test('the copy choice is offered only for a new sprite with other sprites to copy', () => {
    const first = open({newSprite: true, copySources: []});
    assert.equal(first.dialog.querySelector('.tw-palette-visibility-copy'), null);
    first.close();
    const ordinary = open({copySources: [{name: 'スプライト1', groups: ['events']}]});
    assert.equal(ordinary.dialog.querySelector('.tw-palette-visibility-copy'), null);
    ordinary.close();
});

test('pointing at a shortcut or the copy source marks the groups it would choose', () => {
    const view = open({newSprite: true, copySources: [{name: 'スプライト1', groups: ['events', 'pen']}]});
    const marked = () => [...view.dialog.querySelectorAll('[data-highlighted]')].map(element => element.getAttribute('data-group'));
    const enter = element => element.dispatchEvent(new dom.window.MouseEvent('mouseover', {bubbles: true, relatedTarget: document.body}));
    const leave = element => element.dispatchEvent(new dom.window.MouseEvent('mouseout', {bubbles: true, relatedTarget: document.body}));
    assert.deepEqual(marked(), []);
    enter(view.set('data'));
    assert.deepEqual(marked(), ['variables', 'lists']);
    leave(view.set('data'));
    assert.deepEqual(marked(), []);
    const copyPanel = view.dialog.querySelector('[aria-label="設定のコピー元"][role="group"]');
    enter(copyPanel);
    assert.deepEqual(marked(), [], 'no copy source is chosen yet');
    leave(copyPanel);
    // The two ways to choose sit side by side.
    assert.equal(view.dialog.querySelector('.tw-palette-visibility-quick').getAttribute('data-columns'), '2');
    view.close();
    const single = open();
    assert.equal(single.dialog.querySelector('.tw-palette-visibility-quick').getAttribute('data-columns'), '1');
    single.close();
});

test('while a copy source is chosen, the groups it would choose stay marked', () => {
    const view = open({newSprite: true, copySources: [{name: 'スプライト1', groups: ['events', 'pen']},
        {name: 'スプライト2', groups: ['looks']}]});
    const marked = () => [...view.dialog.querySelectorAll('[data-highlighted]')].map(element => element.getAttribute('data-group'));
    const select = view.dialog.querySelector('.tw-palette-visibility-copy select');
    const copy = view.button('コピー');
    const choose = value => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(select, value);
        select.dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    };
    assert.equal(select.value, '');
    assert.equal(copy.disabled, true);
    assert.deepEqual(marked(), []);
    choose('0');
    assert.deepEqual(marked(), ['events', 'pen']);
    assert.equal(copy.disabled, false);
    // A shortcut under the pointer shows its own groups, and the chosen source comes back after.
    const enter = element => element.dispatchEvent(new dom.window.MouseEvent('mouseover', {bubbles: true, relatedTarget: document.body}));
    const leave = element => element.dispatchEvent(new dom.window.MouseEvent('mouseout', {bubbles: true, relatedTarget: document.body}));
    enter(view.set('data'));
    assert.deepEqual(marked(), ['variables', 'lists']);
    leave(view.set('data'));
    assert.deepEqual(marked(), ['events', 'pen']);
    choose('1');
    assert.deepEqual(marked(), ['looks']);
    choose('');
    assert.deepEqual(marked(), []);
    view.close();
});

test('an extension that declares groups offers each of them inside its row', () => {
    const view = open({
        initial: new Set(['looks', 'shapes/geometry']),
        used: new Map([['shapes/text', 3]]),
        extensions: [{id: 'shapes', metadata: {name: 'Shapes'}, groups: [
            {id: 'shapes', name: 'Shapes'}, {id: 'shapes/geometry', name: '図形', color: '#ff0000'}, {id: 'shapes/text', name: '文字'}
        ]}]
    });
    const row = view.dialog.querySelector('[data-extension="shapes"]');
    assert.deepEqual([...row.querySelectorAll('[data-group]')].map(label => label.textContent),
        ['●そのほかのブロック', '●図形', '●文字使用中 3']);
    assert.equal(row.querySelector('.twextsec-head input'), null, 'the extension itself has no checkbox');
    assert.equal(view.group('shapes/geometry').checked, true);
    view.click(view.group('shapes/text'));
    view.click(view.group('shapes/geometry'));
    view.click(view.button('確定'));
    assert.deepEqual(view.choice.groups, ['looks', 'shapes/text']);
});
