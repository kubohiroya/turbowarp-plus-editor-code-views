import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

let server, browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/semantic-layout.page.ts', import.meta.url))});
    browser = await chromium.launch({headless: true});
});
after(async () => {await browser?.close(); await server?.close();});
const en = 'Rearrange scripts by relationships', ja = 'スクリプトを意味に応じて再配置する';
async function open(locale = 'en') {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}});
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await page.evaluate(locale => (globalThis as any).setupSemantic(locale), locale);
    return {page, errors};
}
async function show(page, label = en) {
    await page.evaluate(() => (globalThis as any).semanticFixture.background());
    await page.getByRole('menuitem', {name: label, exact: true}).click();
    const dialog = page.getByRole('dialog', {name: label, exact: true});
    await expect(dialog.locator('[data-layout-metrics]')).toHaveCount(1);
    return dialog;
}
const saved = page => page.evaluate(() => (globalThis as any).semanticFixture.saved());
const positions = project => project.targets.map(t => ({name: t.name, blocks: Object.fromEntries(Object.entries(t.blocks)
    .filter(([, b]: any) => b.topLevel).map(([id, b]: any) => [id, [b.x, b.y]])), comments: t.comments}));
const program = project => project.targets.map(t => ({...t, blocks: Object.fromEntries(Object.entries(t.blocks)
    .map(([id, b]: any) => {const {x, y, ...rest} = b; return [id, rest];})),
    comments: Object.fromEntries(Object.entries(t.comments).map(([id, c]: any) => {const {x, y, ...rest} = c; return [id, rest];}))}));

test('background action previews native scripts, message styles and external connections without mutating the project', async () => {
    const {page, errors} = await open('ja');
    try {
        const before = await saved(page);
        const dialog = await show(page, ja);
        await expect(dialog.locator('[data-script-view-block]')).toHaveCount(4);
        await expect(dialog.locator('[data-semantic-relation="function"]')).toHaveCount(3);
        await expect(dialog.locator('[data-semantic-relation="message"][data-external]')).toHaveCount(2);
        assert.equal(await dialog.locator('[data-semantic-relation="message"][data-wait="true"] path').first()
            .getAttribute('stroke-dasharray'), '7 5');
        assert.deepEqual(await saved(page), before);
        await dialog.getByRole('button', {name: 'キャンセル', exact: true}).click();
        assert.deepEqual(await saved(page), before);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('native apply preserves programs and comment offsets, supports one undo/redo and saves the coordinates', async () => {
    const {page, errors} = await open();
    try {
        const before = await saved(page);
        const geometry = await page.evaluate(() => (globalThis as any).semanticFixture.geometry());
        const dialog = await show(page);
        await dialog.getByRole('button', {name: 'Rearrange', exact: true}).click();
        await expect(dialog).toHaveCount(0);
        const after = await saved(page);
        assert.notDeepEqual(positions(after), positions(before));
        assert.deepEqual(program(after), program(before));
        assert.deepEqual(after.targets.find(t => t.name === 'Secondary'), before.targets.find(t => t.name === 'Secondary'));
        const moved = await page.evaluate(() => (globalThis as any).semanticFixture.geometry());
        const original = geometry.scripts.find(s => s.id === 'start'), current = moved.scripts.find(s => s.id === 'start');
        const note = geometry.comments.find(c => c.id === 'attached-note'), movedNote = moved.comments.find(c => c.id === 'attached-note');
        assert.ok(Math.abs(movedNote.x - note.x - (current.origin.x - original.origin.x)) < .01);
        assert.ok(Math.abs(movedNote.y - note.y - (current.origin.y - original.origin.y)) < .01);
        assert.deepEqual(moved.comments.find(c => c.id === 'loose-note'), geometry.comments.find(c => c.id === 'loose-note'));
        await page.evaluate(() => (globalThis as any).semanticFixture.undo());
        assert.deepEqual(positions(await saved(page)), positions(before));
        await page.evaluate(() => (globalThis as any).semanticFixture.undo(true));
        assert.deepEqual(positions(await saved(page)), positions(after));
        await page.evaluate(() => (globalThis as any).semanticFixture.reloadSaved());
        assert.deepEqual(positions(await saved(page)), positions(after));
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('program edits with unchanged geometry invalidate the preview; recalculation can recover', async () => {
    const {page, errors} = await open();
    try {
        const dialog = await show(page);
        const before = positions(await saved(page));
        await page.evaluate(() => (globalThis as any).semanticFixture.changeCode());
        await expect(dialog.getByRole('button', {name: 'Rearrange', exact: true})).toBeDisabled();
        await expect(dialog.getByRole('status')).toContainText('code changed');
        assert.deepEqual(positions(await saved(page)), before);
        await dialog.getByRole('button', {name: 'Recalculate', exact: true}).click();
        await expect(dialog.getByRole('button', {name: 'Rearrange', exact: true})).toBeEnabled();
        await expect(dialog.getByRole('status')).toContainText('1 unresolved');
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('target switches and read-only state reject stale previews; serial views have no semantic action', async () => {
    const {page, errors} = await open();
    try {
        const before = positions(await saved(page));
        const dialog = await show(page);
        await page.evaluate(() => (globalThis as any).semanticFixture.switchToSecondary());
        await expect(dialog.getByRole('button', {name: 'Rearrange', exact: true})).toBeDisabled();
        assert.deepEqual(positions(await saved(page)), before);
        await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
        await page.evaluate(() => (globalThis as any).semanticFixture.switchToPrimary());
        for (const view of ['z', 'n']) {
            await page.evaluate(view => (globalThis as any).semanticFixture.view(view), view);
            await page.locator('.tw-script-view-surface').click({button: 'right', position: {x: 15, y: 15}});
            await expect(page.getByRole('menuitem', {name: en, exact: true})).toHaveCount(0);
            await page.keyboard.press('Escape');
        }
        await page.evaluate(() => {(globalThis as any).semanticFixture.view('free'); (globalThis as any).semanticFixture.allow(false);});
        await page.evaluate(() => (globalThis as any).semanticFixture.background());
        await expect(page.getByRole('menuitem', {name: en, exact: true})).toHaveAttribute('aria-disabled', 'true');
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('a failing native move restores all positions and creates no undo entry', async () => {
    const {page, errors} = await open();
    try {
        const before = positions(await saved(page));
        const dialog = await show(page);
        await page.evaluate(() => (globalThis as any).semanticFixture.failNextMove());
        await dialog.getByRole('button', {name: 'Rearrange', exact: true}).click();
        await expect(dialog.getByRole('status')).toContainText('Original positions were restored');
        assert.deepEqual(positions(await saved(page)), before);
        assert.equal(await page.evaluate(() => (globalThis as any).semanticFixture.workspace.undoStack_.length), 0);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('closing and disposing during calculation leaves the program untouched and removes the dialog', async () => {
    const {page, errors} = await open();
    try {
        const before = await saved(page);
        await page.evaluate(() => (globalThis as any).semanticFixture.background());
        await page.getByRole('menuitem', {name: en, exact: true}).click();
        await page.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true}).click();
        assert.deepEqual(await saved(page), before);
        await page.evaluate(() => (globalThis as any).semanticFixture.background());
        await page.getByRole('menuitem', {name: en, exact: true}).click();
        await page.evaluate(() => (globalThis as any).semanticFixture.disposeLayout());
        await expect(page.getByRole('dialog')).toHaveCount(0);
        assert.deepEqual(await saved(page), before);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('folded scripts reserve their expanded bounds and a second run does not drift', async () => {
    const {page, errors} = await open();
    try {
        const before = await page.evaluate(() => (globalThis as any).semanticFixture.geometry());
        await page.evaluate(() => (globalThis as any).semanticFixture.fold('start', true));
        const folded = await page.evaluate(() => (globalThis as any).semanticFixture.geometry());
        assert.equal(folded.scripts.find(s => s.id === 'start').height, before.scripts.find(s => s.id === 'start').height);
        const dialog = await show(page);
        await dialog.getByRole('button', {name: 'Rearrange', exact: true}).click();
        const after = positions(await saved(page));
        const again = await show(page);
        await expect(again.getByRole('button', {name: 'Rearrange', exact: true})).toBeDisabled();
        await again.getByRole('button', {name: 'Cancel', exact: true}).click();
        assert.deepEqual(positions(await saved(page)), after);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('an editable popout previews its parent graph and commits one shared undo step', async () => {
    const {page, errors} = await open();
    try {
        const before = positions(await saved(page));
        const [child] = await Promise.all([page.waitForEvent('popup'),
            page.evaluate(() => (globalThis as any).semanticFixture.openPopout())]);
        child.on('pageerror', error => errors.push(error.message));
        await child.bringToFront();
        await expect(child.locator('#status')).toHaveText('Editing');
        const background = child.locator('.blocklyMainBackground');
        await background.click({button: 'right', position: {x: 650, y: 400}});
        await child.getByRole('menuitem', {name: en, exact: true}).click();
        const dialog = child.getByRole('dialog', {name: en, exact: true});
        await expect(dialog.locator('[data-layout-metrics]')).toHaveCount(1);
        assert.deepEqual(positions(await saved(page)), before);
        await dialog.getByRole('button', {name: 'Rearrange', exact: true}).click();
        await expect.poll(async () => JSON.stringify(positions(await saved(page)))).not.toBe(JSON.stringify(before));
        const after = positions(await saved(page));
        await expect(child.locator('#undo')).toBeEnabled();
        await child.locator('#undo').click();
        await expect.poll(async () => positions(await saved(page))).toEqual(before);
        await expect(child.locator('#redo')).toBeEnabled();
        await child.locator('#redo').click();
        await expect.poll(async () => positions(await saved(page))).toEqual(after);
        await child.close();
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});
