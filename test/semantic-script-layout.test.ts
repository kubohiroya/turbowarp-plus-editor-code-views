import assert from 'node:assert/strict';
import {test} from 'node:test';
import {arrangeSemanticScripts, semanticLayoutLimits} from '../dist/semantic-script-layout.js';
import {applySemanticLayout} from '../dist/semantic-layout-workspace.js';

const script = (id: string, width = 180, height = 100) => ({id, x: 400, y: 300, width, height});
const edge = (a: string, b?: string, kind: 'function' | 'message' = 'function', targetId = 'local') => ({
    kind, source: {targetId: 'local', blockId: `${a}:call`, scriptId: a},
    destination: b ? {targetId, blockId: b, scriptId: b} : undefined,
    label: b ?? '', wait: true, ...(b ? {} : {unresolved: 'dynamic' as const})
});
const options = {yieldControl: async () => {}};
const layout = (scripts, edges = [], extra = {}) => arrangeSemanticScripts(scripts, edges, 'local', {...options, ...extra});
const shape = result => result.placements.map(({script, ...p}) => [script.id, p]);
function noOverlap(result, obstacles = []) {
    const boxes = result.placements.map(p => ({...p.script, x: p.x, y: p.y}));
    for (let i = 0; i < boxes.length; i++) for (const b of [...boxes.slice(i + 1), ...obstacles]) {
        const a = boxes[i];
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
    }
}

test('chains, fans and shared callees preserve left-to-right direction and separate unrelated groups', async () => {
    const result = await layout(['entry', 'middle', 'left', 'right', 'shared', 'unrelated'].map(id => script(id)),
        [edge('entry', 'middle'), edge('middle', 'left', 'message'), edge('middle', 'right', 'message'),
            edge('left', 'shared'), edge('right', 'shared')]);
    const byId = new Map(result.placements.map(p => [p.script.id, p]));
    for (const [a, b] of [['entry', 'middle'], ['middle', 'left'], ['middle', 'right'], ['left', 'shared']]) {
        assert.ok(byId.get(a)!.column < byId.get(b)!.column);
    }
    assert.equal(byId.get('left')!.column, byId.get('right')!.column);
    assert.notEqual(byId.get('entry')!.group, byId.get('unrelated')!.group);
    noOverlap(result);
});

test('recursive and mutually recursive scripts share a rank without changing graph edges', async () => {
    const edges = [edge('entry', 'a'), edge('a', 'b'), edge('b', 'a', 'message'), edge('a', 'a'), edge('b', 'exit')];
    const copy = JSON.stringify(edges);
    const result = await layout(['entry', 'a', 'b', 'exit'].map(id => script(id)), edges);
    const p = Object.fromEntries(result.placements.map(p => [p.script.id, p]));
    assert.equal(p.a.column, p.b.column);
    assert.ok(p.entry.column < p.a.column && p.a.column < p.exit.column);
    assert.equal(JSON.stringify(edges), copy);
    noOverlap(result);
});

test('external, dynamic and unresolved calls do not invent local links; parallel edges do not over-attract', async () => {
    const result = await layout(['a', 'b'].map(id => script(id)), [edge('a', 'b', 'message', 'remote'), edge('a'),
        {...edge('a', 'b'), unresolved: 'ambiguous' as const}]);
    assert.equal(result.metrics.edges, 0);
    assert.notEqual(result.placements[0].group, result.placements[1].group);
    assert.equal((await layout(['a', 'b'].map(id => script(id)),
        [edge('a', 'b'), edge('a', 'b', 'message')])).metrics.edges, 1);
});

test('fixed input, reordered input and already-applied input produce the same positions', async () => {
    const scripts = ['c', 'a', 'b'].map(id => script(id));
    const edges = [edge('a', 'b'), edge('b', 'c')];
    const initial = await layout(scripts, edges);
    assert.deepEqual(shape(await layout([...scripts].reverse(), [...edges].reverse())), shape(initial));
    assert.deepEqual(shape(await layout(initial.placements.map(p => ({...p.script, x: p.x, y: p.y})), edges)), shape(initial));
});

test('wide, tall scripts and fixed loose comments keep their clearance', async () => {
    const obstacle = {id: 'note', x: 20, y: 20, width: 900, height: 800};
    const result = await layout([script('a', 700, 1200), script('b', 500, 200), script('c', 100, 120)],
        [edge('a', 'b'), edge('a', 'c')], {obstacles: [obstacle]});
    noOverlap(result, [obstacle]);
    assert.ok(result.placements.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('empty and single-script layouts work; invalid dimensions and oversized inputs fail before simulation', async () => {
    assert.deepEqual((await layout([])).placements, []);
    assert.equal((await layout([script('single')])).placements.length, 1);
    await assert.rejects(layout([script('bad', NaN)]), /Invalid/);
    await assert.rejects(layout([script('same'), script('same')]), /Invalid/);
    await assert.rejects(layout(Array.from({length: semanticLayoutLimits.scripts + 1}, (_, i) => script(String(i)))), /limit/);
});

test('bounded simulations yield and can be cancelled without returning a partial result', async () => {
    const controller = new AbortController();
    let yields = 0;
    await assert.rejects(layout(['a', 'b'].map(id => script(id)), [edge('a', 'b')], {
        signal: controller.signal, yieldControl: async () => {if (++yields === 3) controller.abort();}
    }), /cancelled/);
    assert.equal(yields, 3);
});

test('a throwing native move rolls back earlier moves, comments and queued undo events', () => {
    let enabled = true, group = '', fail = true;
    const queue = [];
    const events = {getGroup: () => group, setGroup: value => {group = value === true ? 'layout' : value;},
        FIRE_QUEUE_: queue, disable: () => {enabled = false;}, enable: () => {enabled = true;}, fireNow_: () => {}};
    const make = (id, throws = false) => {
        let x = 10, y = 20;
        const block = {getRelativeToSurfaceXY: () => ({x, y}), moveBy(dx, dy) {
            x += dx; y += dy;
            if (enabled) queue.push({id, group});
            if (throws && fail) {fail = false; throw new Error('native failure');}
        }};
        return {...script(id), x: 10, y: 20, block};
    };
    const a = make('a'), b = make('b', true);
    let comment = {x: 30, y: 50};
    const comments = [{rootId: 'a', origin: {...comment}, comment: {moveTo(x, y) {comment = {x, y};}}}];
    let resizes = true;
    assert.throws(() => applySemanticLayout({setResizesEnabled(value) {resizes = value;}} as any, events as any,
        [a, b].map(script => ({script, x: 200, y: 400, column: 0, group: 0})) as any, comments as any), /native failure/);
    assert.deepEqual(a.block.getRelativeToSurfaceXY(), {x: 10, y: 20});
    assert.deepEqual(b.block.getRelativeToSurfaceXY(), {x: 10, y: 20});
    assert.deepEqual(comment, {x: 30, y: 50});
    assert.deepEqual(queue, []);
    assert.equal(group, ''); assert.equal(enabled, true); assert.equal(resizes, true);
});
