export type ScriptProjection = {surface: HTMLElement; svg: SVGSVGElement};

const projections = new WeakMap<object, ScriptProjection>();

export const getScriptProjection = (workspace: object) => projections.get(workspace);

export function setScriptProjection(workspace: {getInjectionDiv(): HTMLElement}, projection?: ScriptProjection) {
    if (projection) projections.set(workspace, projection);
    else projections.delete(workspace);
    const container = workspace.getInjectionDiv();
    container.dispatchEvent(new container.ownerDocument.defaultView.Event('scriptprojectionchange'));
}
