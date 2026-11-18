import {isFoldedDefinition} from './procedure-edits.ts';
import {readScriptRelations, type RelationTarget, type ScriptEndpoint, type ScriptRelation} from './script-relations.ts';

export type ScriptRelationVisibility = {function: boolean; message: boolean};

export interface ScriptRelationContext {
    vm?: {
        runtime?: {targets?: readonly RelationTarget[]; on?(name: string, listener: () => void): void;
            removeListener?(name: string, listener: () => void): void};
        on?(name: string, listener: () => void): void;
        removeListener?(name: string, listener: () => void): void;
        setEditingTarget?(id: string): void;
    };
    getTarget(): RelationTarget | undefined;
    /** A child window receives the parent's graph rather than interpreting a partial project. */
    getRelations?(): readonly ScriptRelation[];
    getLocale?(): string;
    getTargetName?(id: string): string | undefined;
    navigate?(endpoint: ScriptEndpoint): void;
    initialVisibility?: ScriptRelationVisibility;
}

type Point = {x: number; y: number};
type Box = Point & {width: number; height: number};
type Anchor = {id: string; box: Box; point(side: 'left' | 'right', fraction: number): Point};
type Drawing = {relation: ScriptRelation; source?: Anchor; destination?: Anchor; count: number};
const ns = 'http://www.w3.org/2000/svg';
// Keep the same sixteen-unit hourglass as the call graph's relation badge.
const relationWaitGlyph = 'M1 1h14M1 15h14M2 1v3l12 8v3M14 1v3l-12 8v3M2 4h12M2 12h12';

/** Keep the badge beside the receiving end of the cubic curve, leaving its stroke visible. */
function waitBadgePoint(path: string, offset: number): Point {
    const values = path.match(/-?(?:\d*\.?\d+)(?:e[+-]?\d+)?/gi).map(Number);
    const [sx, sy] = values;
    const [bx, by, tx, ty] = values.slice(-4);
    const endX = tx - bx;
    const endY = ty - by;
    const dx = endX || endY ? endX : tx - sx;
    const dy = endX || endY ? endY : ty - sy;
    const length = Math.hypot(dx, dy) || 1;
    const side = -dy < 0 || dy === 0 && dx > 0 ? -1 : 1;
    return {x: tx - dx / length * offset * .75 - dy / length * offset * side,
        y: ty - dy / length * offset * .75 + dx / length * offset * side};
}
type Outline = {points: (Point & {distance: number})[]; cuts: Map<string, Point>};
const outlines = new Map<string, Outline>();

/** Intersect the actual outline, including a hat's overhang, rather than Blockly's layout padding. */
function outlinePoint(shape: SVGGeometryElement, bounds: Box, side: 'left' | 'right', fraction: number): Point {
    const data = shape.getAttribute('d') ?? '';
    let outline = outlines.get(data);
    if (!outline) {
        const length = shape.getTotalLength();
        const count = Math.max(24, Math.min(96, Math.ceil(length / 8)));
        const points = Array.from({length: count + 1}, (_, index) => {
            const distance = length * index / count;
            const point = shape.getPointAtLength(distance);
            return {x: point.x, y: point.y, distance};
        });
        outline = {points, cuts: new Map()};
        if (outlines.size >= 512) outlines.delete(outlines.keys().next().value);
        outlines.set(data, outline);
    }
    const y = bounds.y + bounds.height * fraction;
    const key = `${side}:${y}`;
    const cached = outline.cuts.get(key);
    if (cached) return cached;
    let edge: number | undefined;
    for (let index = 1; index < outline.points.length; index++) {
        const before = outline.points[index - 1];
        const after = outline.points[index];
        if ((before.y <= y && after.y >= y) || (before.y >= y && after.y <= y)) {
            let x: number;
            if (before.y === after.y) x = side === 'left' ? Math.min(before.x, after.x) : Math.max(before.x, after.x);
            else {
                // Refine only a crossing instead of sampling every two units along the entire outline.
                let low = before.distance, high = after.distance;
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

// The shared workspace owns navigation even when an arrow is in a read-only preview.
const navigators = new WeakMap<object, (endpoint: ScriptEndpoint) => void>();
export function registerScriptRelationNavigation(vm: object, navigate: (endpoint: ScriptEndpoint) => void) {
    navigators.set(vm, navigate);
    return () => { if (navigators.get(vm) === navigate) navigators.delete(vm); };
}

const transform = (matrix: DOMMatrix, {x, y}: Point): Point => ({
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f
});

/** One renderer and semantic stylesheet serve live code, folded scripts, previews and serial layouts. */
export function attachScriptArrows({workspace, vm, getTarget, getRelations, getLocale, getTargetName, navigate,
    initialVisibility}: ScriptRelationContext & {
    workspace: {
        getInjectionDiv(): HTMLElement;
        getCanvas(): SVGElement;
        getParentSvg(): SVGElement;
        getBlockById?(id: string): {width?: number; height?: number; getSvgRoot(): SVGElement | null} | null;
        addChangeListener?(listener: (event: {type?: string}) => void): void;
        removeChangeListener?(listener: (event: {type?: string}) => void): void;
        centerOnBlock(id: string): void;
        RTL?: boolean;
    };
}) {
    const injection = workspace.getInjectionDiv();
    const document = injection.ownerDocument;
    const view = document.defaultView;
    const canvas = workspace.getCanvas();
    const layer = document.createElementNS(ns, 'g');
    layer.setAttribute('data-script-relation-layer', '');
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('pointer-events', 'none');
    // Keep arrow mutations outside the block canvas observed by the minimap and serial previews.
    canvas.before(layer);
    const destinations = document.createElement('div');
    destinations.className = 'tw-script-relation-guide tw-script-relation-destinations';
    destinations.dataset.scriptRelationGuide = '';
    destinations.dataset.codeViewControl = '';
    destinations.hidden = true;
    // Blockly listens on the document; operating these controls must not delete or undo a block.
    destinations.addEventListener('keydown', event => {
        if (event.key !== 'Tab') event.stopPropagation();
    });
    injection.append(destinations);
    let projection: SVGSVGElement | null = null;
    let projectedLayer: SVGGElement | undefined;
    let frame: number | undefined;
    let disposed = false;
    let dirty = true;
    let graph: readonly ScriptRelation[] = [];
    let selected: string | undefined;
    let enabled = true;
    let visibility: ScriptRelationVisibility = {...initialVisibility ?? {function: true, message: true}};
    let geometryChanged = true;
    let lastMatrix: DOMMatrix | undefined;
    let edgeDrawings: {key: string; drawing: Drawing; group: SVGGElement; highlighted: boolean}[] = [];
    const renderedGroups = new WeakMap<SVGGElement, Map<string, SVGGElement>>();
    const syncTransform = (matrix: DOMMatrix) => {
        // Workspace dragging lends the two native canvases to a separate SVG which must keep exactly two children.
        // Leave our layer in place and project that surface's transform back into its original parent instead.
        const parent = layer.parentElement as unknown as SVGGraphicsElement;
        const relative = canvas.parentElement !== layer.parentElement && parent.getScreenCTM()?.inverse().multiply(matrix);
        const transform = relative ? `matrix(${relative.a},${relative.b},${relative.c},${relative.d},${relative.e},${relative.f})` :
            canvas.getAttribute('transform');
        if (layer.getAttribute('transform') !== transform) {
            if (transform === null) layer.removeAttribute('transform');
            else layer.setAttribute('transform', transform);
        }
    };
    const markedScripts = new Map<SVGElement, 'source' | 'related'>();
    const text = () => /^ja(?:-|$)/i.test(getLocale?.() ?? document.documentElement.lang) ? {
        title: '呼び出しの矢印', function: '関数呼び出し', message: 'メッセージ送信', wait: '送って待つ',
        dynamic: '実行時に決定', missing: '接続先が見つかりません', ambiguous: '接続先が複数の定義に一致',
        incoming: '呼び出し元', outgoing: '接続先', count: '件'
    } : {
        title: 'Script arrows', function: 'Function call', message: 'Message send', wait: 'Send and wait',
        dynamic: 'Determined at runtime', missing: 'Destination not found', ambiguous: 'Multiple definitions match',
        incoming: 'Source', outgoing: 'Destination', count: 'calls'
    };

    function element<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string> = {}) {
        const node = document.createElementNS(ns, tag);
        for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
        return node;
    }

    function markScripts(next: Map<SVGElement, 'source' | 'related'>) {
        for (const [root, role] of markedScripts) {
            if (next.get(root) !== role) root.removeAttribute(`data-script-relation-${role === 'source' ? 'drag-source' : 'related'}`);
        }
        for (const [root, role] of next) {
            if (markedScripts.get(root) !== role) root.setAttribute(`data-script-relation-${role === 'source' ? 'drag-source' : 'related'}`, '');
        }
        markedScripts.clear();
        for (const entry of next) markedScripts.set(...entry);
    }

    function blockRoot(id: string, roots: Map<string, SVGElement>) {
        // Blockly lends a dragged stack to an SVG outside the canvas; the Block keeps its SVG identity.
        return roots.get(id) ?? (!projection ? workspace.getBlockById?.(id)?.getSvgRoot() ?? undefined : undefined);
    }

    function go(endpoint: ScriptEndpoint) {
        const target = getTarget();
        const current = vm?.runtime?.targets?.find(item => item.id === endpoint.targetId);
        if (vm && (!current || !current.blocks._blocks[endpoint.blockId])) return;
        const handler = navigate ?? (vm && navigators.get(vm));
        if (handler) handler(endpoint);
        else {
            if (endpoint.targetId !== target?.id) vm?.setEditingTarget?.(endpoint.targetId);
            view.requestAnimationFrame(() => {
                if (!disposed) workspace.centerOnBlock(endpoint.blockId);
            });
        }
    }

    function anchor(endpoint: ScriptEndpoint, target: RelationTarget, roots: Map<string, SVGElement>, inverse: DOMMatrix): Anchor | undefined {
        if (endpoint.targetId !== target.id) return;
        const top = blockRoot(endpoint.scriptId, roots);
        // A script hidden by the one-script view is not the same as its folded body.
        if (!top || !top.getClientRects().length || top.closest('[data-tw-plus-hidden]') ||
            view.getComputedStyle(top).display === 'none') return;
        const folded = isFoldedDefinition(target.blocks._blocks[endpoint.scriptId]);
        let id = folded ? endpoint.scriptId : endpoint.blockId;
        let root = blockRoot(id, roots);
        // Native Blockly collapsing can also hide a caller inside a control block.
        const visited = new Set<string>();
        while (root && (!root.getClientRects().length || root.closest('[data-tw-plus-hidden]') ||
            view.getComputedStyle(root).display === 'none') && !visited.has(id)) {
            visited.add(id);
            id = target.blocks._blocks[id]?.parent ?? '';
            root = blockRoot(id, roots);
        }
        if (!root) return;
        const path = root.querySelector<SVGGeometryElement>(':scope > .blocklyPath');
        const matrix = (path ?? root as SVGGraphicsElement).getScreenCTM();
        if (!matrix) return;
        const block = workspace.getBlockById?.(id);
        const bounds = path?.getBBox() ?? {x: workspace.RTL ? -(block?.width ?? 0) : 0,
            y: 0, width: block?.width ?? 0, height: block?.height ?? 0};
        if (!bounds.width || !bounds.height) return;
        const convert = (point: Point) => transform(inverse, transform(matrix, point));
        const first = convert(bounds);
        const last = convert({x: bounds.x + bounds.width, y: bounds.y + bounds.height});
        const points = new Map<string, Point>();
        return {id, box: {x: Math.min(first.x, last.x), y: Math.min(first.y, last.y),
            width: Math.abs(last.x - first.x), height: Math.abs(last.y - first.y)}, point(side, fraction) {
            const localSide = first.x <= last.x ? side : side === 'left' ? 'right' : 'left';
            const key = `${localSide}:${fraction}`;
            if (!points.has(key)) points.set(key, convert(path ? outlinePoint(path, bounds, localSide, fraction) :
                {x: bounds.x + (localSide === 'right' ? bounds.width : 0), y: bounds.y + bounds.height * fraction}));
            return points.get(key);
        }};
    }

    function arrowGeometry({relation, source, destination, count}: Drawing, matrix: DOMMatrix, inverse: DOMMatrix,
        area: DOMRect, highlighted: boolean) {
        // Anchor an external link to the viewport edge; the list itself remains keyboard accessible.
        const local = source ?? destination;
        const edgeX = source ? area.right - 12 : area.left + 12;
        const screenY = transform(matrix, {x: local.box.x, y: local.box.y + local.box.height / 2}).y;
        const edge = transform(inverse, {x: edgeX, y: Math.max(area.top + 12, Math.min(area.bottom - 12, screenY))});
        let start = source ? source.point('right', 0.5) : edge;
        let end = destination ? destination.point('left', Math.min(0.5, 24 / destination.box.height)) : edge;
        const bend = Math.max(36, Math.abs(end.x - start.x) / 2);
        let path = `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
        const recursive = source && destination && relation.source.scriptId === relation.destination.scriptId &&
            relation.source.targetId === relation.destination.targetId;
        let badgePoint = {x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 6};
        if (recursive) {
            start = source.point('right', 0.75);
            end = destination.point('left', 0.25);
            const right = Math.max(source.box.x + source.box.width, destination.box.x + destination.box.width) + 144;
            const left = Math.min(source.box.x, destination.box.x) - 72;
            const top = Math.min(source.box.y, destination.box.y) - 64;
            const middle = (left + right) / 2;
            path = `M ${start.x} ${start.y} C ${right} ${start.y}, ${right} ${top}, ${middle} ${top}` +
                ` C ${left} ${top}, ${left} ${end.y}, ${end.x} ${end.y}`;
            badgePoint = {x: middle, y: top - 6};
        }
        const head = `M ${end.x - 9} ${end.y - 5} L ${end.x} ${end.y} L ${end.x - 9} ${end.y + 5}`;
        let waitTransform: string | undefined;
        if (relation.kind === 'message' && relation.wait) {
            const point = waitBadgePoint(path, 24);
            badgePoint = {x: point.x + 16, y: point.y + 4};
            waitTransform = `translate(${point.x} ${point.y})`;
        }
        return {path, head, recursive, badgePoint, waitTransform};
    }

    function drawArrow(drawing: Drawing, matrix: DOMMatrix, inverse: DOMMatrix, area: DOMRect, highlighted: boolean) {
        const {relation, source, destination, count} = drawing;
        const {path, head, recursive, badgePoint, waitTransform} = arrowGeometry(drawing, matrix, inverse, area, highlighted);
        const strings = text();
        const group = element('g', {
            'data-script-relation': relation.kind,
            'data-source-block': source?.id ?? relation.source.blockId,
            'data-source-call': relation.source.blockId,
            'data-destination-block': destination?.id ?? relation.destination?.blockId ?? '',
            'data-count': String(count),
            'data-wait': String(relation.wait)
        });
        group.toggleAttribute('data-highlighted', Boolean(highlighted));
        group.toggleAttribute('data-recursive', Boolean(recursive));
        group.toggleAttribute('data-script-external', !source || !destination);
        const description = element('title');
        const waiting = relation.kind === 'message' && relation.wait;
        description.textContent = `${strings[relation.kind]}: ${relation.label}${waiting ? ` · ${strings.wait}` : ''}`;
        group.append(description, element('path', {
            class: 'tw-script-relation-line',
            d: path
        }), element('path', {
            class: 'tw-script-relation-head',
            d: head
        }));
        if (waiting) {
            const badge = element('g', {class: 'tw-script-relation-wait', 'aria-label': strings.wait,
                transform: waitTransform});
            const title = element('title');
            title.textContent = strings.wait;
            badge.append(title, element('rect', {x: '-10', y: '-10', width: '20', height: '20', rx: '4'}),
                element('path', {class: 'tw-script-relation-wait-glyph', d: relationWaitGlyph, transform: 'translate(-8 -8)'}));
            group.append(badge);
        }
        if (count > 1) {
            const badge = element('text', {x: String(badgePoint.x), y: String(badgePoint.y),
                class: 'tw-script-relation-badge', 'text-anchor': waiting ? 'start' : 'middle'});
            badge.textContent = `×${count}`;
            group.append(badge);
        }
        return group;
    }

    function render() {
        frame = undefined;
        if (disposed) return;
        if (!enabled || !visibility.function && !visibility.message) { clear(); return; }
        const strings = text();
        const toolbox = injection.querySelector<HTMLElement>(':scope > .blocklyToolboxDiv');
        const toolboxBounds = toolbox?.getBoundingClientRect();
        const horizontal = toolbox?.hasAttribute('data-horizontal-block-palette');
        // The horizontal palette sits above the blocks, including in the Editor's default layout.
        const guideTop = horizontal ? Math.max(10, toolboxBounds.bottom - injection.getBoundingClientRect().top + 10) : 10;
        const drawingRoot = projection ?? canvas;
        const drawingLayer = projection ? projectedLayer : layer;
        if (!drawingLayer) return;
        const target = getTarget();
        if (!target) { clear(); return; }
        const matrix = (drawingRoot as SVGGraphicsElement).getScreenCTM();
        if (!matrix) { markScripts(new Map()); return; }
        const inverse = matrix.inverse();
        if (![inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite)) {
            markScripts(new Map());
            return;
        }
        // Read the viewport once, before committing any arrow or guide mutations.
        const area = (projection ?? workspace.getParentSvg()).getBoundingClientRect();
        const sameScale = lastMatrix && matrix.a === lastMatrix.a && matrix.b === lastMatrix.b &&
            matrix.c === lastMatrix.c && matrix.d === lastMatrix.d;
        if (!geometryChanged && !projection && sameScale) {
            const geometry = edgeDrawings.map(item => ({...item,
                shape: arrowGeometry(item.drawing, matrix, inverse, area, item.highlighted)}));
            syncTransform(matrix);
            for (const {group, shape} of geometry) {
                const set = (node: Element | null, name: string, value: string | number) => {
                    if (node && node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value));
                };
                set(group.querySelector('.tw-script-relation-line'), 'd', shape.path);
                set(group.querySelector('.tw-script-relation-head'), 'd', shape.head);
                if (shape.waitTransform) set(group.querySelector('.tw-script-relation-wait'), 'transform', shape.waitTransform);
                const count = group.querySelector('.tw-script-relation-badge');
                set(count, 'x', shape.badgePoint.x); set(count, 'y', shape.badgePoint.y);
            }
            lastMatrix = matrix;
            return;
        }
        geometryChanged = false;
        lastMatrix = matrix;
        edgeDrawings = [];
        const paint: SVGElement[] = [];
        const guides = document.createDocumentFragment();
        const previousGroups = renderedGroups.get(drawingLayer);
        const nextGroups = new Map<string, SVGGElement>();
        if (getRelations) graph = getRelations();
        else if (dirty) {
            graph = readScriptRelations(vm?.runtime?.targets ?? [target]);
            dirty = false;
        }
        const roots = new Map<string, SVGElement>();
        for (const root of drawingRoot.querySelectorAll<SVGElement>('[data-id]')) roots.set(root.dataset.id, root);
        const nativeSelection = [...roots.values()].find(root => root.classList.contains('blocklySelected'))?.dataset.id;
        const emphasized = selected ?? scriptOf(nativeSelection, target);
        const dragging = !projection && injection.querySelector<SVGElement>('[data-id].blocklyDragging');
        const draggedIds = new Set<string>();
        if (dragging) {
            draggedIds.add(dragging.dataset.id);
            for (const root of dragging.querySelectorAll<SVGElement>('[data-id]')) draggedIds.add(root.dataset.id);
        }
        const inDrag = (endpoint?: ScriptEndpoint) => Boolean(endpoint && endpoint.targetId === target.id && draggedIds.has(endpoint.blockId));
        const incident = (relation: ScriptRelation) => inDrag(relation.source) || inDrag(relation.destination);
        const drawings = new Map<string, Drawing>();
        const anchors = new Map<string, Anchor | undefined>();
        const measuredAnchor = (endpoint: ScriptEndpoint) => {
            const key = `${endpoint.targetId}\0${endpoint.scriptId}\0${endpoint.blockId}`;
            if (!anchors.has(key)) anchors.set(key, anchor(endpoint, target, roots, inverse));
            return anchors.get(key);
        };
        for (const relation of graph) {
            if (!visibility[relation.kind]) continue;
            if (relation.source.targetId !== target.id && relation.destination?.targetId !== target.id) continue;
            const source = measuredAnchor(relation.source);
            const destination = relation.destination && measuredAnchor(relation.destination);
            if (!source && !destination) continue;
            const key = JSON.stringify([relation.kind, source?.id ?? relation.source,
                destination?.id ?? relation.destination, relation.wait, relation.unresolved, relation.label]);
            const existing = drawings.get(key);
            if (existing) existing.count++;
            else drawings.set(key, {relation, source, destination, count: 1});
        }
        const related = new Set<string>();
        for (const relation of graph) if (visibility[relation.kind] && dragging && incident(relation)) {
            if (inDrag(relation.source) && relation.destination?.targetId === target.id && !inDrag(relation.destination)) {
                related.add(relation.destination.scriptId);
            }
            if (inDrag(relation.destination) && relation.source.targetId === target.id && !inDrag(relation.source)) {
                related.add(relation.source.scriptId);
            }
        }
        const marked = new Map<SVGElement, 'source' | 'related'>();
        if (dragging) marked.set(dragging, 'source');
        for (const id of related) {
            const root = blockRoot(id, roots);
            if (root && root.getClientRects().length && !root.closest('[data-tw-plus-hidden]')) marked.set(root, 'related');
        }
        // Frame the whole stack, including its body; the original block paint and runtime glow stay intact.
        for (const [root, role] of marked) {
            const bounds = root.getBoundingClientRect();
            const first = transform(inverse, {x: bounds.left, y: bounds.top});
            const last = transform(inverse, {x: bounds.right, y: bounds.bottom});
            paint.push(element('rect', {x: String(first.x - 7), y: String(first.y - 7),
                width: String(Math.max(0, last.x - first.x) + 14), height: String(Math.max(0, last.y - first.y) + 14),
                rx: '10', class: 'tw-script-relation-script-highlight', 'data-emphasis': role}));
        }
        for (const [key, drawing] of drawings) {
            const {relation, source, destination, count} = drawing;
            const highlighted = dragging ? incident(relation) :
                emphasized && (emphasized === relation.source.scriptId || emphasized === relation.destination?.scriptId);
            let external: HTMLButtonElement | undefined;
            if ((!source || !destination) && highlighted) {
                external = document.createElement('button');
                external.type = 'button';
                external.dataset.scriptRelation = relation.kind;
                const endpoint = source ? relation.destination : relation.source;
                const name = endpoint && (getTargetName?.(endpoint.targetId) ??
                    vm?.runtime?.targets?.find(item => item.id === endpoint.targetId)?.getName?.());
                const reason = relation.unresolved && strings[relation.unresolved];
                external.textContent = `${name ? `${name} · ` : ''}` +
                    `${relation.label}${reason ? ` · ${reason}` : ''}${relation.kind === 'message' && relation.wait ? ' ⏳' : ''}${count > 1 ? ` ×${count}` : ''}`;
                external.disabled = !endpoint;
                external.setAttribute('aria-label', `${strings[relation.kind]}: ${external.textContent}`);
                external.toggleAttribute('data-highlighted', Boolean(highlighted));
                if (endpoint) external.addEventListener('click', () => go(endpoint));
                guides.append(external);
            }
            let group = drawArrow(drawing, matrix, inverse, area, Boolean(highlighted));
            const previous = previousGroups?.get(key);
            if (previous?.isEqualNode(group)) group = previous;
            nextGroups.set(key, group);
            if (!source || !destination) edgeDrawings.push({key, drawing, group, highlighted: Boolean(highlighted)});
            paint.push(group);
        }
        syncTransform(matrix);
        layer.style.display = projection ? 'none' : '';
        drawingLayer.toggleAttribute('data-script-dragging', Boolean(dragging));
        // Keep unchanged lines in place, including when an unrelated script was edited or dragged.
        const wanted = new Set(paint);
        for (const child of Array.from(drawingLayer.children)) if (!wanted.has(child as SVGElement)) child.remove();
        let cursor = drawingLayer.firstChild;
        for (const node of paint) {
            if (node === cursor) cursor = cursor.nextSibling;
            else drawingLayer.insertBefore(node, cursor);
        }
        renderedGroups.set(drawingLayer, nextGroups);
        destinations.style.top = `${guideTop}px`;
        destinations.replaceChildren(guides);
        destinations.hidden = !destinations.childElementCount;
        markScripts(marked);
    }

    function clear() {
        if (layer.childElementCount) layer.replaceChildren();
        if (projectedLayer?.childElementCount) projectedLayer.replaceChildren();
        if (destinations.childElementCount) destinations.replaceChildren();
        destinations.hidden = true;
        edgeDrawings = [];
        lastMatrix = undefined;
        renderedGroups.delete(layer);
        if (projectedLayer) renderedGroups.delete(projectedLayer);
        markScripts(new Map());
    }

    function schedule() {
        if (!enabled || !visibility.function && !visibility.message) { clear(); return; }
        if (!disposed && frame === undefined) frame = view.requestAnimationFrame(render);
    }
    function update() {
        geometryChanged = true;
        schedule();
    }
    function changed() { dirty = true; update(); }
    function scriptOf(id: string | undefined, target = getTarget()) {
        const blocks = target?.blocks._blocks;
        const visited = new Set<string>();
        while (id && blocks?.[id]?.parent && !visited.has(id)) { visited.add(id); id = blocks[id].parent; }
        return id;
    }
    function selectedScript(event: Event) {
        if ((event.target as Element).closest?.('[data-script-relation-guide]')) return;
        const node = (event.target as Element).closest?.('[data-id]') as SVGElement | null;
        const id = scriptOf(node?.dataset.id);
        if (id !== selected) { selected = id; update(); }
    }
    const dragSurface = injection.querySelector('.blocklyBlockDragSurface');
    const workspaceDragSurface = injection.querySelector('.blocklyWsDragSurface');
    const mutations = new view.MutationObserver(records => {
        // Panning also translates the empty drag surface. It has no endpoints until a block is dragged.
        const dragging = injection.querySelector('[data-id].blocklyDragging');
        const relevant = records.filter(record => record.target !== layer && !layer.contains(record.target) &&
            !record.attributeName?.startsWith('data-script-relation-') &&
            (dragging || !dragSurface?.contains(record.target)));
        if (!relevant.length) return;
        if (!projection && relevant.every(record => record.type === 'attributes' &&
            (record.target === canvas && record.attributeName === 'transform' || record.target === workspaceDragSurface))) schedule();
        else update();
    });
    mutations.observe(canvas, {attributes: true, childList: true, subtree: true});
    // Its CSS translation changes on every drag step, while the workspace canvas stays untouched.
    if (dragSurface) mutations.observe(dragSurface, {attributes: true, childList: true, subtree: true});
    if (workspaceDragSurface) mutations.observe(workspaceDragSurface, {attributes: true, childList: true});
    const resized = new view.ResizeObserver(update);
    resized.observe(injection);
    const toolbox = injection.querySelector('.blocklyToolboxDiv');
    if (toolbox) resized.observe(toolbox);
    injection.addEventListener('pointerover', selectedScript);
    injection.addEventListener('pointerdown', selectedScript);
    const language = new view.MutationObserver(update);
    language.observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
    vm?.runtime?.on?.('PROJECT_CHANGED', changed);
    vm?.on?.('targetsUpdate', changed);
    vm?.on?.('workspaceUpdate', changed);
    workspace.addChangeListener?.(changed);
    update();
    return {
        update: changed,
        get enabled() { return enabled; },
        get visibility() { return {...visibility}; },
        setVisibility(value: ScriptRelationVisibility) {
            if (value.function === visibility.function && value.message === visibility.message) return;
            visibility = {...value};
            update();
        },
        setEnabled(value: boolean) { enabled = value; update(); },
        setProjection(svg: SVGSVGElement | null) {
            if (svg === projection) { update(); return; }
            projectedLayer?.remove();
            projection = svg;
            projectedLayer = svg ? element('g', {'data-script-relation-layer': '', 'aria-hidden': 'true', 'pointer-events': 'none'}) : undefined;
            if (projectedLayer) svg.prepend(projectedLayer);
            update();
        },
        dispose() {
            disposed = true;
            markScripts(new Map());
            if (frame !== undefined) view.cancelAnimationFrame(frame);
            mutations.disconnect();
            resized.disconnect();
            language.disconnect();
            workspace.removeChangeListener?.(changed);
            vm?.runtime?.removeListener?.('PROJECT_CHANGED', changed);
            vm?.removeListener?.('targetsUpdate', changed);
            vm?.removeListener?.('workspaceUpdate', changed);
            injection.removeEventListener('pointerover', selectedScript);
            injection.removeEventListener('pointerdown', selectedScript);
            projectedLayer?.remove();
            layer.remove();
            destinations.remove();
        }
    };
}
