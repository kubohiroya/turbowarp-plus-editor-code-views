// Relationship arrows with the real VM and Blockly, including a folded editor whose body is absent.
import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium, type Browser, type Page} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

let server: Awaited<ReturnType<typeof serveEditorRuntime>>;
let browser: Browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/script-arrows.page.ts', import.meta.url))});
    browser = await chromium.launch({headless: true,
        ...(process.env.TWPE_CHROME_EXECUTABLE ? {executablePath: process.env.TWPE_CHROME_EXECUTABLE} : {})});
});
after(async () => {await browser?.close(); await server?.close();});

const relation = (page: Page, kind?: 'function' | 'message') =>
    page.locator(`[data-script-relation-layer] > [data-script-relation${kind ? `="${kind}"` : ''}]`);
const open = async () => {
    const page = await browser.newPage({viewport: {width: 1200, height: 760}});
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.url);
    await page.evaluate(() => (globalThis as any).setup());
    await page.waitForFunction(() => document.querySelectorAll('[data-script-relation-layer] > [data-script-relation="function"]').length === 3);
    return {page, errors};
};

const beginDrag = async (page: Page, id: string) => {
    const location = await page.locator(`.blocklyBlockCanvas [data-id="${id}"] > .blocklyPath`).evaluate(path => {
        const box = path.getBoundingClientRect();
        return {x: box.x + 10, y: box.y + Math.min(box.height - 10, 40)};
    });
    await page.mouse.move(location.x, location.y);
    await page.mouse.down();
    await page.mouse.move(location.x + 70, location.y + 90, {steps: 4});
    await page.waitForFunction(blockId => (globalThis as any).fixture.workspace.currentGesture_?.blockDragger_?.draggingBlock_?.id === blockId,
        id, {timeout: 10000});
    await page.waitForFunction(blockId => document.querySelector(`[data-id="${blockId}"]`)
        ?.hasAttribute('data-script-relation-drag-source'), id, {timeout: 10000});
};
const endDrag = async (page: Page) => {
    await page.mouse.up();
    // Clear Blockly's ordinary selection after ending the drag, so contextual emphasis can disappear.
    await page.mouse.click(1100, 700);
    await page.waitForFunction(() => !document.querySelector('[data-script-relation-drag-source], [data-script-relation-related]'));
    // The marks go on mouseup; the click's deselection reaches the edges in a later frame.
    await page.evaluate(() => (globalThis as any).fixture.settle());
};
const markedScripts = (page: Page) => page.locator('[data-script-relation-related]')
    .evaluateAll(roots => roots.map(root => root.getAttribute('data-id')).sort());
const strokeStyle = (page: Page, callId: string) => page.locator(`[data-script-relation-layer] > [data-source-call="${callId}"] .tw-script-relation-line`)
    .first().evaluate(line => ({stroke: getComputedStyle(line).stroke, dash: getComputedStyle(line).strokeDasharray}));
const activateScript = async (page: Page, id: string, scope = '.blocklyBlockCanvas') => {
    const location = await page.locator(`${scope} [data-id="${id}"] > .blocklyPath`).evaluate(path => {
        const box = path.getBoundingClientRect();
        return {x: box.x + box.width / 2, y: box.y + box.height / 2};
    });
    // Fields and labels paint over their sibling path; move over the block as a user does.
    await page.mouse.move(location.x, location.y);
    await page.evaluate(() => (globalThis as any).fixture.settle());
};

test('function and message filters independently remove arrows, guides and hidden work', async () => {
    const {page, errors} = await open();
    await activateScript(page, 'start');
    const messages = await relation(page, 'message').count();
    assert.ok(messages > 0);
    for (const [functions, messagesVisible] of [[false, true], [true, false], [false, false], [true, true]]) {
        await page.evaluate(async ([functions, message]) => {
            const f = (globalThis as any).fixture;
            f.arrows.setVisibility({function: functions, message});
            await f.settle();
        }, [functions, messagesVisible]);
        assert.equal(await relation(page, 'function').count(), functions ? 3 : 0);
        assert.equal(await relation(page, 'message').count(), messagesVisible ? messages : 0);
        assert.equal(await page.getByRole('button', {name: /Secondary.*go/}).count(), messagesVisible ? 2 : 0);
    }
    const reads = await page.evaluate(async () => {
        const f = (globalThis as any).fixture;
        f.arrows.setVisibility({function: false, message: false});
        let reads = 0;
        const canvas = f.workspace.getCanvas();
        const original = canvas.getScreenCTM;
        canvas.getScreenCTM = function () {reads++; return original.call(this);};
        try {
            f.workspace.translate(350, 40);
            await f.move('definition', 5, 0);
            await f.settle();
            return reads;
        } finally {canvas.getScreenCTM = original;}
    });
    assert.equal(reads, 0, 'both filters off skip coordinate reads even after scroll and edits');
    assert.deepEqual(errors, []);
    await page.close();
});

test('arrow repaint measures the viewport once and never mutates the minimap block canvas', async () => {
    const {page, errors} = await open();
    const result = await page.evaluate(async () => {
        const f = (globalThis as any).fixture;
        const svg = f.workspace.getParentSvg();
        const canvas = f.workspace.getCanvas();
        const bounds = svg.getBoundingClientRect;
        let reads = 0, mutations = 0;
        svg.getBoundingClientRect = function () {reads++; return bounds.call(this);};
        const observer = new MutationObserver(records => {mutations += records.length;});
        observer.observe(canvas, {childList: true, attributes: true, subtree: true});
        try {await f.settle(); return {reads, mutations};}
        finally {svg.getBoundingClientRect = bounds; observer.disconnect();}
    });
    assert.equal(result.reads, 1, 'all arrows share one viewport measurement');
    assert.equal(result.mutations, 0, 'arrow changes cannot invalidate the minimap shapes');
    assert.deepEqual(errors, []);
    await page.close();
});

test('panning reuses internal arrows and anchors while keeping remote links at the viewport edge', async () => {
    const {page, errors} = await open();
    const result = await page.evaluate(async () => {
        const f = (globalThis as any).fixture;
        const canvas = f.workspace.getCanvas();
        const internal = document.querySelector('[data-source-call="call-1"]');
        const internalPath = internal.querySelector('.tw-script-relation-line');
        const anchor = f.workspace.getBlockById('call-1').getSvgRoot().querySelector('.blocklyPath');
        const original = anchor.getScreenCTM;
        let reads = 0;
        anchor.getScreenCTM = function () {reads++; return original.call(this);};
        try {
            f.workspace.translate(380, 45);
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            const remote = document.querySelector<SVGPathElement>('[data-source-call="send"][data-destination-block="remote-receive"] .tw-script-relation-line');
            const point = remote.getPointAtLength(remote.getTotalLength());
            const matrix = remote.getScreenCTM();
            const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
            const area = f.workspace.getParentSvg().getBoundingClientRect();
            return {same: internal === document.querySelector('[data-source-call="call-1"]') &&
                internalPath === internal.querySelector('.tw-script-relation-line'), reads,
                transform: canvas.previousElementSibling.getAttribute('transform') === canvas.getAttribute('transform'),
                edge: Math.abs(screen.x - (area.right - 12)) < .1};
        } finally {anchor.getScreenCTM = original;}
    });
    assert.deepEqual(result, {same: true, reads: 0, transform: true, edge: true});
    assert.deepEqual(errors, []);
    await page.close();
});

test('arrows keep their real endpoints when only the caller or receiver is on screen', async () => {
    const {page, errors} = await open();
    try {
        const inspect = () => page.evaluate(() => {
            const f = (globalThis as any).fixture;
            const viewport = f.workspace.getParentSvg().getBoundingClientRect();
            const edge = (id: string, destination: string) => {
                const group = document.querySelector(`[data-source-call="${id}"][data-destination-block="${destination}"]`);
                const line = group?.querySelector<SVGPathElement>('.tw-script-relation-line');
                const matrix = line?.getScreenCTM();
                const start = line && line.getPointAtLength(0);
                const end = line && line.getPointAtLength(line.getTotalLength());
                return group ? {external: group.hasAttribute('data-script-external'),
                    path: line?.getAttribute('d'),
                    startX: new DOMPoint(start.x, start.y).matrixTransform(matrix).x,
                    endX: new DOMPoint(end.x, end.y).matrixTransform(matrix).x} : null;
            };
            return {call: edge('call-1', 'definition'), message: edge('send', 'receive'),
                recursive: edge('recursive', 'definition'),
                right: viewport.right,
                callerHidden: f.workspace.getBlockById('start').getSvgRoot().style.display === 'none',
                receiverHidden: f.workspace.getBlockById('receive').getSvgRoot().style.display === 'none'};
        });
        await page.evaluate(async () => {
            const f = (globalThis as any).fixture;
            await f.move('definition', 1600, 0);
            await f.move('receive', 1600, 0);
            f.workspace.intersectionObserver.checkForIntersections();
            await f.settle();
        });
        const outgoing = await inspect();
        assert.equal(outgoing.receiverHidden, true, 'native culling still hides the offscreen block');
        assert.equal(outgoing.call?.external, false, 'a visible caller keeps the actual offscreen definition');
        assert.equal(outgoing.message?.external, false, 'a visible sender keeps the actual offscreen receiver');
        assert.ok(outgoing.call.endX > outgoing.right + 1000 && outgoing.message.endX > outgoing.right + 1000,
            'arrowheads extend to the real offscreen definitions and receivers');
        assert.equal(outgoing.recursive, null, 'a relation with both blocks offscreen is omitted');
        await page.evaluate(async () => {
            const f = (globalThis as any).fixture;
            await f.move('definition', -1600, 0);
            await f.move('receive', -1600, 0);
            await f.moveStart(1600, 0);
            f.workspace.intersectionObserver.checkForIntersections();
            await f.settle();
        });
        const incoming = await inspect();
        assert.equal(incoming.callerHidden, true);
        assert.equal(incoming.call?.external, false, 'a visible definition keeps the actual offscreen caller');
        assert.equal(incoming.message?.external, false, 'a visible receiver keeps the actual offscreen sender');
        assert.ok(incoming.call.startX > incoming.right && incoming.message.startX > incoming.right,
            'incoming arrow tails retain the offscreen callers and senders');
        assert.notEqual(incoming.call?.path, outgoing.call?.path);
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('panning updates endpoint visibility even when native culling leaves the block SVGs mounted', async () => {
    const {page, errors} = await open();
    try {
        await page.evaluate(async () => {
            const f = (globalThis as any).fixture;
            for (const block of f.workspace.getTopBlocks(false)) f.workspace.intersectionObserver.unobserve(block);
            f.arrows.setVisibility({function: true, message: false});
            await f.moveStart(-700, 0);
            await f.move('definition', 1400, 0);
            const path = f.workspace.getBlockById('call-1').getSvgRoot().querySelector('.blocklyPath');
            const read = path.getScreenCTM;
            (globalThis as any).panAnchorReads = 0;
            path.getScreenCTM = function () {(globalThis as any).panAnchorReads++; return read.call(this);};
        });
        assert.equal(await relation(page).count(), 0, 'both endpoints are outside even if the curve crosses the viewport');
        const pan = (x: number) => page.evaluate(async value => {
            const w = (globalThis as any).fixture.workspace;
            w.translate(value, 0);
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        }, x);
        await pan(900);
        const calls = page.locator('[data-script-relation-layer] > [data-source-call="call-1"]');
        assert.equal(await calls.count(), 1, 'panning the source into view restores the arrow');
        assert.equal(await calls.getAttribute('data-script-external'), null);
        assert.equal(await relation(page, 'function').count(), 2);
        await pan(-1200);
        assert.equal(await calls.count(), 1, 'the destination alone keeps the incoming arrow');
        assert.equal(await relation(page, 'function').count(), 3, 'the now-visible recursive definition is included');
        await pan(310);
        assert.equal(await relation(page).count(), 0, 'panning both endpoints out removes the arrows again');
        assert.equal(await page.evaluate(() => (globalThis as any).panAnchorReads), 0,
            'viewport transitions reuse measured endpoints instead of reading block geometry again');
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('moving an unrelated script keeps existing relationship lines in place', async () => {
    const {page, errors} = await open();
    const same = await page.evaluate(async () => {
        const f = (globalThis as any).fixture;
        const group = document.querySelector('[data-source-call="call-1"]');
        const path = group.querySelector('.tw-script-relation-line');
        await f.move('unrelated', 15, 0);
        return group === document.querySelector('[data-source-call="call-1"]') &&
            path === group.querySelector('.tw-script-relation-line');
    });
    assert.equal(same, true);
    assert.deepEqual(errors, []);
    await page.close();
});

test('function and message roles always leave the right side and enter the left side, including reversed layouts', async () => {
    const {page, errors} = await open();
    const check = async () => {
        const results = await page.evaluate(() => {
            const w = (globalThis as any).fixture.workspace;
            return [['call-1', 'definition'], ['send', 'receive'], ['recursive', 'definition']].map(([source, destination]) => {
                const line = document.querySelector<SVGPathElement>(`[data-source-call="${source}"][data-destination-block="${destination}"] .tw-script-relation-line`);
                const matrix = line.getScreenCTM();
                const first = line.getPointAtLength(0), last = line.getPointAtLength(line.getTotalLength());
                const start = new DOMPoint(first.x, first.y).matrixTransform(matrix);
                const end = new DOMPoint(last.x, last.y).matrixTransform(matrix);
                const box = id => w.getBlockById(id).getSvgRoot().querySelector(':scope > .blocklyPath').getBoundingClientRect();
                return {source: Math.abs(start.x - box(source).right), destination: Math.abs(end.x - box(destination).left)};
            });
        });
        assert.ok(results.every(item => item.source < 1.5 && item.destination < 1.5), JSON.stringify(results));
    };
    await check();
    await page.evaluate(async () => {
        const f = (globalThis as any).fixture;
        await f.move('definition', -350, 0); await f.move('receive', -680, 0);
    });
    await check();
    await page.evaluate(() => (globalThis as any).fixture.rtl(true));
    await check();
    assert.deepEqual(errors, []);
    await page.close();
});

test('background dragging follows the workspace drag surface without changing its native canvas children', async () => {
    const {page, errors} = await open();
    const result = await page.evaluate(async () => {
        const f = (globalThis as any).fixture;
        const w = f.workspace;
        // The minimal runtime does not inject this optional surface; use Blockly's real implementation.
        const surface = new (globalThis as any).Blockly.WorkspaceDragSurfaceSvg(w.getInjectionDiv());
        surface.createDom();
        w.workspaceDragSurface_ = surface;
        w.useWorkspaceDragSurface_ = true;
        await f.attachLayout();
        const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const origin = w.getCanvas().parentNode;
        w.setupDragSurface();
        w.translate(420, 40);
        await settle();
        const layer = document.querySelector('[data-script-relation-layer]') as SVGGraphicsElement;
        const first = layer.querySelector('[data-source-call="call-1"]');
        const sameMatrix = () => {
            const a = w.getCanvas().getScreenCTM(), b = layer.getScreenCTM();
            return ['a', 'b', 'c', 'd', 'e', 'f'].every(key => Math.abs(a[key] - b[key]) < .01);
        };
        const firstAligned = sameMatrix();
        w.translate(470, 65);
        await settle();
        const aligned = sameMatrix();
        const same = first === layer.querySelector('[data-source-call="call-1"]');
        const children = [...w.getCanvas().parentNode.children].map(node => node.getAttribute('class'));
        w.resetDragSurface();
        await settle();
        return {firstAligned, aligned, same, children, restored: w.getCanvas().parentNode === origin && sameMatrix()};
    });
    assert.deepEqual(result, {firstAligned: true, aligned: true, same: true,
        children: ['blocklyBlockCanvas', 'blocklyBubbleCanvas'], restored: true});
    assert.deepEqual(errors, []);
    await page.close();
});

test('function and message arrows use distinct shared styles behind the blocks without intercepting input', async () => {
    const {page, errors} = await open();
    const styles = await page.locator('.tw-script-relation-line').evaluateAll(lines => lines.map(line => {
        const style = getComputedStyle(line);
        return {kind: line.closest('[data-script-relation]')?.getAttribute('data-script-relation'),
            stroke: style.stroke, dash: style.strokeDasharray, pointerEvents: style.pointerEvents};
    }));
    const functions = styles.filter(style => style.kind === 'function');
    const messages = styles.filter(style => style.kind === 'message');
    assert.equal(functions.length, 3, 'both calls and the recursive call are connected');
    assert.ok(messages.length >= 2, 'both ordinary send and send-and-wait are connected');
    assert.notEqual(functions[0].stroke, messages[0].stroke);
    assert.ok(functions.every(style => style.stroke === functions[0].stroke && style.dash === 'none'));
    assert.ok(messages.every(style => style.stroke === messages[0].stroke && style.dash !== 'none'));
    assert.ok(styles.every(style => style.pointerEvents === 'none'));
    assert.ok(await page.locator('[data-script-relation-layer]').evaluate(layer =>
        layer.nextElementSibling?.classList.contains('blocklyBlockCanvas')), 'the layer is below and outside the Blockly block canvas');
    assert.equal(await page.locator('[data-script-relation-layer] [marker-end]').count(), 0,
        'arrowheads do not depend on URL ids that would break in a copied or detached view');
    assert.deepEqual(errors, []);
    await page.close();
});

test('message destinations in other sprites remain accessible without hourglass icons', async () => {
    const {page, errors} = await open();
    const waiting = page.locator('[data-script-relation="message"][data-source-call="wait"]');
    const sending = page.locator('[data-script-relation="message"][data-source-call="send"]');
    assert.equal(await waiting.locator('.tw-script-relation-wait').count(), 0);
    assert.equal(await sending.locator('.tw-script-relation-wait').count(), 0);
    const paint = () => waiting.evaluateAll(groups => groups.map(group => ({
        external: group.hasAttribute('data-script-external'), opacity: getComputedStyle(group.querySelector('.tw-script-relation-line')).opacity,
        stroke: getComputedStyle(group.querySelector('.tw-script-relation-line')).strokeOpacity
    })));
    assert.deepEqual(await paint(), [
        {external: false, opacity: '1', stroke: '0.2'}, {external: true, opacity: '0.05', stroke: '1'}
    ]);
    await activateScript(page, 'start');
    assert.deepEqual(await paint(), [
        {external: false, opacity: '1', stroke: '1'}, {external: true, opacity: '0.05', stroke: '1'}
    ], 'highlighting keeps external arrows at five percent');
    const destination = page.getByRole('button', {name: /Secondary.*go/}).first();
    await destination.click();
    await page.waitForFunction(() => (globalThis as any).fixture.vm.editingTarget.getName() === 'Secondary');
    await page.waitForFunction(() => !document.querySelector('[data-script-relation="function"][data-source-call="call-1"]'));
    assert.equal(await page.locator('[data-script-relation="function"][data-source-call="call-1"]').count(), 0);
    assert.deepEqual(await paint(), [{external: true, opacity: '0.05', stroke: '1'}],
        'an incoming edge with its source in another sprite uses the same opacity');
    assert.deepEqual(errors, []);
    await page.close();
});

test('message dash styles replace hourglasses in free, serial, folded and preview code views', async () => {
    const {page, errors} = await open();
    await page.evaluate(() => (globalThis as any).fixture.attachLayout());
    for (const layout of ['free', 'z', 'n']) {
        await page.evaluate(value => (globalThis as any).fixture.layout(value), layout);
        for (const scale of [1, .2, 1.5]) {
            await page.evaluate(value => (globalThis as any).fixture.zoom(value), scale);
            const styles = await relation(page, 'message').evaluateAll(groups => groups.map(group => ({
                wait: group.getAttribute('data-wait'),
                dash: getComputedStyle(group.querySelector('.tw-script-relation-line')).strokeDasharray
                    .split(/[ ,]+/).map(parseFloat)
            })));
            assert.ok(styles.length > 0);
            for (const style of styles) assert.deepEqual(style.dash, style.wait === 'true' ? [7, 5] : [3.5, 2.5]);
            assert.equal(await page.locator('.tw-script-relation-wait').count(), 0);
        }
    }
    await page.evaluate(async () => {
        await (globalThis as any).fixture.layout('free');
        await (globalThis as any).fixture.fold('start', true);
        await (globalThis as any).fixture.project('z');
    });
    const preview = page.locator('[data-arrow-test-projection]');
    assert.equal(await preview.locator('.tw-script-relation-wait').count(), 0);
    assert.ok(await preview.locator('[data-script-relation="message"][data-wait="true"]').count() > 0);
    assert.ok(await preview.locator('[data-script-relation="message"][data-wait="false"]').count() > 0);
    assert.equal(await page.locator('[data-script-relation-guide]').evaluateAll(nodes => nodes.some(node => node.textContent.includes('⏳'))), false);
    assert.deepEqual(errors, []);
    await page.close();
});

test('a VM-free child context resolves contextual destination names from its catalog', async () => {
    const {page, errors} = await open();
    await page.evaluate(() => (globalThis as any).fixture.attachCatalogContext());
    assert.equal(await page.getByRole('button', {name: /Secondary.*go/}).count(), 0, 'an idle workspace has no destination list');
    await activateScript(page, 'start');
    assert.equal(await page.getByRole('button', {name: /Secondary.*go/}).count(), 2,
        'the remote sprite name comes from the injected catalog without a VM');
    assert.deepEqual(errors, []);
    await page.close();
});

test('the workspace has no persistent overlay controls, legend or destination list', async () => {
    const {page, errors} = await open();
    assert.equal(await page.locator('.tw-script-relation-controls, .tw-script-relation-legend').count(), 0);
    assert.equal(await page.locator('.injectionDiv input[type="checkbox"]').count(), 0);
    assert.equal(await page.locator('[data-script-relation-guide]:not([hidden])').count(), 0);
    await page.evaluate(() => {
        const toolbox = document.querySelector('.blocklyToolboxDiv') as HTMLElement;
        toolbox.setAttribute('data-horizontal-block-palette', '');
        Object.assign(toolbox.style, {position: 'absolute', top: '0px', left: '0px', width: '100%', height: '50px'});
    });
    await page.evaluate(() => (globalThis as any).fixture.settle());
    assert.equal(await page.locator('.tw-script-relation-controls, .tw-script-relation-legend').count(), 0);
    assert.equal(await page.locator('[data-script-relation-guide]:not([hidden])').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
});

test('keyboard input on a destination button cannot delete or undo the selected block and Enter still navigates', async () => {
    const {page, errors} = await open();
    await page.evaluate(() => {
        const {workspace} = (globalThis as any).fixture;
        workspace.markFocused();
        workspace.getBlockById('call-1').select();
    });
    await activateScript(page, 'start');
    const destination = page.getByRole('button', {name: /Secondary.*go/}).first();
    const original = await destination.elementHandle();
    await activateScript(page, 'unrelated');
    await expect(destination).toHaveCount(0);
    await activateScript(page, 'start');
    assert.equal(await destination.evaluate((node, saved) => node === saved, original), true);
    for (const key of ['Delete', 'Backspace', 'Control+z']) {
        await destination.press(key);
        assert.equal(await page.evaluate(() => Boolean((globalThis as any).fixture.workspace.getBlockById('call-1'))), true,
            `${key} on the destination control must not edit the selected block`);
        assert.equal(await page.evaluate(() => (globalThis as any).fixture.hasVMBlock('call-1')), true);
    }
    await destination.press('Enter');
    await page.waitForFunction(() => (globalThis as any).fixture.vm.editingTarget.getName() === 'Secondary');
    assert.deepEqual(errors, []);
    await page.close();
});

test('serial layout projections reuse the same styles and folded anchors in both directions', async () => {
    const {page, errors} = await open();
    const liveStroke = await relation(page, 'function').first().locator('.tw-script-relation-line')
        .evaluate(line => getComputedStyle(line).stroke);
    for (const view of ['z', 'n']) {
        await page.evaluate(value => (globalThis as any).fixture.project(value), view);
        const projected = page.locator('[data-arrow-test-projection] [data-script-relation-layer]');
        assert.equal(await projected.locator('[data-script-relation="function"]').count(), 3);
        assert.equal(await projected.locator('[data-script-relation="function"] .tw-script-relation-line').first()
            .evaluate(line => getComputedStyle(line).stroke), liveStroke);
        const messages = await projected.locator('[data-script-relation="message"] .tw-script-relation-line')
            .evaluateAll(lines => lines.map(line => getComputedStyle(line).strokeDasharray));
        assert.ok(messages.length > 0 && messages.every(dash => dash !== 'none'));
        assert.equal(await page.locator('.blocklyBlockCanvas').first()
            .evaluate(canvas => getComputedStyle(canvas.previousElementSibling).display), 'none');
    }
    await page.evaluate(async () => {
        await (globalThis as any).fixture.fold('start', true);
        await (globalThis as any).fixture.project('z');
    });
    assert.equal(await page.locator('[data-arrow-test-projection] [data-script-relation="function"]' +
        '[data-source-block="start"][data-count="2"]').count(), 1);
    await page.evaluate(async () => {
        await (globalThis as any).fixture.project(null);
        await (globalThis as any).fixture.fold('start', false);
    });
    assert.equal(await relation(page, 'function').count(), 3);
    assert.deepEqual(errors, []);
    await page.close();
});

test('the integrated script view switches Z, N and free layouts without a redraw feedback loop', async () => {
    const {page, errors} = await open();
    await page.evaluate(() => (globalThis as any).fixture.attachLayout());
    for (const view of ['z', 'n']) {
        await page.evaluate(value => (globalThis as any).fixture.layout(value), view);
        const serial = page.locator('.tw-script-view-surface:not([hidden])');
        assert.equal(await serial.locator('[data-script-relation="function"]').count(), 3);
        const stable = await serial.evaluate(async surface => {
            const svg = surface.querySelector('.tw-script-layout-svg');
            const first = svg?.querySelector('[data-script-relation-layer] > g');
            let changes = 0;
            const observer = new MutationObserver(() => {changes++;});
            observer.observe(surface, {childList: true, subtree: true, attributes: true});
            await new Promise(resolve => setTimeout(resolve, 150));
            observer.disconnect();
            return {sameSVG: surface.querySelector('.tw-script-layout-svg') === svg,
                sameArrow: svg?.querySelector('[data-script-relation-layer] > g') === first, changes};
        });
        assert.deepEqual(stable, {sameSVG: true, sameArrow: true, changes: 0}, 'an idle layout does not redraw itself');
    }
    await page.evaluate(() => (globalThis as any).fixture.layout('free'));
    assert.equal(await page.locator('.tw-script-view-surface').getAttribute('hidden'), '');
    assert.equal(await page.locator('.blocklyBlockCanvas').first()
        .evaluate(canvas => getComputedStyle(canvas.previousElementSibling).display), 'inline');
    assert.equal(await relation(page, 'function').count(), 3);
    assert.deepEqual(errors, []);
    await page.close();
});

test('light and dark themes retain function and message colors and distinct line styles', async () => {
    const {page, errors} = await open();
    const read = () => page.locator('[data-script-relation-layer] .tw-script-relation-line').evaluateAll(lines =>
        Object.fromEntries(['function', 'message'].map(kind => {
            const line = lines.find(entry => entry.closest('[data-script-relation]')?.getAttribute('data-script-relation') === kind)!;
            const style = getComputedStyle(line);
            return [kind, {stroke: style.stroke, dash: style.strokeDasharray}];
        })));
    await page.evaluate(() => {document.documentElement.style.colorScheme = 'light';});
    const light = await read();
    await page.evaluate(() => {document.documentElement.style.colorScheme = 'dark';});
    const dark = await read();
    assert.notEqual(light.function.stroke, dark.function.stroke, 'the function color adjusts for a dark background');
    assert.notEqual(light.message.stroke, dark.message.stroke, 'the message color adjusts for a dark background');
    for (const theme of [light, dark]) {
        assert.notEqual(theme.function.stroke, theme.message.stroke);
        assert.equal(theme.function.dash, 'none');
        assert.notEqual(theme.message.dash, 'none');
    }
    assert.deepEqual(errors, []);
    await page.close();
});

test('a folded recursive arrow loops outside the hat so its relation remains visible', async () => {
    const {page, errors} = await open();
    await page.evaluate(() => (globalThis as any).fixture.fold('definition', true));
    const recursive = page.locator('[data-script-relation="function"][data-recursive][data-source-block="definition"]');
    assert.equal(await recursive.count(), 1);
    const loop = (await recursive.locator('.tw-script-relation-line').boundingBox())!;
    const hat = await page.evaluate(() => {
        const block = (globalThis as any).fixture.workspace.getBlockById('definition');
        return {right: block.getSvgRoot().querySelector(':scope > .blocklyPath').getBoundingClientRect().right};
    });
    assert.ok(loop.x + loop.width > hat.right + 30, 'the loop extends visibly beyond the hat');
    assert.deepEqual(errors, []);
    await page.close();
});

test('recursive arrow endpoints touch actual block outlines when expanded, folded, zoomed and mirrored', async () => {
    const {page, errors} = await open();
    for (const rtl of [false, true]) {
        await page.evaluate(value => (globalThis as any).fixture.rtl(value), rtl);
        for (const folded of [false, true]) {
            await page.evaluate(value => (globalThis as any).fixture.fold('definition', value), folded);
            for (const scale of [0.75, 1.25]) {
                await page.evaluate(value => (globalThis as any).fixture.zoom(value), scale);
                const distances = await page.evaluate(folded => {
                    const workspace = (globalThis as any).fixture.workspace;
                    const line = document.querySelector('[data-source-call="recursive"] .tw-script-relation-line') as SVGPathElement;
                    const pointAt = (shape: SVGPathElement, length: number) => {
                        const point = shape.getPointAtLength(length);
                        return new DOMPoint(point.x, point.y).matrixTransform(shape.getScreenCTM()!);
                    };
                    const distanceToOutline = (point: DOMPoint, id: string) => {
                        const shape = workspace.getBlockById(id).getSvgRoot().querySelector(':scope > .blocklyPath') as SVGPathElement;
                        const length = shape.getTotalLength();
                        let distance = Infinity;
                        for (let i = 0; i <= 2000; i++) {
                            const candidate = pointAt(shape, length * i / 2000);
                            distance = Math.min(distance, Math.hypot(point.x - candidate.x, point.y - candidate.y));
                        }
                        return distance;
                    };
                    return {start: distanceToOutline(pointAt(line, 0), folded ? 'definition' : 'recursive'),
                        end: distanceToOutline(pointAt(line, line.getTotalLength()), 'definition')};
                }, folded);
                assert.ok(distances.start <= 1 && distances.end <= 1,
                    `rtl=${rtl}, folded=${folded}, scale=${scale}: outline distances ${JSON.stringify(distances)}`);
            }
        }
    }
    assert.deepEqual(errors, []);
    await page.close();
});

test('the real function editor keeps arrows through its folded-body replacement and navigates to an external caller', async () => {
    const {page, errors} = await open();
    await page.evaluate(() => (globalThis as any).fixture.attachProcedure());
    const editor = page.locator('[data-arrow-test-procedure]');
    assert.equal(await editor.locator('[data-script-relation="function"][data-recursive]').count(), 1);
    await page.evaluate(() => (globalThis as any).fixture.toggleProcedureFold());
    assert.equal(await page.evaluate(() => (globalThis as any).fixture.procedureHasBlock('recursive')), false);
    assert.equal(await page.evaluate(() => (globalThis as any).fixture.procedureHasBlock('definition:tw-plus-folded')), true);
    assert.equal(await page.evaluate(() => (globalThis as any).fixture.hasVMBlock('recursive')), true);
    assert.equal(await editor.locator('[data-script-relation="function"][data-recursive]' +
        '[data-source-block="definition"][data-destination-block="definition"]').count(), 1);
    await page.evaluate(() => (globalThis as any).fixture.toggleProcedureFold());
    assert.equal(await page.evaluate(() => (globalThis as any).fixture.procedureHasBlock('recursive')), true);
    assert.equal(await editor.locator('[data-script-relation="function"][data-recursive]' +
        '[data-source-block="recursive"]').count(), 1);

    await activateScript(page, 'definition', '[data-arrow-test-procedure] .blocklyBlockCanvas');
    await editor.getByRole('button', {name: /Primary.*jump/}).first().click();
    await page.evaluate(() => (globalThis as any).fixture.settle());
    assert.equal(await page.evaluate(() => (globalThis as any).fixture.focusedScript()), undefined);
    assert.equal(await page.evaluate(() => (globalThis as any).fixture.lastCenteredScript()), 'start');
    assert.equal(await page.evaluate(() => {
        const workspace = (globalThis as any).fixture.workspace;
        return workspace.getTopBlocks(false).some((block: any) => block.getSvgRoot().hasAttribute('data-tw-plus-hidden'));
    }), false, 'following a caller preserves the code area\'s all-script view');
    assert.deepEqual(await page.evaluate(() => (globalThis as any).fixture.procedureErrors()), []);
    await page.evaluate(() => (globalThis as any).fixture.disposeProcedure());
    assert.equal(await editor.locator('[data-script-relation-layer], [data-script-relation-guide]').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
});

test('folding either side preserves calls, groups duplicate folded calls, and unfolds to the original anchors', async () => {
    const {page, errors} = await open();
    await page.evaluate(() => (globalThis as any).fixture.fold('start', true));
    // Select the group directly: the root belongs to the relationship, not to the hidden call block.
    const source = page.locator('[data-script-relation="function"][data-source-block="start"]');
    await source.waitFor();
    assert.equal(await source.count(), 1);
    assert.equal(await source.getAttribute('data-count'), '2', 'same folded source and destination are grouped');
    assert.equal(await relation(page, 'function').count(), 2, 'the recursive call remains separate');

    await page.evaluate(() => (globalThis as any).fixture.fold('definition', true));
    assert.equal(await source.count(), 1, 'both sides may be folded');
    assert.equal(await source.getAttribute('data-destination-block'), 'definition');
    assert.equal(await relation(page, 'function').count(), 2);

    await page.evaluate(async () => {
        await (globalThis as any).fixture.fold('start', false);
        await (globalThis as any).fixture.fold('definition', false);
    });
    assert.equal(await relation(page, 'function').count(), 3);
    for (const id of ['call-1', 'call-2', 'recursive']) {
        assert.equal(await page.locator(`[data-script-relation="function"][data-source-block="${id}"]`).count(), 1);
    }
    assert.deepEqual(errors, []);
    await page.close();
});

test('a folded function with its display body removed still shows the recursive relation stored by the VM', async () => {
    const {page, errors} = await open();
    await page.evaluate(() => (globalThis as any).fixture.fold('definition', true, true));
    assert.equal(await page.locator('.blocklyBlockCanvas [data-id="recursive"]').count(), 0);
    assert.equal(await page.locator('[data-script-relation="function"][data-source-block="definition"]' +
        '[data-destination-block="definition"]').count(), 1, 'the recursive self edge survives body replacement');
    assert.equal(await page.evaluate(() => (globalThis as any).fixture.hasVMBlock('recursive')), true,
        'the VM body remains while the display body is removed');
    await page.evaluate(() => (globalThis as any).fixture.fold('definition', false));
    await page.evaluate(() => (globalThis as any).fixture.reload());
    assert.equal(await relation(page, 'function').count(), 3);
    assert.deepEqual(errors, []);
    await page.close();
});

test('arrows follow a moved call and workspace zoom and scroll, and are removed when the target changes', async () => {
    const {page, errors} = await open();
    const call = page.locator('[data-script-relation="function"][data-source-block="call-1"] .tw-script-relation-line');
    const before = await call.getAttribute('d');
    await page.evaluate(() => (globalThis as any).fixture.moveStartWithoutUpdate(80, 30));
    await page.waitForFunction(previous => document.querySelector('[data-script-relation="function"]' +
        '[data-source-block="call-1"] .tw-script-relation-line')?.getAttribute('d') !== previous, before);
    assert.notEqual(await call.getAttribute('d'), before, 'the path follows the moved script');
    const original = (await call.boundingBox())!;
    await page.evaluate(() => (globalThis as any).fixture.presentation(1.4, 70, 35));
    const scaled = (await call.boundingBox())!;
    assert.ok(Math.abs(scaled.width - original.width * 1.4) <= 3, 'zoom keeps anchors in workspace coordinates');
    assert.ok(Math.abs(scaled.x - original.x) > 5 || Math.abs(scaled.y - original.y) > 5, 'scroll moves the drawn line');
    await page.evaluate(() => (globalThis as any).fixture.switchToSecondary());
    assert.equal(await page.locator('[data-script-relation][data-source-block="call-1"]').count(), 0,
        'a target change clears the previous sprite\'s source anchors');
    await page.evaluate(() => (globalThis as any).fixture.switchToPrimary());
    assert.equal(await relation(page, 'function').count(), 3);
    assert.deepEqual(errors, []);
    await page.close();
});

test('one-script hiding is distinct from folding, and disabling and disposal leave no active arrows', async () => {
    const {page, errors} = await open();
    const caller = page.locator('[data-script-relation="function"][data-source-call="call-1"] .tw-script-relation-line');
    const before = await caller.getAttribute('d');
    await page.evaluate(() => (globalThis as any).fixture.hideScript('start', true));
    assert.equal(await page.locator('[data-script-relation][data-source-block="start"]').count(), 0,
        'a hidden whole script must not acquire a folded proxy anchor');
    assert.notEqual(await caller.getAttribute('d'), before, 'the hidden caller becomes an incoming edge from outside the view');
    await page.evaluate(() => (globalThis as any).fixture.hideScript('start', false));
    assert.equal(await relation(page, 'function').count(), 3);
    await page.evaluate(() => (globalThis as any).fixture.enable(false));
    assert.equal(await relation(page).count(), 0);
    await page.evaluate(() => (globalThis as any).fixture.enable(true));
    assert.equal(await relation(page, 'function').count(), 3);
    await page.evaluate(() => (globalThis as any).fixture.dispose());
    assert.equal(await page.locator('[data-script-relation-layer], [data-script-relation-guide]').count(), 0);
    await page.evaluate(() => (globalThis as any).fixture.moveStart(10, 10));
    assert.equal(await page.locator('[data-script-relation-layer], [data-script-relation-guide]').count(), 0,
        'a later workspace change cannot revive the disposed attachment');
    assert.deepEqual(errors, []);
    await page.close();
});

test('dragging a script highlights its outgoing function and message edges and the related script chunks', async () => {
    const {page, errors} = await open();
    const functions = await strokeStyle(page, 'call-1');
    const messages = await strokeStyle(page, 'send');
    await beginDrag(page, 'start');
    assert.deepEqual(await markedScripts(page), ['definition', 'receive']);
    for (const id of ['call-1', 'call-2', 'send', 'wait']) {
        assert.ok(await page.locator(`[data-script-relation-layer] > [data-source-call="${id}"][data-highlighted]`).count() > 0);
    }
    assert.equal(await page.locator('[data-source-call="recursive"][data-highlighted]').count(), 0,
        'the related function\'s internal recursion does not become an outgoing edge of the dragged event');
    assert.equal(await page.locator('[data-id="unrelated"][data-script-relation-related]').count(), 0);
    assert.deepEqual(await strokeStyle(page, 'call-1'), functions);
    assert.deepEqual(await strokeStyle(page, 'send'), messages);
    const previousPath = await page.locator('[data-source-call="call-1"] .tw-script-relation-line').getAttribute('d');
    await page.mouse.move(500, 240, {steps: 3});
    await page.waitForFunction(previous => document.querySelector('[data-source-call="call-1"] .tw-script-relation-line')
        ?.getAttribute('d') !== previous, previousPath, {timeout: 10000});
    await endDrag(page);
    assert.equal(await page.locator('[data-script-relation-layer] > [data-highlighted]').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
});

test('dragging a function highlights incoming callers and recursion without highlighting the callers\' messages', async () => {
    const {page, errors} = await open();
    await beginDrag(page, 'definition');
    assert.deepEqual(await markedScripts(page), ['start']);
    for (const id of ['call-1', 'call-2', 'recursive']) {
        assert.equal(await page.locator(`[data-source-call="${id}"][data-highlighted]`).count(), 1);
    }
    assert.equal(await page.locator('[data-script-relation="message"][data-highlighted]').count(), 0);
    assert.equal(await page.locator('[data-id="unrelated"][data-script-relation-related]').count(), 0);
    await endDrag(page);
    assert.deepEqual(errors, []);
    await page.close();
});

test('dragging a receiver highlights incoming message senders and preserves their message style', async () => {
    const {page, errors} = await open();
    const messages = await strokeStyle(page, 'send');
    await beginDrag(page, 'receive');
    assert.deepEqual(await markedScripts(page), ['start']);
    for (const id of ['send', 'wait']) {
        assert.equal(await page.locator(`[data-source-call="${id}"][data-destination-block="receive"][data-highlighted]`).count(), 1);
        assert.equal(await page.locator(`[data-source-call="${id}"][data-destination-block="remote-receive"][data-highlighted]`).count(), 0,
            'the other receiver is not part of the dragged receiver\'s incoming edge');
    }
    assert.equal(await page.locator('[data-script-relation="function"][data-highlighted]').count(), 0);
    assert.deepEqual(await strokeStyle(page, 'send'), messages);
    await endDrag(page);
    assert.deepEqual(errors, []);
    await page.close();
});

test('folded script dragging preserves grouped edges and clears every mark when disabled or disposed mid-drag', async () => {
    const {page, errors} = await open();
    await page.evaluate(async () => {
        await (globalThis as any).fixture.fold('start', true);
        await (globalThis as any).fixture.fold('definition', true);
    });
    await beginDrag(page, 'start');
    assert.equal(await page.locator('[data-script-relation="function"][data-source-block="start"]' +
        '[data-count="2"][data-highlighted]').count(), 1);
    assert.deepEqual(await markedScripts(page), ['definition', 'receive']);
    await page.evaluate(() => (globalThis as any).fixture.enable(false));
    assert.equal(await page.locator('[data-script-relation-drag-source], [data-script-relation-related], [data-highlighted]').count(), 0);
    await page.evaluate(() => (globalThis as any).fixture.enable(true));
    await page.waitForFunction(() => document.querySelector('[data-script-relation-drag-source]') !== null);
    await page.evaluate(() => (globalThis as any).fixture.dispose());
    assert.equal(await page.locator('[data-script-relation-drag-source], [data-script-relation-related], [data-highlighted]').count(), 0);
    await endDrag(page);
    assert.deepEqual(errors, []);
    await page.close();
});
