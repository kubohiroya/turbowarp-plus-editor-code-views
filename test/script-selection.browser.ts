// Selecting several scripts with the real VM and Blockly. Input is synthesized inside the headless page.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser, type Page} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

let server: Awaited<ReturnType<typeof serveEditorRuntime>>;
let browser: Browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/script-selection.page.ts', import.meta.url))});
    browser = await chromium.launch({headless: true,
        ...(process.env.TWPE_CHROME_EXECUTABLE ? {executablePath: process.env.TWPE_CHROME_EXECUTABLE} : {})});
});
after(async () => {await browser?.close(); await server?.close();});

const open = async () => {
    const page = await browser.newPage({viewport: {width: 1400, height: 800}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => {errors.push(`dialog: ${dialog.message()}`); dialog.dismiss();});
    await page.goto(server.url);
    await page.evaluate(() => (globalThis as any).setup());
    return {page, errors};
};
const fixture = <T>(page: Page, body: string, arg?: unknown) =>
    page.evaluate(([source, value]) => new Function('fixture', 'value', `return (${source})`)((globalThis as any).fixture, value),
        [body, arg] as const) as Promise<T>;
const settle = (page: Page) => page.evaluate(() => (globalThis as any).fixture.settle());
const selected = (page: Page) => fixture<string[]>(page, 'fixture.selected()');
const position = (page: Page, id: string) => fixture<{x: number; y: number} | null>(page, 'fixture.position(value)', id);
/** A point on the hat of a script, away from its fields. */
const hat = (page: Page, id: string) => page.locator(`.blocklyBlockCanvas [data-id="${id}"] > .blocklyPath`).evaluate(path => {
    const box = path.getBoundingClientRect();
    return {x: box.x + 12, y: box.y + box.height / 2};
});
const toggle = async (page: Page, id: string) => {
    const point = await hat(page, id);
    await page.keyboard.down('ControlOrMeta');
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up('ControlOrMeta');
    await settle(page);
};
const background = {x: 1300, y: 760};
const marquee = async (page: Page, from: {x: number; y: number}, to: {x: number; y: number}, modifiers: string[] = ['Shift']) => {
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, {steps: 5});
    await page.mouse.up();
    for (const key of modifiers.toReversed()) await page.keyboard.up(key);
    await settle(page);
};
/** The screen rectangle around two scripts' hats. */
const around = async (page: Page, ids: string[]) => {
    const boxes = await Promise.all(ids.map(id => page.locator(`.blocklyBlockCanvas [data-id="${id}"]`).evaluate(node => {
        const {left, top, right, bottom} = node.getBoundingClientRect();
        return {left, top, right, bottom};
    })));
    return {from: {x: Math.min(...boxes.map(box => box.left)) - 15, y: Math.min(...boxes.map(box => box.top)) - 15},
        to: {x: Math.max(...boxes.map(box => box.right)) + 15, y: Math.max(...boxes.map(box => box.bottom)) + 15}};
};

test('Ctrl+click (⌘+click on macOS) toggles whole scripts without running them, and a background click clears', async () => {
    const {page, errors} = await open();
    try {
        await toggle(page, 'a');
        await toggle(page, 'b-body');
        assert.deepEqual(await selected(page), ['a', 'b']);
        assert.equal(await fixture(page, 'fixture.vm.runtime.threads.length'), 0, 'a toggle never starts the script');
        await toggle(page, 'a');
        assert.deepEqual(await selected(page), ['b']);
        await page.keyboard.press('Escape');
        await settle(page);
        assert.deepEqual(await selected(page), []);
        await toggle(page, 'c');
        await page.mouse.click(background.x, background.y);
        await settle(page);
        assert.deepEqual(await selected(page), []);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('Shift+drag on the background adds touched scripts, Shift+Alt+drag removes them, and nothing moves', async () => {
    const {page, errors} = await open();
    try {
        const before = await Promise.all(['a', 'b', 'c', 'd'].map(id => position(page, id)));
        const top = await around(page, ['a', 'b']);
        await marquee(page, top.from, top.to);
        assert.deepEqual(await selected(page), ['a', 'b']);
        assert.equal(await page.locator('.tw-plus-script-marquee').count(), 0);
        const left = await around(page, ['a', 'c']);
        await marquee(page, left.from, left.to);
        assert.deepEqual(await selected(page), ['a', 'b', 'c']);
        await marquee(page, left.from, left.to, ['Shift', 'Alt']);
        assert.deepEqual(await selected(page), ['b']);
        assert.deepEqual(await Promise.all(['a', 'b', 'c', 'd'].map(id => position(page, id))), before);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('dragging a selected script moves the others by the same distance, undone as one edit', async () => {
    const {page, errors} = await open();
    try {
        await toggle(page, 'a');
        await toggle(page, 'd');
        const before = {a: await position(page, 'a'), d: await position(page, 'd'), b: await position(page, 'b')};
        const start = await hat(page, 'a');
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 60, start.y + 200, {steps: 8});
        await page.mouse.up();
        await settle(page);
        const after = {a: await position(page, 'a'), d: await position(page, 'd'), b: await position(page, 'b')};
        assert.deepEqual(after.b, before.b, 'an unselected script stays');
        const moved = {x: after.a.x - before.a.x, y: after.a.y - before.a.y};
        assert.ok(Math.abs(moved.x - 60) <= 2 && Math.abs(moved.y - 200) <= 2, JSON.stringify(moved));
        assert.deepEqual({x: after.d.x - before.d.x, y: after.d.y - before.d.y}, moved);
        assert.deepEqual(await selected(page), ['a', 'd'], 'the selection survives the move');
        await fixture(page, 'fixture.undo()');
        assert.deepEqual(await position(page, 'a'), before.a);
        assert.deepEqual(await position(page, 'd'), before.d);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('pressing an unselected script clears the selection and drags only that script', async () => {
    const {page, errors} = await open();
    try {
        await toggle(page, 'a');
        const before = await position(page, 'a');
        const start = await hat(page, 'b');
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + 40, start.y + 150, {steps: 6});
        await page.mouse.up();
        await settle(page);
        assert.deepEqual(await selected(page), []);
        assert.deepEqual(await position(page, 'a'), before);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('Delete removes every selected script as one undoable edit', async () => {
    const {page, errors} = await open();
    try {
        await toggle(page, 'a');
        await toggle(page, 'c');
        await page.keyboard.press('Delete');
        await settle(page);
        assert.equal(await fixture(page, 'fixture.exists("a") || fixture.exists("a-body") || fixture.exists("c")'), false);
        assert.equal(await fixture(page, 'fixture.exists("b")'), true);
        assert.deepEqual(await selected(page), []);
        await fixture(page, 'fixture.undo()');
        assert.equal(await fixture(page, 'fixture.exists("a") && fixture.exists("a-body") && fixture.exists("c")'), true);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('the block context menu offers deleting the selection', async () => {
    const {page, errors} = await open();
    try {
        await toggle(page, 'b');
        await toggle(page, 'd');
        const point = await hat(page, 'b');
        await page.mouse.click(point.x, point.y, {button: 'right'});
        const item = page.locator('.blocklyContextMenu .goog-menuitem', {hasText: 'Delete 2 selected scripts'});
        await item.waitFor();
        await item.click();
        await settle(page);
        assert.equal(await fixture(page, 'fixture.exists("b") || fixture.exists("d")'), false);
        assert.equal(await fixture(page, 'fixture.exists("a")'), true);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('deleting a used function definition with other scripts is rolled back as a whole', async () => {
    const {page, errors} = await open();
    try {
        await toggle(page, 'a');
        await toggle(page, 'definition');
        await page.keyboard.press('Delete');
        await settle(page);
        await page.waitForFunction(() => (globalThis as any).fixture.exists('definition'));
        await settle(page);
        assert.equal(await fixture(page, 'fixture.exists("a") && fixture.exists("definition")'), true);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /^dialog: /);
    } finally {await page.close();}
});

test('switching to another sprite clears the selection', async () => {
    const {page, errors} = await open();
    try {
        await toggle(page, 'a');
        await fixture(page, 'fixture.switchTo("Other")');
        await fixture(page, 'fixture.switchTo("Sprite")');
        assert.deepEqual(await selected(page), []);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('dropping a selected script on the palette deletes the whole selection in one edit', async () => {
    const {page, errors} = await open();
    try {
        await toggle(page, 'a');
        await toggle(page, 'd');
        const start = await hat(page, 'a');
        const palette = await page.evaluate(() => {
            const box = (globalThis as any).fixture.workspace.getFlyout().svgBackground_.getBoundingClientRect();
            return {x: box.x + box.width / 2, y: box.y + box.height / 2};
        });
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(palette.x, palette.y, {steps: 10});
        await page.mouse.up();
        await settle(page);
        assert.equal(await fixture(page, 'fixture.exists("a") || fixture.exists("d")'), false);
        assert.equal(await fixture(page, 'fixture.exists("b") && fixture.exists("c")'), true);
        await fixture(page, 'fixture.undo()');
        assert.equal(await fixture(page, 'fixture.exists("a") && fixture.exists("d")'), true);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('dropping a selected script on a sprite copies every selected script there, keeping their places', async () => {
    const {page, errors} = await open();
    try {
        await fixture(page, 'fixture.spriteList("Other")');
        await toggle(page, 'a');
        await toggle(page, 'd');
        const before = {a: await position(page, 'a'), d: await position(page, 'd')};
        const start = await hat(page, 'a');
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(1250, start.y + 100, {steps: 10});
        await page.mouse.up();
        await settle(page);
        await fixture(page, 'fixture.shared');
        await settle(page);
        const copy = {opcode: 'event_whenkeypressed', below: ['looks_show']};
        assert.deepEqual(await fixture(page, 'fixture.scriptsOf("Other")'), [
            {opcode: 'event_whenkeypressed', x: 30, y: 30, below: ['looks_show']},
            {opcode: 'event_whenkeypressed', x: 40, y: 40, below: ['looks_show']},
            {...copy, x: 30 + before.d.x - before.a.x, y: 30 + before.d.y - before.a.y}
        ].sort((a, b) => a.x - b.x || a.y - b.y));
        assert.deepEqual(await position(page, 'a'), before.a, 'the dropped script returns');
        assert.deepEqual(await position(page, 'd'), before.d, 'so do the others');
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});
