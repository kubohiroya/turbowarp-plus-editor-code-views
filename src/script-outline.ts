import {svgPathProperties} from 'svg-path-properties';

type Point = {x: number; y: number};
type Box = Point & {width: number; height: number};
type Sample = Point & {distance: number; native?: Point};
type Outline = {points: Sample[]; cuts: Map<string, Point>};
const outlines = new Map<string, Outline>();

/** Bracket crossings without DOM queries, then refine against the browser's actual outline. */
export function outlinePoint(shape: SVGGeometryElement, bounds: Box, side: 'left' | 'right', fraction: number): Point {
    const data = shape.getAttribute('d') ?? '';
    let outline = outlines.get(data);
    if (!outline) {
        const length = shape.getTotalLength();
        const count = Math.max(24, Math.min(96, Math.ceil(length / 8)));
        let properties: {getPointAtLength(distance: number): Point} | undefined;
        try {
            if (data) {
                const candidate = new svgPathProperties(data);
                // Reject unsupported parsing before using its samples to bracket native geometry.
                if (Math.abs(candidate.getTotalLength() - length) <= .05) properties = candidate;
            }
        } catch { /* Keep native support for other shapes. */ }
        const points = Array.from({length: count + 1}, (_, index): Sample => {
            const distance = length * index / count;
            // Move-only segments and the exact endpoint can differ between SVG implementations.
            if (properties && index > 0 && index < count) {
                try {
                    const point = properties.getPointAtLength(distance);
                    if (Number.isFinite(point.x) && Number.isFinite(point.y)) return {...point, distance};
                } catch { /* A valid browser path can use syntax the parser does not support. */ }
            }
            const point = shape.getPointAtLength(distance);
            return {x: point.x, y: point.y, distance, native: point};
        });
        outline = {points, cuts: new Map()};
        if (outlines.size >= 512) outlines.delete(outlines.keys().next().value);
        outlines.set(data, outline);
    }
    const y = bounds.y + bounds.height * fraction;
    // Ignore transform round-off far below the native .001 refinement tolerance.
    const key = `${side}:${y.toFixed(6)}`;
    const cached = outline.cuts.get(key);
    if (cached) return cached.y === y ? cached : {x: cached.x, y};
    const native = (sample: Sample) => sample.native ??= shape.getPointAtLength(sample.distance);
    let edge: number | undefined;
    for (let index = 1; index < outline.points.length; index++) {
        const first = outline.points[index - 1], last = outline.points[index];
        // The coarse calculation only selects candidates; it never supplies the final attachment.
        if (y < Math.min(first.y, last.y) - .1 || y > Math.max(first.y, last.y) + .1) continue;
        const before = native(first), after = native(last);
        if ((before.y <= y && after.y >= y) || (before.y >= y && after.y <= y)) {
            let x: number;
            if (before.y === after.y) x = side === 'left' ? Math.min(before.x, after.x) : Math.max(before.x, after.x);
            else {
                let low = first.distance, high = last.distance;
                for (let step = 0; step < 12; step++) {
                    const middle = (low + high) / 2;
                    const point = shape.getPointAtLength(middle);
                    x = point.x;
                    if (Math.abs(point.y - y) < .001) break;
                    if ((point.y < y) === (before.y < y)) low = middle;
                    else high = middle;
                }
            }
            edge = edge === undefined ? x : side === 'left' ? Math.min(edge, x) : Math.max(edge, x);
        }
    }
    const point = {x: edge ?? bounds.x + (side === 'right' ? bounds.width : 0), y};
    outline.cuts.set(key, point);
    return point;
}
