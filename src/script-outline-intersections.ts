// Intersect normalized SVG segments with a horizontal line in local coordinates.

function at(a: number, b: number, c: number, d: number, t: number): number {
    const u = 1 - t;
    return u * u * (u * a + 3 * t * b) + t * t * (3 * u * c + t * d);
}

function turns(a: number, b: number, c: number, d: number): Float64Array {
    const first = b - a;
    const second = c - b;
    const third = d - c;
    const quadratic = first - 2 * second + third;
    const linear = 2 * (second - first);
    const points = new Float64Array(4);
    points[1] = 1;
    points[2] = 1;
    points[3] = 1;
    if (Math.abs(quadratic) < 1e-12) {
        if (Math.abs(linear) >= 1e-12) {
            const root = -first / linear;
            if (root > 0 && root < 1) points[1] = root;
        }
    } else {
        const discriminant = linear * linear - 4 * quadratic * first;
        if (discriminant >= 0) {
            const delta = Math.sqrt(discriminant);
            const a = (-linear - delta) / (2 * quadratic);
            const b = (-linear + delta) / (2 * quadratic);
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            if (lo > 0 && lo < 1) {
                points[1] = lo;
                if (hi > lo && hi < 1) points[2] = hi;
            } else if (hi > 0 && hi < 1) points[1] = hi;
        }
    }
    return points;
}

function outer(a: number, b: number, left: boolean): number {
    return left ? Math.min(a, b) : Math.max(a, b);
}

// Segments have nine values: kind, start, controls, end.
export function intersectOutline(segments: Float64Array, y: number, left: boolean): number | null {
    let edge = left ? Infinity : -Infinity;
    for (let i = 0; i < segments.length; i += 9) {
        const x0 = segments[i + 1], y0 = segments[i + 2], x1 = segments[i + 7], y1 = segments[i + 8];
        if (segments[i] === 0) {
            if (y < Math.min(y0, y1) || y > Math.max(y0, y1)) continue;
            const x = y0 === y1 ? outer(x0, x1, left) : x0 + (x1 - x0) * ((y - y0) / (y1 - y0));
            edge = outer(edge, x, left);
            continue;
        }
        const ax = segments[i + 3], ay = segments[i + 4], bx = segments[i + 5], by = segments[i + 6];
        if (y < Math.min(Math.min(y0, y1), Math.min(ay, by)) ||
            y > Math.max(Math.max(y0, y1), Math.max(ay, by))) continue;
        if (y0 === ay && ay === by && by === y1) {
            const extrema = turns(x0, ax, bx, x1);
            for (let p = 0; p < extrema.length; p++) edge = outer(edge, at(x0, ax, bx, x1, extrema[p]), left);
            continue;
        }
        const stops = turns(y0, ay, by, y1);
        for (let p = 1; p < stops.length; p++) {
            let lo = stops[p - 1], hi = stops[p];
            if (lo === hi) break;
            const a = at(y0, ay, by, y1, lo), b = at(y0, ay, by, y1, hi);
            if (y < Math.min(a, b) - 1e-10 || y > Math.max(a, b) + 1e-10) continue;
            if (Math.abs(y - a) <= 1e-10) hi = lo;
            else if (Math.abs(y - b) <= 1e-10) lo = hi;
            else for (let step = 0; step < 24; step++) {
                const mid = (lo + hi) / 2;
                if ((at(y0, ay, by, y1, mid) < y) === (a < b)) lo = mid;
                else hi = mid;
            }
            edge = outer(edge, at(x0, ax, bx, x1, (lo + hi) / 2), left);
        }
    }
    return Number.isFinite(edge) ? edge : null;
}
