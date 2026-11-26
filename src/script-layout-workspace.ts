import type {ScriptBounds} from './script-layout.ts';

interface Point {
    x: number;
    y: number;
}

export interface LayoutBlock {
    id: string;
    getRelativeToSurfaceXY(): Point;
    getBoundingRectangle(): {topLeft: Point; bottomRight: Point};
    getSvgRoot(): SVGElement | null;
    moveBy(dx: number, dy: number): void;
}

export interface LayoutWorkspace {
    getTopBlocks(ordered: boolean): LayoutBlock[];
    getInjectionDiv(): HTMLElement;
    getParentSvg(): SVGElement;
    getCanvas(): SVGElement;
    isDragging(): boolean;
    isVisible(): boolean;
    setResizesEnabled(enabled: boolean): void;
    centerOnBlock(id: string): void;
    scale: number;
}

export interface LayoutEvents {
    getGroup(): string;
    setGroup(group: string | boolean): void;
    fireNow_(): void;
}

export interface RenderedScript extends ScriptBounds {
    block: LayoutBlock;
    origin: Point;
    root: SVGElement;
}

export function readScripts(workspace: LayoutWorkspace): RenderedScript[] {
    return workspace.getTopBlocks(false).flatMap(block => {
        const root = block.getSvgRoot();
        if (!root || !workspace.getCanvas().contains(root) || root.hasAttribute('data-tw-plus-hidden')) return [];
        const origin = block.getRelativeToSurfaceXY();
        let {topLeft, bottomRight} = block.getBoundingRectangle();
        if (root.querySelector(':scope > [data-tw-plus-folded-mark]')) {
            const box = (root as SVGGraphicsElement).getBBox();
            topLeft = {x: origin.x + box.x, y: origin.y + box.y};
            bottomRight = {x: topLeft.x + box.width, y: topLeft.y + box.height};
        }
        return [{
            id: block.id, block, root, origin, ...topLeft,
            width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y
        }];
    });
}

type Placement = {script: RenderedScript; x: number; y: number};

export function moveScripts(workspace: LayoutWorkspace, events: LayoutEvents, placements: Placement[]) {
    const group = events.getGroup();
    events.setGroup(true);
    workspace.setResizesEnabled(false);
    try {
        for (const {script, x, y} of placements) {
            const dx = x - script.x;
            const dy = y - script.y;
            if (dx || dy) script.block.moveBy(dx, dy);
        }
    } finally {
        events.setGroup(group);
        workspace.setResizesEnabled(true);
    }
    events.fireNow_();
}

export function paintScripts(element: HTMLElement, placements: Placement[], scale: number, previous?: SVGSVGElement) {
    const document = element.ownerDocument;
    const ns = 'http://www.w3.org/2000/svg';
    const copies = previous?.querySelectorAll<SVGElement>(':scope > [data-script-view-block]');
    const reuse = copies?.length === placements.length &&
        placements.every(({script}, index) => copies[index].dataset.scriptViewBlock === script.id);
    const svg = reuse ? previous : document.createElementNS(ns, 'svg');
    if (!reuse) {
        svg.setAttribute('class', 'tw-script-layout-svg');
        svg.setAttribute('aria-hidden', 'true');
    }
    const width = placements.reduce((edge, {script, x}) => Math.max(edge, x + script.width), 0) + 32;
    const height = placements.reduce((edge, {script, y}) => Math.max(edge, y + script.height), 0) + 32;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(Math.ceil(width * scale)));
    svg.setAttribute('height', String(Math.ceil(height * scale)));
    for (const [index, {script, x, y}] of placements.entries()) {
        const clone = reuse ? copies[index] : script.root.cloneNode(true) as SVGElement;
        if (!reuse) {
            clone.style.removeProperty('display');
            clone.removeAttribute('id');
            clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
            clone.classList.remove('blocklySelected', 'blocklyDragging');
            // The original block owns its fields and all native editing handlers.
            clone.dataset.scriptViewBlock = script.id;
            svg.append(clone);
        }
        const transform = `translate(${x + script.origin.x - script.x} ${y + script.origin.y - script.y})`;
        if (clone.getAttribute('transform') !== transform) clone.setAttribute('transform', transform);
    }
    if (!reuse) element.replaceChildren(svg);
    return svg;
}
