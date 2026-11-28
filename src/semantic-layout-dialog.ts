import {paintScripts, type LayoutEvents} from './script-layout-workspace.ts';
import {readScriptRelations, type ScriptRelation} from './script-relations.ts';
import type {ScriptRelationContext} from './script-arrows.ts';
import {arrangeSemanticScripts, type SemanticPlacement} from './semantic-script-layout.ts';
import {applySemanticLayout, readSemanticWorkspace, type SemanticScript, type SemanticWorkspace} from './semantic-layout-workspace.ts';

const ns = 'http://www.w3.org/2000/svg';
export interface SemanticLayoutContext {
    workspace: SemanticWorkspace;
    events: LayoutEvents;
    relations: ScriptRelationContext;
    canArrange(): boolean;
}

export function openSemanticLayout(context: SemanticLayoutContext, locale: string) {
    const {workspace, events, relations, canArrange} = context;
    const document = workspace.getInjectionDiv().ownerDocument;
    const window = document.defaultView!;
    const ja = /^ja(?:-|$)/i.test(locale);
    const t = (en: string, japanese: string) => ja ? japanese : en;
    const dialog = document.createElement('dialog');
    dialog.className = 'tw-script-layout-dialog';
    dialog.setAttribute('aria-label', t('Rearrange scripts by relationships', 'スクリプトを意味に応じて再配置する'));
    const title = document.createElement('h2');
    title.textContent = dialog.getAttribute('aria-label');
    const explanation = document.createElement('p');
    explanation.textContent = t('Read static calls and messages from left to right. This does not guarantee execution order.',
        '関数の呼び出しとメッセージ送受信を左から右にたどる配置です。実行順序を保証するものではありません。');
    const preview = document.createElement('div');
    preview.className = 'tw-script-layout-preview';
    preview.tabIndex = 0;
    preview.setAttribute('aria-label', t('Layout preview', '再配置のプレビュー'));
    const footer = document.createElement('footer');
    footer.className = 'tw-plus-dialog-actions';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    const cancel = document.createElement('button');
    cancel.textContent = t('Cancel', 'キャンセル');
    cancel.dataset.dialogAction = 'cancel';
    const apply = document.createElement('button');
    apply.textContent = t('Rearrange', '再配置する');
    apply.dataset.dialogAction = 'confirm';
    apply.disabled = true;
    const recalculate = document.createElement('button');
    recalculate.textContent = t('Recalculate', '再計算する');
    footer.append(status, recalculate, cancel, apply);
    dialog.append(title, explanation, preview, footer);
    document.body.append(dialog);
    let closed = false;
    let run: AbortController | undefined;
    let snapshot: ReturnType<typeof readSemanticWorkspace>;
    let placements: SemanticPlacement<SemanticScript>[] = [];
    let signature = '';
    let originalTarget: ReturnType<ScriptRelationContext['getTarget']>;

    function graph() {
        return relations.getRelations?.() ?? readScriptRelations(relations.vm?.runtime?.targets ??
            (relations.getTarget() ? [relations.getTarget()!] : []));
    }
    function revision() {
        // Include program contents and external targets: unchanged bounds do not imply unchanged calls.
        const targets = relations.vm?.runtime?.targets ?? [relations.getTarget()];
        const geometry = readSemanticWorkspace(workspace);
        return JSON.stringify({targets: targets.filter(t => t && t.isOriginal !== false).map(t => [t.id, t.blocks._blocks]),
            graph: relations.getRelations?.(), scripts: geometry.scripts.map(s => [s.id, s.x, s.y, s.width, s.height]),
            comments: geometry.comments.map(c => [c.id, c.rootId, c.x, c.y, c.width, c.height, c.origin, c.text])});
    }
    function stale() {
        try {
            const current = readSemanticWorkspace(workspace).scripts;
            return !canArrange() || relations.getTarget()?.id !== originalTarget?.id || revision() !== signature ||
                current.length !== snapshot.scripts.length || current.some(s =>
                    snapshot.scripts.find(original => original.id === s.id)?.block !== s.block);
        } catch {return true;}
    }
    function close() {
        if (closed) return;
        closed = true;
        run?.abort();
        for (const [emitter, name] of subscriptions) emitter?.removeListener?.(name, invalidate);
        if (dialog.open) dialog.close();
        dialog.remove();
    }
    function invalidate() {
        if (closed || !snapshot || !stale()) return;
        run?.abort(); apply.disabled = true; recalculate.disabled = false;
        status.textContent = t('The code changed. Recalculate the preview.', 'コードが変わりました。プレビューを再計算してください。');
    }
    const subscriptions = [
        [relations.vm, 'workspaceUpdate'], [relations.vm, 'targetsUpdate'], [relations.vm?.runtime, 'PROJECT_CHANGED']
    ] as const;
    for (const [emitter, name] of subscriptions) emitter?.on?.(name, invalidate);

    async function calculate() {
        run?.abort();
        const task = new window.AbortController(); run = task;
        apply.disabled = true; recalculate.disabled = true; preview.replaceChildren();
        status.textContent = t('Calculating layout…', '配置を計算しています…');
        try {
            events.fireNow_();
            if (!canArrange()) throw new Error('Workspace is unavailable');
            originalTarget = relations.getTarget();
            if (!originalTarget) throw new Error('No target');
            snapshot = readSemanticWorkspace(workspace);
            signature = revision();
            const edges = graph();
            const started = window.performance.now();
            const result = await arrangeSemanticScripts(snapshot.scripts, edges, originalTarget.id, {
                signal: task.signal, obstacles: snapshot.obstacles,
                yieldControl: () => new Promise(resolve => window.setTimeout(resolve, 0))
            });
            if (closed || run !== task || task.signal.aborted) return;
            if (stale()) {invalidate(); return;}
            placements = result.placements;
            paintPreview(edges);
            const external = edges.filter(e => e.destination && e.source.targetId !== e.destination.targetId &&
                [e.source.targetId, e.destination.targetId].includes(originalTarget.id)).length;
            const unresolved = edges.filter(e => e.source.targetId === originalTarget.id && e.unresolved).length;
            status.textContent = t(`${placements.length} scripts · ${result.metrics.edges} links · ${external} external · ${unresolved} unresolved`,
                `${placements.length}スクリプト・${result.metrics.edges}接続・外部${external}・未解決${unresolved}`);
            preview.dataset.layoutMetrics = JSON.stringify({...result.metrics, milliseconds: window.performance.now() - started,
                overlaps: 0, external, unresolved});
            apply.disabled = !placements.some(p => p.x !== p.script.x || p.y !== p.script.y);
        } catch (error) {
            if (closed || run !== task || task.signal.aborted) return;
            status.textContent = t('Unable to calculate a safe layout. The project has not changed.',
                '安全な配置を計算できませんでした。作品は変更されていません。');
            status.title = String(error);
        } finally {if (!closed && run === task) recalculate.disabled = false;}
    }

    function paintPreview(edges: readonly ScriptRelation[]) {
        paintScripts(preview, placements, .6);
        const svg = preview.querySelector('svg')!;
        const local = new Map(placements.map(p => [p.script.id, p]));
        // Include loose comments and the complete cluster extents, even beyond the visible folded body.
        for (const c of snapshot.comments) {
            const p = local.get(c.rootId);
            const x = c.x + (p ? p.x - p.script.x : 0), y = c.y + (p ? p.y - p.script.y : 0);
            const rect = document.createElementNS(ns, 'rect');
            for (const [key, value] of Object.entries({x, y, width: c.width, height: c.height, fill: '#fff2ae', stroke: '#9b8524'})) {
                rect.setAttribute(key, String(value));
            }
            const text = document.createElementNS(ns, 'title'); text.textContent = t('Comment', 'コメント');
            rect.append(text); svg.append(rect);
            const content = document.createElementNS(ns, 'foreignObject');
            for (const [key, value] of Object.entries({x: x + 8, y: y + 8,
                width: Math.max(0, c.width - 16), height: Math.max(0, c.height - 16)})) content.setAttribute(key, String(value));
            const prose = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
            prose.style.cssText = 'height:100%;overflow:hidden;white-space:pre-wrap;color:#332f20;font:14px sans-serif';
            prose.textContent = c.text; content.append(prose); svg.append(content);
        }
        const layer = document.createElementNS(ns, 'g');
        layer.setAttribute('data-semantic-relations', '');
        for (const edge of edges) {
            const source = edge.source.targetId === originalTarget.id ? local.get(edge.source.scriptId) : undefined;
            const destination = edge.destination?.targetId === originalTarget.id ? local.get(edge.destination.scriptId) : undefined;
            if (!source && !destination) continue;
            const p = source ?? destination;
            const end = destination ?? source;
            const from = {x: p.x + (source ? p.script.width : -40), y: p.y + p.script.height / 2};
            const to = {x: destination ? end.x : end.x + end.script.width + 40, y: end.y + end.script.height / 2};
            const group = document.createElementNS(ns, 'g');
            group.dataset.semanticRelation = edge.kind;
            group.dataset.wait = String(edge.wait);
            if (edge.unresolved) group.dataset.unresolved = edge.unresolved;
            else if (!source || !destination) group.dataset.external = 'true';
            const line = document.createElementNS(ns, 'path');
            const middle = Math.max(from.x + 32, (from.x + to.x) / 2);
            line.setAttribute('d', `M ${from.x} ${from.y} C ${middle} ${from.y} ${middle} ${to.y} ${to.x} ${to.y}`);
            line.setAttribute('fill', 'none'); line.setAttribute('stroke', edge.kind === 'function' ? '#b65be6' : edge.kind === 'reference' ? '#00838f' : '#ba8a00');
            line.setAttribute('stroke-width', '2');
            if (edge.kind === 'message') line.setAttribute('stroke-dasharray', edge.wait ? '7 5' : '3.5 2.5');
            if (edge.kind === 'reference') line.setAttribute('stroke-dasharray', '10 3 2 3');
            const head = document.createElementNS(ns, 'path');
            head.setAttribute('d', `M ${to.x - 7} ${to.y - 4} L ${to.x} ${to.y} L ${to.x - 7} ${to.y + 4}`);
            head.setAttribute('fill', 'none'); head.setAttribute('stroke', line.getAttribute('stroke'));
            const label = document.createElementNS(ns, 'title');
            label.textContent = `${edge.label} ${edge.unresolved ? t('(unresolved)', '（未解決）') :
                !source || !destination ? t('(external)', '（外部）') : ''}`;
            group.append(line, head, label); layer.append(group);
            if (edge.unresolved || !source || !destination) {
                const text = document.createElementNS(ns, 'text');
                text.setAttribute('x', String(to.x + 8)); text.setAttribute('y', String(to.y));
                text.setAttribute('fill', 'currentColor'); text.setAttribute('font-size', '14');
                const externalId = source ? edge.destination?.targetId : edge.source.targetId;
                text.textContent = edge.unresolved ? `${edge.label || '?'} ${t('(unresolved)', '（未解決）')}` :
                    `${edge.label} ↗ ${relations.getTargetName?.(externalId) ??
                        relations.vm?.runtime?.targets?.find(target => target.id === externalId)?.getName?.() ?? t('external', '外部')}`;
                group.append(text);
            }
        }
        svg.prepend(layer);
        const box = svg.getBBox();
        const left = Math.min(0, box.x) - 16, top = Math.min(0, box.y) - 16;
        const width = box.x + box.width - left + 32, height = box.y + box.height - top + 32;
        svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);
        svg.setAttribute('width', String(width * .6));
        svg.setAttribute('height', String(height * .6));
    }

    cancel.addEventListener('click', close);
    dialog.addEventListener('close', close, {once: true});
    dialog.addEventListener('cancel', close, {once: true});
    dialog.addEventListener('keydown', e => e.stopPropagation());
    recalculate.addEventListener('click', () => void calculate());
    apply.addEventListener('click', () => {
        events.fireNow_();
        if (stale()) {invalidate(); return;}
        try {applySemanticLayout(workspace, events, placements, snapshot.comments);}
        catch (error) {
            apply.disabled = true;
            status.textContent = t('Unable to apply the layout. Original positions were restored.',
                '配置を適用できませんでした。元の位置に戻しました。');
            status.title = String(error); return;
        }
        close();
        if (placements.length) workspace.centerOnBlock(placements[0].script.id);
    });
    dialog.showModal(); cancel.focus();
    void calculate();
    return {close};
}
