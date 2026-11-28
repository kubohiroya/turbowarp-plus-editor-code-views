import assert from 'node:assert/strict';
import {test} from 'node:test';

import {JSDOM} from 'jsdom';

import {attachPaletteCategoryGroups, filterGroupedToolboxTree, flattenCategoryGroups, hasCategoryGroups, prepareGroupedToolboxTree} from
    '../dist/palette-category-groups.js';
import {createPaletteOrder, createPaletteVisibilityStore, extensionPaletteCatalog, filterToolboxTree, splitExtensionCategories} from
    '../dist/palette-category-visibility.js';

const toolbox = `<xml>
<category id="motion"><block type="motion_movesteps"/></category>
<category id="media">
  <category id="looks"><block type="looks_show"/></category>
  <category id="sound"><block type="sound_play"/></category>
  <category id="more">
    <category id="events"><block type="event_whenflagclicked"/></category>
    <category><block type="control_wait"/></category>
  </category>
</category>
<category id="operators"><block type="operator_add"/></category>
</xml>`;

const parse = (source: string) => {
    const dom = new JSDOM('<!doctype html><body></body>');
    return {dom, tree: new dom.window.DOMParser().parseFromString(source, 'text/xml').documentElement};
};
const topLevel = (tree: Element) => Array.from(tree.children).map(category =>
    `${category.getAttribute('id')}${category.getAttribute('palette-group-parent') ? `<${category.getAttribute('palette-group-parent')}` : ''}`);

test('nested categories are moved after their group, depth first, and named by the group', () => {
    const {tree} = parse(toolbox);
    const groups = flattenCategoryGroups(tree);
    assert.deepEqual(topLevel(tree),
        ['motion', 'media', 'looks<media', 'sound<media', 'more<media', 'events<more', 'more/1<more', 'operators']);
    assert.deepEqual([...groups.members], [['media', ['looks', 'sound', 'more']], ['more', ['events', 'more/1']]]);
    assert.equal(groups.withOwnContents.size, 0);
    assert.equal(tree.querySelector('category category'), null);
});

test('a filter by id keeps the groups that still have members and drops the empty ones', () => {
    const {tree} = parse(toolbox);
    const groups = flattenCategoryGroups(tree);
    const visible = new Set(['motion', 'looks']);
    const remaining = filterGroupedToolboxTree(tree, groups, filtered => {
        for (const category of Array.from(filtered.querySelectorAll(':scope > category'))) {
            if (!visible.has(category.getAttribute('id')!)) category.remove();
        }
    });
    assert.deepEqual(topLevel(tree), ['motion', 'media', 'looks<media']);
    assert.deepEqual([...remaining.members], [['media', ['looks']]]);
});

test('a group opens its members in a child palette, and a click outside closes it', () => {
    const {dom, tree} = parse(toolbox);
    const doc = dom.window.document;
    const groups = flattenCategoryGroups(tree);
    const wrapper = doc.createElement('div');
    const menu = doc.createElement('div');
    const table = doc.createElement('div');
    table.className = 'scratchCategoryMenu';
    menu.append(table);
    wrapper.append(menu);
    doc.body.append(wrapper);
    const chosen: string[] = [];
    const categories = Array.from(tree.children).map(element => {
        const row = doc.createElement('div');
        const item = doc.createElement('div');
        item.className = `scratchCategoryMenuItem scratchCategoryId-${element.getAttribute('id')}`;
        item.textContent = element.getAttribute('id');
        row.append(item);
        table.append(row);
        return {id_: element.getAttribute('id')!, name_: element.getAttribute('id')!, item_: item, setSelected(selected: boolean) {
            item.classList.toggle('categorySelected', selected);
        }};
    });
    const controller = attachPaletteCategoryGroups(menu, {
        categories: () => categories,
        horizontal: () => true,
        choose: category => chosen.push(category.id_)
    });
    controller.update(groups);
    const byId = (id: string) => categories.find(category => category.id_ === id)!;
    assert.deepEqual(categories.filter(category => !category.item_.parentElement!.hidden).map(category => category.id_),
        ['motion', 'media', 'operators']);
    assert.equal(byId('media').item_.getAttribute('aria-haspopup'), 'true');
    assert.equal(controller.anchorOf(byId('events')), byId('media').item_);

    // Scratch Blocks would open the category on mouseup; a group's icon keeps it to itself.
    let reached = false;
    byId('media').item_.addEventListener('mouseup', () => { reached = true; });
    byId('media').item_.dispatchEvent(new dom.window.MouseEvent('mouseup', {bubbles: true}));
    assert.equal(reached, false);

    const click = (element: Element) => element.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));
    const popups = () => Array.from(doc.querySelectorAll('[data-palette-group-popup]'),
        popup => `${popup.getAttribute('data-palette-group-popup')}:${Array.from(popup.querySelectorAll('[data-palette-group-item]'),
            item => item.getAttribute('data-palette-group-item')).join(',')}`);
    click(byId('media').item_);
    assert.deepEqual(popups(), ['media:looks,sound,more']);
    assert.ok(doc.querySelector('[data-palette-group-popup]')!.hasAttribute('data-horizontal'));
    assert.equal(byId('media').item_.getAttribute('aria-expanded'), 'true');

    click(doc.querySelector('[data-palette-group-item="more"]')!);
    assert.deepEqual(popups(), ['media:looks,sound,more', 'more:events,more/1']);

    // Another member of the outer palette closes the inner one.
    click(doc.querySelector('[data-palette-group-item="more"]')!);
    assert.deepEqual(popups(), ['media:looks,sound,more']);
    click(doc.querySelector('[data-palette-group-item="more"]')!);

    click(doc.querySelector('[data-palette-group-item="events"]')!);
    assert.deepEqual(chosen, ['events']);
    assert.deepEqual(popups(), []);
    byId('events').setSelected(true);
    assert.ok(byId('media').item_.classList.contains('categorySelected'));
    assert.ok(byId('media').item_.hasAttribute('data-palette-group-current'));

    click(byId('media').item_);
    assert.equal(controller.isOpen(), true);
    doc.querySelector('[data-palette-group-popup]')!.dispatchEvent(new dom.window.Event('pointerdown', {bubbles: true}));
    assert.equal(controller.isOpen(), true);
    doc.body.dispatchEvent(new dom.window.Event('pointerdown', {bubbles: true}));
    assert.equal(controller.isOpen(), false);
    assert.equal(byId('media').item_.getAttribute('aria-expanded'), 'false');

    // Clicking the group's icon again closes its child palette.
    click(byId('media').item_);
    click(byId('media').item_);
    assert.equal(controller.isOpen(), false);

    click(byId('media').item_);
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    assert.equal(controller.isOpen(), false);

    controller.dispose();
    click(byId('media').item_);
    assert.equal(controller.isOpen(), false);
});

test('a group with blocks of its own offers them first, and keeps only the way to its members when they are hidden', () => {
    const source = '<xml><category id="g"><block type="a"/><category id="c"><block type="b"/></category></category></xml>';
    let {tree} = parse(source);
    let groups = flattenCategoryGroups(tree);
    assert.deepEqual([...groups.withOwnContents], ['g']);
    let remaining = filterGroupedToolboxTree(tree, groups, filtered => {
        filtered.querySelector(':scope > category[id="c"]')?.remove();
    });
    assert.deepEqual([...remaining.members], [['g', []]]);
    assert.deepEqual(topLevel(tree), ['g']);
    assert.equal(tree.querySelector('category[id="g"]')!.childElementCount, 1);

    ({tree} = parse(source));
    groups = flattenCategoryGroups(tree);
    remaining = filterGroupedToolboxTree(tree, groups, filtered => filterToolboxTree(filtered, new Set(['c'])));
    assert.deepEqual(topLevel(tree), ['g', 'c<g']);
    assert.equal(tree.querySelector('category[id="g"]')!.childElementCount, 0);
    assert.deepEqual([...remaining.withOwnContents], []);

    ({tree} = parse(source));
    groups = flattenCategoryGroups(tree);
    filterGroupedToolboxTree(tree, groups, filtered => filterToolboxTree(filtered, new Set()));
    assert.deepEqual(topLevel(tree), []);
});

test('an extension that declares groups becomes a group of its declared groups', () => {
    const catalog = extensionPaletteCatalog([{
        id: 'shapes', name: 'Shapes', color1: '#0fbd8c',
        paletteGroups: [{id: 'geometry', name: 'Geometry', color1: '#ff0000'}, {id: 'text', name: 'Text'}],
        blocks: [
            {info: {paletteGroup: 'geometry'}, json: {type: 'shapes_circle'}},
            {info: {}, json: {type: 'shapes_reset'}},
            {info: {paletteGroup: 'text'}, json: {type: 'shapes_write'}}
        ]
    }]);
    const {tree} = parse('<xml><category id="motion"/><category id="shapes" name="Shapes" showStatusButton="true">' +
        '<label text="Draw"/><block type="shapes_circle"/><block type="shapes_reset"/><block type="shapes_write"/></category></xml>');
    splitExtensionCategories(tree, catalog, {nested: true});
    const shapes = tree.querySelector(':scope > category[id="shapes"]')!;
    assert.deepEqual(Array.from(shapes.children, child => child.getAttribute('id') ?? child.getAttribute('type')),
        ['shapes_reset', 'shapes/geometry', 'shapes/text']);
    assert.equal(shapes.getAttribute('showStatusButton'), 'true');
    assert.equal(shapes.querySelector('category[id="shapes/geometry"]')!.getAttribute('colour'), '#ff0000');
    const groups = flattenCategoryGroups(tree);
    assert.deepEqual([...groups.members], [['shapes', ['shapes/geometry', 'shapes/text']]]);
    assert.deepEqual([...groups.withOwnContents], ['shapes']);
    const remaining = filterGroupedToolboxTree(tree, groups,
        filtered => filterToolboxTree(filtered, new Set(['motion', 'shapes/text'])));
    assert.deepEqual(topLevel(tree), ['motion', 'shapes', 'shapes/text<shapes']);
    assert.deepEqual([...remaining.members], [['shapes', ['shapes/text']]]);
});

test('a toolbox tree is prepared in one step, and a group without blocks of its own is selected by its first member', () => {
    const catalog = extensionPaletteCatalog([{
        id: 'shapes', name: 'Shapes',
        paletteGroups: [{id: 'geometry', name: {en: 'Geometry', ja: '図形'}}, {id: 'text', name: 'Text'}],
        blocks: [{info: {paletteGroup: 'geometry'}, json: {type: 'shapes_circle'}}, {info: {paletteGroup: 'text'}, json: {type: 'shapes_write'}}]
    }], 'ja');
    const source = '<xml><category id="motion"/><category id="shapes" name="Shapes">' +
        '<block type="shapes_circle"/><block type="shapes_write"/></category></xml>';
    const {dom, tree} = parse(source);
    assert.equal(hasCategoryGroups(tree), false);
    const groups = prepareGroupedToolboxTree(tree, {catalog, visible: new Set(['motion', 'shapes/geometry', 'shapes/text'])});
    assert.deepEqual(topLevel(tree), ['motion', 'shapes', 'shapes/geometry<shapes', 'shapes/text<shapes']);
    assert.equal(tree.querySelector('category[id="shapes/geometry"]')!.getAttribute('name'), '図形');
    assert.equal(hasCategoryGroups(parse(source.replace('</category></xml>', '<category id="x"/></category></xml>')).tree), true);
    assert.deepEqual(topLevel((() => {
        const {tree: plain} = parse(source);
        prepareGroupedToolboxTree(plain);
        return plain;
    })()), ['motion', 'shapes']);

    const doc = dom.window.document;
    const menu = doc.createElement('div');
    doc.body.append(menu);
    const categories = Array.from(tree.children).map(element => {
        const row = doc.createElement('div');
        const item = doc.createElement('div');
        row.append(item);
        menu.append(row);
        return {id_: element.getAttribute('id')!, name_: '', item_: item, setSelected() {}};
    });
    let horizontal = true;
    const controller = attachPaletteCategoryGroups(menu, {categories: () => categories, horizontal: () => horizontal, choose() {}});
    controller.update(groups);
    assert.equal(controller.selectionTarget('shapes'), 'shapes/geometry');
    assert.equal(controller.selectionTarget('motion'), 'motion');
    const shapes = categories[1].item_;
    controller.syncButtons('shapes/text');
    assert.equal(shapes.getAttribute('role'), 'button');
    assert.equal(shapes.tabIndex, 0);
    assert.ok(shapes.hasAttribute('data-palette-group-shown'));
    horizontal = false;
    controller.syncButtons('shapes/text');
    assert.equal(shapes.hasAttribute('tabindex'), false);
    assert.equal(shapes.hasAttribute('data-palette-group-shown'), false);
    controller.dispose();
});

test('categories are arranged by their outermost group, each group followed by its members in order', () => {
    const {dom, tree} = parse(toolbox);
    const groups = flattenCategoryGroups(tree);
    const doc = dom.window.document;
    const menu = doc.createElement('div');
    doc.body.append(menu);
    const categories = Array.from(tree.children).map(element => {
        const row = doc.createElement('div');
        const item = doc.createElement('div');
        row.append(item);
        menu.append(row);
        return {id_: element.getAttribute('id')!, name_: '', item_: item, setSelected() {}};
    });
    const controller = attachPaletteCategoryGroups(menu, {categories: () => categories, horizontal: () => true, choose() {}, reorder: true});
    controller.update(groups);
    const ids = (list: {id_: string}[]) => list.map(category => category.id_).join(',');
    // Without an order of its own, the palette keeps its order, members after their group.
    const shuffled = [categories[7], categories[3], categories[0], categories[5], categories[1], categories[2], categories[4], categories[6]];
    assert.equal(ids(controller.arrange(shuffled, () => 0)), 'operators,media,looks,sound,more,events,more/1,motion');
    const order = ['operators', 'motion', 'media'];
    assert.equal(ids(controller.arrange(categories, id => order.indexOf(id))),
        'operators,motion,media,looks,sound,more,events,more/1');
    controller.dispose();
});

test('the order is saved with the palette settings and given back to a loaded project', () => {
    let changes = 0;
    const store = createPaletteVisibilityStore({onOrderChange: () => changes++});
    assert.equal(store.capture([]), undefined);
    store.order.setCategories(['operators', 'motion']);
    store.order.setMembers('media', ['more', 'looks', 'sound']);
    assert.equal(changes, 2);
    const saved = store.capture([]);
    assert.deepEqual(saved, {version: 1, order: {categories: ['operators', 'motion'], groups: {media: ['more', 'looks', 'sound']}}});
    const loaded = createPaletteVisibilityStore();
    loaded.apply(structuredClone(saved), []);
    assert.deepEqual(loaded.order.categories(), ['operators', 'motion']);
    assert.deepEqual(loaded.order.members('media'), ['more', 'looks', 'sound']);
    assert.equal(loaded.order.members('more'), undefined);
    loaded.apply({version: 1, order: {categories: 'motion', groups: {media: [1], more: ['control']}}}, []);
    assert.deepEqual(loaded.order.categories(), []);
    assert.deepEqual([loaded.order.members('media'), loaded.order.members('more')], [undefined, ['control']]);
    loaded.reset();
    assert.equal(loaded.capture([]), undefined);
});

test('a prepared tree puts each group\'s members in their saved order', () => {
    const {dom, tree} = parse(toolbox);
    const order = createPaletteOrder();
    order.setMembers('media', ['more', 'looks', 'sound']);
    order.setMembers('more', ['more/1', 'events']);
    const menu = dom.window.document.createElement('div');
    dom.window.document.body.append(menu);
    const controller = attachPaletteCategoryGroups(menu, {categories: () => [], horizontal: () => true, choose() {}, order: () => order});
    const groups = controller.prepare(tree);
    assert.deepEqual(topLevel(tree),
        ['motion', 'media', 'more<media', 'more/1<more', 'events<more', 'looks<media', 'sound<media', 'operators']);
    assert.deepEqual(groups.members.get('media'), ['more', 'looks', 'sound']);
    controller.dispose();
});

test('pinning a group shows its members after it in the palette that showed the group, and unpinning folds them back', () => {
    const {dom, tree} = parse(toolbox);
    const doc = dom.window.document;
    const order = createPaletteOrder();
    let changes = 0;
    order.subscribe(() => changes++);
    const groups = flattenCategoryGroups(tree);
    const menu = doc.createElement('div');
    doc.body.append(menu);
    const categories = Array.from(tree.children).map(element => {
        const row = doc.createElement('div');
        const item = doc.createElement('div');
        item.textContent = element.getAttribute('id');
        row.append(item);
        menu.append(row);
        return {id_: element.getAttribute('id')!, name_: '', item_: item, setSelected() {}};
    });
    const chosen: string[] = [];
    const controller = attachPaletteCategoryGroups(menu, {categories: () => categories, horizontal: () => true,
        choose: category => chosen.push(category.id_), order: () => order, locale: () => 'ja'});
    controller.update(groups);
    const byId = (id: string) => categories.find(category => category.id_ === id)!;
    const shown = () => categories.filter(category => !category.item_.parentElement!.hidden).map(category => category.id_).join(',');
    const click = (element: Element) => element.dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true}));
    const popupItems = (id: string) => Array.from(doc.querySelectorAll(`[data-palette-group-popup="${id}"] [data-palette-group-item]`),
        item => item.getAttribute('data-palette-group-item')).join(',');

    // The inner group, pinned from its child palette, joins the child palette it opened from.
    click(byId('media').item_);
    click(doc.querySelector('[data-palette-group-item="more"]')!);
    const pinMore = doc.querySelector('[data-palette-group-popup="more"] > [data-palette-group-pin="unpinned"]')!;
    assert.equal(pinMore.getAttribute('aria-label'), 'グループをパレットに広げて固定する');
    click(pinMore);
    assert.equal(order.isPinned('more'), true);
    assert.equal(doc.querySelector('[data-palette-group-popup="more"]'), null);
    assert.equal(popupItems('media'), 'looks,sound,more,events,more/1');
    assert.equal(shown(), 'motion,media,operators');
    assert.equal(controller.shownAs('events'), 'media');

    // The outer group, pinned, joins the palette itself, its pinned member with it.
    click(doc.querySelector('[data-palette-group-popup="media"] > [data-palette-group-pin="unpinned"]')!);
    assert.equal(doc.querySelectorAll('[data-palette-group-popup]').length, 0);
    assert.equal(shown(), 'motion,media,looks,sound,more,events,more/1,operators');
    assert.equal(controller.shownAs('events'), 'events');
    assert.equal(controller.isGroup('more'), true);
    assert.equal(controller.anchorOf(byId('looks')), byId('looks').item_);
    const unpin = byId('media').item_.querySelector('[data-palette-group-pin="pinned"]')!;
    assert.ok(unpin);
    assert.ok(byId('media').item_.hasAttribute('data-palette-group-pinned'));
    // A pinned group without blocks of its own opens nothing.
    click(byId('media').item_);
    assert.equal(controller.isOpen(), false);
    assert.deepEqual(chosen, []);

    // Unpinning the outer group folds it, and its pinned member stays pinned inside it.
    click(unpin);
    assert.equal(order.isPinned('media'), false);
    assert.equal(shown(), 'motion,media,operators');
    assert.equal(byId('media').item_.querySelector('[data-palette-group-pin]'), null);
    click(byId('media').item_);
    assert.equal(popupItems('media'), 'looks,sound,more,events,more/1');
    // Unpinning the inner group from the outer child palette draws it again.
    click(doc.querySelector('[data-palette-group-item="more"] > [data-palette-group-pin="pinned"]')!);
    assert.equal(order.isPinned('more'), false);
    assert.equal(popupItems('media'), 'looks,sound,more');
    assert.ok(changes >= 4);

    // Another palette given the same order follows it.
    order.setPinned('media', true);
    assert.equal(shown(), 'motion,media,looks,sound,more,operators');
    assert.deepEqual(createPaletteOrder().capture(), undefined);
    assert.deepEqual(order.capture(), {pinned: ['media']});
    controller.dispose();
});

test('a declared group with a parent is nested in its parent, which gets a category even without blocks of its own', () => {
    const catalog = extensionPaletteCatalog([{
        id: 'kami', name: 'Kamishibai',
        paletteGroups: [{id: 'library', name: {en: 'Libraries', ja: 'ライブラリ'}}, {id: 'assetcache', name: 'Asset Cache', parent: 'library'},
            {id: 'svg', name: 'SVG', parent: 'library'}, {id: 'text', name: 'SVG Text', parent: 'svg'}, {id: 'stage', name: 'Stage'}],
        blocks: [
            {info: {paletteGroup: 'stage'}, json: {type: 'kami_page'}},
            {info: {paletteGroup: 'assetcache'}, json: {type: 'kami_cache'}},
            {info: {paletteGroup: 'text'}, json: {type: 'kami_text'}}
        ]
    }], 'ja');
    const source = '<xml><category id="motion"/><category id="kami" name="Kamishibai" showStatusButton="true">' +
        '<block type="kami_page"/><label text="Cache"/><block type="kami_cache"/><block type="kami_text"/></category></xml>';
    const {tree: nested} = parse(source);
    splitExtensionCategories(nested, catalog, {nested: true});
    const outline = (category: Element): unknown => [category.getAttribute('id') ?? category.getAttribute('type') ?? category.tagName,
        ...Array.from(category.children).filter(child => child.tagName === 'category' || child.children.length).map(outline)];
    assert.deepEqual(outline(nested.querySelector(':scope > category[id="kami"]')!),
        ['kami', ['kami/library', ['kami/assetcache'], ['kami/svg', ['kami/text']]], ['kami/stage']]);
    const library = nested.querySelector('category[id="kami/library"]')!;
    assert.equal(library.getAttribute('name'), 'ライブラリ');
    assert.equal(library.hasAttribute('showStatusButton'), false);
    assert.deepEqual(Array.from(library.querySelector('category[id="kami/assetcache"]')!.children, child => child.tagName),
        ['label', 'block'], 'a label goes with its block into the nested group');

    const {tree} = parse(source);
    const groups = prepareGroupedToolboxTree(tree, {catalog, visible: new Set(['motion', 'kami/stage', 'kami/text'])});
    assert.deepEqual(topLevel(tree), ['motion', 'kami', 'kami/library<kami', 'kami/svg<kami/library', 'kami/text<kami/svg',
        'kami/stage<kami'], 'a parent is kept while a group nested in it is shown, even when the parent is not chosen');
    assert.deepEqual(Object.fromEntries(groups.members), {kami: ['kami/library', 'kami/stage'], 'kami/library': ['kami/svg'],
        'kami/svg': ['kami/text']});
    assert.equal(groups.withOwnContents.size, 0);

    const {tree: hidden} = parse(source);
    prepareGroupedToolboxTree(hidden, {catalog, visible: new Set(['motion', 'kami/library', 'kami/stage'])});
    assert.deepEqual(topLevel(hidden), ['motion', 'kami', 'kami/stage<kami'], 'a parent whose groups are all hidden goes');
});
