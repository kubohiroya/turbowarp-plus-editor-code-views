import {isFoldedDefinition} from './procedure-edits.ts';
import {readScriptRelations, type RelationTarget, type ScriptEndpoint, type ScriptRelation} from './script-relations.ts';

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
}

type Point = {x: number; y: number};
type Box = Point & {width: number; height: number};
type Anchor = {id: string; box: Box; point(side: 'left' | 'right', fraction: number): Point};
type Drawing = {relation: ScriptRelation; source?: Anchor; destination?: Anchor; count: number};
const ns = 'http://www.w3.org/2000/svg';
const outlines = new WeakMap<SVGGeometryElement, {data: string; points: Point[]}>();

/** Intersect the actual outline, including a hat's overhang, rather than Blockly's layout padding. */
function outlinePoint(shape: SVGGeometryElement, bounds: Box, side: 'left' | 'right', fraction: number): Point {
    const data = shape.getAttribute('d') ?? '';
    let outline = outlines.get(shape);
    if (!outline || outline.data !== data) {
        const length = shape.getTotalLength();
        const count = Math.max(32, Math.min(1024, Math.ceil(length / 2)));
        const points = Array.from({length: count + 1}, (_, index) => {
            const point = shape.getPointAtLength(length * index / count);
            return {x: point.x, y: point.y};
        });
        outline = {data, points};
        outlines.set(shape, outline);
    }
    const y = bounds.y + bounds.height * fraction;
    let edge: number | undefined;
    for (let index = 1; index < outline.points.length; index++) {
        const before = outline.points[index - 1];
        const after = outline.points[index];
        if ((before.y <= y && after.y >= y) || (before.y >= y && after.y <= y)) {
            const x = before.y === after.y ? (side === 'left' ? Math.min(before.x, after.x) : Math.max(before.x, after.x)) :
                before.x + (after.x - before.x) * (y - before.y) / (after.y - before.y);
            edge = edge === undefined ? x : side === 'left' ? Math.min(edge, x) : Math.max(edge, x);
        }
    }
    return {x: edge ?? bounds.x + (side === 'right' ? bounds.width : 0), y};
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
export function attachScriptArrows({workspace, vm, getTarget, getRelations, getLocale, getTargetName, navigate}: ScriptRelationContext & {
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
    canvas.prepend(layer);
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
        return {id, box: {x: Math.min(first.x, last.x), y: Math.min(first.y, last.y),
            width: Math.abs(last.x - first.x), height: Math.abs(last.y - first.y)}, point(side, fraction) {
            const localSide = first.x <= last.x ? side : side === 'left' ? 'right' : 'left';
            return convert(path ? outlinePoint(path, bounds, localSide, fraction) :
                {x: bounds.x + (localSide === 'right' ? bounds.width : 0), y: bounds.y + bounds.height * fraction});
        }};
    }

    function render() {
        frame = undefined;
        if (disposed) return;
        const strings = text();
        const toolbox = injection.querySelector<HTMLElement>(':scope > .blocklyToolboxDiv');
        const toolboxBounds = toolbox?.getBoundingClientRect();
        const horizontal = toolbox?.hasAttribute('data-horizontal-block-palette');
        // The horizontal palette sits above the blocks, including in the Editor's default layout.
        destinations.style.top = `${horizontal ? Math.max(10, toolboxBounds.bottom - injection.getBoundingClientRect().top + 10) : 10}px`;
        destinations.replaceChildren();
        destinations.hidden = true;
        const drawingRoot = projection ?? canvas;
        const drawingLayer = projection ? projectedLayer : layer;
        if (!drawingLayer) return;
        drawingLayer.replaceChildren();
        drawingLayer.removeAttribute('data-script-dragging');
        layer.style.display = projection ? 'none' : '';
        if (!enabled) { markScripts(new Map()); return; }
        const target = getTarget();
        if (!target) { markScripts(new Map()); return; }
        const matrix = (drawingRoot as SVGGraphicsElement).getScreenCTM();
        if (!matrix) { markScripts(new Map()); return; }
        const inverse = matrix.inverse();
        if (![inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite)) {
            markScripts(new Map());
            return;
        }
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
        drawingLayer.toggleAttribute('data-script-dragging', Boolean(dragging));
        const drawings = new Map<string, Drawing>();
        for (const relation of graph) {
            if (relation.source.targetId !== target.id && relation.destination?.targetId !== target.id) continue;
            const source = anchor(relation.source, target, roots, inverse);
            const destination = relation.destination && anchor(relation.destination, target, roots, inverse);
            if (!source && !destination) continue;
            const key = JSON.stringify([relation.kind, source?.id ?? relation.source,
                destination?.id ?? relation.destination, relation.wait, relation.unresolved, relation.label]);
            const existing = drawings.get(key);
            if (existing) existing.count++;
            else drawings.set(key, {relation, source, destination, count: 1});
        }
        const related = new Set<string>();
        for (const relation of graph) if (dragging && incident(relation)) {
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
        markScripts(marked);
        // Frame the whole stack, including its body; the original block paint and runtime glow stay intact.
        for (const [root, role] of marked) {
            const bounds = root.getBoundingClientRect();
            const first = transform(inverse, {x: bounds.left, y: bounds.top});
            const last = transform(inverse, {x: bounds.right, y: bounds.bottom});
            drawingLayer.append(element('rect', {x: String(first.x - 7), y: String(first.y - 7),
                width: String(Math.max(0, last.x - first.x) + 14), height: String(Math.max(0, last.y - first.y) + 14),
                rx: '10', class: 'tw-script-relation-script-highlight', 'data-emphasis': role}));
        }
        for (const {relation, source, destination, count} of drawings.values()) {
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
                destinations.append(external);
            }
            // Anchor an external link to the viewport edge; the list itself remains keyboard accessible.
            const area = (projection ?? workspace.getParentSvg()).getBoundingClientRect();
            const local = source ?? destination;
            const edgeX = source ? area.right - 12 : area.left + 12;
            const screenY = transform(matrix, {x: local.box.x, y: local.box.y + local.box.height / 2}).y;
            const edge = transform(inverse, {x: edgeX, y: Math.max(area.top + 12, Math.min(area.bottom - 12, screenY))});
            const forward = !source || !destination || destination.box.x >= source.box.x + source.box.width / 2;
            let start = source ? source.point(forward ? 'right' : 'left', 0.5) : edge;
            let end = destination ? destination.point(forward ? 'left' : 'right', Math.min(0.5, 24 / destination.box.height)) : edge;
            let direction = forward ? 1 : -1;
            const bend = Math.max(36, Math.abs(end.x - start.x) / 2);
            let path = `M ${start.x} ${start.y} C ${start.x + bend * direction} ${start.y}, ${end.x - bend * direction} ${end.y}, ${end.x} ${end.y}`;
            const recursive = source && destination && relation.source.scriptId === relation.destination.scriptId &&
                relation.source.targetId === relation.destination.targetId;
            let badgePoint = {x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 6};
            if (recursive) {
                start = source.point('right', 0.75);
                end = destination.point('right', 0.25);
                const outside = Math.max(start.x, end.x) + 72;
                path = `M ${start.x} ${start.y} C ${outside} ${start.y + 32}, ${outside} ${end.y - 32}, ${end.x} ${end.y}`;
                direction = -1;
                badgePoint = {x: outside - 14, y: (start.y + end.y) / 2 - 6};
            }
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
            const description = element('title');
            const waiting = relation.kind === 'message' && relation.wait;
            description.textContent = `${strings[relation.kind]}: ${relation.label}${waiting ? ` · ${strings.wait}` : ''}`;
            group.append(description, element('path', {
                class: 'tw-script-relation-line',
                d: path
            }), element('path', {
                class: 'tw-script-relation-head',
                d: `M ${end.x - 9 * direction} ${end.y - 5} L ${end.x} ${end.y} L ${end.x - 9 * direction} ${end.y + 5}`
            }));
            if (count > 1 || waiting) {
                const badge = element('text', {x: String(badgePoint.x), y: String(badgePoint.y),
                    class: `tw-script-relation-badge${waiting ? ' tw-script-relation-wait' : ''}`, 'text-anchor': 'middle'});
                badge.textContent = `${waiting ? '⏳' : ''}${count > 1 ? ` ×${count}` : ''}`;
                group.append(badge);
            }
            drawingLayer.append(group);
        }
        destinations.hidden = !destinations.childElementCount;
    }

    function update() {
        if (!disposed && frame === undefined) frame = view.requestAnimationFrame(render);
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
    const mutations = new view.MutationObserver(records => {
        if (records.some(record => record.target !== layer && !layer.contains(record.target) &&
            !record.attributeName?.startsWith('data-script-relation-'))) update();
    });
    mutations.observe(canvas, {attributes: true, childList: true, subtree: true});
    // Its CSS translation changes on every drag step, while the workspace canvas stays untouched.
    const dragSurface = injection.querySelector('.blocklyBlockDragSurface');
    if (dragSurface) mutations.observe(dragSurface, {attributes: true, childList: true, subtree: true});
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
