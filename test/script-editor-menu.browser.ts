import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, expect, type Browser, type Page} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

let server: Awaited<ReturnType<typeof serveEditorRuntime>>;
let browser: Browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/script-editor-menu.page.ts', import.meta.url))});
    browser = await chromium.launch({headless: true,
        ...(process.env.TWPE_CHROME_EXECUTABLE ? {executablePath: process.env.TWPE_CHROME_EXECUTABLE} : {})});
});
after(async () => {await browser?.close(); await server?.close();});

const open = async (locale = 'ja') => {
    const page = await browser.newPage({viewport: {width: 1200, height: 760}});
    await page.goto(server.url);
    await page.evaluate(value => (globalThis as any).setupScriptMenu(value), locale);
    return page;
};
const show = (page: Page, id: string) => page.evaluate(value => (globalThis as any).menuFixture.show(value), id);
const items = (page: Page) => page.getByRole('menuitem').filter({visible: true});
const edit = 'このスクリプトを個別の画面で編集する';
const calls = 'このスクリプトの呼び出し関係を開く';

test('the first block menu entry edits the containing script, ahead of a function call destination', async () => {
    const page = await open();
    try {
        for (const [block, script] of [['start', 'start'], ['call-1', 'start'], ['send', 'start'],
            ['definition', 'definition'], ['recursive', 'definition']]) {
            await show(page, block);
            await expect(items(page).first()).toHaveText(edit);
            await expect(items(page).nth(1)).toHaveText(calls);
            assert.deepEqual(await items(page).evaluateAll(nodes => nodes.slice(0, 3)
                .map(node => getComputedStyle(node).borderTopWidth)), ['0px', '0px', '1px']);
            if (block === 'call-1') await expect(items(page).nth(2)).toHaveText('この関数を表示');
            await items(page).first().click();
            assert.deepEqual(await page.evaluate(() => (globalThis as any).menuFixture.opened.at(-1)),
                {kind: 'script', id: script, block, section: 'functions'});
        }
        await show(page, 'call-1');
        await page.getByRole('menuitem', {name: 'この関数を表示', exact: true}).click();
        assert.deepEqual(await page.evaluate(() => (globalThis as any).menuFixture.opened.at(-1)),
            {kind: 'callee', id: 'definition'});
        await show(page, 'call-1');
        await page.getByRole('menuitem', {name: calls, exact: true}).click();
        assert.deepEqual(await page.evaluate(() => (globalThis as any).menuFixture.opened.at(-1)),
            {kind: 'script', id: 'start', block: 'call-1', section: 'calls'});
    } finally {await page.close();}
});

test('the edit entry is limited to free layout and disappears after disposal', async () => {
    const page = await open();
    try {
        await page.evaluate(() => (globalThis as any).menuFixture.focused(true));
        await show(page, 'call-1');
        await expect(page.getByRole('menuitem', {name: edit, exact: true})).toHaveCount(0);
        await expect(items(page).first()).toHaveText('この関数を表示');
        await page.keyboard.press('Escape');
        await page.evaluate(() => (globalThis as any).menuFixture.focused(false));
        for (const view of ['z', 'n']) {
            await page.evaluate(value => (globalThis as any).menuFixture.view(value), view);
            await show(page, 'call-1');
            await expect(page.getByRole('menuitem', {name: edit, exact: true})).toHaveCount(0);
            await page.keyboard.press('Escape');
        }
        await page.evaluate(() => (globalThis as any).menuFixture.view('free'));
        await show(page, 'call-1');
        await expect(items(page).first()).toHaveText(edit);
        await page.keyboard.press('Escape');
        await page.evaluate(() => (globalThis as any).menuFixture.detach());
        await show(page, 'call-1');
        await expect(page.getByRole('menuitem', {name: edit, exact: true})).toHaveCount(0);
    } finally {await page.close();}
});

test('English menus use the localized edit label', async () => {
    const page = await open('en');
    try {
        await show(page, 'start');
        await expect(items(page).first()).toHaveText('Edit this script in a separate view');
    } finally {await page.close();}
});

test('the edit entry remains first after an addon prepends menu items', async () => {
    const page = await open();
    try {
        await page.evaluate(() => (globalThis as any).menuFixture.prependOption());
        await show(page, 'call-1');
        await expect(items(page).first()).toHaveText(edit);
        await expect(items(page).nth(1)).toHaveText(calls);
        await expect(items(page).nth(2)).toHaveText('Addon first item');
        await expect(items(page).nth(3)).toHaveText('この関数を表示');
        await items(page).first().click();
        assert.deepEqual(await page.evaluate(() => (globalThis as any).menuFixture.opened.at(-1)),
            {kind: 'script', id: 'start', block: 'call-1', section: 'functions'});
    } finally {await page.close();}
});
