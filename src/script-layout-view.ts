import {arrangeScripts} from './script-layout.ts';
import {paintScripts, readScripts, type LayoutWorkspace} from './script-layout-workspace.ts';
import {openRearrangement, type RearrangementContext} from './script-layout-dialog.ts';
import {attachScriptViewMenu, type ScriptViewMenuBlocks, type ScriptViewMenuWorkspace} from './script-view-menu.ts';
import type {PresentationElements} from './preview-chrome.ts';
import {attachScriptArrows, type ScriptRelationContext, type ScriptRelationVisibility} from './script-arrows.ts';
import {attachCodeZoomRange} from './code-zoom.ts';
import {setScriptProjection, type ScriptProjection} from './script-projection.ts';
import {openSerialScriptEditor} from './serial-script-editor.ts';
import {openSemanticLayout, type SemanticLayoutContext} from './semantic-layout-dialog.ts';
import {isFoldedDefinition, setFoldedDefinition} from './procedure-edits.ts';

export type ScriptView = 'free' | 'z' | 'n';

interface ViewOptions {
    workspace: LayoutWorkspace & ScriptViewMenuWorkspace;
    ScratchBlocks: ScriptViewMenuBlocks;
    getLocale(): string;
    mount?: HTMLElement;
    initialView?: ScriptView;
    canShowBlock?(): boolean;
    onChange?(view: ScriptView): void;
    hasWorkspaceMenu?(): boolean;
    relations?: ScriptRelationContext;
    semanticLayout?: Pick<SemanticLayoutContext, 'events' | 'canArrange'>;
}

const choices = [
    {view: 'free', label: 'Normal layout view', jaLabel: '通常配置の見え方'},
    {view: 'z', label: 'Z layout view', jaLabel: 'Z配置の見え方'},
    {view: 'n', label: 'N layout view', jaLabel: 'N配置の見え方'}
] as const;

export function attachScriptView({
    workspace, ScratchBlocks, getLocale, mount, initialView = 'free', canShowBlock, onChange, hasWorkspaceMenu = () => true,
    relations: relationContext, semanticLayout
}: ViewOptions) {
    const injection = workspace.getInjectionDiv();
    const restoreZoomRange = attachCodeZoomRange(workspace);
    const host = mount ?? injection;
    const document = host.ownerDocument;
    const window = document.defaultView;
    const surface = document.createElement('div');
    surface.className = 'tw-script-view-surface';
    surface.dataset.codeViewControl = '';
    surface.tabIndex = 0;
    surface.toggleAttribute('data-can-show-block', Boolean(canShowBlock || relationContext?.vm));
    const contents = document.createElement('div');
    surface.append(contents);
    const gutter = document.createElement('div');
    gutter.className = 'tw-script-fold-gutter';
    gutter.dataset.codeViewControl = '';
    const foldStrip = document.createElement('div');
    gutter.append(foldStrip);
    const foldButtons = new Map<string, HTMLButtonElement>();
    let view = initialView;
    let editor: ReturnType<typeof openSerialScriptEditor>;
    let semanticDialog: ReturnType<typeof openSemanticLayout> | undefined;
    let frame: number | undefined;
    let rebuildProjection = true;
    let projection: ScriptProjection | undefined;
    const svg = workspace.getParentSvg();
    const canvas = workspace.getCanvas();
    const comparisonStyle = document.createElement('div').style;
    const withoutDisplay = (style: string | null) => {
        comparisonStyle.cssText = style ?? '';
        comparisonStyle.removeProperty('display');
        return comparisonStyle.cssText;
    };
    const observer = new window.MutationObserver(records => {
        const changes = records.filter(record => !(record.target as Element).closest?.('[data-script-relation-layer]'));
        if (!changes.length) return;
        for (const {target, attributeName, oldValue} of changes) {
            if (target === canvas && attributeName === 'transform') continue;
            // The projection already strips display from top-level copies, including native viewport culling.
            if (attributeName === 'style' && target.parentNode === canvas &&
                withoutDisplay(oldValue) === withoutDisplay((target as Element).getAttribute('style'))) continue;
            update();
            return;
        }
        schedule();
    });
    const relations = relationContext && attachScriptArrows({workspace, getLocale, ...relationContext});
    const japanese = () => /^ja(?:-|$)/i.test(getLocale());

    function setFold(ids: string[], value?: boolean) {
        const target = relationContext?.getTarget();
        const runtime = relationContext?.vm?.runtime as {emitProjectChanged?(): void} | undefined;
        if (!target || !runtime?.emitProjectChanged || (canShowBlock && !canShowBlock())) return;
        for (const id of ids) {
            const block = target.blocks._blocks[id];
            if (block) setFoldedDefinition(block, value ?? !isFoldedDefinition(block));
        }
        runtime.emitProjectChanged();
        update();
    }

    function paintFoldButtons(placements: ReturnType<typeof arrangeScripts>, scale: number) {
        const target = relationContext?.getTarget();
        const ids = new Set(placements.map(({script}) => script.id));
        for (const [id, button] of foldButtons) if (!ids.has(id)) {button.remove(); foldButtons.delete(id);}
        for (const {script, y} of placements) {
            let button = foldButtons.get(script.id);
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.dataset.scriptFoldToggle = script.id;
                button.addEventListener('click', event => {event.stopPropagation(); setFold([script.id]);});
                button.addEventListener('pointerdown', event => event.stopPropagation());
                foldButtons.set(script.id, button);
                foldStrip.append(button);
            }
            const block = target?.blocks._blocks[script.id];
            const folded = isFoldedDefinition(block);
            const label = japanese() ? (folded ? '折りたたみを解除' : '折りたたむ') : (folded ? 'Unfold script' : 'Fold script');
            const top = `${y * scale}px`;
            if (button.style.top !== top) button.style.top = top;
            const symbol = folded ? '▶' : '▼';
            if (button.textContent !== symbol) button.textContent = symbol;
            const disabled = !block || Boolean(canShowBlock && !canShowBlock());
            if (button.disabled !== disabled) button.disabled = disabled;
            if (button.title !== label) {
                button.setAttribute('aria-label', label);
                button.setAttribute('aria-expanded', String(!folded));
                button.title = label;
            }
        }
    }

    function foldOptions() {
        const target = relationContext?.getTarget();
        const runtime = relationContext?.vm?.runtime as {emitProjectChanged?(): void} | undefined;
        if (view === 'free' || !target || !runtime?.emitProjectChanged || (canShowBlock && !canShowBlock())) return [];
        const roots = readScripts(workspace).map(script => target.blocks._blocks[script.id]).filter(Boolean);
        const options = [
            {value: true, text: japanese() ? 'すべて折りたたむ' : 'Fold all'},
            {value: false, text: japanese() ? '折りたたみをすべて解除' : 'Unfold all'}
        ];
        return options.map(({value, text}) => ({text,
            enabled: roots.some(block => isFoldedDefinition(block) !== value),
            callback() {setFold(readScripts(workspace).map(script => script.id), value);}
        }));
    }

    function labels() {
        const choice = choices.find(choice => choice.view === view);
        surface.setAttribute('aria-label', japanese() ? choice.jaLabel : choice.label);
    }

    const menu = attachScriptViewMenu(ScratchBlocks, workspace, host, surface, target =>
        view === 'free' ? !hasWorkspaceMenu() && (target === host || target.closest('.blocklyMainBackground') !== null) :
            surface.contains(target) && !target.closest('[data-script-view-block]'),
    () => {
        const ja = japanese();
        return {
            label: ja ? 'コードの並びの見え方を変更する' : 'Change code layout view',
            options: [...foldOptions(), ...(view === 'free' && semanticLayout && relationContext ? [{
                text: ja ? 'スクリプトを意味に応じて再配置する' : 'Rearrange scripts by relationships',
                enabled: semanticLayout.canArrange(),
                callback() {
                    if (view !== 'free' || !semanticLayout.canArrange()) return;
                    semanticDialog?.close();
                    semanticDialog = openSemanticLayout({workspace, relations: relationContext, ...semanticLayout,
                        canArrange: () => view === 'free' && semanticLayout.canArrange()}, getLocale());
                }
            }] : [])],
            choices: choices.map(choice => ({
                text: ja ? choice.jaLabel : choice.label,
                enabled: true,
                checked: choice.view === view,
                callback: () => chooseView(choice.view)
            }))
        };
    });

    function render() {
        frame = undefined;
        labels();
        if (view === 'free') return;
        const {left, right, top} = svg.getBoundingClientRect();
        const toolbox = injection.querySelector(':scope > .blocklyToolboxDiv');
        const bounds = toolbox?.getBoundingClientRect();
        const horizontal = toolbox?.hasAttribute('data-horizontal-block-palette');
        const scale = workspace.scale || 1;
        const scripts = readScripts(workspace).map(script => {
            // Include raised hats and labels, and exclude folded bodies, when measuring the visible gap.
            const box = (script.root as SVGGraphicsElement).getBBox();
            return {...script, x: script.origin.x + box.x, y: script.origin.y + box.y,
                width: box.width, height: box.height};
        });
        const placements = arrangeScripts(scripts, view, 'vertical', Math.max(64, 48 / scale))
            // Leave room for incoming arrowheads and return paths beside the fixed fold gutter.
            .map(placement => ({...placement, x: placement.x + 40 / scale}));
        const topInset = bounds && horizontal ? Math.max(0, bounds.bottom - top) : 0;
        const leftInset = bounds && !horizontal && bounds.left <= left + 2 ? bounds.width : 0;
        const rightInset = bounds && !horizontal && bounds.right >= right - 2 ? bounds.width : 0;
        for (const overlay of [surface, gutter]) {
            overlay.style.setProperty('--tw-script-view-top', `${topInset}px`);
            overlay.style.setProperty('--tw-script-view-left', `${leftInset}px`);
        }
        surface.style.setProperty('--tw-script-view-right', `${rightInset}px`);
        const projectedSvg = paintScripts(contents, placements, scale, rebuildProjection ? undefined : projection?.svg);
        projection = {surface, svg: projectedSvg, progressive: view === 'z'};
        rebuildProjection = false;
        paintFoldButtons(placements, scale);
        relations?.setProjection(projectedSvg, view === 'z');
        setScriptProjection(workspace, projection);
    }

    function update() {
        rebuildProjection = true;
        schedule();
    }

    function schedule() {
        if (view === 'free' || frame !== undefined) return;
        frame = window.requestAnimationFrame(render);
    }

    function setView(next: ScriptView) {
        menu.close();
        editor?.dispose();
        editor = undefined;
        observer.disconnect();
        view = next;
        surface.hidden = view === 'free';
        gutter.hidden = view === 'free';
        foldStrip.style.removeProperty('transform');
        svg.toggleAttribute('data-script-serial', view !== 'free');
        labels();
        if (view === 'free') {
            projection = undefined;
            setScriptProjection(workspace);
            relations?.setProjection(null);
            contents.replaceChildren();
            foldStrip.replaceChildren();
            foldButtons.clear();
        }
        else {
            observer.observe(canvas, {attributes: true, attributeOldValue: true, childList: true, subtree: true});
            surface.scrollTo(0, 0);
            update();
        }
    }

    function chooseView(next: ScriptView) {
        setView(next);
        onChange?.(next);
    }

    surface.addEventListener('click', event => {
        event.stopPropagation();
        const id = (event.target as Element).closest('[data-script-view-block]')?.getAttribute('data-script-view-block');
        if (!id || (canShowBlock && !canShowBlock())) return;
        if (relationContext?.vm) {
            editor?.dispose();
            editor = openSerialScriptEditor(relationContext.vm, relationContext.getTarget(), id, document, getLocale());
            if (editor) return;
        }
        if (!canShowBlock?.()) return;
        chooseView('free');
        workspace.centerOnBlock(id);
    });
    const resize = new window.ResizeObserver(entries => {
        for (const {target, contentRect} of entries) {
            if (target === surface) {
                // The content box excludes the scrollbar. Use the layout already observed by the browser.
                gutter.style.height = `${contentRect.height}px`;
            } else update();
        }
    });
    resize.observe(host);
    resize.observe(surface);
    const language = new window.MutationObserver(() => {labels(); update();});
    language.observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
    // The Blockly keyboard listener is document-wide.
    surface.addEventListener('keydown', event => {
        if (event.key !== 'Tab') event.stopPropagation();
    });
    gutter.addEventListener('keydown', event => {
        if (event.key !== 'Tab') event.stopPropagation();
    });
    host.append(surface, gutter);
    surface.addEventListener('scroll', () => {
        const transform = `translateY(${-surface.scrollTop}px)`;
        if (foldStrip.style.transform !== transform) foldStrip.style.transform = transform;
        if (view !== 'free' && projection) setScriptProjection(workspace, projection);
    }, {passive: true});
    setView(initialView);
    return {
        update,
        relations,
        labels,
        get view() { return view; },
        setView,
        dispose() {
            semanticDialog?.close();
            editor?.dispose();
            setScriptProjection(workspace);
            restoreZoomRange();
            resize.disconnect();
            observer.disconnect();
            language.disconnect();
            if (frame !== undefined) window.cancelAnimationFrame(frame);
            menu.dispose();
            relations?.dispose();
            surface.remove();
            gutter.remove();
            foldButtons.clear();
            svg.removeAttribute('data-script-serial');
        }
    };
}

interface DockedScriptLayoutOptions {
    vm: {editingTarget?: object; runtime?: {getEditingTarget(): unknown}};
    workspace: LayoutWorkspace & ScriptViewMenuWorkspace & {
        options: {readOnly: boolean};
    };
    ScratchBlocks: ScriptViewMenuBlocks & {Events: RearrangementContext['events']; getMainWorkspace(): unknown};
    canUse(): boolean;
    locale: string;
    /** The host's elements around the workspace. Without them, the workspace's own element is the surface. */
    presentationElements?: PresentationElements | null;
}

const dockedViews = new WeakMap<object, ReturnType<typeof attachDockedScriptLayout>>();
const relationVisibilities = new WeakMap<object, ScriptRelationVisibility>();

export function getDockedRelationVisibility(vm: object): ScriptRelationVisibility {
    return {...relationVisibilities.get(vm) ?? {function: true, message: true}};
}

export function setDockedRelationVisibility(vm: object, visibility: ScriptRelationVisibility) {
    relationVisibilities.set(vm, {...visibility});
    dockedViews.get(vm)?.view.relations?.setVisibility(visibility);
}

export function getDockedScriptLayout(vm: object) {
    return dockedViews.get(vm);
}

export function attachDockedScriptLayout({vm, workspace, ScratchBlocks, canUse, locale, presentationElements}: DockedScriptLayoutOptions) {
    const injection = workspace.getInjectionDiv();
    const {wrapper, extensionButton, watermark} = presentationElements?.(injection) ?? {};
    const host = wrapper?.parentElement ?? injection;
    // The stylesheet hides these on a hover surface and in an inactive split view by these marks.
    watermark?.setAttribute('data-code-watermark', '');
    extensionButton?.setAttribute('data-code-extension-button', '');
    const canArrange = () => {
        const group = host.closest('.dv-groupview');
        // The last sprite's workspace can stay visible when a stage or document group is active.
        return Boolean(vm.editingTarget && vm.runtime?.getEditingTarget() === vm.editingTarget &&
            canUse() && workspace.isVisible() && !workspace.isDragging() && !workspace.options.readOnly &&
            ScratchBlocks.getMainWorkspace() === workspace && !host.closest('[hidden], [inert]') &&
            (!group || group.classList.contains('dv-active-group')));
    };
    const view = attachScriptView({workspace, ScratchBlocks, getLocale: () => injection.ownerDocument.documentElement.lang || locale,
        canShowBlock: canArrange, semanticLayout: {events: ScratchBlocks.Events, canArrange},
        relations: {vm: vm as ScriptRelationContext['vm'],
            getTarget: () => vm.editingTarget as ReturnType<ScriptRelationContext['getTarget']>,
            initialVisibility: getDockedRelationVisibility(vm)}});
    host.setAttribute('data-code-hover-surface', '');
    let dialog: ReturnType<typeof openRearrangement> | undefined;
    const attachment = {
        view,
        canArrange,
        open(locale: string) {
            if (!canArrange()) return;
            dialog?.close();
            dialog = openRearrangement({workspace, events: ScratchBlocks.Events, canArrange, target: () => vm.editingTarget}, locale);
        },
        dispose() {
            dialog?.close();
            view.dispose();
            host.removeAttribute('data-code-hover-surface');
            watermark?.removeAttribute('data-code-watermark');
            extensionButton?.removeAttribute('data-code-extension-button');
            if (dockedViews.get(vm) === attachment) dockedViews.delete(vm);
        }
    };
    dockedViews.set(vm, attachment);
    return attachment;
}
