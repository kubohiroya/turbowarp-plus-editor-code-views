import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

let server, browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/multiview-sync.page.ts', import.meta.url))});
    browser = await chromium.launch({headless: true});
});
after(async () => {await browser?.close(); await server?.close();});

test('a native custom block creation reaches every view', async () => {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.evaluate(() => (globalThis as any).setupMultiview());
    const id = await page.evaluate(() => (globalThis as any).syncFixture.createNative());
    assert.ok(id);
    for (const pane of ['a', 'b']) {
        await expect(page.locator(`[data-sync-pane="${pane}"] [data-id="${id}"]`)).toHaveCount(1);
    }
    assert.deepEqual(await page.evaluate(() => (globalThis as any).syncFixture.errors), []);
    await page.close();
});

for (const background of [false, true]) test(`new functions reach every view (background target: ${background})`, async () => {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.evaluate(() => (globalThis as any).setupMultiview());
    const id = await page.evaluate(background => (globalThis as any).syncFixture.create(background), background);
    for (const pane of background ? ['other'] : ['a', 'b']) {
        await expect(page.locator(`[data-sync-pane="${pane}"] [data-id="${id}"]`)).toHaveCount(1);
        const updates = await page.evaluate(pane => (globalThis as any).syncFixture.updates(pane), pane);
        assert.ok(updates.some(message => message.blocks[id]), 'shared views also received the definition');
    }
    assert.deepEqual(await page.evaluate(() => (globalThis as any).syncFixture.errors), []);
    await page.close();
});

test('batched function creation refreshes the foreground target even after a background edit', async () => {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.evaluate(() => (globalThis as any).setupMultiview(false));
    const result = await page.evaluate(() => (globalThis as any).syncFixture.simultaneous());
    assert.equal(result.shown, true);
    for (const pane of ['a', 'b']) {
        await expect(page.locator(`[data-sync-pane="${pane}"] [data-id="${result.id}"]`)).toHaveCount(1);
    }
    await page.close();
});

test('function edits, deletion and shared undo/redo keep all three views consistent', async () => {
    const page = await browser.newPage();
    await page.goto(server.url);
    await page.evaluate(() => (globalThis as any).setupMultiview());
    const id = await page.evaluate(() => (globalThis as any).syncFixture.create());
    await page.evaluate(id => (globalThis as any).syncFixture.rename(id), id);
    for (const pane of ['a', 'b']) {
        await expect(page.locator(`[data-sync-pane="${pane}"] [data-id="${id}"]`)).toContainText('renamed function');
    }
    await page.evaluate(id => (globalThis as any).syncFixture.remove(id), id);
    for (const pane of ['a', 'b']) await expect(page.locator(`[data-sync-pane="${pane}"] [data-id="${id}"]`)).toHaveCount(0);
    await page.evaluate(() => (globalThis as any).syncFixture.undo());
    for (const pane of ['a', 'b']) {
        await expect(page.locator(`[data-sync-pane="${pane}"] [data-id="${id}"]`)).toContainText('renamed function');
    }
    await page.evaluate(() => (globalThis as any).syncFixture.undo(true));
    for (const pane of ['a', 'b']) await expect(page.locator(`[data-sync-pane="${pane}"] [data-id="${id}"]`)).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => (globalThis as any).syncFixture.errors), []);
    await page.close();
});
