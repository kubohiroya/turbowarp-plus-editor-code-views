// The child palettes of the block palette's groups with the Editor's own VM and Scratch Blocks, in the minimal
// editor runtime: opening, pinning, reordering, and the detached palette.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser, type Locator, type Page} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

const toolbox = `<xml>
<category name="Motion" id="motion" colour="#4C97FF" secondaryColour="#3373CC"><block type="motion_movesteps"/></category>
<category name="Media" id="media" colour="#9966FF" secondaryColour="#774DCB">
  <category name="Looks" id="looks" colour="#9966FF" secondaryColour="#774DCB"><block type="looks_show"/></category>
  <category name="Sound" id="sound" colour="#CF63CF" secondaryColour="#BD42BD"><block type="sound_stopallsounds"/></category>
  <category name="More" id="more" colour="#FF8C1A" secondaryColour="#DB6E00">
    <category name="Events" id="events" colour="#FFBF00" secondaryColour="#CC9900"><block type="event_whenflagclicked"/></category>
    <category name="Control" id="control" colour="#FFAB19" secondaryColour="#CF8B17"><block type="control_wait"/></category>
  </category>
</category>
<category name="Operators" id="operators" colour="#59C059" secondaryColour="#389438"><block type="operator_add"/></category>
</xml>`;

let server: Awaited<ReturnType<typeof serveEditorRuntime>>;
let browser: Browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/palette-groups.page.ts', import.meta.url))});
    browser = await chromium.launch(process.env.TWPE_CHROME_EXECUTABLE ? {executablePath: process.env.TWPE_CHROME_EXECUTABLE} : {});
});
after(async () => {
    await browser?.close();
    await server?.close();
});

const open = async () => {
    const page = await browser.newPage({viewport: {width: 900, height: 600}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await page.evaluate(xml => (globalThis as any).setup(xml), toolbox);
    return {page, errors};
};
const category = (page: Page, id: string) => page.locator(`.blocklyToolboxDiv .scratchCategoryId-${id}`);
const popup = (page: Page, id: string) => page.locator(`[data-palette-group-popup="${id}"]`);
const item = (page: Page, id: string) => page.locator(`[data-palette-group-item="${id}"]`);
const popupItems = (page: Page, id: string) => popup(page, id).locator('[data-palette-group-item]')
    .evaluateAll(items => items.map(entry => entry.getAttribute('data-palette-group-item')));
// The categories the palette shows, in order.
const shown = (page: Page) => page.locator('.blocklyToolboxDiv .scratchCategoryMenuItem').evaluateAll(items => items
    .filter(entry => !(entry.parentElement as HTMLElement).hidden)
    .map(entry => [...entry.classList].find(name => name.startsWith('scratchCategoryId-'))!.slice('scratchCategoryId-'.length)));
const box = async (locator: Locator) => (await locator.boundingBox())!;
// A long press, then a drag to the target, as the palette's reordering expects.
const drag = async (page: Page, from: Locator, to: Locator) => {
    const start = await box(from);
    const end = await box(to);
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2 - 1, {steps: 8});
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {steps: 2});
    await page.mouse.up();
};

test('a group opens its members in a child palette below its icon, with a shadow and a pin at its top right', async () => {
    const {page, errors} = await open();
    assert.deepEqual(await shown(page), ['motion', 'media', 'operators']);
    await category(page, 'media').click();
    assert.deepEqual(await popupItems(page, 'media'), ['looks', 'sound', 'more']);
    const anchor = await box(category(page, 'media'));
    const child = await box(popup(page, 'media'));
    assert.ok(Math.abs(child.y - (anchor.y + anchor.height)) <= 2, 'below the icon');
    assert.ok(Math.abs(child.x - anchor.x) <= 2, 'aligned with the icon');
    assert.notEqual(await popup(page, 'media').evaluate(element => getComputedStyle(element).boxShadow), 'none');
    const pin = await box(popup(page, 'media').locator(':scope > [data-palette-group-pin="unpinned"]'));
    assert.ok(child.x + child.width - (pin.x + pin.width) <= 6 && pin.y - child.y <= 6, 'the pin is at the top right');

    // A member group opens the next level; choosing a category opens its blocks and closes the child palettes.
    await item(page, 'more').click();
    assert.deepEqual(await popupItems(page, 'more'), ['events', 'control']);
    await item(page, 'control').click();
    assert.equal(await page.locator('[data-palette-group-popup]').count(), 0);
    assert.equal(await page.evaluate(() => (globalThis as any).palette.selected()), 'control');

    // A click outside closes the child palette.
    await category(page, 'media').click();
    await page.mouse.click(700, 500);
    assert.equal(await page.locator('[data-palette-group-popup]').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
});

test('pinning shows a group\'s members after it in the palette that showed it, and unpinning folds them back', async () => {
    const {page, errors} = await open();
    await category(page, 'media').click();
    await item(page, 'more').click();
    await popup(page, 'more').locator(':scope > [data-palette-group-pin]').click();
    assert.equal(await popup(page, 'more').count(), 0);
    assert.deepEqual(await popupItems(page, 'media'), ['looks', 'sound', 'more', 'events', 'control']);
    assert.equal(await item(page, 'more').locator('[data-palette-group-pin="pinned"]').count(), 1);

    await popup(page, 'media').locator(':scope > [data-palette-group-pin]').click();
    assert.deepEqual(await shown(page), ['motion', 'media', 'looks', 'sound', 'more', 'events', 'control', 'operators']);
    const icon = await box(category(page, 'media'));
    const pin = await box(category(page, 'media').locator('[data-palette-group-pin="pinned"]'));
    assert.ok(icon.x + icon.width - (pin.x + pin.width) <= 6 && pin.y - icon.y <= 6, 'the pin is at the icon\'s top right');
    assert.deepEqual(await page.evaluate(() => (globalThis as any).palette.order.capture()), {pinned: ['more', 'media']});

    await category(page, 'media').locator('[data-palette-group-pin]').click();
    assert.deepEqual(await shown(page), ['motion', 'media', 'operators']);
    await category(page, 'media').click();
    assert.deepEqual(await popupItems(page, 'media'), ['looks', 'sound', 'more', 'events', 'control'], 'the inner group stays pinned');
    assert.deepEqual(errors, []);
    await page.close();
});

test('a long press reorders a group\'s members in its child palette, and where a pinned group shows them', async () => {
    const {page, errors} = await open();
    await category(page, 'media').click();
    await drag(page, item(page, 'more'), item(page, 'looks'));
    assert.deepEqual(await popupItems(page, 'media'), ['more', 'looks', 'sound']);
    assert.deepEqual(await page.evaluate(() => (globalThis as any).palette.order.members('media')), ['more', 'looks', 'sound']);
    // The toolbox's categories follow, each group followed by its members.
    assert.deepEqual(await page.evaluate(() => (globalThis as any).palette.ids()),
        ['motion', 'media', 'more', 'events', 'control', 'looks', 'sound', 'operators']);

    // Pinned, the members are reordered in the palette itself, among themselves only.
    await popup(page, 'media').locator(':scope > [data-palette-group-pin]').click();
    assert.deepEqual(await shown(page), ['motion', 'media', 'more', 'looks', 'sound', 'operators']);
    await drag(page, category(page, 'sound'), category(page, 'more'));
    assert.deepEqual(await shown(page), ['motion', 'media', 'sound', 'more', 'looks', 'operators']);
    assert.deepEqual(await page.evaluate(() => (globalThis as any).palette.order.members('media')), ['sound', 'more', 'looks']);
    // A member dropped on a category of another level stays where it was.
    await drag(page, category(page, 'looks'), category(page, 'motion'));
    assert.deepEqual(await shown(page), ['motion', 'media', 'sound', 'more', 'looks', 'operators']);
    // A long press released where it started opens nothing.
    await drag(page, category(page, 'more'), category(page, 'more'));
    assert.equal(await page.locator('[data-palette-group-popup]').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
});

test('the detached palette opens groups in child palettes, below a column of categories and beside a row of them', async () => {
    const {page, errors} = await open();
    const [detached] = await Promise.all([page.waitForEvent('popup'), page.evaluate(() => (globalThis as any).palette.openDetached())]);
    await detached.setViewportSize({width: 720, height: 440});
    detached.on('pageerror', error => errors.push(error.message));
    const button = (id: string) => detached.locator(`button[data-category-id="${id}"]`);
    const listed = () => detached.locator('.tw-detached-palette__categories button').evaluateAll(buttons => buttons
        .filter(entry => (entry as HTMLElement).offsetParent).map(entry => entry.getAttribute('data-category-id')));
    await button('media').waitFor();
    assert.deepEqual(await listed(), ['motion', 'media', 'operators']);

    // Categories in a column: the child palette opens below the icon.
    await button('media').click();
    let anchor = await box(button('media'));
    let child = await box(popup(detached, 'media'));
    assert.ok(child.y >= anchor.y + anchor.height - 2 && Math.abs(child.x - anchor.x) <= 4, 'below the icon');
    await item(detached, 'sound').click();
    assert.equal(await detached.locator('.tw-detached-palette__blocks').getAttribute('aria-label'), 'Sound');
    assert.equal(await button('media').getAttribute('aria-pressed'), 'true', 'the group stands for its member');

    // Categories in a row: the child palette opens to the right of the icon.
    await detached.getByRole('button', {name: 'Block palette layout'}).click();
    await detached.getByRole('menuitemradio', {name: 'Arrange vertically'}).or(
        detached.getByRole('menuitem', {name: 'Arrange vertically'})).click();
    await button('media').click();
    anchor = await box(button('media'));
    child = await box(popup(detached, 'media'));
    assert.ok(child.x >= anchor.x + anchor.width - 2 && Math.abs(child.y - anchor.y) <= 4, 'to the right of the icon');
    assert.ok(await popup(detached, 'media').evaluate(element => element.hasAttribute('data-horizontal')));

    // Pinning in the detached palette shows the members there, and the Editor's palette follows.
    await popup(detached, 'media').locator(':scope > [data-palette-group-pin]').click();
    assert.deepEqual(await listed(), ['motion', 'media', 'looks', 'sound', 'more', 'operators']);
    assert.deepEqual(await shown(page), ['motion', 'media', 'looks', 'sound', 'more', 'operators']);
    await button('media').locator('[data-palette-group-pin]').click();
    assert.deepEqual(await listed(), ['motion', 'media', 'operators']);
    assert.deepEqual(errors, []);
    await page.close();
});
