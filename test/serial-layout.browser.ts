import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, expect} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

let server, browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/script-arrows.page.ts', import.meta.url))});
    browser = await chromium.launch({headless: true});
});
after(async () => {await browser?.close(); await server?.close();});

const open = async (layout: 'z' | 'n', locale = 'en') => {
    const page = await browser.newPage({viewport: {width: 1200, height: 760}});
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await page.evaluate(async ({layout, locale}) => {
        await (globalThis as any).setup();
        document.documentElement.lang = locale;
        const f = (globalThis as any).fixture;
        await f.attachLayout();
        await f.attachOverview();
        await f.layout(layout);
    }, {layout, locale});
    await expect(page.locator('.tw-script-view-surface [data-script-view-block]')).toHaveCount(4);
    return {page, errors};
};

for (const layout of ['z', 'n'] as const) {
    test(`${layout}: local arrows use separate routes beyond the right edge of every script`, async () => {
        const {page, errors} = await open(layout);
        try {
            for (const scale of [1, .2]) {
                await page.evaluate(async scale => {await (globalThis as any).fixture.zoom(scale);}, scale);
                const routes = await page.locator('.tw-script-view-surface svg').evaluate(svg => {
                    const edge = Math.max(...[...svg.querySelectorAll('[data-script-view-block]')]
                        .map(root => root.getBoundingClientRect().right));
                    return [...svg.querySelectorAll<SVGPathElement>(
                        '[data-script-relation-layer] > [data-script-relation]:not([data-script-external]) .tw-script-relation-line'
                    )].map(line => {
                        const matrix = line.getScreenCTM(), length = line.getTotalLength();
                        const point = distance => {
                            const p = line.getPointAtLength(distance);
                            return new DOMPoint(p.x, p.y).matrixTransform(matrix);
                        };
                        const start = point(0), next = point(1), beforeEnd = point(length - 1), end = point(length);
                        const box = line.getBBox();
                        const right = new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix).x;
                        return {outset: right - edge, right, leavesRight: next.x > start.x && Math.abs(next.y - start.y) < .1,
                            entersRight: end.x > beforeEnd.x && Math.abs(end.y - beforeEnd.y) < .1};
                    });
                });
                assert.ok(routes.length >= 4);
                assert.equal(new Set(routes.map(route => Math.round(route.right))).size, routes.length);
                for (const route of routes) {
                    assert.ok(route.outset >= 95, `rightward clearance ${route.outset}px`);
                    assert.equal(route.leavesRight, true);
                    assert.equal(route.entersRight, true);
                }
            }
            assert.deepEqual(errors, []);
        } finally {await page.close();}
    });

    test(`${layout}: left-edge fold buttons toggle one script and follow scrolling, zoom and bulk changes`, async () => {
        const {page, errors} = await open(layout, 'ja');
        try {
            const before = await page.evaluate(() => (globalThis as any).fixture.locations());
            const button = page.locator('[data-script-fold-toggle="start"]');
            await expect(button).toHaveText('▼');
            await expect(button).toHaveAttribute('aria-expanded', 'true');
            await button.click();
            await expect(button).toHaveText('▶');
            await expect(button).toHaveAttribute('aria-expanded', 'false');
            await expect(page.locator('.tw-script-view-surface [data-tw-plus-folded-mark]')).toHaveCount(1);
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await button.press('Enter');
            await expect(button).toHaveText('▼');
            await expect(page.locator('.tw-script-view-surface [data-tw-plus-folded-mark]')).toHaveCount(0);
            await page.evaluate(async () => {
                const f = (globalThis as any).fixture;
                const mount = f.workspace.getInjectionDiv().parentElement;
                mount.style.width = '500px';
                mount.style.height = '460px';
                (globalThis as any).Blockly.svgResize(f.workspace);
                await f.zoom(1.5);
            });
            await page.locator('.tw-script-view-surface').evaluate(surface => surface.scrollTo(100, 140));
            await expect.poll(() => page.locator('.tw-script-view-surface').evaluate(surface => surface.scrollLeft)).toBeGreaterThan(0);
            const positions = await page.locator('.tw-script-fold-gutter').evaluate(gutter => {
                const surface = gutter.parentElement.querySelector('.tw-script-view-surface').getBoundingClientRect();
                return [...gutter.querySelectorAll<HTMLElement>('[data-script-fold-toggle]')].map(button => {
                    const rect = button.getBoundingClientRect();
                    const root = gutter.parentElement.querySelector(`[data-script-view-block="${button.dataset.scriptFoldToggle}"]`)
                        .getBoundingClientRect();
                    return {deltaY: rect.top - root.top, deltaX: rect.left - surface.left};
                });
            });
            assert.equal(positions.length, 4);
            positions.forEach(position => {
                assert.ok(Math.abs(position.deltaY) < 1.1, `vertical alignment ${position.deltaY}`);
                assert.ok(Math.abs(position.deltaX - 2) < 1.1, `pinned left edge ${position.deltaX}`);
            });
            await page.evaluate(async () => {
                const f = (globalThis as any).fixture;
                const mount = f.workspace.getInjectionDiv().parentElement;
                mount.style.width = '1200px';
                mount.style.height = '760px';
                (globalThis as any).Blockly.svgResize(f.workspace);
                await f.zoom(1);
            });
            await page.locator('.tw-script-view-surface').evaluate(surface => surface.scrollTo(0, 0));
            await page.locator('.tw-script-view-surface').click({button: 'right', position: {x: 700, y: 20}});
            await page.getByText('すべて折りたたむ', {exact: true}).click();
            await expect(page.locator('[data-script-fold-toggle][aria-expanded="false"]')).toHaveCount(4);
            await page.evaluate(() => (globalThis as any).fixture.layout('free'));
            await expect(page.locator('.tw-script-fold-gutter')).toBeHidden();
            assert.deepEqual(await page.evaluate(() => (globalThis as any).fixture.locations()), before);
            assert.deepEqual(errors, []);
        } finally {await page.close();}
    });

    test(`${layout}: overview follows the serial geometry, scroll and click navigation`, async () => {
        const {page, errors} = await open(layout);
        try {
            const before = await page.evaluate(() => (globalThis as any).fixture.locations());
            const geometry = await page.evaluate(() => {
                const surface = document.querySelector<HTMLElement>('.tw-script-view-surface');
                const svg = surface.querySelector<SVGSVGElement>('svg');
                const roots = [...svg.querySelectorAll<SVGGraphicsElement>(':scope > [data-script-view-block]')];
                const boxes = roots.map(root => root.getBoundingClientRect());
                const gaps = boxes.slice(1).map((box, index) => box.top - boxes[index].bottom);
                const source = roots[0].querySelector<SVGPathElement>(':scope > .blocklyPath');
                const path = [...document.querySelectorAll<SVGPathElement>('[data-workspace-minimap] > g > path')]
                    .find(path => path.getAttribute('d') === source.getAttribute('d'));
                const actual = path.transform.baseVal.consolidate().matrix;
                const expected = svg.getScreenCTM().inverse().multiply(source.getScreenCTM());
                return {gaps, actual: [actual.a, actual.d, actual.e, actual.f],
                    expected: [expected.a, expected.d, expected.e, expected.f]};
            });
            for (const gap of geometry.gaps) assert.ok(gap >= 47, `visible gap ${gap}`);
            geometry.actual.forEach((value, index) => assert.ok(Math.abs(value - geometry.expected[index]) < .01));
            await page.locator('.tw-script-view-surface').evaluate(surface => surface.scrollTo(0, 240));
            await expect.poll(() => page.locator('[data-workspace-minimap] rect').getAttribute('y')).not.toBe('0');
            await page.locator('[data-workspace-minimap]').click({position: {x: 65, y: 6}});
            await expect.poll(() => page.locator('.tw-script-view-surface').evaluate(surface => surface.scrollTop)).toBe(0);
            await page.evaluate(() => (globalThis as any).fixture.layout('free'));
            assert.deepEqual(await page.evaluate(() => (globalThis as any).fixture.locations()), before);
            assert.deepEqual(errors, []);
        } finally {await page.close();}
    });

    test(`${layout}: edit a script without changing its free position or the selected layout`, async () => {
        const {page, errors} = await open(layout);
        try {
            const before = await page.evaluate(() => (globalThis as any).fixture.locations());
            await page.locator('[data-script-view-block="unrelated"]').click();
            await expect(page.getByRole('dialog', {name: 'Edit script'})).toBeVisible();
            await page.evaluate(async () => {
                const f = (globalThis as any).fixture;
                const editor = f.serialEditor;
                const hat = editor.getBlockById('unrelated');
                if (hat.isMovable()) throw new Error('The root must remain fixed');
                const tail = editor.newBlock('looks_show');
                tail.initSvg(); tail.render();
                editor.getBlockById('unrelated-body').nextConnection.connect(tail.previousConnection);
                await f.flush();
            });
            await page.locator('[data-serial-script-editor] [data-id="unrelated"] .blocklyEditableText').click();
            await page.locator('.blocklyDropDownDiv').getByText('a', {exact: true}).click();
            await page.getByRole('button', {name: 'Close', exact: true}).click();
            assert.equal(await page.locator('.blocklySvg[data-script-serial]').count(), 1);
            const state = await page.evaluate(() => {
                const f = (globalThis as any).fixture;
                const blocks = f.vm.editingTarget.blocks._blocks;
                return {locations: f.locations(), key: blocks.unrelated.fields.KEY_OPTION.value,
                    added: blocks[blocks['unrelated-body'].next]?.opcode, errors: f.procedureErrors()};
            });
            assert.deepEqual(state.locations, before);
            assert.equal(state.key, 'a');
            assert.equal(state.added, 'looks_show');
            assert.deepEqual(state.errors, []);
            await page.evaluate(() => (globalThis as any).fixture.layout('free'));
            assert.deepEqual(await page.evaluate(() => (globalThis as any).fixture.locations()), before);
            assert.deepEqual(errors, []);
        } finally {await page.close();}
    });

    test(`${layout}: background menu folds and unfolds every script in Japanese`, async () => {
        const {page, errors} = await open(layout, 'ja');
        try {
            const before = await page.evaluate(() => (globalThis as any).fixture.locations());
            const background = page.locator('.tw-script-view-surface');
            await background.click({button: 'right', position: {x: 700, y: 20}});
            await page.getByText('すべて折りたたむ', {exact: true}).click();
            await expect.poll(() => page.locator('.tw-script-view-surface [data-tw-plus-folded-mark]').count()).toBe(4);
            await background.click({button: 'right', position: {x: 700, y: 20}});
            await page.getByText('折りたたみをすべて解除', {exact: true}).click();
            await expect.poll(() => page.locator('.tw-script-view-surface [data-tw-plus-folded-mark]').count()).toBe(0);
            assert.deepEqual(await page.evaluate(() => (globalThis as any).fixture.locations()), before);
            assert.deepEqual(errors, []);
        } finally {await page.close();}
    });
}
