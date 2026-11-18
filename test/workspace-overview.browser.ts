import assert from 'node:assert/strict';
import {before, after, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

let server, browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/script-arrows.page.ts', import.meta.url))});
    browser = await chromium.launch({headless: true});
});
after(async () => {await browser?.close(); await server?.close();});
const open = async () => {
    const page = await browser.newPage({viewport: {width: 1200, height: 760}});
    await page.goto(server.url);
    await page.evaluate(async () => {await (globalThis as any).setup(); await (globalThis as any).fixture.attachOverview();});
    await expect(page.locator('[data-workspace-minimap]')).toBeVisible();
    return page;
};

test('the overview reuses shapes during scroll and native offscreen culling, and refreshes real edits', async () => {
    const page = await open();
    const result = await page.evaluate(async () => {
        const f = (globalThis as any).fixture, w = f.workspace;
        const map = document.querySelector('[data-workspace-minimap]');
        const shapes = map.firstElementChild;
        const path = shapes.firstElementChild;
        let writes = 0, scans = 0;
        const original = w.getAllBlocks;
        w.getAllBlocks = function (...args) {scans++; return original.apply(this, args);};
        const observer = new MutationObserver(records => writes += records.length);
        observer.observe(shapes, {attributes: true, childList: true, subtree: true});
        try {
            const viewport = map.querySelector('rect');
            const before = viewport.getAttribute('x');
            w.scrollbar.set(250, 100);
            w.getBlockById('unrelated').getSvgRoot().style.display = 'none';
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            return {writes, scans, same: path === shapes.firstElementChild, moved: viewport.getAttribute('x') !== before};
        } finally {w.getAllBlocks = original; observer.disconnect();}
    });
    assert.deepEqual(result, {writes: 0, scans: 0, same: true, moved: true});
    const before = await page.locator('[data-workspace-minimap] > g').innerHTML();
    await page.evaluate(() => (globalThis as any).fixture.move('definition', 20, 30));
    assert.notEqual(await page.locator('[data-workspace-minimap] > g').innerHTML(), before);
    await page.evaluate(() => (globalThis as any).fixture.hideScript('start', true));
    const reduced = await page.locator('[data-workspace-minimap] > g > path').count();
    await page.evaluate(() => (globalThis as any).fixture.hideScript('start', false));
    assert.ok(await page.locator('[data-workspace-minimap] > g > path').count() > reduced);
    await page.evaluate(() => (globalThis as any).fixture.disposeOverview());
    assert.equal(await page.locator('[data-workspace-minimap]').count(), 0);
    await page.close();
});

test('minimap clicks and viewport drags move the actual workspace', async () => {
    const page = await open();
    const map = page.locator('[data-workspace-minimap]');
    const before = await page.evaluate(() => (globalThis as any).fixture.workspace.getMetrics().viewLeft);
    const box = await map.boundingBox();
    await page.mouse.click(box.x + box.width * .8, box.y + box.height * .7);
    await expect.poll(() => page.evaluate(() => (globalThis as any).fixture.workspace.getMetrics().viewLeft)).not.toBe(before);
    const viewport = map.locator('rect');
    const center = await viewport.evaluate((element: SVGRectElement) => {
        const point = new DOMPoint(element.x.baseVal.value + element.width.baseVal.value / 2,
            element.y.baseVal.value + element.height.baseVal.value / 2).matrixTransform(element.getScreenCTM());
        return {x: point.x, y: point.y};
    });
    const previous = await page.evaluate(() => (globalThis as any).fixture.workspace.getMetrics().viewLeft);
    await page.mouse.move(center.x, center.y); await page.mouse.down();
    await page.mouse.move(center.x - 8, center.y - 6, {steps: 3}); await page.mouse.up();
    await expect.poll(() => page.evaluate(() => (globalThis as any).fixture.workspace.getMetrics().viewLeft)).not.toBe(previous);
    await page.close();
});

test('zoom controls reach two percent, keep finite scroll metrics, and restore the viewport', async () => {
    const page = await open();
    const result = await page.evaluate(async () => {
        const f = (globalThis as any).fixture;
        await f.attachLayout();
        const w = f.workspace;
        for (let i = 0; i < 40; i++) w.zoomCenter(-1);
        await f.settle();
        const minimum = w.scale;
        const metrics = w.getMetrics();
        w.zoomCenter(1);
        const larger = w.scale;
        w.setScale(w.options.zoomOptions.startScale);
        return {minimum, larger, reset: w.scale, start: w.options.zoomOptions.startScale,
            finite: Object.values(metrics).filter(value => typeof value === 'number').every(Number.isFinite)};
    });
    assert.equal(result.minimum, .02); assert.ok(result.larger > .02); assert.equal(result.reset, result.start);
    assert.equal(result.finite, true);
    await page.close();
});
