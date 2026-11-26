import SvgPath from 'svgpath';

function segmentsFor(data: string): Float64Array | undefined {
    const path = new SvgPath(data).abs().unshort().unarc() as ReturnType<typeof SvgPath> & {
        err: string;
        segments: [string, ...number[]][];
    };
    if (path.err) return;
    const values: number[] = [];
    let x = 0, y = 0, startX = 0, startY = 0;
    const line = (endX: number, endY: number) => {
        values.push(0, x, y, 0, 0, 0, 0, endX, endY);
        x = endX;
        y = endY;
    };
    const curve = (a: number, b: number, c: number, d: number, endX: number, endY: number) => {
        values.push(1, x, y, a, b, c, d, endX, endY);
        x = endX;
        y = endY;
    };
    for (const [command, a, b, c, d, endX, endY] of path.segments) {
        switch (command) {
        case 'M': x = startX = a; y = startY = b; break;
        case 'L': line(a, b); break;
        case 'H': line(a, y); break;
        case 'V': line(x, a); break;
        case 'C': curve(a, b, c, d, endX, endY); break;
        case 'Q': curve(x + 2 * (a - x) / 3, y + 2 * (b - y) / 3,
            c + 2 * (a - c) / 3, d + 2 * (b - d) / 3, c, d); break;
        case 'Z': line(startX, startY); break;
        default: return;
        }
    }
    if (!values.length || values.some(value => !Number.isFinite(value))) return;
    return Float64Array.from(values);
}

const boundaryTolerance = .001;

function compatibilityBoundaries(segments: Float64Array): number[] {
    const ends = new Set<number>();
    const horizontal = new Set<number>();
    let top = Infinity, bottom = -Infinity;
    for (let i = 0; i < segments.length; i += 9) {
        const startY = segments[i + 2], endY = segments[i + 8];
        top = Math.min(top, startY, endY);
        bottom = Math.max(bottom, startY, endY);
        ends.add(startY);
        ends.add(endY);
        if (segments[i] === 0 && startY === endY && Math.abs(segments[i + 1] - segments[i + 7]) > boundaryTolerance) {
            horizontal.add(startY);
        }
    }
    const levels = [...horizontal].filter(y => y > top + boundaryTolerance && y < bottom - boundaryTolerance);
    return levels.length > 1 ? [...ends] : [];
}

export function describeOutline(data: string) {
    const segments = segmentsFor(data);
    if (!segments) return;
    return {segments, boundaries: compatibilityBoundaries(segments)};
}

export function needsNativeCut(boundaries: readonly number[], height: number) {
    // A cut at the join of a recessed outline can hit an arm missed by the native sampling grid.
    return boundaries.some(y => Math.abs(y - height) <= boundaryTolerance);
}
