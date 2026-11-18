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
    await page.mouse.move(1100, 700);
    await page.waitForFunction(() => !document.querySelector('[data-script-relation-drag-source], [data-script-relation-related]'));
};
const markedScripts = (page: Page) => page.locator('[data-script-relation-related]')
    .evaluateAll(roots => roots.map(root => root.getAttribute('data-id')).sort());
const strokeStyle = (page: Page, callId: string) => page.locator(`[data-script-relation-layer] > [data-source-call="${callId}"] .tw-script-relation-line`)
    .first().evaluate(line => ({stroke: getComputedStyle(line).stroke, dash: getComputedStyle(line).strokeDasharray}));

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
        layer.parentElement?.firstElementChild === layer), 'the layer is below the Blockly block roots');
    assert.equal(await page.locator('[data-script-relation-layer] [marker-end]').count(), 0,
        'arrowheads do not depend on URL ids that would break in a copied or detached view');
    assert.deepEqual(errors, []);
    await page.close();
});

test('message destinations in other sprites are accessible and send-and-wait keeps its own mark', async () => {
    const {page, errors} = await open();
    const waiting = page.locator('[data-script-relation="message"][data-source-call="wait"]');
    const sending = page.locator('[data-script-relation="message"][data-source-call="send"]');
    assert.equal(await waiting.locator('.tw-script-relation-wait').count(), 2,
        'the same wait mark appears on local and remote receiver edges');
    assert.equal(await sending.locator('.tw-script-relation-wait').count(), 0);
    const destination = page.getByRole('button', {name: /Destination: Secondary/}).first();
    await destination.click();
    await page.waitForFunction(() => (globalThis as any).fixture.vm.editingTarget.getName() === 'Secondary');
    await page.waitForFunction(() => !document.querySelector('[data-script-relation="function"][data-source-call="call-1"]'));
    assert.equal(await page.locator('[data-script-relation="function"][data-source-call="call-1"]').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
});

test('a VM-free child context resolves destination names from its catalog and leaves the zoom corner clear', async () => {
    const {page, errors} = await open();
    await page.evaluate(() => (globalThis as any).fixture.attachCatalogContext());
    assert.equal(await page.getByRole('button', {name: /Destination: Secondary/}).count(), 2,
        'the remote sprite name comes from the injected catalog without a VM');
    const controls = page.locator('.tw-script-relation-controls');
    const box = (await controls.boundingBox())!;
    assert.ok(box.y < 100, 'the controls stay above the lower zoom corner');
    assert.equal(await controls.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
    assert.equal(await controls.locator('.tw-script-relation-legend').evaluate(element => getComputedStyle(element).pointerEvents), 'none');
    assert.equal(await controls.locator('label').evaluate(element => getComputedStyle(element).pointerEvents), 'auto');
    assert.equal(await controls.locator('button').first().evaluate(element => getComputedStyle(element).pointerEvents), 'auto');
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
    const destination = page.getByRole('button', {name: /Destination: Secondary/}).first();
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
        assert.equal(await page.locator('.blocklyBlockCanvas > [data-script-relation-layer]')
            .evaluate(layer => getComputedStyle(layer).display), 'none');
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
    assert.equal(await page.locator('.blocklyBlockCanvas > [data-script-relation-layer]')
        .evaluate(layer => getComputedStyle(layer).display), 'inline');
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
        const matrix = block.getSvgRoot().getScreenCTM();
        return {right: matrix.e + block.width * matrix.a};
    });
    assert.ok(loop.x + loop.width > hat.right + 30, 'the loop extends visibly beyond the hat');
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

    await editor.getByRole('button', {name: /Source: Primary/}).first().click();
    await page.evaluate(() => (globalThis as any).fixture.settle());
    assert.equal(await page.evaluate(() => (globalThis as any).fixture.focusedScript()), undefined);
    assert.equal(await page.evaluate(() => (globalThis as any).fixture.lastCenteredScript()), 'start');
    assert.equal(await page.evaluate(() => {
        const workspace = (globalThis as any).fixture.workspace;
        return workspace.getTopBlocks(false).some((block: any) => block.getSvgRoot().hasAttribute('data-tw-plus-hidden'));
    }), false, 'following a caller preserves the code area\'s all-script view');
    assert.deepEqual(await page.evaluate(() => (globalThis as any).fixture.procedureErrors()), []);
    await page.evaluate(() => (globalThis as any).fixture.disposeProcedure());
    assert.equal(await editor.locator('[data-script-relation-layer], .tw-script-relation-controls').count(), 0);
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
    assert.equal(await page.locator('[data-script-relation-layer], .tw-script-relation-controls').count(), 0);
    await page.evaluate(() => (globalThis as any).fixture.moveStart(10, 10));
    assert.equal(await page.locator('[data-script-relation-layer], .tw-script-relation-controls').count(), 0,
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
