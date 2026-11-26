import {getScriptProjection, type ScriptProjection} from './script-projection.ts';

type OverviewOptions = {
    workspace: any;
    ScratchBlocks: any;
    zoomHeight?: number;
    getCorner?(metrics: any): {right: number; bottom: number};
    watermark?: HTMLElement;
    getWatermark?(): HTMLElement | undefined | null;
};

const svgNamespace = 'http://www.w3.org/2000/svg';

/** A cached overview drawn from public block geometry; offscreen culling never changes the project map. */
export function attachWorkspaceOverview({workspace, ScratchBlocks, zoomHeight = 0, getCorner,
    watermark, getWatermark}: OverviewOptions) {
    const container = workspace.getInjectionDiv() as HTMLElement;
    const document = container.ownerDocument;
    const view = document.defaultView;
    const canvas = workspace.getCanvas() as SVGElement;
    const element = <K extends keyof SVGElementTagNameMap>(tag: K) => document.createElementNS(svgNamespace, tag);
    const map = element('svg');
    map.dataset.workspaceMinimap = '';
    map.classList.add('tw-workspace-overview');
    map.setAttribute('aria-hidden', 'true');
    const shapes = element('g');
    const clip = element('svg');
    clip.setAttribute('overflow', 'hidden');
    const viewport = element('rect');
    viewport.classList.add('tw-workspace-overview-viewport');
    clip.append(viewport);
    map.append(shapes, clip);
    container.append(map);
    const paths = new Map<string, SVGPathElement>();
    let needsShapes = true;
    let frame: number | undefined;
    let disposed = false;
    const attribute = (node: Element, name: string, value: string | number) => {
        const text = String(value);
        if (node.getAttribute(name) !== text) node.setAttribute(name, text);
    };
    const style = (node: HTMLElement | SVGElement, name: string, value: string) => {
        if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
    };

    function refreshShapes() {
        const retained = new Set<string>();
        const additions = document.createDocumentFragment();
        const painting: [string, string, string, string][] = [];
        const paint = (id: string, data: string, fill: string, transform: string) => {
            painting.push([id, data, fill, transform]);
        };
        const projection = getScriptProjection(workspace);
        if (projection) {
            const inverse = projection.svg.getScreenCTM()?.inverse();
            if (inverse) for (const source of projection.svg.querySelectorAll<SVGPathElement>('.blocklyPath')) {
                if (source.closest('[data-tw-plus-hidden]')) continue;
                const id = source.closest('[data-id]')?.getAttribute('data-id');
                const data = source.getAttribute('d');
                const matrix = source.getScreenCTM();
                if (!id || !data || !matrix) continue;
                const transform = inverse.multiply(matrix);
                paint(id, data, source.getAttribute('fill') || view.getComputedStyle(source).fill,
                    `matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.e} ${transform.f})`);
            }
        } else {
            for (const block of workspace.getAllBlocks(false)) {
                const root = block.getSvgRoot() as SVGElement | null;
                if (!root || !canvas.contains(root) || root.closest('[data-tw-plus-hidden]')) continue;
                const source = root.querySelector(':scope > .blocklyPath');
                const data = source?.getAttribute('d');
                if (!data) continue;
                const position = block.getRelativeToSurfaceXY();
                paint(block.id, data, source.getAttribute('fill') || block.getColour(),
                    `translate(${position.x} ${position.y})${block.RTL ? ' scale(-1 1)' : ''}`);
            }
        }
        // Measure every projected path before updating the live overview's cached shapes.
        for (const [id, data, fill, transform] of painting) {
            retained.add(id);
            let path = paths.get(id);
            if (!path) {
                path = element('path');
                paths.set(id, path);
                additions.append(path);
            }
            attribute(path, 'd', data);
            attribute(path, 'fill', fill);
            attribute(path, 'transform', transform);
        }
        for (const [id, path] of paths) if (!retained.has(id)) {path.remove(); paths.delete(id);}
        if (additions.childNodes.length) shapes.append(additions);
        needsShapes = false;
    }

    function render() {
        frame = undefined;
        if (disposed) return;
        const metrics = workspace.isVisible() && workspace.getMetrics();
        if (!metrics || metrics.viewWidth <= 32 || metrics.viewHeight <= 32) {map.toggleAttribute('hidden', true); return;}
        const scale = workspace.scale;
        const projection = getScriptProjection(workspace);
        const x = projection ? projection.surface.scrollLeft / scale : metrics.viewLeft / scale;
        const y = projection ? projection.surface.scrollTop / scale : metrics.viewTop / scale;
        const width = (projection ? projection.surface.clientWidth : metrics.viewWidth) / scale;
        const height = (projection ? projection.surface.clientHeight : metrics.viewHeight) / scale;
        const content = metrics.contentWidth > 0 && metrics.contentHeight > 0;
        const box = projection?.svg.viewBox.baseVal;
        const area = box ? {x: box.x, y: box.y, width: Math.max(box.width, width), height: Math.max(box.height, height)} :
            content ? {x: metrics.contentLeft / scale, y: metrics.contentTop / scale,
            width: metrics.contentWidth / scale, height: metrics.contentHeight / scale} : {x, y, width, height};
        if (!projection && !workspace.scrollbar && content) {
            const right = Math.max(x + width, area.x + area.width), bottom = Math.max(y + height, area.y + area.height);
            area.x = Math.min(x, area.x); area.y = Math.min(y, area.y);
            area.width = right - area.x; area.height = bottom - area.y;
        }
        const corner = getCorner?.(metrics);
        if (!watermark?.isConnected) watermark = getWatermark?.() ?? undefined;
        const mapWidth = Math.min(164, metrics.viewWidth * .4) * .8;
        let mapHeight = Math.min(104, metrics.viewHeight * .35) * .8;
        const spacing = zoomHeight ? zoomHeight + 8 : 0;
        if (watermark && corner) mapHeight = Math.min(mapHeight, Math.max(0, corner.bottom - spacing - 8) * .6);
        const right = corner ? container.clientWidth - corner.right : undefined;
        const bottom = corner ? container.clientHeight - corner.bottom + spacing :
            (metrics.toolboxPosition === ScratchBlocks.TOOLBOX_AT_BOTTOM ? metrics.toolboxHeight : 0) + 16;
        const borderX = container.offsetWidth - container.clientWidth - container.clientLeft;
        const borderY = container.offsetHeight - container.clientHeight - container.clientTop;

        // All layout reads above precede writes. Identical values do not invalidate the editor's styles.
        if (needsShapes) refreshShapes();
        map.toggleAttribute('hidden', false);
        const viewBox = `${area.x} ${area.y} ${area.width} ${area.height}`;
        attribute(map, 'viewBox', viewBox); attribute(clip, 'viewBox', viewBox);
        for (const [name, value] of Object.entries(area)) attribute(clip, name, value);
        for (const [name, value] of Object.entries({x, y, width, height})) attribute(viewport, name, value);
        style(map, 'width', `${mapWidth}px`); style(map, 'height', `${mapHeight}px`);
        style(map, 'bottom', `${bottom}px`);
        if (right !== undefined) style(map, 'right', `${right}px`);
        else style(map, 'left', `${metrics.absoluteLeft + 12}px`);
        if (watermark && corner) {
            if (!watermark.classList.contains('tw-workspace-overview-watermark')) watermark.classList.add('tw-workspace-overview-watermark');
            if (!watermark.hasAttribute('data-plus-workspace-watermark')) watermark.dataset.plusWorkspaceWatermark = '';
            style(watermark, '--plus-watermark-right', `${right + borderX}px`);
            style(watermark, '--plus-watermark-bottom', `${bottom + mapHeight + 8 + borderY}px`);
            style(watermark, '--plus-watermark-size', `${Math.max(0, Math.min(64, corner.bottom - spacing - mapHeight - 8))}px`);
        }
    }
    const schedule = () => {
        if (!disposed && frame === undefined) frame = view.requestAnimationFrame(render);
    };
    const changes = new view.MutationObserver(records => {
        needsShapes ||= records.some(record => record.type === 'childList' || record.target !== canvas);
        schedule();
    });
    // Native intersection culling only writes display styles. Those blocks still belong in the overview.
    changes.observe(canvas, {subtree: true, childList: true,
        attributeFilter: ['transform', 'd', 'fill', 'data-tw-plus-hidden']});
    const surface = container.querySelector('.blocklyWsDragSurface');
    const scrolling = new view.MutationObserver(schedule);
    if (surface) scrolling.observe(surface, {attributes: true});
    const resize = new view.ResizeObserver(schedule);
    resize.observe(container);
    const events = new view.AbortController();
    let displayedProjection: ScriptProjection | undefined;
    container.addEventListener('scriptprojectionchange', () => {
        // A layout update publishes new positions even if its SVG is reused. Scrolling keeps the same projection.
        const next = getScriptProjection(workspace);
        needsShapes ||= next !== displayedProjection;
        displayedProjection = next;
        schedule();
    }, {signal: events.signal});
    view.addEventListener('resize', schedule, {signal: events.signal});
    view.addEventListener('scroll', schedule, {signal: events.signal, passive: true});

    const moveView = (left: number, top: number) => {
        const projection = getScriptProjection(workspace);
        if (projection) {
            projection.surface.scrollTo(left * workspace.scale, top * workspace.scale);
            return;
        }
        const metrics = workspace.getMetrics();
        if (!metrics || !workspace.scrollbar) return;
        const clamp = (value: number, maximum: number) => Math.max(0, Math.min(value, Math.max(0, maximum)));
        workspace.scrollbar.set(clamp(left * workspace.scale - metrics.contentLeft, metrics.contentWidth - metrics.viewWidth),
            clamp(top * workspace.scale - metrics.contentTop, metrics.contentHeight - metrics.viewHeight));
    };
    type Pointer = {id: number; x: number; y: number; start: DOMPoint; inverse: DOMMatrix;
        left: number; top: number; viewport: boolean; moved: boolean};
    let pointer: Pointer | undefined;
    const point = (event: PointerEvent, inverse: DOMMatrix) =>
        new view.DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
    map.addEventListener('pointerdown', event => {
        const projection = getScriptProjection(workspace);
        if (!event.isPrimary || event.button !== 0 || pointer || (!projection && !workspace.scrollbar)) return;
        const matrix = map.getScreenCTM(), metrics = workspace.getMetrics();
        if (!matrix || !metrics) return;
        const inverse = matrix.inverse();
        pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, start: point(event, inverse), inverse,
            left: projection ? projection.surface.scrollLeft / workspace.scale : metrics.viewLeft / workspace.scale,
            top: projection ? projection.surface.scrollTop / workspace.scale : metrics.viewTop / workspace.scale,
            viewport: event.target === viewport, moved: false};
        map.setPointerCapture(event.pointerId);
    }, {signal: events.signal});
    const move = (event: PointerEvent) => {
        if (pointer?.id !== event.pointerId) return;
        if (!pointer.moved && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 3) {
            pointer.moved = true;
            if (pointer.viewport) {map.dataset.dragging = ''; ScratchBlocks.hideChaff(true);}
        }
        if (pointer.moved && pointer.viewport) {
            const current = point(event, pointer.inverse);
            moveView(pointer.left + current.x - pointer.start.x, pointer.top + current.y - pointer.start.y);
        }
    };
    map.addEventListener('pointermove', move, {signal: events.signal});
    const finish = (event: PointerEvent) => {
        if (pointer?.id !== event.pointerId) return;
        if (event.type === 'pointerup') {
            move(event);
            if (!pointer.moved) {
                const current = point(event, pointer.inverse), metrics = workspace.getMetrics();
                const projection = getScriptProjection(workspace);
                if (metrics) moveView(current.x - (projection ? projection.surface.clientWidth : metrics.viewWidth) / (2 * workspace.scale),
                    current.y - (projection ? projection.surface.clientHeight : metrics.viewHeight) / (2 * workspace.scale));
                ScratchBlocks.hideChaff(true);
            }
        }
        pointer = undefined;
        delete map.dataset.dragging;
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) map.addEventListener(type, finish, {signal: events.signal});
    schedule();
    return {dispose() {
        disposed = true;
        events.abort(); changes.disconnect(); scrolling.disconnect(); resize.disconnect();
        if (frame !== undefined) view.cancelAnimationFrame(frame);
        map.remove(); paths.clear();
        if (watermark) {
            watermark.classList.remove('tw-workspace-overview-watermark');
            delete watermark.dataset.plusWorkspaceWatermark;
            for (const name of ['right', 'bottom', 'size']) watermark.style.removeProperty(`--plus-watermark-${name}`);
        }
    }};
}
