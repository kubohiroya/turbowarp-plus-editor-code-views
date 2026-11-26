import assert from 'node:assert/strict';
import {after, before, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {serveEditorRuntime} from '@kubohiroya/turbowarp-plus-editor-test-runtime';

let server, browser;
before(async () => {
    server = await serveEditorRuntime({script: fileURLToPath(new URL('./browser/script-outline.page.ts', import.meta.url))});
    browser = await chromium.launch({headless: true});
});
after(async () => {await browser?.close(); await server?.close();});

test('arrow attachments retain curved hats, arcs, narrow C-shaped caps and multiple moves', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(server.url);
        const errors = await page.evaluate(() => {
            const ns = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(ns, 'svg'); document.body.append(svg);
            const failures = [];
            const check = (data, fraction, expectedLeft, expectedRight) => {
                const path = document.createElementNS(ns, 'path');path.setAttribute('d', data);svg.append(path);
                const bounds = path.getBBox();
                for (const [side, expected] of [['left', expectedLeft], ['right', expectedRight]] as const) {
                    const actual = (globalThis as any).outlinePoint(path, bounds, side, fraction);
                    if (Math.abs(actual.x - expected) > .01 || Math.abs(actual.y - bounds.y - bounds.height * fraction) > .001)
                        failures.push({data, fraction, side, expected, actual});
                }
            };
            for (const fraction of [.25, .5, .75]) {
                const x = Math.sqrt(40 ** 2 - (80 * fraction - 40) ** 2);
                check('M40 0 A40 40 0 1 1 40 80 A40 40 0 1 1 40 0 Z', fraction, 40 - x, 40 + x);
                check('M40 0A40 40 0 1140 80A40 40 0 1140 0Z', fraction, 40 - x, 40 + x);
                check('M0 20 Q40 -20 80 20 V60 H0 Z', fraction,
                    fraction === .25 ? 40 - Math.sqrt(1200) : 0, fraction === .25 ? 40 + Math.sqrt(1200) : 80);
                check('M0 0 H80 V20 H20 V80 H80 V100 H0 Z', fraction, 0, 20);
                const cap = Math.sqrt(16 ** 2 - (32 * fraction - 16) ** 2);
                check('m0,0 m16,0 H48 a16 16 0 0 1 0 32 H16 a16 16 0 0 1 0 -32 z', fraction, 16 - cap, 48 + cap);
            }
            check('M0 0 H80 V20 H20 V80 H80 V100 H0 Z', .1, 0, 80);
            check('M0 0 H80 V20 H20 V80 H80 V100 H0 Z', .9, 0, 80);
            return failures;
        });
        assert.deepEqual(errors, []);
    } finally {await page.close();}
});

test('pan and zoom reuse intrinsic cuts while a changed contour invalidates them', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(server.url);
        const result = await page.evaluate(() => {
            const ns = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(ns, 'svg');document.body.append(svg);
            const path = document.createElementNS(ns, 'path');svg.append(path);
            path.setAttribute('d', 'M0 0 H83 V40 H0 Z');
            const point = path.getPointAtLength.bind(path);let reads = 0;
            path.getPointAtLength = distance => {reads++;return point(distance);};
            const outlinePoint = (globalThis as any).outlinePoint;
            const before = outlinePoint(path, path.getBBox(), 'right', .5);const measured = reads;
            svg.style.transform = 'translate(20px, 30px) scale(2)';
            const after = outlinePoint(path, path.getBBox(), 'right', .5);
            const perturbed = outlinePoint(path, path.getBBox(), 'right', .5 + Number.EPSILON);
            const reused = reads === measured;
            const preciseY = perturbed.y === 40 * (.5 + Number.EPSILON) && perturbed.x === before.x;
            path.setAttribute('d', 'M0 0 H97 V40 H0 Z');
            const changed = outlinePoint(path, path.getBBox(), 'right', .5);
            return {before, after, changed, reused, preciseY, refreshed:reads > measured};
        });
        assert.deepEqual(result, {before:{x:83,y:20},after:{x:83,y:20},changed:{x:97,y:20},reused:true,preciseY:true,refreshed:true});
    } finally {await page.close();}
});

test('geometry without path data retains the native fallback', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(server.url);
        const points = await page.evaluate(() => {
            const ns = 'http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');document.body.append(svg);
            const shape=document.createElementNS(ns,'rect');shape.setAttribute('width','86');shape.setAttribute('height','40');svg.append(shape);
            const point=(globalThis as any).outlinePoint;
            return [point(shape,shape.getBBox(),'left',.5),point(shape,shape.getBBox(),'right',.5)];
        });
        assert.deepEqual(points,[{x:0,y:20},{x:86,y:20}]);
    } finally {await page.close();}
});

test('the bundled worker uses native fallback only at recessed outline joins or for unsupported paths', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(server.url);
        const result = await page.evaluate(async () => {
            const worker = (globalThis as any).createOutlineWorker(window);
            try {
                const recessed = 'M0 0 H120 V28 H20 V72 H120 V100 H0 Z';
                return await worker.calculate([
                    {data: 'M0 0 H83 V40 H0 Z', y: 20, left: false},
                    {data: recessed, y: 28, left: false},
                    {data: recessed, y: 72.0005, left: false},
                    {data: recessed, y: 50, left: false},
                    {data: 'M0 0 invalid', y: 12, left: false}
                ]);
            } finally {worker.dispose();}
        });
        assert.deepEqual(result, [83, null, null, 20, null]);
    } finally {await page.close();}
});

test('a host that blocks the worker can fall back without retrying creation', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(server.url);
        const result = await page.evaluate(async () => {
            let attempts = 0;
            const nativeWorker = window.Worker;
            window.Worker = class extends nativeWorker {
                constructor() {
                    attempts++;
                    throw new Error('Worker blocked by host');
                }
            };
            const worker = (globalThis as any).createOutlineWorker(window);
            try {
                const cuts = [{data: 'M0 0 H83 V40 H0 Z', y: 20, left: false}];
                return {first: await worker.calculate(cuts), second: await worker.calculate(cuts), attempts};
            } finally {
                worker.dispose();
                window.Worker = nativeWorker;
            }
        });
        assert.deepEqual(result, {first: null, second: null, attempts: 1});
    } finally {await page.close();}
});
