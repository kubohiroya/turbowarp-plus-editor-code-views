import {arrangeScripts} from './script-layout.ts';
import {paintScripts, readScripts, type LayoutWorkspace} from './script-layout-workspace.ts';
import {openRearrangement, type RearrangementContext} from './script-layout-dialog.ts';
import {attachScriptViewMenu, type ScriptViewMenuBlocks, type ScriptViewMenuWorkspace} from './script-view-menu.ts';
import type {PresentationElements} from './preview-chrome.ts';
import {attachScriptArrows, type ScriptRelationContext, type ScriptRelationVisibility} from './script-arrows.ts';
import {attachCodeZoomRange} from './code-zoom.ts';
import {setScriptProjection} from './script-projection.ts';
import {openSerialScriptEditor} from './serial-script-editor.ts';
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
}

const choices = [
    {view: 'free', label: 'Normal layout view', jaLabel: '通常配置の見え方'},
    {view: 'z', label: 'Z layout view', jaLabel: 'Z配置の見え方'},
    {view: 'n', label: 'N layout view', jaLabel: 'N配置の見え方'}
] as const;

export function attachScriptView({
    workspace, ScratchBlocks, getLocale, mount, initialView = 'free', canShowBlock, onChange, hasWorkspaceMenu = () => true,
    relations: relationContext
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
    const foldButtons = new Map<string, {button: HTMLButtonElement; top: number}>();
    let view = initialView;
    let editor: ReturnType<typeof openSerialScriptEditor>;
    let frame: number | undefined;
    const svg = workspace.getParentSvg();
    const observer = new window.MutationObserver(records => {
        if (records.some(record => !(record.target as Element).closest?.('[data-script-relation-layer]'))) update();
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

    function positionFoldButtons() {
        gutter.style.left = `${surface.offsetLeft}px`;
        gutter.style.top = `${surface.offsetTop}px`;
        gutter.style.height = `${surface.clientHeight}px`;
        for (const {button, top} of foldButtons.values()) button.style.top = `${top - surface.scrollTop}px`;
    }

    function paintFoldButtons(placements: ReturnType<typeof arrangeScripts>, scale: number) {
        const target = relationContext?.getTarget();
        const ids = new Set(placements.map(({script}) => script.id));
        for (const [id, {button}] of foldButtons) if (!ids.has(id)) {button.remove(); foldButtons.delete(id);}
        for (const {script, y} of placements) {
            let entry = foldButtons.get(script.id);
            if (!entry) {
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.scriptFoldToggle = script.id;
                button.addEventListener('click', event => {event.stopPropagation(); setFold([script.id]);});
                button.addEventListener('pointerdown', event => event.stopPropagation());
                entry = {button, top: 0};
                foldButtons.set(script.id, entry);
                gutter.append(button);
            }
            const block = target?.blocks._blocks[script.id];
            const folded = isFoldedDefinition(block);
            const label = japanese() ? (folded ? '折りたたみを解除' : '折りたたむ') : (folded ? 'Unfold script' : 'Fold script');
            entry.top = y * scale;
            entry.button.textContent = folded ? '▶' : '▼';
            entry.button.disabled = !block || Boolean(canShowBlock && !canShowBlock());
            entry.button.setAttribute('aria-label', label);
            entry.button.setAttribute('aria-expanded', String(!folded));
            entry.button.title = label;
        }
        positionFoldButtons();
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
            options: foldOptions(),
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
        if (toolbox) {
            const bounds = toolbox.getBoundingClientRect();
            const horizontal = toolbox.hasAttribute('data-horizontal-block-palette');
            surface.style.setProperty('--tw-script-view-top', horizontal ? `${Math.max(0, bounds.bottom - top)}px` : '0px');
            surface.style.setProperty('--tw-script-view-left', !horizontal && bounds.left <= left + 2 ? `${bounds.width}px` : '0px');
            surface.style.setProperty('--tw-script-view-right', !horizontal && bounds.right >= right - 2 ? `${bounds.width}px` : '0px');
        }
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
        paintScripts(contents, placements, scale);
        paintFoldButtons(placements, scale);
        const projection = contents.querySelector('svg');
        relations?.setProjection(projection);
        setScriptProjection(workspace, {surface, svg: projection});
    }

    function update() {
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
        svg.toggleAttribute('data-script-serial', view !== 'free');
        labels();
        if (view === 'free') {
            setScriptProjection(workspace);
            relations?.setProjection(null);
            contents.replaceChildren();
            gutter.replaceChildren();
            foldButtons.clear();
        }
        else {
            observer.observe(workspace.getCanvas(), {attributes: true, childList: true, subtree: true});
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
    const resize = new window.ResizeObserver(update);
    resize.observe(host);
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
        positionFoldButtons();
        const projection = contents.querySelector('svg');
        if (view !== 'free' && projection) setScriptProjection(workspace, {surface, svg: projection});
    }, {passive: true});
    setView(initialView);
    return {
        update,
        relations,
        labels,
        get view() { return view; },
        setView,
        dispose() {
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
        canShowBlock: canArrange, relations: {vm: vm as ScriptRelationContext['vm'],
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
