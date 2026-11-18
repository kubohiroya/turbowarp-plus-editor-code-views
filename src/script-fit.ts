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

/** Fit a visible script once. Hidden or not-yet-rendered workspaces can retry after their layout settles. */
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
    const left = origin.x + bounds.x;
    const top = origin.y + bounds.y;
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
    const width = bounds.width * workspace.scale;
    const height = bounds.height * workspace.scale;
    const x = width > scaled.viewWidth - padding * 2 && workspace.RTL ?
        scaled.viewWidth - padding - width : Math.max(padding, (scaled.viewWidth - width) / 2);
    const y = workspace.scale <= minScale ? padding : Math.max(padding, (scaled.viewHeight - height) / 2);
    workspace.scrollbar.set(left * workspace.scale - scaled.contentLeft - x,
        top * workspace.scale - scaled.contentTop - y);
    return true;
}
