import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, expect, type Browser, type Page} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

let server: Awaited<ReturnType<typeof serveEditorRuntime>>;
let browser: Browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/palette-menu.page.ts', import.meta.url))});
    browser = await chromium.launch({headless: true});
});
after(async () => {
    await browser?.close();
    await server?.close();
});

const open = async (horizontal = true, showPaletteMenu = true) => {
    const page = await browser.newPage({viewport: {width: 900, height: 600}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await page.evaluate(({horizontal, showPaletteMenu}) => (globalThis as any).setup(horizontal, showPaletteMenu),
        {horizontal, showPaletteMenu});
    return {page, errors};
};
const showWorkspace = (page: Page, visible: boolean) => page.evaluate(visible => {
    (globalThis as any).palette.host.workspace.setVisible(visible);
}, visible);
const expectOneRow = async (page: Page) => {
    const toolbox = page.locator('[data-horizontal-block-palette]');
    const button = toolbox.getByRole('button', {name: 'Open the block palette editor'});
    await expect(toolbox).toHaveCSS('display', 'flex');
    const palette = (await toolbox.boundingBox())!;
    const control = (await button.boundingBox())!;
    assert.ok(control.y >= palette.y && control.y + control.height <= palette.y + palette.height + 1);
    assert.ok(control.x >= palette.x && control.x + control.width <= palette.x + palette.width + 1);
    assert.ok(palette.height < 65, 'the palette occupies one row');
    await button.click();
    const editor = page.locator('dialog.tw-block-palette-editor-dialog');
    await expect(editor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    return palette.height;
};

test('the horizontal palette keeps its menu in one row after hide/show and workspace resizing', async () => {
    const {page, errors} = await open();
    const height = await expectOneRow(page);
    for (const width of [900, 600, 400, 240, 900]) {
        await page.setViewportSize({width, height: 600});
        await showWorkspace(page, false);
        await expect(page.locator('.blocklyToolboxDiv')).toBeHidden();
        await showWorkspace(page, true);
        assert.equal(await expectOneRow(page), height);
        await page.locator('.scratchCategoryId-motion').click();
        const flyout = page.locator('.blocklyFlyout');
        await expect(flyout).toBeVisible();
        assert.equal((await flyout.boundingBox())!.y, height, 'the flyout stays below the single row');
        await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
    await page.close();
});

test('switching a shown vertical toolbox to horizontal removes the inline block display', async () => {
    const {page, errors} = await open(false);
    await showWorkspace(page, false);
    await showWorkspace(page, true);
    await expect(page.locator('.blocklyToolboxDiv')).toHaveCSS('display', 'block');
    await page.evaluate(() => (globalThis as any).palette.setHorizontal(true));
    await expectOneRow(page);
    await page.evaluate(() => (globalThis as any).palette.setHorizontal(false));
    await showWorkspace(page, false);
    await expect(page.locator('.blocklyToolboxDiv')).toBeHidden();
    await showWorkspace(page, true);
    await expect(page.locator('.blocklyToolboxDiv')).toHaveCSS('display', 'block');
    assert.deepEqual(errors, []);
    await page.close();
});

test('disposing the workspace removes its visibility wrapper', async () => {
    const {page, errors} = await open();
    assert.equal(await page.evaluate(() => {
        const {host, originalSetVisible} = (globalThis as any).palette;
        return host.workspace.setVisible === originalSetVisible;
    }), false);
    assert.equal(await page.evaluate(() => {
        const {host, originalSetVisible} = (globalThis as any).palette;
        host.workspace.dispose();
        return host.workspace.setVisible === originalSetVisible;
    }), true);
    assert.deepEqual(errors, []);
    await page.close();
});

test('a host can hide the palette menu while categories and layout switching still work', async () => {
    const {page, errors} = await open(false, false);
    const toolbox = page.locator('.blocklyToolboxDiv');
    const button = page.getByRole('button', {name: 'Open the block palette editor'});
    await expect(toolbox).toBeVisible();
    await expect(button).toHaveCount(0);
    await page.evaluate(() => (globalThis as any).palette.setHorizontal(true));
    await expect(toolbox).toHaveAttribute('data-horizontal-block-palette', '');
    await toolbox.locator('.scratchCategoryId-motion').click();
    await expect(page.locator('.blocklyFlyout')).toBeVisible();
    await showWorkspace(page, false);
    await showWorkspace(page, true);
    await expect(button).toHaveCount(0);
    await page.evaluate(() => (globalThis as any).palette.host.workspace.dispose());
    assert.deepEqual(errors, []);
    await page.close();
});
