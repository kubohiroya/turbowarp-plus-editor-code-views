import Matter from 'matter-js';
import type {ScriptBounds} from './script-layout.ts';
import type {ScriptRelation} from './script-relations.ts';

export interface SemanticPlacement<T extends ScriptBounds = ScriptBounds> {
    script: T;
    x: number;
    y: number;
    column: number;
    group: number;
}

export interface SemanticLayoutOptions {
    signal?: AbortSignal;
    /** Yield to the host without making the simulation depend on elapsed time. */
    yieldControl?(): Promise<void>;
    obstacles?: readonly ScriptBounds[];
}

export const semanticLayoutLimits = {scripts: 1000, relations: 10000, steps: 120};
const gap = 64;
const compareId = (a: string, b: string) => a < b ? -1 : Number(a > b);
const overlaps = (a: ScriptBounds, b: ScriptBounds) =>
    a.x < b.x + b.width + gap && b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

function check(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error('Layout cancelled');
}

/** Iterative Kosaraju traversal: recursive projects must not exhaust the JS stack. */
function components(ids: string[], outgoing: Map<string, string[]>, incoming: Map<string, string[]>) {
    const seen = new Set<string>();
    const finished: string[] = [];
    for (const id of ids) {
        if (seen.has(id)) continue;
        const stack: [string, number][] = [[id, 0]];
        seen.add(id);
        while (stack.length) {
            const entry = stack.at(-1)!;
            const edges = outgoing.get(entry[0])!;
            if (entry[1] === edges.length) {finished.push(entry[0]); stack.pop(); continue;}
            const next = edges[entry[1]++];
            if (!seen.has(next)) {seen.add(next); stack.push([next, 0]);}
        }
    }
    seen.clear();
    const groups: string[][] = [];
    for (const id of finished.reverse()) {
        if (seen.has(id)) continue;
        const group: string[] = [], stack = [id];
        seen.add(id);
        while (stack.length) {
            const current = stack.pop()!;
            group.push(current);
            for (const next of incoming.get(current)!) if (!seen.has(next)) {seen.add(next); stack.push(next);}
        }
        groups.push(group.sort(compareId));
    }
    return groups.sort((a, b) => compareId(a[0], b[0]));
}

/**
 * Lay out the SCC condensation DAG in ranks, then relax rectangles with Matter.js.
 * Canonical ID order, fixed steps and final packing keep repeated runs stable.
 * Relations to other targets are shown by the preview, never used to move those targets.
 */
export async function arrangeSemanticScripts<T extends ScriptBounds>(
    scripts: readonly T[], relations: readonly ScriptRelation[], targetId: string, options: SemanticLayoutOptions = {}
): Promise<{placements: SemanticPlacement<T>[]; metrics: {nodes: number; edges: number; steps: number; fallback: boolean}}> {
    const {signal, obstacles = []} = options;
    const yieldControl = options.yieldControl ?? (() => new Promise<void>(resolve => setTimeout(resolve, 0)));
    check(signal);
    if (scripts.length > semanticLayoutLimits.scripts || relations.length > semanticLayoutLimits.relations ||
        obstacles.length > semanticLayoutLimits.scripts) throw new Error('Layout size limit exceeded');
    const ordered = [...scripts].sort((a, b) => compareId(a.id, b.id));
    if (new Set(ordered.map(s => s.id)).size !== ordered.length || [...ordered, ...obstacles].some(s =>
        ![s.x, s.y, s.width, s.height].every(Number.isFinite) || s.width <= 0 || s.height <= 0)) {
        throw new Error('Invalid script bounds');
    }
    const ids = ordered.map(s => s.id);
    const outgoing = new Map(ids.map(id => [id, [] as string[]]));
    const incoming = new Map(ids.map(id => [id, [] as string[]]));
    const edges = new Set<string>();
    for (const {source, destination, unresolved} of relations) {
        if (unresolved || source.targetId !== targetId || destination?.targetId !== targetId ||
            !outgoing.has(source.scriptId) || !incoming.has(destination.scriptId)) continue;
        const key = JSON.stringify([source.scriptId, destination.scriptId]);
        if (edges.has(key)) continue;
        edges.add(key);
        outgoing.get(source.scriptId)!.push(destination.scriptId);
        incoming.get(destination.scriptId)!.push(source.scriptId);
    }
    for (const map of [outgoing, incoming]) for (const entries of map.values()) entries.sort(compareId);
    const scc = components(ids, outgoing, incoming);
    const owner = new Map(scc.flatMap((group, index) => group.map(id => [id, index] as const)));
    const next = scc.map(() => new Set<number>()), before = scc.map(() => new Set<number>());
    for (const [id, children] of outgoing) for (const child of children) {
        const a = owner.get(id)!, b = owner.get(child)!;
        if (a !== b) {next[a].add(b); before[b].add(a);}
    }
    const rank = scc.map(() => 0), remaining = before.map(set => set.size);
    const ready = remaining.flatMap((n, i) => n ? [] : [i]);
    for (let cursor = 0; cursor < ready.length; cursor++) {
        const current = ready[cursor];
        for (const child of next[current]) {
            rank[child] = Math.max(rank[child], rank[current] + 1);
            if (--remaining[child] === 0) ready.push(child);
        }
    }
    // Separate weak components, including orphan scripts, into non-overlapping bands.
    const band = new Map<string, number>();
    let bandCount = 0;
    for (const id of ids) {
        if (band.has(id)) continue;
        const stack = [id];
        band.set(id, bandCount);
        while (stack.length) {
            const current = stack.pop()!;
            for (const adjacent of [...outgoing.get(current)!, ...incoming.get(current)!]) {
                if (!band.has(adjacent)) {band.set(adjacent, bandCount); stack.push(adjacent);}
            }
        }
        bandCount++;
    }
    await yieldControl(); check(signal);
    const widths = new Map<number, number>();
    for (const script of ordered) {
        const column = rank[owner.get(script.id)!];
        widths.set(column, Math.max(widths.get(column) ?? 0, script.width));
    }
    const columnX: number[] = [];
    let x = gap;
    for (let column = 0; column < widths.size; column++) {
        columnX[column] = x;
        x += widths.get(column)! + gap * 2;
    }
    const placements: SemanticPlacement<T>[] = [];
    let bandTop = gap;
    for (let group = 0; group < bandCount; group++) {
        const columns = new Map<number, T[]>();
        for (const script of ordered) if (band.get(script.id) === group) {
            const column = rank[owner.get(script.id)!];
            const entries = columns.get(column) ?? [];
            entries.push(script); columns.set(column, entries);
        }
        // Barycentric sweeps reduce crossings; SCC members stay contiguous.
        const order = new Map<string, number>();
        for (const entries of columns.values()) entries.forEach((s, i) => order.set(s.id, i));
        const ranks = [...columns.keys()].sort((a, b) => a - b);
        for (let sweep = 0; sweep < 4; sweep++) {
            const neighbors = sweep % 2 ? outgoing : incoming;
            for (const column of sweep % 2 ? [...ranks].reverse() : ranks) {
                const mean = (id: string) => {
                    const members = scc[owner.get(id)!];
                    const values = members.flatMap(member => neighbors.get(member)!)
                        .filter(n => owner.get(n) !== owner.get(id)).map(n => order.get(n) ?? 0);
                    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : order.get(members[0]) ?? 0;
                };
                const entries = columns.get(column)!;
                entries.sort((a, b) => owner.get(a.id) === owner.get(b.id) ? compareId(a.id, b.id) :
                    mean(a.id) - mean(b.id) || owner.get(a.id)! - owner.get(b.id)!);
                entries.forEach((s, i) => order.set(s.id, i));
            }
        }
        let bottom = bandTop;
        for (const column of ranks) {
            let y = bandTop;
            for (const script of columns.get(column)!) {
                placements.push({script, x: columnX[column], y, column, group});
                y += script.height + gap;
            }
            bottom = Math.max(bottom, y);
        }
        bandTop = bottom + gap * 2;
    }
    const engine = Matter.Engine.create({gravity: {x: 0, y: 0, scale: 0}, enableSleeping: false});
    let steps = 0;
    let fallback = false;
    try {
        const bodies = placements.map((p, index) => Matter.Bodies.rectangle(p.x + p.script.width / 2, p.y + p.script.height / 2,
            p.script.width + gap, p.script.height + gap,
            {id: index + 1, inertia: Infinity, restitution: 0, frictionAir: .35, friction: 0}));
        const fixed = [...obstacles].sort((a, b) => compareId(a.id, b.id)).map((o, index) =>
            Matter.Bodies.rectangle(o.x + o.width / 2, o.y + o.height / 2,
                o.width + gap, o.height + gap, {id: bodies.length + index + 1, isStatic: true}));
        Matter.Composite.add(engine.world, [...bodies, ...fixed]);
        const byId = new Map(placements.map((p, i) => [p.script.id, i]));
        // Attract related rectangles to the same reading band, without losing their rank.
        const targets = placements.map(p => {
            const parents = incoming.get(p.script.id)!.filter(id => owner.get(id) !== owner.get(p.script.id));
            const centers = parents.map(id => {
                const parent = placements[byId.get(id)!];
                return parent.y + parent.script.height / 2;
            });
            return {x: p.x + p.script.width / 2, y: centers.length ?
                centers.reduce((a, b) => a + b, 0) / centers.length : p.y + p.script.height / 2};
        });
        let stableSteps = 0;
        for (; steps < semanticLayoutLimits.steps && bodies.length; steps++) {
            if (steps % 8 === 0) {await yieldControl(); check(signal);}
            bodies.forEach((body, i) => {
                const target = targets[i];
                Matter.Body.applyForce(body, body.position, {
                    x: (target.x - body.position.x) * body.mass * .00002,
                    y: (target.y - body.position.y) * body.mass * .00002
                });
            });
            Matter.Engine.update(engine, 1000 / 60);
            stableSteps = bodies.every(body => body.speed < .01) ? stableSteps + 1 : 0;
            if (stableSteps >= 12) {steps++; break;}
        }
        if (steps === semanticLayoutLimits.steps) fallback = true;
        // Snap ranks and preserve canonical within-column order after the physical relaxation.
        let bottom = gap;
        for (let group = 0; group < bandCount; group++) {
            let groupBottom = bottom;
            for (const column of [...widths.keys()].sort((a, b) => a - b)) {
                let y = bottom;
                for (const p of placements.filter(p => p.group === group && p.column === column)) {
                    const body = bodies[byId.get(p.script.id)!];
                    const relaxed = body.position.y - p.script.height / 2;
                    if (!Number.isFinite(relaxed)) fallback = true;
                    p.y = Math.ceil(Math.max(y, Number.isFinite(relaxed) ? relaxed : y));
                    // Keep loose comments fixed. Move past any intersecting obstacle.
                    let changed = true;
                    while (changed) {
                        changed = false;
                        for (const obstacle of obstacles) if (overlaps({...p.script, x: p.x, y: p.y}, obstacle)) {
                            p.y = obstacle.y + obstacle.height + gap;
                            changed = true; fallback = true;
                        }
                    }
                    y = p.y + p.script.height + gap;
                }
                groupBottom = Math.max(groupBottom, y);
            }
            bottom = groupBottom + gap * 2;
            if (group % 32 === 0) {await yieldControl(); check(signal);}
        }
        const boxes = placements.map(p => ({...p.script, x: p.x, y: p.y}));
        for (let i = 0; i < boxes.length; i++) {
            if (![boxes[i].x, boxes[i].y].every(Number.isFinite) ||
                boxes.slice(i + 1).some(b => overlaps(boxes[i], b)) || obstacles.some(o => overlaps(boxes[i], o))) {
                throw new Error('Layout validation failed');
            }
        }
        check(signal);
        return {placements, metrics: {nodes: scripts.length, edges: edges.size, steps, fallback}};
    } finally {
        Matter.Composite.clear(engine.world, false);
        Matter.Engine.clear(engine);
    }
}
