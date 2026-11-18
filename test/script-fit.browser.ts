// Fit assertions use screen geometry rather than duplicating the implementation's scale calculation.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, expect, type Browser, type Page} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

let server: Awaited<ReturnType<typeof serveEditorRuntime>>;
let browser: Browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/script-fit.page.ts', import.meta.url))});
    browser = await chromium.launch({headless: true,
        ...(process.env.TWPE_CHROME_EXECUTABLE ? {executablePath: process.env.TWPE_CHROME_EXECUTABLE} : {})});
});
after(async () => {await browser?.close(); await server?.close();});

type Setup = {rtl?: boolean; minScale?: number; maxScale?: number; width?: number; height?: number};
const open = async (options: Setup = {}) => {
    const page = await browser.newPage({viewport: {width: 1200, height: 800}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await page.evaluate(value => (globalThis as any).setupFit(value), options);
    return {page, errors};
};
const inspect = (page: Page, id: string) => page.evaluate(value => (globalThis as any).fitFixture.inspect(value), id);
const near = (actual: number, expected: number, label: string, tolerance = 2) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`);
const inside = (result: any) => result.box.left >= result.view.left + 22 &&
    result.box.right <= result.view.right - 22 && result.box.top >= result.view.top + 22 &&
    result.box.bottom <= result.view.bottom - 22;
const topLeft = (result: any) => {
    near(result.first.left, result.view.left + 24, 'first block left');
    near(result.first.top, result.view.top + 24, 'first block top');
};
const fit = (page: Page, id: string) => page.evaluate(value => (globalThis as any).fitFixture.fit(value), id);
const focus = (page: Page, id: string, refit = false) =>
    page.evaluate(value => (globalThis as any).fitFixture.focus(value.id, value.refit), {id, refit});

test('the complete selected script fits the usable viewport and leaves unrelated project coordinates unchanged', async () => {
    const {page, errors} = await open();
    try {
        const before = await page.evaluate(() => (globalThis as any).fitFixture.locations());
        const undo = (await inspect(page, 'medium')).undo;
        assert.equal(await fit(page, 'medium'), true);
        await expect.poll(async () => inside(await inspect(page, 'medium'))).toBe(true);
        const result = await inspect(page, 'medium');
        assert.ok(result.scale > .5 && result.scale < 1.25);
        topLeft(result);
        assert.deepEqual(await page.evaluate(() => (globalThis as any).fitFixture.locations()), before);
        assert.equal(result.undo, undo, 'fitting never creates a block edit');
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('fitting refreshes an already visible SVG after its panel shrinks without a preceding svgResize', async () => {
    const {page, errors} = await open();
    try {
        // setupFit has already rendered the original 900 by 620 panel at a positive size.
        const before = await inspect(page, 'medium');
        const result = await page.evaluate(async () => {
            const fixture = (globalThis as any).fitFixture;
            fixture.resizeMount(450, 420);
            // Invoke fit in the same task, before any resize observer or animation frame can run.
            const fitted = await fixture.fit('medium');
            return {fitted, metrics: fixture.inspect('medium')};
        });
        assert.equal(result.fitted, true);
        const current = result.metrics;
        near(current.view.width, before.view.width - 450, 'updated viewport width');
        near(current.view.height, before.view.height - 200, 'updated viewport height');
        assert.ok(current.box.left >= current.view.left + 22 && current.box.right <= current.view.right - 22);
        topLeft(current);
        if (Math.abs(current.scale - .5) < .001) near(current.box.top, current.view.top + 24, 'resized floor top');
        else {
            assert.ok(inside(current));
            topLeft(current);
        }
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('small scripts stop at the automatic zoom ceiling and stricter workspace ceilings remain authoritative', async () => {
    for (const [maxScale, expected] of [[2, 1.25], [.85, .85], [.4, .4]]) {
        const {page, errors} = await open({maxScale});
        try {
            assert.equal(await fit(page, 'small'), true);
            const result = await inspect(page, 'small');
            near(result.scale, expected, 'zoom ceiling', .001);
            assert.ok(inside(result));
            topLeft(result);
            assert.deepEqual(errors, []);
        } finally {await page.close();}
    }
});

test('tall scripts stop at the zoom floor and keep their top visible with a 24px margin', async () => {
    for (const [minScale, expected] of [[.2, .5], [.7, .7], [1.5, 1.5]]) {
        const {page, errors} = await open({minScale});
        try {
            assert.equal(await fit(page, 'tall'), true);
            const result = await inspect(page, 'tall');
            near(result.scale, expected, 'zoom floor', .001);
            assert.ok(result.box.height > result.view.height - 48);
            near(result.box.top, result.view.top + 24, 'overflow top');
            topLeft(result);
            assert.deepEqual(errors, []);
        } finally {await page.close();}
    }
});

test('wide procedure scripts keep the first block at the top left in LTR and RTL, including raised hats', async () => {
    for (const rtl of [false, true]) {
        const {page, errors} = await open({rtl});
        try {
            assert.equal(await fit(page, 'wide'), true);
            const result = await inspect(page, 'wide');
            near(result.scale, .5, 'wide script floor', .001);
            assert.ok(result.box.width > result.view.width - 48);
            topLeft(result);
            // Reaching the floor aligns the entire raised hat to the top, even when only width overflows.
            near(result.box.top, result.view.top + 24, 'wide script floor top');
            assert.deepEqual(errors, []);
        } finally {await page.close();}
    }
});

test('missing or hidden workspaces do not mutate the viewport and a focused hidden script fits after showing', async () => {
    const {page, errors} = await open();
    try {
        await page.evaluate(() => (globalThis as any).fitFixture.manual(.9));
        const before = await inspect(page, 'medium');
        assert.equal(await fit(page, 'missing'), false);
        const unchanged = await inspect(page, 'medium');
        assert.deepEqual([unchanged.scale, unchanged.scrollX, unchanged.scrollY], [before.scale, before.scrollX, before.scrollY]);
        await page.evaluate(() => (globalThis as any).fitFixture.visible(false));
        assert.equal(await fit(page, 'medium'), false);
        await focus(page, 'medium');
        await page.evaluate(() => (globalThis as any).fitFixture.visible(true));
        await expect.poll(async () => inside(await inspect(page, 'medium'))).toBe(true);
        topLeft(await inspect(page, 'medium'));
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('a wider block below the hat does not move the first block away from the top left', async () => {
    for (const rtl of [false, true]) {
        const {page, errors} = await open({rtl});
        try {
            await focus(page, 'offset');
            const result = await inspect(page, 'offset');
            topLeft(result);
            assert.ok(result.box.width > result.first.right - result.first.left + 100);
            if (rtl) assert.ok(result.box.left < result.first.left - 100);
            assert.deepEqual(errors, []);
        } finally {await page.close();}
    }
});

test('focus changes and explicit reselection refit while manual zoom survives ordinary redraws', async () => {
    const {page, errors} = await open();
    try {
        await focus(page, 'medium');
        await expect.poll(async () => inside(await inspect(page, 'medium'))).toBe(true);
        assert.equal((await inspect(page, 'unrelated')).hidden, true);
        await page.evaluate(() => (globalThis as any).fitFixture.manual(.8));
        await focus(page, 'medium');
        await page.evaluate(() => (globalThis as any).fitFixture.redraw());
        near((await inspect(page, 'medium')).scale, .8, 'manual zoom survives redraw', .001);
        await focus(page, 'medium', true);
        await expect.poll(async () => inside(await inspect(page, 'medium'))).toBe(true);
        topLeft(await inspect(page, 'medium'));
        await focus(page, 'small');
        near((await inspect(page, 'small')).scale, 1.25, 'changed script fits', .001);
        assert.equal((await inspect(page, 'medium')).hidden, true);
        assert.deepEqual((await inspect(page, 'small')).errors, []);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('the pane adapter restores a focused script without letting a saved viewport overwrite the fit', async () => {
    const {page, errors} = await open();
    try {
        await page.evaluate(() => (globalThis as any).fitFixture.adapterFocus('medium',
            {scale: 1.7, x: -5000, y: -7000, visible: true}));
        await expect.poll(async () => inside(await inspect(page, 'medium'))).toBe(true);
        topLeft(await inspect(page, 'medium'));
        await page.evaluate(() => (globalThis as any).fitFixture.manual(.8));
        await page.evaluate(() => (globalThis as any).fitFixture.adapterFocus('medium',
            {scale: 1.7, x: -5000, y: -7000, visible: true}));
        await expect.poll(async () => inside(await inspect(page, 'medium'))).toBe(true);
        topLeft(await inspect(page, 'medium'));
        assert.deepEqual((await inspect(page, 'medium')).errors, []);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});
