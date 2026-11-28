// The block palette editor in the minimal editor runtime: opened from the palette's ▼ button, groups dragged from the
// source onto palette tabs, folders, separators and display modes, and the palette drawn from the chosen tab.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, expect, type Browser, type Locator, type Page} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

const toolbox = `<xml>
<category name="Motion" id="motion" colour="#4C97FF" secondaryColour="#3373CC"><block type="motion_movesteps"/><block type="motion_turnright"/></category>
<category name="Looks" id="looks" colour="#9966FF" secondaryColour="#774DCB"><block type="looks_show"/></category>
<category name="Media" id="media" colour="#CF63CF" secondaryColour="#BD42BD">
  <category name="Sound" id="sound" colour="#CF63CF" secondaryColour="#BD42BD"><block type="sound_stopallsounds"/></category>
  <category name="Events" id="events" colour="#FFBF00" secondaryColour="#CC9900"><block type="event_whenflagclicked"/></category>
</category>
<category name="Control" id="control" colour="#FFAB19" secondaryColour="#CF8B17"><block type="control_wait"/></category>
<category name="Operators" id="operators" colour="#59C059" secondaryColour="#389438"><block type="operator_add"/></category>
</xml>`;
const shots = process.env.BPE_SHOTS;

let server: Awaited<ReturnType<typeof serveEditorRuntime>>;
let browser: Browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/block-palette-editor.page.ts', import.meta.url))});
    browser = await chromium.launch(process.env.TWPE_CHROME_EXECUTABLE ? {executablePath: process.env.TWPE_CHROME_EXECUTABLE} : {});
});
after(async () => {
    await browser?.close();
    await server?.close();
});

const open = async (horizontal = true, locale = 'en') => {
    const page = await browser.newPage({viewport: {width: 1200, height: 860}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await page.evaluate(({horizontal, toolbox, locale}) => (globalThis as any).setup(horizontal, toolbox, locale),
        {horizontal, toolbox, locale});
    return {page, errors};
};
const shot = async (page: Page, name: string) => {
    if (shots) await page.screenshot({path: `${shots}/${name}.png`});
};
/** Presses long enough to pick the tile up, then drags it onto the target. */
const longDrag = async (page: Page, from: Locator, to: Locator, where: 'center' | 'left' | 'right' = 'center') => {
    const a = (await from.boundingBox())!;
    const b = (await to.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(400);
    const x = where === 'left' ? b.x + 4 : where === 'right' ? b.x + b.width - 4 : b.x + b.width / 2;
    await page.mouse.move(x, b.y + b.height / 2, {steps: 8});
    await page.mouse.up();
};
const editorOf = (page: Page) => page.locator('dialog.tw-block-palette-editor-dialog');
const sourceTile = (page: Page, id: string) => editorOf(page).locator(`.tw-bpe-source-tile[data-group-id="${id}"]`);
const tiles = (page: Page) => editorOf(page).locator('.tw-bpe-tab-content:visible .tw-bpe-layout > .tw-bpe-grid > .tw-bpe-tile');
const area = (page: Page) => editorOf(page).locator('.tw-bpe-tab-content:visible .tw-bpe-layout');

test('the ▼ button opens the editor; groups dragged onto a tab become the palette', async () => {
    const {page, errors} = await open();
    await page.getByRole('button', {name: 'Open the block palette editor'}).click();
    const editor = editorOf(page);
    await expect(editor).toBeVisible();
    assert.deepEqual(await editor.locator('.tw-bpe-source-tile').evaluateAll(items => items.map(item => (item as HTMLElement).dataset.groupId)),
        ['motion', 'looks', 'media', 'sound', 'events', 'control', 'operators']);
    await shot(page, '1-opened');

    // A click on a source group shows what is in it.
    await sourceTile(page, 'motion').click();
    await expect(editor.locator('.tw-bpe-popover')).toContainText('move');
    await page.keyboard.press('Escape');
    await expect(editor.locator('.tw-bpe-popover')).toHaveCount(0);
    await expect(editor).toBeVisible();

    await editor.getByRole('button', {name: 'Add a palette'}).click();
    await expect(editor.locator('.dv-tab')).toHaveCount(2);
    await longDrag(page, sourceTile(page, 'looks'), area(page));
    await longDrag(page, sourceTile(page, 'motion'), tiles(page).first(), 'left');
    await longDrag(page, sourceTile(page, 'media'), area(page));
    assert.deepEqual(await tiles(page).evaluateAll(items => items.map(item => item.getAttribute('title'))), ['Motion', 'Looks', 'Media']);
    await expect(sourceTile(page, 'motion').locator('.tw-bpe-badge')).toHaveText('1');
    await longDrag(page, sourceTile(page, 'motion'), area(page));
    await expect(sourceTile(page, 'motion').locator('.tw-bpe-badge')).toHaveText('2');
    // Both references are drawn: the preview shows two Motion icons and fades neither.
    await expect(editor.locator('.tw-bpe-preview-palette .tw-bpe-preview-item[title="Motion"]')).toHaveCount(2);
    await expect(editor.locator('.tw-bpe-preview-palette [data-omitted]')).toHaveCount(0);

    // Remove the second Motion from its menu.
    await tiles(page).nth(3).click({button: 'right'});
    await editor.getByRole('menuitem', {name: 'Remove'}).click();
    await expect(sourceTile(page, 'motion').locator('.tw-bpe-badge')).toHaveText('1');

    // Media opens in place.
    await tiles(page).nth(2).click({button: 'right'});
    await editor.getByRole('menuitem', {name: 'Display'}).hover();
    await editor.getByRole('menuitemradio', {name: 'Always open'}).click();
    await expect(tiles(page).nth(2)).toHaveAttribute('data-mode', 'open');

    // Label Looks.
    await tiles(page).nth(1).click({button: 'right'});
    await editor.getByRole('menuitem', {name: 'Edit label…'}).click();
    await editor.getByRole('textbox', {name: 'Label'}).fill('Costumes');
    await page.keyboard.press('Enter');
    await expect(tiles(page).nth(1)).toHaveAttribute('title', 'Costumes');

    // A separator and a folder from the speed dial; operators and control go into the folder.
    await editor.getByRole('button', {name: 'Add', exact: true}).click();
    await editor.getByRole('menuitem', {name: 'Separator'}).click();
    await editor.getByRole('button', {name: 'Add', exact: true}).click();
    await editor.getByRole('menuitem', {name: 'Auto-opening folder'}).click();
    const folder = tiles(page).nth(4);
    await expect(folder).toHaveAttribute('data-kind', 'folder');
    const openFolder = editor.locator('.tw-bpe-tab-content:visible .tw-bpe-folder-open');
    await longDrag(page, sourceTile(page, 'operators'), openFolder);
    await longDrag(page, sourceTile(page, 'control'), folder);
    await expect(openFolder.locator('.tw-bpe-tile')).toHaveCount(2);
    // Reorder Looks before Motion by a long press.
    await longDrag(page, tiles(page).nth(1), tiles(page).nth(0), 'left');
    assert.deepEqual(await tiles(page).evaluateAll(items => items.map(item => item.getAttribute('title'))),
        ['Costumes', 'Motion', 'Media', 'Separator', 'Folder']);
    await expect(editor.locator('.tw-bpe-preview-palette .tw-bpe-preview-separator')).toHaveCount(1);
    await expect(editor.locator('.tw-bpe-preview-palette .tw-bpe-preview-open')).toHaveCount(1);
    await shot(page, '2-arranged');

    await editor.getByRole('button', {name: 'Save and close'}).click();
    await expect(editor).toHaveCount(0);
    const paletteRows = () => page.evaluate(() => (globalThis as any).palette.rows());
    await expect.poll(async () => (await paletteRows()).includes('|')).toBe(true);
    const rows = await paletteRows();
    assert.deepEqual(rows.filter((id: string) => !id.startsWith('tw-layout-folder-')),
        ['looks', 'motion', 'media', 'sound', 'events', '|']);
    assert.ok(rows.at(-1).startsWith('tw-layout-folder-'), 'the folder ends the palette');
    assert.ok((await page.evaluate(() => (globalThis as any).palette.names())).includes('Costumes'));
    await shot(page, '3-palette');

    // The editor opens with the layouts kept.
    await page.getByRole('button', {name: 'Open the block palette editor'}).click();
    await expect(tiles(page)).toHaveCount(5);
    // A second tab, renamed from its menu.
    await editor.getByRole('button', {name: 'Add a palette'}).click();
    await expect(editor.locator('.dv-tab')).toHaveCount(3);
    await editor.locator('.dv-tab').nth(2).click({button: 'right'});
    await editor.getByRole('menuitem', {name: 'Edit label'}).click();
    await editor.getByRole('textbox', {name: 'Label'}).fill('Story');
    await page.keyboard.press('Enter');
    await expect(editor.locator('.dv-tab').nth(2)).toContainText('Story');
    await expect(tiles(page)).toHaveCount(0);
    await expect(sourceTile(page, 'motion').locator('.tw-bpe-badge')).toHaveCount(0);
    // Maximize.
    await editor.getByRole('button', {name: 'Maximize'}).click();
    await expect(editor).toHaveAttribute('data-maximized', '');
    await shot(page, '4-second-tab');
    // Cancel keeps the palette as it was.
    await editor.getByRole('button', {name: 'Cancel'}).click();
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => (globalThis as any).palette.rows()), rows);
    assert.deepEqual(errors, []);
});

test('a vertical palette lays the editor out in columns, and an empty palette keeps every group', async () => {
    const {page, errors} = await open(false);
    await page.getByRole('button', {name: 'Open the block palette editor'}).click();
    const editor = editorOf(page);
    await expect(editor.locator('.tw-bpe')).toHaveAttribute('data-orientation', 'vertical');
    const [source, layouts] = await Promise.all([editor.locator('.tw-bpe-source').boundingBox(), editor.locator('.tw-bpe-layouts').boundingBox()]);
    assert.ok(layouts!.x > source!.x + source!.width - 2, 'the panels sit side by side');
    // The splitter moves the boundary.
    const splitter = editor.locator('.tw-bpe-splitter').first();
    const box = (await splitter.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height / 2, {steps: 4});
    await page.mouse.up();
    assert.ok((await editor.locator('.tw-bpe-source').boundingBox())!.width > source!.width + 80);
    await editor.getByRole('button', {name: 'Add a palette'}).click();
    await expect(editor.locator('.tw-bpe-preview')).toContainText('every block group');
    await shot(page, '5-vertical');
    await editor.getByRole('button', {name: 'Save and close'}).click();
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => (globalThis as any).palette.rows()), ['motion', 'looks', 'media', 'control', 'operators']);
    assert.deepEqual(errors, []);
});

test('each group kept open gets its own block list under its icon, spaced so no two lists overlap', async () => {
    const {page, errors} = await open();
    await page.getByRole('button', {name: 'Open the block palette editor'}).click();
    const editor = editorOf(page);
    await editor.getByRole('button', {name: 'Add a palette'}).click();
    for (const id of ['motion', 'control', 'looks']) await longDrag(page, sourceTile(page, id), area(page));
    for (const index of [0, 1]) {
        await tiles(page).nth(index).click({button: 'right'});
        await editor.getByRole('menuitem', {name: 'Display'}).hover();
        await editor.getByRole('menuitemradio', {name: 'Always open'}).click();
    }
    // The preview draws each kept-open group's blocks under its icon.
    await expect(editor.locator('.tw-bpe-preview-kept')).toHaveCount(2);
    await expect(editor.locator('.tw-bpe-preview-kept').first()).toContainText('move');
    await shot(page, '6-kept-open-preview');
    await editor.getByRole('button', {name: 'Save and close'}).click();
    const list = (id: string) => page.locator(`svg[data-kept-open-flyout="${id}"]`);
    await expect(list('motion')).toBeVisible();
    await expect(list('control')).toBeVisible();
    await expect(list('motion')).toContainText('move');
    await expect(list('control')).toContainText('wait');
    await expect(list('looks')).toHaveCount(0);
    const box = async (locator) => (await locator.boundingBox())!;
    const [motionList, controlList] = [await box(list('motion')), await box(list('control'))];
    const [motionIcon, controlIcon, looksIcon] = [await box(page.locator('.scratchCategoryId-motion')),
        await box(page.locator('.scratchCategoryId-control')), await box(page.locator('.scratchCategoryId-looks'))];
    assert.ok(Math.abs(motionList.x - motionIcon.x) < 2 && Math.abs(controlList.x - controlIcon.x) < 2, 'each list is under its icon');
    assert.ok(controlIcon.x >= motionList.x + motionList.width, 'the next icon starts after the list');
    assert.ok(looksIcon.x >= controlList.x + controlList.width, 'the lists never overlap the icons after them');
    await shot(page, '7-kept-open-palette');
    // Another group opens in the palette's own list, over them, and the kept lists stay.
    await page.locator('.scratchCategoryId-looks').click();
    await expect.poll(() => page.evaluate(() => (globalThis as any).palette.flyoutBlocks())).toEqual(['looks_show']);
    await page.keyboard.press('Escape');
    await expect(list('motion')).toBeVisible();
    // Blocks drag out of a kept list into the workspace.
    const block = list('control').locator('.blocklyDraggable').first();
    const from = await box(block);
    await page.mouse.move(from.x + 8, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(700, 500, {steps: 12});
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (globalThis as any).palette.host.workspace.getTopBlocks()
        .map((item: any) => item.type))).toContain('control_wait');
    // Back to opening automatically, the lists go away and the icons close up.
    await page.getByRole('button', {name: 'Open the block palette editor'}).click();
    for (const index of [0, 1]) {
        await tiles(page).nth(index).click({button: 'right'});
        await editor.getByRole('menuitem', {name: 'Display'}).hover();
        await editor.getByRole('menuitemradio', {name: 'Opens and closes automatically'}).click();
    }
    await editor.getByRole('button', {name: 'Save and close'}).click();
    await expect(page.locator('svg[data-kept-open-flyout]')).toHaveCount(0);
    assert.ok((await box(page.locator('.scratchCategoryId-control'))).x < motionList.x + motionList.width);
    assert.deepEqual(errors, []);
});

test('a group placed twice appears twice in the saved palette, and each opens its blocks', async () => {
    const {page, errors} = await open();
    await page.getByRole('button', {name: 'Open the block palette editor'}).click();
    const editor = editorOf(page);
    await editor.getByRole('button', {name: 'Add a palette'}).click();
    for (const id of ['motion', 'looks', 'motion']) await longDrag(page, sourceTile(page, id), area(page));
    await tiles(page).nth(2).click({button: 'right'});
    await editor.getByRole('menuitem', {name: 'Edit label…'}).click();
    await editor.getByRole('textbox', {name: 'Label'}).fill('Motion again');
    await page.keyboard.press('Enter');
    await editor.getByRole('button', {name: 'Save and close'}).click();
    const rows = () => page.evaluate(() => (globalThis as any).palette.rows());
    await expect.poll(rows).toEqual(['motion', 'looks', 'motion~2']);
    assert.deepEqual(await page.evaluate(() => (globalThis as any).palette.names()), ['Motion', 'Looks', 'Motion again']);
    const blocks = () => page.evaluate(() => (globalThis as any).palette.flyoutBlocks());
    await page.locator('[class~="scratchCategoryId-motion~2"]').click();
    await expect.poll(blocks).toEqual(['motion_movesteps', 'motion_turnright']);
    await shot(page, '8-twice');
    assert.deepEqual(errors, []);
});

test('the default tab holds every source group in order, cannot be removed, and is changed through a duplicate', async () => {
    const {page, errors} = await open();
    await page.getByRole('button', {name: 'Open the block palette editor'}).click();
    const editor = editorOf(page);
    const tabs = editor.locator('.dv-tab');
    await expect(tabs).toHaveCount(1);
    await expect(tabs.first()).toContainText('Standard');
    await expect(tabs.first().locator('.dv-default-tab-action')).toBeHidden();
    const order = () => editor.locator('.tw-bpe-tab-content:visible .tw-bpe-tile').evaluateAll(items =>
        items.map(item => item.getAttribute('title')));
    assert.deepEqual(await order(), ['Motion', 'Looks', 'Media', 'Sound', 'Events', 'Control', 'Operators']);
    await expect(sourceTile(page, 'looks').locator('.tw-bpe-badge')).toHaveText('1');
    // It follows the first panel's order.
    await longDrag(page, sourceTile(page, 'operators'), sourceTile(page, 'motion'), 'left');
    assert.deepEqual((await order())[0], 'Operators');
    // Its menu offers no removal, and a duplicate is an ordinary palette.
    await tabs.first().click({button: 'right'});
    await expect(editor.getByRole('menuitem', {name: 'Remove'})).toHaveCount(0);
    await editor.getByRole('menuitem', {name: 'Duplicate'}).click();
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toContainText('Standard copy');
    assert.deepEqual(await tiles(page).evaluateAll(items => items.map(item => item.getAttribute('title'))),
        ['Operators', 'Motion', 'Looks', 'Media', 'Sound', 'Events', 'Control']);
    await tiles(page).nth(0).click({button: 'right'});
    await editor.getByRole('menuitem', {name: 'Remove'}).click();
    await expect(tiles(page)).toHaveCount(6);
    await tabs.nth(1).click({button: 'right'});
    await expect(editor.getByRole('menuitem', {name: 'Remove'})).toHaveCount(1);
    await page.keyboard.press('Escape');
    // Managing the extension set is at the end of the first panel, outside its grid.
    const source = (await editor.locator('.tw-bpe-source').boundingBox())!;
    const add = (await editor.getByRole('button', {name: 'Manage extension set'}).boundingBox())!;
    assert.ok(source.x + source.width - (add.x + add.width) < 24 && source.y + source.height - (add.y + add.height) < 24);
    await expect(editor.locator('.tw-bpe-source-grid').getByRole('button', {name: 'Manage extension set'})).toHaveCount(0);
    await shot(page, '9-default-tab');
    // The default tab chosen and saved, the palette shows every group in the first panel's order.
    await tabs.first().click();
    await editor.getByRole('button', {name: 'Save and close'}).click();
    await expect.poll(() => page.evaluate(() => (globalThis as any).palette.rows()))
        .toEqual(['operators', 'motion', 'looks', 'media', 'sound', 'events', 'control']);
    // Opened again, the default tab is still first and chosen, and the copy kept its change.
    await page.getByRole('button', {name: 'Open the block palette editor'}).click();
    await expect(tabs).toHaveCount(2);
    await tabs.nth(1).click();
    await expect(tiles(page)).toHaveCount(6);
    assert.deepEqual(errors, []);
});
