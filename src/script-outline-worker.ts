import {intersectOutline} from './script-outline-intersections.ts';
import {describeOutline, needsNativeCut} from './script-outline-segments.ts';

export type OutlineCut = {data: string; y: number; left: boolean};
export type OutlineResults = (number | null)[];

const outlines = new Map<string, ReturnType<typeof describeOutline>>();
function outline(data: string) {
    if (!outlines.has(data)) {
        if (outlines.size >= 512) outlines.delete(outlines.keys().next().value);
        outlines.set(data, describeOutline(data));
    }
    return outlines.get(data);
}

const scope = globalThis as unknown as {
    onmessage: (event: MessageEvent<OutlineCut[]>) => void;
    postMessage(result: OutlineResults): void;
};
scope.onmessage = ({data: cuts}) => {
    const groups = new Map<string, number[]>();
    const results: OutlineResults = Array(cuts.length).fill(null);
    for (const [index, cut] of cuts.entries()) {
        let group = groups.get(cut.data);
        if (!group) groups.set(cut.data, group = []);
        group.push(index);
    }
    for (const [data, indexes] of groups) {
        let shape: ReturnType<typeof describeOutline>;
        try { shape = outline(data); } catch { continue; }
        if (!shape) continue;
        for (const index of indexes) {
            const {y, left} = cuts[index];
            if (!needsNativeCut(shape.boundaries, y)) results[index] = intersectOutline(shape.segments, y, left);
        }
    }
    scope.postMessage(results);
};
