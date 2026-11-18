type ScriptFitWorkspace = {
    RTL?: boolean;
    options?: {zoomOptions?: {minScale?: number; maxScale?: number}};
    scale: number;
    getInjectionDiv(): HTMLElement;
    getBlockById(id: string): {
        getSvgRoot(): SVGGraphicsElement | null;
        getRelativeToSurfaceXY(): {x: number; y: number};
    } | null;
    getMetrics(): {viewWidth: number; viewHeight: number; contentLeft: number; contentTop: number} | null;
    resize?(): void;
    setScale(scale: number): void;
    scrollbar?: {set(x: number, y: number): void};
};

const padding = 24;
const positive = (value: number | undefined, fallback: number) =>
    Number.isFinite(value) && value > 0 ? value : fallback;

/** Fit a script once, placing its first block at the viewport's top left with padding. */
export function fitScriptInWorkspace(workspace: ScriptFitWorkspace, scriptId: string,
    blocks: {svgResize(workspace: ScriptFitWorkspace): void}): boolean {
    const injection = workspace.getInjectionDiv();
    const block = workspace.getBlockById(scriptId);
    if (!block || !injection.clientWidth || !injection.clientHeight || !workspace.scrollbar) return false;
    const root = block.getSvgRoot();
    if (!root) return false;
    // A split can have its new DOM size while Blockly's cached SVG size still belongs to the old pane.
    blocks.svgResize(workspace);
    workspace.resize?.();
    const bounds = root.getBBox();
    const metrics = workspace.getMetrics();
    if (!metrics?.viewWidth || !metrics.viewHeight || !(bounds.width > 0) || !(bounds.height > 0)) return false;
    // SVG bounds include nested reporters and the hat's overhang, but exclude folded, hidden bodies.
    const origin = block.getRelativeToSurfaceXY();
    // A wider block farther down the script must not shift the first block's anchor.
    const path = root.querySelector<SVGGraphicsElement>(':scope > .blocklyPath');
    const first = path?.getBBox() ?? bounds;
    const left = origin.x + (path && workspace.RTL ? -first.x - first.width : first.x);
    const top = origin.y + first.y;
    const zoom = workspace.options?.zoomOptions;
    const workspaceMin = positive(zoom?.minScale, 0.01);
    const workspaceMax = Math.max(workspaceMin, positive(zoom?.maxScale, Infinity));
    const minScale = Math.min(Math.max(0.5, workspaceMin), workspaceMax);
    const maxScale = Math.max(minScale, Math.min(1.25, workspaceMax));
    const fit = Math.min(Math.max(1, metrics.viewWidth - padding * 2) / bounds.width,
        Math.max(1, metrics.viewHeight - padding * 2) / bounds.height);
    const scale = Math.max(minScale, Math.min(maxScale, fit));
    workspace.setScale(scale);
    const scaled = workspace.getMetrics();
    if (!scaled) return false;
    workspace.scrollbar.set(left * workspace.scale - scaled.contentLeft - padding,
        top * workspace.scale - scaled.contentTop - padding);
    return true;
}
